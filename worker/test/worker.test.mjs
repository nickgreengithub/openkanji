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
  assert.deepEqual(await r.json(), { mastered: {}, deck: null, lang: null });

  r = await call(env, "PUT", "/api/progress", { cookie, body: { mastered: { w0001: true, w0226: true }, deck: "JLPT N3", lang: "ES" } });
  assert.equal(r.status, 200);

  r = await call(env, "GET", "/api/progress", { cookie });
  assert.deepEqual(await r.json(), { mastered: { w0001: true, w0226: true }, deck: "JLPT N3", lang: "ES" });
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
