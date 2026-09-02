// OpenKanji Worker: serves the static site and the /api routes.
//
// Static assets are matched first by the runtime, so "/" and "/index.html" are
// served without ever invoking this script. Anything unmatched arrives here:
// /api/* is handled below, everything else falls back to the app shell.
import {
  json, bad, isEmail, randomToken, sha256, rateLimited,
  makeSession, sessionCookie, clearCookie, readSession,
} from "./lib.js";

const TOKEN_MINUTES = 15;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const route = url.pathname.slice(5);
    const method = request.method.toUpperCase();
    try {
      if (route === "login"    && method === "POST")   return await login(request, env, url);
      if (route === "verify"   && method === "GET")    return await verify(request, env, url);
      if (route === "me"       && method === "GET")    return await me(request, env);
      if (route === "progress" && method === "GET")    return await getProgress(request, env);
      if (route === "progress" && method === "PUT")    return await putProgress(request, env);
      if (route === "logout"   && method === "POST")   return json({ ok: true }, 200, { "set-cookie": clearCookie() });
      if (route === "account"  && method === "DELETE") return await deleteAccount(request, env);
    } catch (err) {
      console.error(route + ": " + (err && err.stack || err));
      return json({ error: "server error" }, 500);
    }
    return json({ error: "not found" }, 404);
  },
};

async function session(request, env) {
  if (!env.SESSION_SECRET) return null;
  return readSession(env.SESSION_SECRET, request.headers.get("cookie"));
}

// Answers identically whether or not the address has an account, so this
// cannot be used to discover who is registered.
async function login(request, env, url) {
  if (!env.DB || !env.RESEND_API_KEY || !env.MAIL_FROM) return json({ error: "server not configured" }, 500);

  let body;
  try { body = await request.json(); } catch { return bad("expected JSON"); }
  const email = String(body?.email || "").trim().toLowerCase();
  if (!isEmail(email)) return bad("enter a valid email address");

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (await rateLimited(env.DB, "ip", ip, 10, 3600)) return bad("too many requests, try later", 429);
  if (await rateLimited(env.DB, "email", email, 5, 3600)) return json({ ok: true });

  const now = Math.floor(Date.now() / 1000);
  let user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (!user) {
    const res = await env.DB.prepare("INSERT INTO users (email, created_at) VALUES (?, ?)").bind(email, now).run();
    user = { id: res.meta.last_row_id };
  }

  const token = randomToken();
  await env.DB
    .prepare("INSERT INTO login_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), user.id, now + TOKEN_MINUTES * 60)
    .run();

  const link = url.origin + "/api/verify?t=" + encodeURIComponent(token);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: email,
      subject: "Your OpenKanji sign-in link",
      text: "Sign in to OpenKanji:\n\n" + link +
        "\n\nThe link works once and expires in " + TOKEN_MINUTES + " minutes." +
        "\nIf you did not ask for it, ignore this email.\n",
    }),
  });
  if (!res.ok) {
    console.error("resend " + res.status + ": " + (await res.text()).slice(0, 300));
    return json({ error: "could not send the email" }, 502);
  }
  return json({ ok: true });
}

// Opened from an email client, so this redirects into the app rather than
// returning JSON.
async function verify(request, env, url) {
  const go = (q, cookie) =>
    new Response(null, {
      status: 302,
      headers: Object.assign({ location: url.origin + "/" + q }, cookie ? { "set-cookie": cookie } : {}),
    });

  if (!env.DB || !env.SESSION_SECRET) return go("?signin=error");
  const token = url.searchParams.get("t");
  if (!token) return go("?signin=invalid");

  const hash = await sha256(token);
  const row = await env.DB
    .prepare("SELECT user_id, expires_at FROM login_tokens WHERE token_hash = ?")
    .bind(hash).first();

  // Consumed whether or not it had expired, so a leaked link cannot be retried.
  if (row) await env.DB.prepare("DELETE FROM login_tokens WHERE token_hash = ?").bind(hash).run();
  if (!row || row.expires_at < Math.floor(Date.now() / 1000)) return go("?signin=expired");

  return go("?signin=ok", sessionCookie(await makeSession(env.SESSION_SECRET, row.user_id)));
}

async function me(request, env) {
  const userId = await session(request, env);
  if (!userId) return json({ error: "not signed in" }, 401);
  const row = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first();
  if (!row) return json({ error: "not signed in" }, 401);
  return json({ email: row.email });
}

async function getProgress(request, env) {
  const userId = await session(request, env);
  if (!userId) return json({ error: "not signed in" }, 401);
  const row = await env.DB
    .prepare("SELECT mastered, updated_at FROM progress WHERE user_id = ?").bind(userId).first();
  if (!row) return json({ mastered: [], updated_at: null });
  let mastered = [];
  try { mastered = JSON.parse(row.mastered); } catch { mastered = []; }
  return json({ mastered, updated_at: row.updated_at });
}

const MAX_IDS = 20000;
const VALID_ID = /^w\d{1,6}$/;

async function putProgress(request, env) {
  const userId = await session(request, env);
  if (!userId) return json({ error: "not signed in" }, 401);

  let body;
  try { body = await request.json(); } catch { return bad("expected JSON"); }
  if (!Array.isArray(body?.mastered)) return bad("`mastered` must be an array of word ids");
  if (body.mastered.length > MAX_IDS) return bad("too many ids", 413);

  // Normalised before storage: unique, sorted, well-formed ids only.
  const ids = [...new Set(body.mastered)].filter((id) => typeof id === "string" && VALID_ID.test(id)).sort();
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      "INSERT INTO progress (user_id, mastered, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET mastered = excluded.mastered, updated_at = excluded.updated_at"
    )
    .bind(userId, JSON.stringify(ids), now).run();
  return json({ ok: true, count: ids.length, updated_at: now });
}

// GDPR deletion: actually deletes. D1 does not enforce foreign keys by
// default, so children go explicitly rather than by cascade.
async function deleteAccount(request, env) {
  const userId = await session(request, env);
  if (!userId) return json({ error: "not signed in" }, 401);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM progress WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM login_tokens WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]);
  return json({ ok: true }, 200, { "set-cookie": clearCookie() });
}
