// Shared helpers for the OpenKanji API (Cloudflare Pages Functions).
//
// No dependencies: everything uses Web Crypto, which the Workers runtime
// provides. Sessions are signed cookies rather than JWTs -- the payload is a
// user id and an expiry, so a library would be all cost and no benefit.

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

export const bad = (message, status = 400) => json({ error: message }, status);

const enc = new TextEncoder();

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function sha256(text) {
  return b64url(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

export function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(secret, payload) {
  const key = await hmacKey(secret);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

// Constant-time compare: a fast-exit compare on a signature leaks it byte by
// byte to an attacker who can time requests.
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const SESSION_DAYS = 90;

export async function makeSession(secret, userId) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload = userId + "." + expires;
  return payload + "." + (await sign(secret, payload));
}

export async function readSession(secret, cookieHeader) {
  const raw = (cookieHeader || "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("ok_session="));
  if (!raw) return null;
  const value = decodeURIComponent(raw.slice("ok_session=".length));
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userId, expires, sig] = parts;
  if (!/^\d+$/.test(userId) || !/^\d+$/.test(expires)) return null;
  if (Number(expires) < Math.floor(Date.now() / 1000)) return null;
  const expected = await sign(secret, userId + "." + expires);
  if (!safeEqual(sig, expected)) return null;
  return Number(userId);
}

export const sessionCookie = (value) =>
  `ok_session=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;

export const clearCookie = () =>
  "ok_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";

// Deliberately permissive: the point is to reject obvious rubbish before
// spending an email send, not to police what a valid address looks like.
export const isEmail = (s) =>
  typeof s === "string" && s.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

export async function requireSession(context) {
  const secret = context.env.SESSION_SECRET;
  if (!secret) return { error: json({ error: "server not configured" }, 500) };
  const userId = await readSession(secret, context.request.headers.get("cookie"));
  if (!userId) return { error: json({ error: "not signed in" }, 401) };
  return { userId };
}

// Rolling window rate limit backed by the send_log table.
export async function rateLimited(db, kind, subject, max, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const since = now - windowSeconds;
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM send_log WHERE kind = ? AND subject = ? AND at > ?")
    .bind(kind, subject, since)
    .first();
  if (row && row.n >= max) return true;
  await db.prepare("INSERT INTO send_log (kind, subject, at) VALUES (?, ?, ?)").bind(kind, subject, now).run();
  // Opportunistic cleanup so the table cannot grow without bound.
  await db.prepare("DELETE FROM send_log WHERE at < ?").bind(now - 86400).run();
  return false;
}
