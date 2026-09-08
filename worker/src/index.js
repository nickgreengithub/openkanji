// OpenKanji progress sync -- Cloudflare Worker.
//
// Email-only sign-in by magic link, and one row of progress per learner:
// the mastered word ids, the last deck and the last language. Nothing else is
// stored, and nothing here is sensitive -- but the sign-in endpoint sends mail
// on demand, so it is rate limited in two dimensions (see rateLimited).
//
// Routed on the site's own origin (openkanji.org/api/*), so the session cookie
// is first-party and there is no CORS in the normal case.
//
//   POST   /api/login      { email, lang }  -> sends a sign-in link
//   GET    /api/callback?token=...          -> sets the session cookie, redirects
//   GET    /api/me                          -> { email } (null when signed out)
//   GET    /api/progress                    -> { mastered, deck, lang }
//   PUT    /api/progress   { mastered, deck, lang }
//   POST   /api/logout                      -> clears the cookie
//   POST   /api/issue     { title, text, notify } -> opens a GitHub issue
//   POST   /api/gh-hook                     -> GitHub's webhook; mails the reporter
//   GET    /api/issue-stop?t=...            -> stops those mails
//   DELETE /api/account                     -> erases the account and its progress

const TOKEN_TTL = 15 * 60;             // magic link: 15 minutes
const SESSION_TTL = 180 * 24 * 60 * 60; // session cookie: 180 days
const COOKIE = "ok_session";
const MAX_BODY = 512 * 1024;
const MAX_WORDS = 20000;
// Per hour, counted from login_tokens. Generous for a person, useless as a
// spam relay.
const RATE_EMAIL = 5;
const RATE_IP = 20;

const now = () => Math.floor(Date.now() / 1000);

// ---------- issues: the report form, posted to GitHub ----------
// A reader who has found something wrong writes it here and the Worker opens
// the issue under the project's own token -- which the page never sees. Signed
// in only, for one reason: an answer needs somewhere to go, and the account is
// where the address already is. Metered per account, capped in length, and
// given a floor, because an empty report costs a public issue.
const ISSUE_MAX_TITLE = 120;
const ISSUE_MAX_TEXT = 4000;
const ISSUE_MIN_TEXT = 10;
const ISSUE_PER_HOUR = 3;
const ISSUE_REPO_OK = /^[\w.-]{1,64}\/[\w.-]{1,64}$/;

const issueUsageReady = new WeakSet();
async function issueAllowed(db, who) {
  if (!issueUsageReady.has(db)) {
    // A new name, not a new shape for the old one: "create table if not
    // exists" does nothing to a table that is already there, so renaming the
    // column inside it left every insert naming a column the live database
    // had never heard of. The meter used to be by address; it is by account
    // now, which is a different table.
    await db.prepare("create table if not exists issue_meter (who text not null, hour integer not null, n integer not null default 0, primary key (who, hour))").run();
    issueUsageReady.add(db);
  }
  const hour = Math.floor(now() / 3600);
  const row = await db.prepare(
    "insert into issue_meter (who, hour, n) values (?1, ?2, 1) on conflict(who, hour) do update set n = n + 1 returning n"
  ).bind(String(who), hour).first();
  return !row || row.n <= ISSUE_PER_HOUR;
}

// Who asked to hear back about which issue. One row per report, dropped when
// they say stop -- there is nothing else in it, and it is the only place the
// address is kept against an issue number. GitHub is never told the address.
const issueWatchReady = new WeakSet();
async function ensureIssueWatch(db) {
  if (issueWatchReady.has(db)) return;
  await db.prepare("create table if not exists issue_watch (number integer primary key, email text not null, lang text, created_at integer not null)").run();
  issueWatchReady.add(db);
}

// One line, no markup, no newlines: what the page says about itself goes in a
// footer, and a footer is not a place a reporter gets to write.
const oneLine = (v, max) => String(v == null ? "" : v).replace(/[\r\n]+/g, " ").replace(/[`<>]/g, "").trim().slice(0, max);

async function handleIssue(request, env, user) {
  const repo = ISSUE_REPO_OK.test(env.ISSUE_REPO || "") ? env.ISSUE_REPO : null;
  if (!env.GITHUB_TOKEN || !repo) return json({ error: "not_configured" }, 503);
  const body = await readJson(request);
  if (!body || typeof body.title !== "string" || typeof body.text !== "string") return json({ error: "bad_request" }, 400);
  const title = body.title.replace(/[\r\n]+/g, " ").trim();
  const text = body.text.trim();
  if (!title || text.length < ISSUE_MIN_TEXT) return json({ error: "too_short" }, 400);
  if (title.length > ISSUE_MAX_TITLE || text.length > ISSUE_MAX_TEXT) return json({ error: "too_long" }, 413);
  if (!(await issueAllowed(env.DB, user.id))) return json({ error: "rate_limited" }, 429);

  // The reporter's words first and whole; then a rule, then what the page
  // knows about itself. Both of the footer's facts come from the page, so
  // neither is presented as anything more than that -- and the reporter's
  // address is not among them. It stays here.
  const footer = "Reported from the app · v" + oneLine(body.version, 16) + " · " + oneLine(body.agent, 180);
  const res = await (env.GITHUB_FETCH || fetch)("https://api.github.com/repos/" + repo + "/issues", {
    method: "POST",
    headers: {
      authorization: "Bearer " + env.GITHUB_TOKEN,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      // GitHub refuses a request that will not say who is making it
      "user-agent": "openkanji-worker",
    },
    // Two kinds come through this form, and which one is the reporter's word
    // for it, not ours to guess from the text.
    body: JSON.stringify({ title, body: text + "\n\n---\n" + footer, labels: ["in-app", body.kind === "idea" ? "suggestion" : "bug"] }),
  }).catch(() => null);
  if (!res) return json({ error: "upstream_failed" }, 502);
  if (res.status === 401 || res.status === 403 || res.status === 404) return json({ error: "not_configured" }, 503);
  if (!res.ok) return json({ error: "upstream_failed" }, 502);
  const out = await res.json().catch(() => null);
  if (!out || !out.number) return json({ error: "upstream_failed" }, 502);

  // Hearing back is the default and is one row; saying no keeps none.
  if (body.notify !== false) {
    await ensureIssueWatch(env.DB);
    const lang = (await env.DB.prepare("select lang from progress where user_id = ?").bind(user.id).first() || {}).lang;
    await env.DB.prepare("insert or replace into issue_watch (number, email, lang, created_at) values (?, ?, ?, ?)")
      .bind(out.number, user.email, lang || null, now()).run();
  }
  return json({ ok: true, number: out.number, url: out.html_url, notify: body.notify !== false });
}

// Asking GitHub what has happened, rather than waiting to be told. A webhook
// is faster, but it is also a thing to configure in a place the code cannot
// reach -- a box to tick, a secret to paste in two places, and a delivery page
// to read when it goes wrong. This needs nothing but the token that already
// opens the issues. It runs on a schedule; the webhook below still works if it
// is ever set up, and the two cannot double up because both go through
// alreadyTold.
const POLL_WINDOW = 3 * 24 * 3600;   // never look further back than this

// What has already been said, so a comment is mailed once whichever way it
// arrives, and a restart does not mail a week of history.
const toldReady = new WeakSet();
async function ensureTold(db) {
  if (toldReady.has(db)) return;
  await db.prepare("create table if not exists issue_told (id text primary key, at integer not null)").run();
  toldReady.add(db);
}
async function alreadyTold(db, id) {
  await ensureTold(db);
  const row = await db.prepare("insert or ignore into issue_told (id, at) values (?, ?) returning id").bind(String(id), now()).first();
  return !row;   // nothing returned means the row was already there
}

async function gh(env, path) {
  const res = await (env.GITHUB_FETCH || fetch)("https://api.github.com" + path, {
    headers: {
      authorization: "Bearer " + env.GITHUB_TOKEN,
      accept: "application/vnd.github+json",
      "user-agent": "openkanji-worker",
    },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
}

// One pass: every comment and every close since the last one, against the
// issues somebody asked to hear about. Nothing is mailed twice, whichever way
// it arrived, because both paths pass through alreadyTold first.
async function pollGitHub(env) {
  const repo = ISSUE_REPO_OK.test(env.ISSUE_REPO || "") ? env.ISSUE_REPO : null;
  if (!env.GITHUB_TOKEN || !repo) return { skipped: "not_configured" };
  await ensureIssueWatch(env.DB);
  const watch = await env.DB.prepare("select number, email, lang from issue_watch limit 500").all();
  const rows = (watch && watch.results) || [];
  if (!rows.length) return { watching: 0, told: 0 };
  const by = {};
  for (const r of rows) by[r.number] = r;

  const since = new Date((now() - POLL_WINDOW) * 1000).toISOString().replace(/\.\d+Z$/, "Z");
  const titles = {};
  const titleOf = async (n) => {
    if (titles[n] === undefined) {
      const issue = await gh(env, "/repos/" + repo + "/issues/" + n);
      titles[n] = (issue && issue.title) || "";
    }
    return titles[n];
  };
  let told = 0;

  // Comments across the repository, and only the ones on a watched issue.
  const comments = await gh(env, "/repos/" + repo + "/issues/comments?sort=updated&direction=desc&per_page=100&since=" + since) || [];
  for (const c of comments) {
    const n = Number(String((c && c.issue_url) || "").split("/").pop());
    const w = by[n];
    if (!w || !c.id) continue;
    if (await alreadyTold(env.DB, "c" + c.id)) continue;
    await sendIssueMail(env, w.email, w.lang, "reply", { number: n, title: await titleOf(n), url: c.html_url || "", said: c.body || "" });
    told++;
  }

  // And the ones that have been closed since.
  const closed = await gh(env, "/repos/" + repo + "/issues?state=closed&sort=updated&direction=desc&per_page=100&since=" + since) || [];
  for (const i of closed) {
    const w = i && by[i.number];
    if (!w || !i.closed_at) continue;
    if (await alreadyTold(env.DB, "x" + i.number)) continue;
    await sendIssueMail(env, w.email, w.lang, "closed", { number: i.number, title: i.title || "", url: i.html_url || "", said: "" });
    told++;
  }
  return { watching: rows.length, told };
}

// GitHub's own webhook, telling us an issue moved. Signed with a shared
// secret, so a POST from anyone else is refused before it is read as anything.
async function handleGitHubHook(request, env) {
  if (!env.GH_WEBHOOK_SECRET) return json({ error: "not_configured" }, 503);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: "too_large" }, 413);
  const given = request.headers.get("x-hub-signature-256") || "";
  const want = "sha256=" + [...new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(env.GH_WEBHOOK_SECRET), new TextEncoder().encode(raw)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  // constant time: a comparison that stops early leaks the signature a byte
  // at a time to anyone willing to ask often enough
  if (given.length !== want.length) return json({ error: "bad_signature" }, 401);
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
  if (diff) return json({ error: "bad_signature" }, 401);

  const event = request.headers.get("x-github-event") || "";
  let hook = null;
  try { hook = JSON.parse(raw); } catch (e) { return json({ error: "bad_body" }, 400); }
  const number = hook && hook.issue && hook.issue.number;
  // Every skip says what arrived and what was made of it. A webhook is
  // diagnosed through this one line or not at all: the logs are somewhere
  // else, and the person reading it is looking at GitHub's delivery page.
  const saw = event + "." + ((hook && hook.action) || "?") + (number ? " #" + number : "");
  if (!number) return json({ ok: true, skipped: "not an issue", saw });

  // A comment on it, or it being closed. Everything else is not news.
  const kind = event === "issue_comment" && hook.action === "created" ? "reply"
    : event === "issues" && hook.action === "closed" ? "closed" : null;
  if (!kind) return json({ ok: true, skipped: "nothing to say", saw, wants: "issue_comment.created or issues.closed" });

  await ensureIssueWatch(env.DB);
  const watch = await env.DB.prepare("select email, lang from issue_watch where number = ?").bind(number).first();
  const waiting = await env.DB.prepare("select count(*) as n from issue_watch").first();
  if (!watch) return json({ ok: true, skipped: "nobody is waiting", saw, watching: (waiting && waiting.n) || 0 });

  const once = kind === "reply" ? "c" + ((hook.comment && hook.comment.id) || number) : "x" + number;
  if (await alreadyTold(env.DB, once)) return json({ ok: true, skipped: "already told", saw });
  await sendIssueMail(env, watch.email, watch.lang, kind, {
    number,
    title: String((hook.issue && hook.issue.title) || ""),
    url: String((hook.issue && hook.issue.html_url) || ""),
    said: kind === "reply" ? String((hook.comment && hook.comment.body) || "") : "",
  });
  return json({ ok: true, told: true, saw, to: watch.email.replace(/^(.).*@/, "$1***@") });
}

// The link that ends it. Signed, so it cannot be guessed for someone else's
// issue, and it needs no session -- a person following a link out of an email
// is not necessarily signed in on the device they read it on.
async function issueStopToken(secret, number, email) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode("stop:" + number + ":" + email));
  return number + "." + b64url(sig);
}

async function handleIssueStop(request, env, url) {
  const t = url.searchParams.get("t") || "";
  const [num] = t.split(".");
  const number = parseInt(num, 10);
  const page = (msg) => new Response("<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\">" +
    "<body style=\"font:16px/1.5 system-ui;margin:0;display:flex;align-items:center;justify-content:center;height:100svh;background:#f4f4f1;color:#15181c\">" +
    "<p style=\"max-width:28rem;padding:1.5rem;text-align:center\">" + msg + "</p>",
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  if (!number) return page("That link is not one of ours.");
  await ensureIssueWatch(env.DB);
  const watch = await env.DB.prepare("select email from issue_watch where number = ?").bind(number).first();
  // Already gone is the same answer as just now gone: following the link twice
  // should not tell anyone whether there was ever a row.
  if (!watch) return page("You will hear nothing more about that report.");
  if (t !== await issueStopToken(env.SESSION_SECRET, number, watch.email)) return page("That link is not one of ours.");
  await env.DB.prepare("delete from issue_watch where number = ?").bind(number).run();
  return page("You will hear nothing more about that report.");
}

const ISSUE_MAIL = {
  en: {
    reply: { subject: "Re: your OpenKanji report #{n}", lead: "There is a reply to what you reported." },
    closed: { subject: "Your OpenKanji report #{n} is closed", lead: "What you reported has been closed." },
    see: "Reply on GitHub",
    // Nobody reads mail sent back to this address, and a reply written here in
    // the belief it is private would be neither read nor private -- the thread
    // it belongs to is public. Say both, above the link.
    noreply: "Replies to this address are not read. Answer on the thread, which anyone can see.",
    why: "You asked to hear back when you sent this report.",
    stop: "Stop emails about this report",
  },
  es: {
    reply: { subject: "Re: tu informe de OpenKanji #{n}", lead: "Hay una respuesta a lo que informaste." },
    closed: { subject: "Tu informe de OpenKanji #{n} está cerrado", lead: "Lo que informaste se ha cerrado." },
    see: "Responder en GitHub",
    noreply: "No se leen las respuestas a esta dirección. Responde en el hilo, que es público.",
    why: "Pediste que te avisáramos al enviar este informe.",
    stop: "Dejar de recibir avisos de este informe",
  },
};

async function sendIssueMail(env, email, lang, kind, issue) {
  const t = ISSUE_MAIL[(lang || "EN").toLowerCase()] || ISSUE_MAIL.en;
  const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const stop = (env.SITE_URL || "") + "/api/issue-stop?t=" + encodeURIComponent(await issueStopToken(env.SESSION_SECRET, issue.number, email));
  const said = issue.said.length > 600 ? issue.said.slice(0, 600) + "…" : issue.said;
  const html = '<div style="font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#15181c;max-width:34rem">' +
    "<p>" + esc(t[kind].lead) + "</p>" +
    '<p style="color:#6b7280">#' + issue.number + " · " + esc(issue.title) + "</p>" +
    (said ? '<blockquote style="margin:1rem 0;padding:.2rem 0 .2rem 1rem;border-left:3px solid #0891b2;color:#374151;white-space:pre-wrap">' + esc(said) + "</blockquote>" : "") +
    '<p style="font-size:13px;color:#6b7280">' + esc(t.noreply) + "</p>" +
    '<p><a href="' + esc(issue.url) + '" style="display:inline-block;padding:.6rem 1rem;border-radius:999px;background:#0891b2;color:#fff;text-decoration:none">' + esc(t.see) + "</a></p>" +
    '<hr style="border:0;border-top:1px solid #e5e5e0;margin:1.5rem 0">' +
    '<p style="font-size:13px;color:#6b7280">' + esc(t.why) + ' <a href="' + esc(stop) + '" style="color:#6b7280">' + esc(t.stop) + "</a></p></div>";
  await deliver(env, {
    to: email,
    from: env.MAIL_FROM,
    subject: t[kind].subject.replace("{n}", issue.number),
    html,
    text: t[kind].lead + "\n\n#" + issue.number + " · " + issue.title + (said ? "\n\n" + said : "") +
      "\n\n" + t.noreply + "\n" + issue.url + "\n\n" + t.why + " " + stop,
  });
}

// ---------- AI: the writing coach and the IME, proxied ----------
// Inside Claude Design the page had window.claude; on the site it has this.
// The key is a Worker secret the page never sees. Signed in only, and metered
// per account per hour, because every call costs money and the URL is public.
//
// DeepSeek speaks the OpenAI chat-completions shape: one POST, one JSON body.
// That is little enough to write out, so the Worker carries no dependency and
// there is nothing to install or bundle.
const AI_MAX_SYSTEM = 12000;
const AI_MAX_MSG = 4000;
const AI_MAX_MSGS = 8;
const AI_URL = "https://api.deepseek.com/chat/completions";
const AI_MODEL_DEFAULT = "deepseek-v4-flash";
// AI_MODEL is an operator setting in wrangler.jsonc, not user input, so any
// well-formed name passes: a different model is a config change, not a deploy.
const AI_MODEL_OK = /^[a-zA-Z0-9._:-]{1,64}$/;
// The meter's table is created on first use, once per database binding, so
// there is no migration to run.
const aiUsageReady = new WeakSet();
async function aiAllowed(db, userId, perHour) {
  if (!aiUsageReady.has(db)) {
    await db.prepare("create table if not exists ai_usage (user_id text not null, hour integer not null, n integer not null default 0, primary key (user_id, hour))").run();
    aiUsageReady.add(db);
  }
  const hour = Math.floor(now() / 3600);
  const row = await db.prepare(
    "insert into ai_usage (user_id, hour, n) values (?1, ?2, 1) on conflict(user_id, hour) do update set n = n + 1 returning n"
  ).bind(userId, hour).first();
  return !row || row.n <= perHour;
}
async function handleAsk(request, env, user) {
  if (!env.DEEPSEEK_API_KEY) return json({ error: "not_configured" }, 503);
  const body = await readJson(request);
  if (!body || typeof body.system !== "string" || !Array.isArray(body.messages) || !body.messages.length) return json({ error: "bad_body" }, 400);
  if (body.system.length > AI_MAX_SYSTEM || body.messages.length > AI_MAX_MSGS) return json({ error: "too_long" }, 413);
  const messages = [{ role: "system", content: body.system }];
  for (const m of body.messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return json({ error: "bad_body" }, 400);
    if (m.content.length > AI_MAX_MSG) return json({ error: "too_long" }, 413);
    messages.push({ role: m.role, content: m.content });
  }
  const perHour = Number(env.AI_PER_HOUR) > 0 ? Number(env.AI_PER_HOUR) : 150;
  if (!(await aiAllowed(env.DB, user.id, perHour))) return json({ error: "rate_limited" }, 429);
  const model = AI_MODEL_OK.test(env.AI_MODEL || "") ? env.AI_MODEL : AI_MODEL_DEFAULT;
  const send = env.AI_FETCH || fetch;
  let res;
  try {
    res = await send(AI_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      // every caller on the page asks for JSON and nothing else, so make that
      // a server-enforced guarantee rather than trusting the prompt alone --
      // DeepSeek otherwise sometimes wraps the object in prose or a fence.
      body: JSON.stringify({ model, messages, max_tokens: 4096, stream: false, response_format: { type: "json_object" } }),
    });
  } catch {
    return json({ error: "upstream_failed" }, 502);
  }
  // 401/403 is a bad key and 402 an empty balance: both are ours to fix, and
  // both leave the learner with the same dead feature, so they read alike.
  if (res.status === 401 || res.status === 402 || res.status === 403) return json({ error: "not_configured" }, 503);
  if (res.status === 429 || res.status >= 500) return json({ error: "upstream_busy" }, 503);
  if (!res.ok) return json({ error: "upstream_failed" }, 502);
  const out = await res.json().catch(() => null);
  const choice = out && Array.isArray(out.choices) ? out.choices[0] : null;
  if (choice && choice.finish_reason === "content_filter") return json({ error: "refused" }, 422);
  const text = choice && choice.message && choice.message.content;
  if (typeof text !== "string") return json({ error: "upstream_failed" }, 502);
  return json({ text, model: (out && out.model) || model });
}
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

// ---------- crypto ----------

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const unb64url = (s) => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
};

const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

// Tokens are stored as their SHA-256, never in the clear: a dump of the
// database cannot be replayed to sign in as anyone.
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const hmacKey = (secret) =>
  crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

// Session cookie: "<payload>.<signature>", both base64url. Stateless, so there
// is no session table to read on every request; the cost is that signing out
// one device cannot invalidate the others (rotating SESSION_SECRET does).
async function signSession(secret, userId) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: userId, e: now() + SESSION_TTL })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(payload));
  return payload + "." + b64url(sig);
}

async function readSession(secret, cookie) {
  if (!cookie || cookie.indexOf(".") < 0) return null;
  const [payload, sig] = cookie.split(".");
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64url(sig), new TextEncoder().encode(payload));
    if (!ok) return null;
    const claim = JSON.parse(new TextDecoder().decode(unb64url(payload)));
    if (!claim || typeof claim.u !== "number" || typeof claim.e !== "number" || claim.e < now()) return null;
    return claim.u;
  } catch (e) {
    return null;
  }
}

const cookieHeader = (value, maxAge) =>
  COOKIE + "=" + value + "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=" + maxAge;

function readCookie(request) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return null;
}

// ---------- validation ----------

const isEmail = (s) => typeof s === "string" && s.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

// The client keys progress on stable word ids ("w0226"). Anything else is
// rejected rather than stored: this row is a study record, not a scratch pad.
function cleanMastered(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  if (keys.length > MAX_WORDS) return null;
  const out = {};
  for (const k of keys) {
    if (!/^w\d{1,7}$/.test(k)) return null;
    if (v[k]) out[k] = true;
  }
  return out;
}

// [str, n, day, hist] per word: strength 0-100, graded answers, the day it was
// last graded, and the last six results as bits. Anything else is dropped
// rather than rejected -- one malformed record should not cost a learner the
// save of everything else in the body.
function cleanStrength(v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  if (keys.length > MAX_WORDS) return null;
  const int = (x, lo, hi) => typeof x === "number" && isFinite(x) && x >= lo && x <= hi;
  const out = {};
  for (const k of keys) {
    if (!/^w\d{1,7}$/.test(k)) continue;
    const r = v[k];
    if (!Array.isArray(r) || r.length !== 4) continue;
    if (!int(r[0], 0, 100) || !int(r[1], 0, 255) || !int(r[2], 0, 1e6) || !int(r[3], 0, 63)) continue;
    out[k] = [Math.round(r[0]), Math.round(r[1]), Math.round(r[2]), Math.round(r[3])];
  }
  return out;
}

// Per word, the later grading is the true one -- ties going to whichever has
// seen more answers. This is why strength needs no `replace` flag the way
// mastered does: a word can genuinely get worse, and a union would lose that.
function mergeStrength(mine, theirs) {
  const out = Object.assign({}, mine || {});
  const o = theirs || {};
  for (const k of Object.keys(o)) {
    const a = out[k], b = o[k];
    if (!a || b[2] > a[2] || (b[2] === a[2] && b[1] > a[1])) out[k] = b;
  }
  return out;
}

// The column arrived after the table did, so a database made before it exists
// gets it here, once per binding. Same shape as the AI meter's table: no
// migration to run before a deploy.
const strengthReady = new WeakSet();
// The updates flag was added after the fact too, so the Worker adds the column
// on a database that predates it. Same shape as ensureStrength: try once per
// database handle, and let "already there" be the ordinary case.
const updatesReady = new WeakSet();
async function ensureUpdates(db) {
  if (updatesReady.has(db)) return;
  try {
    await db.prepare("alter table users add column updates integer not null default 0").run();
  } catch (e) {
    // already there
  }
  updatesReady.add(db);
}

async function ensureStrength(db) {
  if (strengthReady.has(db)) return;
  try {
    await db.prepare("alter table progress add column strength text not null default '{}'").run();
  } catch (e) {
    // already there, which is the normal case
  }
  strengthReady.add(db);
}

const cleanLabel = (v, max) => (typeof v === "string" && v.length && v.length <= max ? v : null);

async function readJson(request) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_BODY) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

// ---------- rate limiting ----------

// login_tokens doubles as the ledger: every issued link is a row, so counting
// recent rows by email and by IP is exactly the limit we want, with no extra
// table and no extra write.
async function rateLimited(db, email, ip) {
  const since = now() - 3600;
  const byEmail = await db.prepare("select count(*) as n from login_tokens where email = ? and created_at > ?").bind(email, since).first();
  if (byEmail && byEmail.n >= RATE_EMAIL) return true;
  if (ip) {
    const byIp = await db.prepare("select count(*) as n from login_tokens where ip = ? and created_at > ?").bind(ip, since).first();
    if (byIp && byIp.n >= RATE_IP) return true;
  }
  return false;
}

// ---------- email ----------

const MAIL = {
  en: {
    subject: "Your OpenKanji sign-in link",
    lead: "Click below to sign in and sync your progress.",
    button: "Sign in to OpenKanji",
    expiry: "This link works once and expires in 15 minutes.",
    ignore: "If you did not ask to sign in, ignore this email.",
    progress: "{n} words learned so far.",
    progressOne: "1 word learned so far.",
    welcome: "Your first set is waiting.",
  },
  es: {
    subject: "Tu enlace de acceso a OpenKanji",
    lead: "Pulsa abajo para acceder y sincronizar tu progreso.",
    button: "Acceder a OpenKanji",
    expiry: "El enlace funciona una sola vez y caduca en 15 minutos.",
    ignore: "Si no has pedido acceder, ignora este correo.",
    progress: "{n} palabras aprendidas hasta ahora.",
    progressOne: "1 palabra aprendida hasta ahora.",
    welcome: "Tu primer grupo te espera.",
  },
};

// The Japanese half of the progress line. It is the same sentence whatever
// the learner reads the rest of the mail in -- that is the point: a line of
// the language they are here for, with their own underneath it.
const MAIL_JA = {
  progress: "これまでに{n}語おぼえました。がんばってください！",
  welcome: "さいしょのセットが待っています。がんばってください！",
};

// How far along the account is, for that line. Unknown addresses count zero,
// which is what a new learner sees anyway.
async function learnedCount(db, email) {
  const row = await db.prepare(
    "select p.mastered as m from users u join progress p on p.user_id = u.id where u.email = ?"
  ).bind(email).first();
  if (!row || !row.m) return 0;
  try {
    const o = JSON.parse(row.m);
    return Object.keys(o).filter((k) => o[k]).length;
  } catch (e) {
    return 0;
  }
}

async function sendLink(env, email, link, lang, learned) {
  const t = MAIL[(lang || "en").toLowerCase()] || MAIL.en;
  const n = Number(learned) > 0 ? Number(learned) : 0;
  const ja = (n ? MAIL_JA.progress : MAIL_JA.welcome).replace("{n}", n);
  const own = n ? (n === 1 ? t.progressOne : t.progress).replace("{n}", n) : t.welcome;
  const html =
    '<div style="font:16px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;color:#16232c">' +
    '<p style="font-size:22px;margin:0 0 18px">開 OpenKanji</p>' +
    '<p style="font-size:18px;margin:0 0 2px">' + ja + "</p>" +
    '<p style="color:#5f7384;font-size:14px;margin:0 0 22px">' + own + "</p>" +
    "<p>" + t.lead + "</p>" +
    '<p style="margin:26px 0"><a href="' + link + '" style="background:#0891b2;color:#fff;padding:12px 20px;text-decoration:none">' + t.button + "</a></p>" +
    '<p style="color:#5f7384;font-size:14px">' + t.expiry + " " + t.ignore + "</p></div>";
  await deliver(env, {
    to: email,
    from: env.MAIL_FROM,
    subject: t.subject,
    html,
    text: ja + "\n" + own + "\n\n" + t.lead + "\n\n" + link + "\n\n" + t.expiry + " " + t.ignore,
  });
}

// One seam, two backends. Resend is used in production because Cloudflare's
// send_email binding only reaches addresses already verified in the account
// unless you are on the Workers Paid plan -- useless for signing up strangers.
// env.EMAIL stays supported so the tests can capture messages, and so a paid
// account could drop Resend without touching anything above.
async function deliver(env, message) {
  if (env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify(message),
    });
    if (!res.ok) {
      console.error("resend " + res.status + ": " + (await res.text()).slice(0, 300));
      throw new Error("email_send_failed");
    }
    return;
  }
  if (env.EMAIL) return env.EMAIL.send(message);
  throw new Error("no email backend configured");
}

// ---------- handlers ----------

async function handleLogin(request, env) {
  const body = await readJson(request);
  const email = body && isEmail(body.email) ? body.email.trim().toLowerCase() : null;
  // Uniform reply either way: this endpoint never reveals whether an address
  // already has an account.
  const okReply = json({ ok: true });
  if (!email) return json({ error: "invalid_email" }, 400);

  const ip = request.headers.get("cf-connecting-ip") || null;
  await env.DB.prepare("delete from login_tokens where expires_at < ?").bind(now()).run();
  if (await rateLimited(env.DB, email, ip)) return json({ error: "rate_limited" }, 429);

  const token = randomToken();
  await env.DB.prepare("insert into login_tokens (hash, email, ip, created_at, expires_at) values (?, ?, ?, ?, ?)")
    .bind(await sha256(token), email, ip, now(), now() + TOKEN_TTL)
    .run();

  const link = env.SITE_URL.replace(/\/$/, "") + "/api/callback?token=" + encodeURIComponent(token);
  try {
    await sendLink(env, email, link, body.lang, await learnedCount(env.DB, email));
  } catch (e) {
    return json({ error: "send_failed" }, 502);
  }
  return okReply;
}

async function handleCallback(request, env, url) {
  const token = url.searchParams.get("token") || "";
  const site = env.SITE_URL.replace(/\/$/, "");
  const fail = Response.redirect(site + "/#sign-in-failed", 302);
  if (!token) return fail;

  // Claiming the token and marking it used are one statement, so two clicks on
  // the same link cannot both succeed.
  const row = await env.DB.prepare(
    "update login_tokens set used_at = ?1 where hash = ?2 and used_at is null and expires_at > ?1 returning email"
  ).bind(now(), await sha256(token)).first();
  if (!row) return fail;

  let user = await env.DB.prepare("select id from users where email = ?").bind(row.email).first();
  if (!user) {
    user = await env.DB.prepare("insert into users (email, created_at) values (?, ?) returning id").bind(row.email, now()).first();
    await env.DB.prepare("insert or ignore into progress (user_id, mastered, updated_at) values (?, '{}', ?)").bind(user.id, now()).run();
  }

  return new Response(null, {
    status: 302,
    headers: {
      location: site + "/#signed-in",
      "set-cookie": cookieHeader(await signSession(env.SESSION_SECRET, user.id), SESSION_TTL),
      "cache-control": "no-store",
    },
  });
}

async function handleGetProgress(env, userId) {
  await ensureStrength(env.DB);
  const row = await env.DB.prepare("select mastered, strength, deck, lang from progress where user_id = ?").bind(userId).first();
  let mastered = {}, strength = {};
  try {
    mastered = row ? JSON.parse(row.mastered) : {};
  } catch (e) {}
  try {
    strength = row && row.strength ? JSON.parse(row.strength) : {};
  } catch (e) {}
  return json({ mastered, strength, deck: (row && row.deck) || null, lang: (row && row.lang) || null });
}

async function handlePutProgress(request, env, userId) {
  const body = await readJson(request);
  if (!body) return json({ error: "bad_body" }, 400);
  const incoming = cleanMastered(body.mastered);
  if (!incoming) return json({ error: "bad_mastered" }, 400);
  const incomingStr = cleanStrength(body.strength);
  if (body.strength !== undefined && incomingStr === null) return json({ error: "bad_strength" }, 400);
  await ensureStrength(env.DB);

  // Union by default: a device that saves without having loaded first can
  // only ever add progress, never erase another device's. A device that has
  // loaded says so (`replace: true`) and its copy is then the whole truth,
  // which is what lets un-mastering a word stick instead of coming back on
  // the next load.
  const row = await env.DB.prepare("select mastered, strength from progress where user_id = ?").bind(userId).first();
  let merged = incoming;
  if (row && body.replace !== true) {
    try {
      merged = Object.assign({}, JSON.parse(row.mastered), incoming);
    } catch (e) {}
  }
  // Strength always merges per word, whether or not this device loaded first:
  // recency decides, so there is nothing for `replace` to rescue.
  let mergedStr = incomingStr || {};
  if (row && row.strength) {
    try {
      mergedStr = mergeStrength(JSON.parse(row.strength), incomingStr || {});
    } catch (e) {}
  }

  await env.DB.prepare(
    "insert into progress (user_id, mastered, strength, deck, lang, updated_at) values (?1, ?2, ?3, ?4, ?5, ?6)" +
    " on conflict(user_id) do update set mastered = ?2, strength = ?3, deck = ?4, lang = ?5, updated_at = ?6"
  ).bind(userId, JSON.stringify(merged), JSON.stringify(mergedStr), cleanLabel(body.deck, 40), cleanLabel(body.lang, 8), now()).run();

  return json({ ok: true, count: Object.keys(merged).length });
}

// ---------- router ----------

export default {
  // Cloudflare calls this on the schedule in wrangler.jsonc. It is the whole
  // notification path: no webhook to configure, no secret to keep in step.
  async scheduled(event, env, ctx) {
    const done = pollGitHub(env).catch((e) => ({ failed: String(e && e.message) }));
    if (ctx && ctx.waitUntil) ctx.waitUntil(done);
    else await done;
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    if (!env.SESSION_SECRET) return json({ error: "not_configured" }, 500);

    if (method === "POST" && path === "/api/login") return handleLogin(request, env);
    if (method === "GET" && path === "/api/callback") return handleCallback(request, env, url);

    if (method === "POST" && path === "/api/logout") {
      return json({ ok: true }, 200, { "set-cookie": cookieHeader("", 0) });
    }

    // The cookie is stateless, so a signature alone is not proof the account
    // still exists: resolve it every time. That is what makes deletion final
    // rather than merely clearing one browser's cookie.
    const userId = await readSession(env.SESSION_SECRET, readCookie(request));
    const user = userId
      ? await env.DB.prepare("select id, email from users where id = ?").bind(userId).first()
      : null;

    // "Who am I, possibly nobody" -- the app asks this on every page load, so
    // being signed out is a 200 with a null email rather than an error.
    if (method === "GET" && path === "/api/me") {
      if (!user) return json({ email: null }, 200, userId ? { "set-cookie": cookieHeader("", 0) } : {});
      await ensureUpdates(env.DB);
      const row = await env.DB.prepare("select updates from users where id = ?").bind(user.id).first();
      return json({ email: user.email, updates: !!(row && row.updates) });
    }

    // GitHub telling us an issue moved, and the link that stops those emails.
    // Neither is the app asking: one is signed by a shared secret, the other
    // by ours, so neither needs a session.
    if (method === "POST" && path === "/api/gh-hook") return handleGitHubHook(request, env);
    if (method === "GET" && path === "/api/issue-stop") return handleIssueStop(request, env, url);

    // Everything below needs a live account.
    if (!user) return json({ error: "signed_out" }, 401, userId ? { "set-cookie": cookieHeader("", 0) } : {});
    if (method === "POST" && path === "/api/ask") return handleAsk(request, env, user);
    // Signed in to report: an answer needs somewhere to go, and the account is
    // where the address already is.
    if (method === "POST" && path === "/api/issue") return handleIssue(request, env, user);

    // Whether to hear about what is new here. One thing, on or off, and the
    // account panel is the only place that sets it -- there is no list to be
    // added to by anyone but the reader.
    if (method === "PUT" && path === "/api/updates") {
      const body = await readJson(request);
      if (!body || typeof body.on !== "boolean") return json({ error: "bad_request" }, 400);
      await ensureUpdates(env.DB);
      await env.DB.prepare("update users set updates = ? where id = ?").bind(body.on ? 1 : 0, user.id).run();
      return json({ ok: true, updates: body.on });
    }
    if (method === "GET" && path === "/api/progress") return handleGetProgress(env, user.id);
    if (method === "PUT" && path === "/api/progress") return handlePutProgress(request, env, user.id);
    if (method === "DELETE" && path === "/api/account") {
      // progress is deleted explicitly rather than trusting the cascade, and
      // the sign-in rows are keyed by email, not by user id.
      await env.DB.prepare("delete from login_tokens where email = ?").bind(user.email).run();
      await env.DB.prepare("delete from progress where user_id = ?").bind(user.id).run();
      await env.DB.prepare("delete from users where id = ?").bind(user.id).run();
      return json({ ok: true }, 200, { "set-cookie": cookieHeader("", 0) });
    }

    return json({ error: "not_found" }, 404);
  },
};
