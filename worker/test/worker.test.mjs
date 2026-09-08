// Worker tests. Runs the real schema and the real handler against an in-memory
// SQLite behind a small D1 shim, so the SQL is exercised rather than mocked.
//
//   npm test        (from worker/)
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = "https://openkanji.test";

// --- D1 shim: prepare().bind().first()/run(), the surface the worker uses ---
function d1(db) {
  return {
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a; return stmt; },
        first() {
          const rows = db.prepare(sql).all(...args);
          return rows.length ? { ...rows[0] } : null;
        },
        run() { return { success: true, ...db.prepare(sql).run(...args) }; },
        all() { return { success: true, results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }; },
      };
      return stmt;
    },
  };
}

function makeEnv() {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = on");
  db.exec(readFileSync(join(HERE, "..", "schema.sql"), "utf8"));
  const sent = [];
  return {
    _db: db,
    _sent: sent,
    DB: d1(db),
    EMAIL: { send: async (m) => { sent.push(m); } },
    SESSION_SECRET: "test-secret-abcdefghijklmnopqrstuvwxyz",
    MAIL_FROM: "login@openkanji.test",
    SITE_URL: SITE,
    // The AI route: a key that is never sent anywhere, and a fetch that plays
    // DeepSeek's chat-completions endpoint, so the call is exercised without
    // the network.
    DEEPSEEK_API_KEY: "sk-deepseek-test",
    AI_PER_HOUR: "3",
    _ai: [],
  };
}
const aiStub = (env, text = '{"c":["味"]}') => {
  env.AI_FETCH = async (url, init) => {
    env._ai.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      id: "chat_test", object: "chat.completion", model: "deepseek-v4-flash",
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
};

// The report form: a token that never leaves the Worker, and a fetch that
// plays GitHub's issues endpoint, so the call is exercised without the network.
const ghStub = (env, status = 201) => {
  env.GITHUB_TOKEN = "ghp-test";
  env.ISSUE_REPO = "nickgreengithub/openkanji";
  env._gh = [];
  env.GITHUB_FETCH = async (url, init) => {
    env._gh.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    if (status !== 201) return new Response("no", { status });
    return new Response(JSON.stringify({ number: 42, html_url: "https://github.com/nickgreengithub/openkanji/issues/42" }),
      { status: 201, headers: { "content-type": "application/json" } });
  };
  return env;
};

const call = (env, method, path, { body, cookie, ip } = {}) => {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  headers["cf-connecting-ip"] = ip || "203.0.113.7";
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return worker.fetch(new Request(SITE + path, init), env);
};

const cookieOf = (res) => (res.headers.get("set-cookie") || "").split(";")[0];
const tokenFrom = (env) => new URL(env._sent.at(-1).text.split("\n").find((l) => l.startsWith("http"))).searchParams.get("token");

let pass = 0;
const results = [];
async function test(name, fn) {
  try {
    await fn();
    pass++;
    results.push("  ok   " + name);
  } catch (e) {
    results.push("  FAIL " + name + "\n       " + (e && e.message));
    process.exitCode = 1;
  }
}

// --- sign-in ---

await test("rejects a malformed email", async () => {
  const env = makeEnv();
  const r = await call(env, "POST", "/api/login", { body: { email: "nope" } });
  assert.equal(r.status, 400);
  assert.equal(env._sent.length, 0);
});

await test("sends a link and stores only its hash", async () => {
  const env = makeEnv();
  const r = await call(env, "POST", "/api/login", { body: { email: "Nick@Example.com" } });
  assert.equal(r.status, 200);
  assert.equal(env._sent.length, 1);
  assert.equal(env._sent[0].to, "nick@example.com", "address is normalised");
  const token = tokenFrom(env);
  assert.ok(token && token.length >= 40);
  const rows = env._db.prepare("select hash, email from login_tokens").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, "nick@example.com");
  assert.ok(!rows[0].hash.includes(token), "raw token must not be stored");
});

await test("sends the email in the requested language", async () => {
  const env = makeEnv();
  await call(env, "POST", "/api/login", { body: { email: "a@b.co", lang: "es" } });
  assert.match(env._sent[0].subject, /acceso/);
  await call(env, "POST", "/api/login", { body: { email: "c@d.co", lang: "en" } });
  assert.match(env._sent[1].subject, /sign-in/);
});

await test("a new address gets the welcome line, in Japanese and its own language", async () => {
  const env = makeEnv();
  await call(env, "POST", "/api/login", { body: { email: "new@example.com", lang: "en" } });
  const m = env._sent[0];
  assert.match(m.html, /さいしょのセットが待っています。/);
  assert.match(m.html, /Your first set is waiting\./);
  assert.ok(!/語おぼえました/.test(m.html), "nothing learned yet, so no count");
});

await test("a returning address gets its progress, in Japanese and its own language", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env, "back@example.com");
  await call(env, "PUT", "/api/progress", { cookie, body: { mastered: { w0001: true, w0002: true, w0003: true } } });
  env._sent.length = 0;
  await call(env, "POST", "/api/login", { body: { email: "back@example.com", lang: "es" }, ip: "203.0.113.9" });
  const m = env._sent[0];
  assert.match(m.html, /これまでに3語おぼえました。/);
  assert.match(m.html, /がんばってください！/, "and a word of encouragement after it");
  assert.match(m.html, /3 palabras aprendidas hasta ahora\./);
  assert.match(m.text, /これまでに3語おぼえました。/, "the plain part carries it too");
});

await test("one word learned reads as one, not as a plural", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env, "solo@example.com");
  await call(env, "PUT", "/api/progress", { cookie, body: { mastered: { w0001: true } } });
  env._sent.length = 0;
  await call(env, "POST", "/api/login", { body: { email: "solo@example.com", lang: "en" }, ip: "203.0.113.8" });
  assert.match(env._sent[0].html, /1 word learned so far\./);
});

await test("rate limits per email", async () => {
  const env = makeEnv();
  for (let i = 0; i < 5; i++) {
    const r = await call(env, "POST", "/api/login", { body: { email: "spam@example.com" }, ip: "1.1.1." + i });
    assert.equal(r.status, 200, "request " + i + " should pass");
  }
  const r = await call(env, "POST", "/api/login", { body: { email: "spam@example.com" }, ip: "1.1.1.9" });
  assert.equal(r.status, 429);
  assert.equal(env._sent.length, 5, "no mail sent once limited");
});

await test("rate limits per IP across different addresses", async () => {
  const env = makeEnv();
  for (let i = 0; i < 20; i++) {
    const r = await call(env, "POST", "/api/login", { body: { email: "u" + i + "@example.com" }, ip: "198.51.100.4" });
    assert.equal(r.status, 200, "request " + i + " should pass");
  }
  const r = await call(env, "POST", "/api/login", { body: { email: "u99@example.com" }, ip: "198.51.100.4" });
  assert.equal(r.status, 429);
});

// --- callback ---

async function signedIn(env, email = "nick@example.com") {
  await call(env, "POST", "/api/login", { body: { email } });
  const res = await call(env, "GET", "/api/callback?token=" + encodeURIComponent(tokenFrom(env)));
  return cookieOf(res);
}

await test("callback signs in, sets an HttpOnly cookie and redirects", async () => {
  const env = makeEnv();
  await call(env, "POST", "/api/login", { body: { email: "nick@example.com" } });
  const res = await call(env, "GET", "/api/callback?token=" + encodeURIComponent(tokenFrom(env)));
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), SITE + "/#signed-in");
  const sc = res.headers.get("set-cookie");
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /Secure/);
  assert.match(sc, /SameSite=Lax/);
  assert.equal(env._db.prepare("select count(*) as n from users").get().n, 1);
});

await test("a link works only once", async () => {
  const env = makeEnv();
  await call(env, "POST", "/api/login", { body: { email: "nick@example.com" } });
  const token = tokenFrom(env);
  const first = await call(env, "GET", "/api/callback?token=" + encodeURIComponent(token));
  assert.equal(first.headers.get("location"), SITE + "/#signed-in");
  const second = await call(env, "GET", "/api/callback?token=" + encodeURIComponent(token));
  assert.equal(second.headers.get("location"), SITE + "/#sign-in-failed");
  assert.equal(second.headers.get("set-cookie"), null);
});

await test("an expired link is refused", async () => {
  const env = makeEnv();
  await call(env, "POST", "/api/login", { body: { email: "nick@example.com" } });
  const token = tokenFrom(env);
  env._db.prepare("update login_tokens set expires_at = ?").run(Math.floor(Date.now() / 1000) - 60);
  const res = await call(env, "GET", "/api/callback?token=" + encodeURIComponent(token));
  assert.equal(res.headers.get("location"), SITE + "/#sign-in-failed");
});

await test("an unknown token is refused", async () => {
  const env = makeEnv();
  const res = await call(env, "GET", "/api/callback?token=made-up");
  assert.equal(res.headers.get("location"), SITE + "/#sign-in-failed");
});

await test("signing in twice reuses the same account", async () => {
  const env = makeEnv();
  await signedIn(env);
  await signedIn(env);
  assert.equal(env._db.prepare("select count(*) as n from users").get().n, 1);
});

// --- session ---

await test("rejects progress requests with no cookie", async () => {
  const env = makeEnv();
  assert.equal((await call(env, "GET", "/api/progress")).status, 401);
  assert.equal((await call(env, "PUT", "/api/progress", { body: { mastered: {} } })).status, 401);
  assert.equal((await call(env, "DELETE", "/api/account")).status, 401);
});

// The app asks this on every page load; an error there would be console noise
// on a first visit, so signed-out is a normal answer.
await test("me answers 200 with a null email when signed out", async () => {
  const env = makeEnv();
  const r = await call(env, "GET", "/api/me");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).email, null);
});

await test("rejects a tampered cookie", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env);
  const [name, value] = cookie.split("=");
  const [payload, sig] = value.split(".");
  // Re-sign nothing: swap the payload for one claiming another user id.
  const forged = Buffer.from(JSON.stringify({ u: 999, e: Math.floor(Date.now() / 1000) + 999 })).toString("base64url");
  const rejected = async (c) => (await (await call(env, "GET", "/api/me", { cookie: c })).json()).email === null;
  assert.ok(await rejected(name + "=" + forged + "." + sig), "forged payload");
  assert.ok(await rejected(name + "=" + payload + ".AAAA"), "forged signature");
  assert.ok(await rejected(name + "=garbage"), "malformed cookie");
  assert.equal((await call(env, "GET", "/api/progress", { cookie: name + "=" + forged + "." + sig })).status, 401);
});

await test("a cookie from another secret is refused", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env);
  const other = { ...env, SESSION_SECRET: "a-completely-different-secret-value" };
  assert.equal((await call(other, "GET", "/api/progress", { cookie })).status, 401);
});

await test("me returns the address", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env, "learner@example.com");
  const r = await call(env, "GET", "/api/me", { cookie });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).email, "learner@example.com");
});

await test("the updates flag starts off and round-trips", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env);
  assert.equal((await (await call(env, "GET", "/api/me", { cookie })).json()).updates, false);
  assert.equal((await call(env, "PUT", "/api/updates", { cookie, body: { on: true } })).status, 200);
  assert.equal((await (await call(env, "GET", "/api/me", { cookie })).json()).updates, true);
  assert.equal((await call(env, "PUT", "/api/updates", { cookie, body: { on: false } })).status, 200);
  assert.equal((await (await call(env, "GET", "/api/me", { cookie })).json()).updates, false);
});

await test("updates needs a session", async () => {
  const env = makeEnv();
  assert.equal((await call(env, "PUT", "/api/updates", { body: { on: true } })).status, 401);
});

await test("a database made before the updates column gets it on first use", async () => {
  const env = makeEnv();
  env._db.exec("drop table users");
  env._db.exec("create table users (id integer primary key autoincrement, email text not null unique, created_at integer not null)");
  const cols0 = env._db.prepare("select name from pragma_table_info('users')").all().map(r => r.name);
  assert.ok(!cols0.includes("updates"), "starts without the column");

  const cookie = await signedIn(env);
  assert.equal((await call(env, "PUT", "/api/updates", { cookie, body: { on: true } })).status, 200);
  const cols1 = env._db.prepare("select name from pragma_table_info('users')").all().map(r => r.name);
  assert.ok(cols1.includes("updates"), "and has it afterwards");
  assert.equal((await (await call(env, "GET", "/api/me", { cookie })).json()).updates, true);
});

// --- reporting a problem ---

await test("a signed-in reader reports a problem", async () => {
  const env = ghStub(makeEnv());
  const cookie = await signedIn(env, "reader@example.com");
  const r = await call(env, "POST", "/api/issue", { cookie, body: { title: "Audio stops", text: "The clip cuts off on set three." } });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.number, 42);
  assert.match(out.url, /\/issues\/42$/);
  assert.equal(env._gh[0].url, "https://api.github.com/repos/nickgreengithub/openkanji/issues");
  assert.equal(env._gh[0].body.title, "Audio stops");
  assert.match(env._gh[0].body.body, /^The clip cuts off on set three\./);
});

await test("a problem and a suggestion are told apart by their labels", async () => {
  const env = ghStub(makeEnv());
  const cookie = await signedIn(env);
  await call(env, "POST", "/api/issue", { cookie, body: { title: "t", text: "a report long enough" } });
  assert.deepEqual(env._gh[0].body.labels, ["in-app", "bug"], "a problem by default");
  await call(env, "POST", "/api/issue", { cookie, body: { title: "t", text: "an idea long enough", kind: "idea" } });
  assert.deepEqual(env._gh[1].body.labels, ["in-app", "suggestion"]);
});

await test("reporting needs an account, because an answer needs somewhere to go", async () => {
  const env = ghStub(makeEnv());
  const r = await call(env, "POST", "/api/issue", { body: { title: "t", text: "a report long enough" } });
  assert.equal(r.status, 401);
  assert.equal(env._gh.length, 0);
});

await test("the token never leaves the Worker, and GitHub is told who is calling", async () => {
  const env = ghStub(makeEnv());
  const cookie = await signedIn(env);
  const r = await call(env, "POST", "/api/issue", { cookie, body: { title: "t", text: "something long enough" } });
  const seen = JSON.stringify(await r.json());
  assert.ok(!seen.includes("ghp-test"), "the reply carries no token");
  assert.equal(env._gh[0].headers.authorization, "Bearer ghp-test");
  assert.ok(env._gh[0].headers["user-agent"], "a user-agent, which GitHub insists on");
});

await test("the reporter's address is kept here, and never sent to GitHub", async () => {
  const env = ghStub(makeEnv());
  const cookie = await signedIn(env, "reader@example.com");
  await call(env, "POST", "/api/issue", { cookie, body: { title: "t", text: "a report long enough" } });
  assert.ok(!JSON.stringify(env._gh[0].body).includes("reader@example.com"), "the issue does not carry it");
  const row = env._db.prepare("select email from issue_watch where number = 42").get();
  assert.equal(row.email, "reader@example.com", "but we know where to write");
});

await test("hearing back is the default, and saying no keeps no row", async () => {
  const env = ghStub(makeEnv());
  const cookie = await signedIn(env);
  const on = await (await call(env, "POST", "/api/issue", { cookie, body: { title: "t", text: "a report long enough" } })).json();
  assert.equal(on.notify, true);
  env._db.exec("delete from issue_watch");
  const off = await (await call(env, "POST", "/api/issue", { cookie, body: { title: "t", text: "a report long enough", notify: false } })).json();
  assert.equal(off.notify, false);
  assert.equal(env._db.prepare("select count(*) as n from issue_watch").get().n, 0);
});

await test("what the page says about itself is a footer, and cannot be more", async () => {
  const env = ghStub(makeEnv());
  const cookie = await signedIn(env);
  await call(env, "POST", "/api/issue", { cookie, body: {
    title: "Bad", text: "a real report here",
    version: "0.1\n\n# not a heading", agent: "Mozilla/5.0 <script>x</script>",
  } });
  const body = env._gh[0].body.body;
  const foot = body.slice(body.indexOf("---"));
  assert.ok(!foot.includes("\n# "), "no newline smuggled into the footer");
  assert.ok(!foot.includes("<script>"), "and no markup");
  assert.match(foot, /Reported from the app/);
});

await test("an empty or enormous report is refused", async () => {
  const env = ghStub(makeEnv());
  const cookie = await signedIn(env);
  assert.equal((await call(env, "POST", "/api/issue", { cookie, body: { title: "", text: "long enough to pass" } })).status, 400);
  assert.equal((await call(env, "POST", "/api/issue", { cookie, body: { title: "t", text: "short" } })).status, 400);
  assert.equal((await call(env, "POST", "/api/issue", { cookie, body: { title: "t", text: "x".repeat(4001) } })).status, 413);
  assert.equal((await call(env, "POST", "/api/issue", { cookie, body: { title: "t".repeat(121), text: "long enough to pass" } })).status, 413);
  assert.equal(env._gh.length, 0, "none of them reached GitHub");
});

await test("one account cannot fill the tracker", async () => {
  const env = ghStub(makeEnv());
  const cookie = await signedIn(env);
  const one = () => call(env, "POST", "/api/issue", { cookie, body: { title: "t", text: "a report long enough" } });
  for (let i = 0; i < 3; i++) assert.equal((await one()).status, 200);
  assert.equal((await one()).status, 429);
  assert.equal(env._gh.length, 3);
});

await test("a database carrying the old by-address meter still takes reports", async () => {
  // The live shape before the meter moved from addresses to accounts. "create
  // table if not exists" leaves it alone, so an insert naming the new column
  // would fail against it -- which is exactly what shipped, and what put
  // "Could not send it" in front of a reader.
  const env = ghStub(makeEnv());
  env._db.exec("create table issue_usage (ip text not null, hour integer not null, n integer not null default 0, primary key (ip, hour))");
  const cookie = await signedIn(env);
  const r = await call(env, "POST", "/api/issue", { cookie, body: { title: "t", text: "a report long enough" } });
  assert.equal(r.status, 200, "the report still lands");
  assert.equal(env._db.prepare("select count(*) as n from issue_meter").get().n, 1);
});

await test("with no token configured the form says so rather than failing oddly", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env);
  const r = await call(env, "POST", "/api/issue", { cookie, body: { title: "t", text: "a report long enough" } });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "not_configured");
});

await test("a token GitHub refuses reads as not configured too", async () => {
  const env = ghStub(makeEnv(), 401);
  const cookie = await signedIn(env);
  const r = await call(env, "POST", "/api/issue", { cookie, body: { title: "t", text: "a report long enough" } });
  assert.equal(r.status, 503);
});

// --- hearing back ---

const HOOK_SECRET = "hook-secret-abcdefghijklmnop";
const hookCall = async (env, event, payload) => {
  const raw = JSON.stringify(payload);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(HOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return worker.fetch(new Request(SITE + "/api/gh-hook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-github-event": event, "x-hub-signature-256": "sha256=" + sig },
    body: raw,
  }), env);
};
const reported = async (env, email = "reader@example.com") => {
  const cookie = await signedIn(env, email);
  await call(env, "POST", "/api/issue", { cookie, body: { title: "Audio stops", text: "The clip cuts off." } });
  env._sent.length = 0;
  return cookie;
};

await test("a reply on the issue reaches the reader who asked for it", async () => {
  const env = ghStub(makeEnv());
  env.GH_WEBHOOK_SECRET = HOOK_SECRET;
  await reported(env);
  const r = await hookCall(env, "issue_comment", {
    action: "created",
    issue: { number: 42, title: "Audio stops", html_url: "https://github.com/x/y/issues/42" },
    comment: { body: "Fixed in the next deploy." },
  });
  assert.equal(r.status, 200);
  const told = await r.json();
  assert.equal(told.told, true);
  assert.equal(told.to, "r***@example.com", "who it went to, without printing an address into a public log");
  assert.equal(env._sent.length, 1);
  assert.equal(env._sent[0].to, "reader@example.com");
  assert.match(env._sent[0].subject, /#42/);
  assert.match(env._sent[0].text, /Fixed in the next deploy/);
  // A reply written to this address would be neither read nor private
  assert.match(env._sent[0].text, /Replies to this address are not read/);
  assert.match(env._sent[0].text, /anyone can see/);
  assert.match(env._sent[0].html, /Reply on GitHub/);
});

await test("closing it is news too, and nothing else is", async () => {
  const env = ghStub(makeEnv());
  env.GH_WEBHOOK_SECRET = HOOK_SECRET;
  await reported(env);
  const skip = await (await hookCall(env, "issues", { action: "labeled", issue: { number: 42, title: "t", html_url: "u" } })).json();
  assert.equal(env._sent.length, 0, "a label is not news");
  // the delivery page is where this gets diagnosed, so the line says enough
  assert.equal(skip.saw, "issues.labeled #42");
  assert.match(skip.wants, /issue_comment\.created/);
  await hookCall(env, "issues", { action: "closed", issue: { number: 42, title: "t", html_url: "u" } });
  assert.equal(env._sent.length, 1);
  assert.match(env._sent[0].subject, /closed/i);
});

await test("an issue nobody asked about sends nothing", async () => {
  const env = ghStub(makeEnv());
  env.GH_WEBHOOK_SECRET = HOOK_SECRET;
  await reported(env);
  await hookCall(env, "issue_comment", { action: "created", issue: { number: 999, title: "t", html_url: "u" }, comment: { body: "hi" } });
  assert.equal(env._sent.length, 0);
});

await test("a hook that is not signed by GitHub is refused unread", async () => {
  const env = ghStub(makeEnv());
  env.GH_WEBHOOK_SECRET = HOOK_SECRET;
  await reported(env);
  const r = await worker.fetch(new Request(SITE + "/api/gh-hook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-github-event": "issue_comment", "x-hub-signature-256": "sha256=" + "0".repeat(64) },
    body: JSON.stringify({ action: "created", issue: { number: 42, title: "t", html_url: "u" }, comment: { body: "hi" } }),
  }), env);
  assert.equal(r.status, 401);
  assert.equal(env._sent.length, 0);
});

await test("the link in the mail stops them, and only for that report", async () => {
  const env = ghStub(makeEnv());
  env.GH_WEBHOOK_SECRET = HOOK_SECRET;
  await reported(env);
  await hookCall(env, "issue_comment", { action: "created", issue: { number: 42, title: "t", html_url: "u" }, comment: { body: "hi" } });
  const stop = env._sent[0].text.match(/https?:\S*issue-stop\?t=[^\s]+/)[0];
  const bad = await worker.fetch(new Request(stop.replace(/t=./, "t=9")), env);
  assert.equal(bad.status, 200, "a forged link answers, but");
  assert.equal(env._db.prepare("select count(*) as n from issue_watch").get().n, 1, "changes nothing");
  const good = await worker.fetch(new Request(stop), env);
  assert.equal(good.status, 200);
  assert.equal(env._db.prepare("select count(*) as n from issue_watch").get().n, 0);
  env._sent.length = 0;
  await hookCall(env, "issue_comment", { action: "created", issue: { number: 42, title: "t", html_url: "u" }, comment: { body: "more" } });
  assert.equal(env._sent.length, 0, "and no more mail");
});

// --- and without a webhook at all: the Worker asks ---

// GitHub's API, played by a stub: the comments endpoint, the closed issues,
// and an issue by number for its title.
const pollStub = (env, { comments = [], closed = [] } = {}) => {
  env.GITHUB_TOKEN = "ghp-test";
  env.ISSUE_REPO = "nickgreengithub/openkanji";
  env._asked = [];
  env.GITHUB_FETCH = async (url, init) => {
    const u = String(url);
    env._asked.push(u);
    if (init && init.method === "POST") {
      return new Response(JSON.stringify({ number: 42, html_url: "https://github.com/x/y/issues/42" }), { status: 201 });
    }
    const body = /\/issues\/comments/.test(u) ? comments
      : /state=closed/.test(u) ? closed
      : { title: "Audio stops", number: 42 };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return env;
};
const watched = async (env, email = "reader@example.com") => {
  const cookie = await signedIn(env, email);
  await call(env, "POST", "/api/issue", { cookie, body: { title: "Audio stops", text: "The clip cuts off." } });
  env._sent.length = 0;
};

await test("the schedule finds a reply nobody told us about", async () => {
  const env = pollStub(makeEnv(), {
    comments: [{ id: 900, issue_url: "https://api.github.com/repos/x/y/issues/42", html_url: "https://github.com/x/y/issues/42#c900", body: "Fixed in the next deploy." }],
  });
  await watched(env);
  await worker.scheduled({}, env, null);
  assert.equal(env._sent.length, 1);
  assert.equal(env._sent[0].to, "reader@example.com");
  assert.match(env._sent[0].text, /Fixed in the next deploy/);
  assert.match(env._sent[0].subject, /#42/);
});

await test("and says it once, however many times it runs", async () => {
  const env = pollStub(makeEnv(), {
    comments: [{ id: 900, issue_url: "https://api.github.com/repos/x/y/issues/42", html_url: "u", body: "hello" }],
  });
  await watched(env);
  await worker.scheduled({}, env, null);
  await worker.scheduled({}, env, null);
  await worker.scheduled({}, env, null);
  assert.equal(env._sent.length, 1);
});

await test("a close is found the same way", async () => {
  const env = pollStub(makeEnv(), {
    closed: [{ number: 42, title: "Audio stops", html_url: "u", closed_at: "2026-09-08T00:00:00Z" }],
  });
  await watched(env);
  await worker.scheduled({}, env, null);
  assert.equal(env._sent.length, 1);
  assert.match(env._sent[0].subject, /closed/i);
});

await test("comments on issues nobody is waiting for are left alone", async () => {
  const env = pollStub(makeEnv(), {
    comments: [{ id: 901, issue_url: "https://api.github.com/repos/x/y/issues/999", html_url: "u", body: "not yours" }],
  });
  await watched(env);
  await worker.scheduled({}, env, null);
  assert.equal(env._sent.length, 0);
});

await test("with nobody waiting it does not even ask GitHub", async () => {
  const env = pollStub(makeEnv());
  await worker.scheduled({}, env, null);
  assert.equal((env._asked || []).length, 0);
  assert.equal(env._sent.length, 0);
});

await test("the webhook and the schedule cannot both mail the same comment", async () => {
  const env = pollStub(makeEnv(), {
    comments: [{ id: 900, issue_url: "https://api.github.com/repos/x/y/issues/42", html_url: "u", body: "twice?" }],
  });
  env.GH_WEBHOOK_SECRET = HOOK_SECRET;
  await watched(env);
  await hookCall(env, "issue_comment", {
    action: "created",
    issue: { number: 42, title: "t", html_url: "u" },
    comment: { id: 900, body: "twice?" },
  });
  assert.equal(env._sent.length, 1, "the webhook got there first");
  await worker.scheduled({}, env, null);
  assert.equal(env._sent.length, 1, "and the schedule left it alone");
});

await test("logout clears the cookie", async () => {
  const env = makeEnv();
  const r = await call(env, "POST", "/api/logout");
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
});

// --- progress ---

await test("progress starts empty and round-trips", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env);
  let r = await call(env, "GET", "/api/progress", { cookie });
  assert.deepEqual(await r.json(), { mastered: {}, strength: {}, deck: null, lang: null });

  r = await call(env, "PUT", "/api/progress", { cookie, body: { mastered: { w0001: true, w0226: true }, deck: "JLPT N3", lang: "ES" } });
  assert.equal(r.status, 200);

  r = await call(env, "GET", "/api/progress", { cookie });
  assert.deepEqual(await r.json(), { mastered: { w0001: true, w0226: true }, strength: {}, deck: "JLPT N3", lang: "ES" });
});

// --- strength: how well practice has found each word to be known ---

await test("strength round-trips per word", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env);
  await call(env, "PUT", "/api/progress", { cookie, body: { mastered: {}, strength: { w0001: [86, 4, 20700, 15] } } });
  const r = await call(env, "GET", "/api/progress", { cookie });
  assert.deepEqual((await r.json()).strength, { w0001: [86, 4, 20700, 15] });
});

await test("the later grading wins, even when the word got worse", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env);
  await call(env, "PUT", "/api/progress", { cookie, body: { mastered: {}, strength: { w0001: [90, 5, 20700, 31] } } });
  // a second device, a day later, having missed it
  await call(env, "PUT", "/api/progress", { cookie, body: { mastered: {}, strength: { w0001: [27, 6, 20701, 62] } } });
  let r = await call(env, "GET", "/api/progress", { cookie });
  assert.deepEqual((await r.json()).strength, { w0001: [27, 6, 20701, 62] }, "a drop must survive the merge");
  // and a stale device saving the old record does not undo it
  await call(env, "PUT", "/api/progress", { cookie, body: { mastered: {}, strength: { w0001: [90, 5, 20700, 31] } } });
  r = await call(env, "GET", "/api/progress", { cookie });
  assert.deepEqual((await r.json()).strength, { w0001: [27, 6, 20701, 62] }, "older gradings lose");
});

await test("strength from two devices joins rather than replaces", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env);
  await call(env, "PUT", "/api/progress", { cookie, body: { mastered: {}, strength: { w0001: [50, 2, 20700, 3] } } });
  await call(env, "PUT", "/api/progress", { cookie, body: { mastered: {}, strength: { w0002: [70, 3, 20700, 7] }, replace: true } });
  const got = (await (await call(env, "GET", "/api/progress", { cookie })).json()).strength;
  assert.deepEqual(got, { w0001: [50, 2, 20700, 3], w0002: [70, 3, 20700, 7] }, "replace is for mastered, not for this");
});

await test("a malformed record is dropped, not the whole save", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env);
  const r = await call(env, "PUT", "/api/progress", { cookie, body: { mastered: {}, strength: {
    w0001: [50, 2, 20700, 3],
    w0002: [500, 2, 20700, 3],        // out of range
    w0003: [50, 2, 20700],            // wrong shape
    "drop table": [50, 2, 20700, 3],  // not a word id
    w0004: "nonsense"
  } } });
  assert.equal(r.status, 200);
  assert.deepEqual((await (await call(env, "GET", "/api/progress", { cookie })).json()).strength, { w0001: [50, 2, 20700, 3] });
});

await test("a database made before the strength column gets it on first use", async () => {
  // The production path: the table exists from an earlier deploy, without the
  // column. Nothing runs a migration, so the Worker has to add it itself.
  const env = makeEnv();
  env._db.exec("drop table progress");
  env._db.exec("create table progress (user_id integer primary key references users(id) on delete cascade, mastered text not null default '{}', deck text, lang text, updated_at integer not null)");
  const cols0 = env._db.prepare("select name from pragma_table_info('progress')").all().map(r => r.name);
  assert.ok(!cols0.includes("strength"), "starts without the column");

  const cookie = await signedIn(env);
  const r = await call(env, "PUT", "/api/progress", { cookie, body: { mastered: { w0001: true }, strength: { w0001: [50, 2, 20700, 3] } } });
  assert.equal(r.status, 200);
  const cols1 = env._db.prepare("select name from pragma_table_info('progress')").all().map(r => r.name);
  assert.ok(cols1.includes("strength"), "and has it afterwards");
  const got = await (await call(env, "GET", "/api/progress", { cookie })).json();
  assert.deepEqual(got.mastered, { w0001: true });
  assert.deepEqual(got.strength, { w0001: [50, 2, 20700, 3] });
});

await test("strength is optional: an old client saves without it", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env);
  await call(env, "PUT", "/api/progress", { cookie, body: { mastered: {}, strength: { w0001: [50, 2, 20700, 3] } } });
  const r = await call(env, "PUT", "/api/progress", { cookie, body: { mastered: { w0009: true } } });
  assert.equal(r.status, 200);
  const got = (await (await call(env, "GET", "/api/progress", { cookie })).json()).strength;
  assert.deepEqual(got, { w0001: [50, 2, 20700, 3] }, "and what is already there is kept");
});

await test("a save from a device that never loaded cannot erase progress", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env);
  await call(env, "PUT", "/api/progress", { cookie, body: { mastered: { w0001: true, w0002: true }, deck: "JLPT N4", lang: "EN" } });
  // Second device knows only w0003, and picked a different deck.
  await call(env, "PUT", "/api/progress", { cookie, body: { mastered: { w0003: true }, deck: "JLPT N1", lang: "ES" } });
  const got = await (await call(env, "GET", "/api/progress", { cookie })).json();
  assert.deepEqual(got.mastered, { w0001: true, w0002: true, w0003: true }, "mastered unions");
  assert.equal(got.deck, "JLPT N1", "deck is last-write-wins");
  assert.equal(got.lang, "ES");
});

await test("a device that loaded first can replace, so un-mastering sticks", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env);
  await call(env, "PUT", "/api/progress", { cookie, body: { mastered: { w0001: true, w0002: true }, deck: "JLPT N4", lang: "EN" } });
  // Loaded, un-mastered w0002, saved with replace: the server takes the copy as given.
  await call(env, "PUT", "/api/progress", { cookie, body: { mastered: { w0001: true }, deck: "JLPT N4", lang: "EN", replace: true } });
  let got = await (await call(env, "GET", "/api/progress", { cookie })).json();
  assert.deepEqual(got.mastered, { w0001: true }, "replace does not union");
  // Anything but exactly `true` is still a union.
  await call(env, "PUT", "/api/progress", { cookie, body: { mastered: { w0003: true }, replace: "yes" } });
  got = await (await call(env, "GET", "/api/progress", { cookie })).json();
  assert.deepEqual(got.mastered, { w0001: true, w0003: true }, "a truthy non-boolean is not a replace");
});

await test("rejects keys that are not word ids", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env);
  for (const bad of [{ "'; drop table users; --": true }, { k0001: true }, { w: true }, { w12345678: true }]) {
    const r = await call(env, "PUT", "/api/progress", { cookie, body: { mastered: bad } });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal(env._db.prepare("select count(*) as n from users").get().n, 1, "table still there");
});

await test("rejects a mastered set that is not an object, or is absurd", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env);
  for (const bad of [null, "x", 12, ["w0001"]]) {
    assert.equal((await call(env, "PUT", "/api/progress", { cookie, body: { mastered: bad } })).status, 400);
  }
  const huge = {};
  for (let i = 0; i < 20001; i++) huge["w" + i] = true;
  assert.equal((await call(env, "PUT", "/api/progress", { cookie, body: { mastered: huge } })).status, 400);
});

await test("drops an over-long deck or language label", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env);
  await call(env, "PUT", "/api/progress", { cookie, body: { mastered: {}, deck: "x".repeat(200), lang: "y".repeat(50) } });
  const got = await (await call(env, "GET", "/api/progress", { cookie })).json();
  assert.equal(got.deck, null);
  assert.equal(got.lang, null);
});

// --- account deletion ---

await test("delete erases the account, its progress and its sign-in rows", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env, "gone@example.com");
  await call(env, "PUT", "/api/progress", { cookie, body: { mastered: { w0001: true } } });
  const r = await call(env, "DELETE", "/api/account", { cookie });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(env._db.prepare("select count(*) as n from users").get().n, 0);
  assert.equal(env._db.prepare("select count(*) as n from progress").get().n, 0);
  assert.equal(env._db.prepare("select count(*) as n from login_tokens").get().n, 0);
  assert.equal((await (await call(env, "GET", "/api/me", { cookie })).json()).email, null, "the old cookie is inert");
  assert.equal((await call(env, "GET", "/api/progress", { cookie })).status, 401);
});

// --- misc ---

await test("ask needs a signed-in caller", async () => {
  const env = makeEnv(); aiStub(env);
  const r = await call(env, "POST", "/api/ask", { body: { system: "s", messages: [{ role: "user", content: "あじ" }] } });
  assert.equal(r.status, 401);
  assert.equal(env._ai.length, 0, "nothing went upstream");
});

await test("ask proxies to DeepSeek and returns the text", async () => {
  const env = makeEnv(); aiStub(env);
  const cookie = await signedIn(env);
  const r = await call(env, "POST", "/api/ask", { cookie, body: { system: "You are an IME.", messages: [{ role: "user", content: "Reading: あじ" }] } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.text, '{"c":["味"]}');
  assert.equal(env._ai.length, 1);
  assert.match(env._ai[0].url, /\/chat\/completions$/);
  assert.equal(env._ai[0].body.model, "deepseek-v4-flash");
  assert.deepEqual(env._ai[0].body.messages, [
    { role: "system", content: "You are an IME." },
    { role: "user", content: "Reading: あじ" },
  ]);
  assert.deepEqual(env._ai[0].body.response_format, { type: "json_object" });
  // Thinking is off, in the shape the API actually reads: a nested object.
  // The body has no top-level reasoning_effort field, so sending one changed
  // nothing -- which is how the empty answers survived the first fix.
  assert.deepEqual(env._ai[0].body.thinking, { type: "disabled" });
  assert.equal(env._ai[0].body.reasoning_effort, undefined);
});

// DeepSeek answering 200 with nothing in it: content "" or whitespace.
const flakyAi = (env, replies) => {
  env.AI_FETCH = async (url, init) => {
    env._ai.push({ url: String(url), body: JSON.parse(init.body) });
    const text = replies.shift();
    return new Response(JSON.stringify({
      id: "chat_test", object: "chat.completion", model: "deepseek-v4-flash",
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: text.trim() ? "stop" : "length" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
};
const aiErrorRows = (env) =>
  env._db.prepare("select name from sqlite_master where name = 'ai_errors'").all().length
    ? env._db.prepare("select kind from ai_errors").all().map((r) => ({ ...r }))
    : [];

await test("an empty answer is asked again, and the second one serves", async () => {
  const env = makeEnv();
  flakyAi(env, ["   \n", '{"c":["味"]}']);
  const cookie = await signedIn(env);
  const r = await call(env, "POST", "/api/ask", { cookie, body: { system: "s", messages: [{ role: "user", content: "a" }] } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).text, '{"c":["味"]}');
  assert.equal(env._ai.length, 2, "asked twice, same payload");
  assert.deepEqual(env._ai[0].body, env._ai[1].body);
  assert.deepEqual(aiErrorRows(env), [], "a rescued request is not an error");
});

await test("two empty answers read as an upstream failure, and are logged once", async () => {
  const env = makeEnv();
  flakyAi(env, ["", "  "]);
  const cookie = await signedIn(env);
  const r = await call(env, "POST", "/api/ask", { cookie, body: { system: "s", messages: [{ role: "user", content: "a" }] } });
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error, "upstream_failed");
  assert.equal(env._ai.length, 2, "one retry, no more");
  assert.deepEqual(aiErrorRows(env), [{ kind: "empty_response" }]);
});

// --- the error digest cron ---

const errorAt = (env, secondsAgo, kind = "empty_response") => {
  env._db.exec("create table if not exists ai_errors (id integer primary key autoincrement, kind text not null, created_at integer not null)");
  env._db.prepare("insert into ai_errors (kind, created_at) values (?, ?)").run(kind, Math.floor(Date.now() / 1000) - secondsAgo);
};

await test("an error is mailed however late the tick runs, and only once", async () => {
  const env = makeEnv();
  env.OWNER_EMAIL = "owner@example.com";
  // Recorded twenty minutes ago: the old 300-second window would look right
  // past it if the tick that should have caught it came late. The high-water
  // mark cannot: unmailed is unmailed, whenever the tick runs.
  errorAt(env, 1200);
  errorAt(env, 1140);
  await worker.scheduled({}, env, null);
  assert.equal(env._sent.length, 1);
  assert.equal(env._sent[0].to, "owner@example.com");
  assert.match(env._sent[0].subject, /empty_response: 2/);
  await worker.scheduled({}, env, null);
  assert.equal(env._sent.length, 1, "already told: the next tick says nothing");
  errorAt(env, 5, "upstream_busy");
  await worker.scheduled({}, env, null);
  assert.equal(env._sent.length, 2, "a new error is news again");
  assert.match(env._sent[1].subject, /upstream_busy: 1/);
  assert.ok(!/empty_response/.test(env._sent[1].subject), "and only the new one");
});

await test("a digest the mailer refuses is retried next tick, not lost", async () => {
  const env = makeEnv();
  env.OWNER_EMAIL = "owner@example.com";
  let down = 1;
  const sent = env._sent;
  env.EMAIL = { send: async (m) => { if (down-- > 0) throw new Error("mailer down"); sent.push(m); } };
  errorAt(env, 60);
  await worker.scheduled({}, env, null);
  assert.equal(env._sent.length, 0, "the first try failed");
  await worker.scheduled({}, env, null);
  assert.equal(env._sent.length, 1, "the next tick still knows about it");
  assert.match(env._sent[0].subject, /empty_response: 1/);
});

await test("ask validates the body and refuses oversize prompts", async () => {
  const env = makeEnv(); aiStub(env);
  const cookie = await signedIn(env);
  for (const bad of [{}, { system: "s" }, { system: "s", messages: [] }, { system: "s", messages: [{ role: "system", content: "x" }] }, { system: "s", messages: [{ role: "user", content: 5 }] }]) {
    assert.equal((await call(env, "POST", "/api/ask", { cookie, body: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call(env, "POST", "/api/ask", { cookie, body: { system: "x".repeat(20000), messages: [{ role: "user", content: "a" }] } })).status, 413);
  assert.equal(env._ai.length, 0, "nothing went upstream");
});

await test("ask is metered per account per hour", async () => {
  const env = makeEnv(); aiStub(env);
  const cookie = await signedIn(env);
  const body = { system: "s", messages: [{ role: "user", content: "a" }] };
  for (let i = 0; i < 3; i++) assert.equal((await call(env, "POST", "/api/ask", { cookie, body })).status, 200);
  assert.equal((await call(env, "POST", "/api/ask", { cookie, body })).status, 429);
  assert.equal(env._ai.length, 3, "the fourth never went upstream");
});

await test("ask says so when the key is not configured", async () => {
  const env = makeEnv(); aiStub(env); delete env.DEEPSEEK_API_KEY;
  const cookie = await signedIn(env);
  const r = await call(env, "POST", "/api/ask", { cookie, body: { system: "s", messages: [{ role: "user", content: "a" }] } });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "not_configured");
});

await test("unknown routes 404 for a signed-in caller", async () => {
  const env = makeEnv();
  const cookie = await signedIn(env);
  assert.equal((await call(env, "GET", "/api/nope", { cookie })).status, 404);
});

await test("refuses to run unconfigured", async () => {
  const env = makeEnv();
  delete env.SESSION_SECRET;
  assert.equal((await call(env, "GET", "/api/progress")).status, 500);
});

console.log(results.join("\n"));
console.log("\n" + pass + "/" + results.length + " passed");
