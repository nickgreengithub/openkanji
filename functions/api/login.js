// POST /api/login  { email }  -> mints a magic link and emails it.
//
// Always answers the same way whether or not the address is already
// registered: a differing response would let anyone test which emails have
// accounts.
import { json, bad, isEmail, randomToken, sha256, rateLimited } from "../_lib.js";

const TOKEN_MINUTES = 15;

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  if (!db || !env.RESEND_API_KEY || !env.MAIL_FROM) {
    return json({ error: "server not configured" }, 500);
  }

  let body;
  try { body = await request.json(); } catch { return bad("expected JSON"); }
  const email = String(body?.email || "").trim().toLowerCase();
  if (!isEmail(email)) return bad("enter a valid email address");

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (await rateLimited(db, "ip", ip, 10, 3600)) return bad("too many requests, try later", 429);
  if (await rateLimited(db, "email", email, 5, 3600)) return json({ ok: true });

  const now = Math.floor(Date.now() / 1000);
  let user = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (!user) {
    const res = await db.prepare("INSERT INTO users (email, created_at) VALUES (?, ?)").bind(email, now).run();
    user = { id: res.meta.last_row_id };
  }

  const token = randomToken();
  await db
    .prepare("INSERT INTO login_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), user.id, now + TOKEN_MINUTES * 60)
    .run();

  const link = new URL(request.url).origin + "/api/verify?t=" + encodeURIComponent(token);
  const sent = await sendMail(env, email, link);
  if (!sent.ok) {
    console.error("resend failed:", sent.detail);
    return json({ error: "could not send the email" }, 502);
  }
  return json({ ok: true });
}

async function sendMail(env, to, link) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: "Bearer " + env.RESEND_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to,
      subject: "Your OpenKanji sign-in link",
      text:
        "Sign in to OpenKanji:\n\n" + link +
        "\n\nThe link works once and expires in " + TOKEN_MINUTES + " minutes." +
        "\nIf you did not ask for it, ignore this email.\n",
    }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, detail: res.status + " " + (await res.text()).slice(0, 300) };
}
