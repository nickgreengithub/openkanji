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
  },
  es: {
    subject: "Tu enlace de acceso a OpenKanji",
    lead: "Pulsa abajo para acceder y sincronizar tu progreso.",
    button: "Acceder a OpenKanji",
    expiry: "El enlace funciona una sola vez y caduca en 15 minutos.",
    ignore: "Si no has pedido acceder, ignora este correo.",
  },
};

async function sendLink(env, email, link, lang) {
  const t = MAIL[(lang || "en").toLowerCase()] || MAIL.en;
  const html =
    '<div style="font:16px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;color:#16232c">' +
    '<p style="font-size:22px;margin:0 0 18px">開 OpenKanji</p>' +
    "<p>" + t.lead + "</p>" +
    '<p style="margin:26px 0"><a href="' + link + '" style="background:#0891b2;color:#fff;padding:12px 20px;text-decoration:none">' + t.button + "</a></p>" +
    '<p style="color:#5f7384;font-size:14px">' + t.expiry + " " + t.ignore + "</p></div>";
  await env.EMAIL.send({
    to: email,
    from: env.MAIL_FROM,
    subject: t.subject,
    html,
    text: t.lead + "\n\n" + link + "\n\n" + t.expiry + " " + t.ignore,
  });
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
    await sendLink(env, email, link, body.lang);
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
  const row = await env.DB.prepare("select mastered, deck, lang from progress where user_id = ?").bind(userId).first();
  let mastered = {};
  try {
    mastered = row ? JSON.parse(row.mastered) : {};
  } catch (e) {}
  return json({ mastered, deck: (row && row.deck) || null, lang: (row && row.lang) || null });
}

async function handlePutProgress(request, env, userId) {
  const body = await readJson(request);
  if (!body) return json({ error: "bad_body" }, 400);
  const incoming = cleanMastered(body.mastered);
  if (!incoming) return json({ error: "bad_mastered" }, 400);

  // Union on the server as well as the client: a device that saves without
  // having loaded first can only ever add progress, never erase another
  // device's. (The flip side, by design: un-mastering does not propagate.)
  const row = await env.DB.prepare("select mastered from progress where user_id = ?").bind(userId).first();
  let merged = incoming;
  if (row) {
    try {
      merged = Object.assign({}, JSON.parse(row.mastered), incoming);
    } catch (e) {}
  }

  await env.DB.prepare(
    "insert into progress (user_id, mastered, deck, lang, updated_at) values (?1, ?2, ?3, ?4, ?5)" +
    " on conflict(user_id) do update set mastered = ?2, deck = ?3, lang = ?4, updated_at = ?5"
  ).bind(userId, JSON.stringify(merged), cleanLabel(body.deck, 40), cleanLabel(body.lang, 8), now()).run();

  return json({ ok: true, count: Object.keys(merged).length });
}

// ---------- router ----------

export default {
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
      return json({ email: user.email });
    }

    // Everything below needs a live account.
    if (!user) return json({ error: "signed_out" }, 401, userId ? { "set-cookie": cookieHeader("", 0) } : {});
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
