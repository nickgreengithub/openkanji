// GET /api/verify?t=  -> consumes the magic link, sets the session cookie.
//
// Redirects rather than returning JSON: this URL is opened from an email
// client, so the user must land on the app.
import { sha256, makeSession, sessionCookie } from "../_lib.js";

const redirect = (origin, query) =>
  new Response(null, { status: 302, headers: { location: origin + "/" + query } });

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;
  const db = env.DB;
  if (!db || !env.SESSION_SECRET) return redirect(origin, "?signin=error");

  const token = new URL(request.url).searchParams.get("t");
  if (!token) return redirect(origin, "?signin=invalid");

  const hash = await sha256(token);
  const row = await db
    .prepare("SELECT user_id, expires_at FROM login_tokens WHERE token_hash = ?")
    .bind(hash)
    .first();

  // Single use: consumed whether or not it had expired, so a leaked link
  // cannot be retried.
  if (row) await db.prepare("DELETE FROM login_tokens WHERE token_hash = ?").bind(hash).run();
  if (!row || row.expires_at < Math.floor(Date.now() / 1000)) return redirect(origin, "?signin=expired");

  const session = await makeSession(env.SESSION_SECRET, row.user_id);
  return new Response(null, {
    status: 302,
    headers: { location: origin + "/?signin=ok", "set-cookie": sessionCookie(session) },
  });
}
