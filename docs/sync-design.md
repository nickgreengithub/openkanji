# Email-only accounts + progress sync — Cloudflare

Status: **design agreed, not implemented.** Supersedes the earlier Supabase plan.

## Decisions

| Decision | Choice |
|---|---|
| What syncs | mastered word ids only — not `seen`, not `gamewins` |
| Progress key | stable word id (`w0142`), never surface text |
| Timestamps | none, booleans only |
| Sync trigger | explicit **Save** / **Load** — no background sync |
| Load semantics | merge (union): local OR server ⇒ mastered |
| Auth | magic link, built in a Worker (no auth vendor) |
| Hosting | Cloudflare Pages |
| Database | D1 |
| Email | third party (Resend or MailChannels) — Cloudflare sends no mail |

Consequence of no timestamps: **un-mastering doesn't propagate.** Un-check on the
laptop, Load on the phone, it returns. Accepted.

## What changed since the Supabase draft

- **Progress is keyed on stable word ids, not text.** The old draft said
  `{"word|reading": true}`. It is now `{"w0142": true}`. This matters much more
  with a server: a gloss or reading can be corrected without invalidating anyone's
  stored progress.
- **Save/Load are built** and currently export/import a JSON file. That stays as
  the signed-out path.
- Save lives on the study screen, Load on home.

## Architecture

```
Cloudflare Pages   static site (replaces GitHub Pages)
  └── Worker       /api/*  auth + progress
        └── D1     users, login_tokens, progress
        └── Resend outbound magic-link email
```

Same origin, so no CORS and no preflight. Cookies are first-party.

Moving hosting to Pages also fixes the deploy-visibility problem: GitHub Pages
sends `cache-control: max-age=600`, so changes take up to ten minutes to appear
and a hard refresh often isn't enough. Cloudflare lets us set that and purge on
deploy.

## Schema (D1 is SQLite)

```sql
create table users (
  id         integer primary key autoincrement,
  email      text    not null unique,
  created_at integer not null
);

-- Only the hash is stored: a leaked database must not yield usable login links.
create table login_tokens (
  token_hash text    primary key,
  user_id    integer not null references users(id) on delete cascade,
  expires_at integer not null
);

-- One row per user. `mastered` is a JSON array of word ids.
create table progress (
  user_id    integer primary key references users(id) on delete cascade,
  mastered   text    not null default '[]',
  updated_at integer not null
);

create index login_tokens_expiry on login_tokens(expires_at);
```

**Why one JSON row and not a `progress(user_id, word_id)` table.** D1's free tier
meters *rows read* (5M/day). Normalised, one Load reads up to N rows per user and
scales with the corpus — 658 words today, thousands later. As a blob it is exactly
**one row read per Load and one write per Save**, regardless of corpus size. The
data is always read and written whole, so normalising buys nothing here and costs
the cheaper pricing dimension. Revisit only if per-word timestamps are ever wanted.

`on delete cascade` means account deletion is one `delete from users`.

## Auth: magic link in ~120 lines

Cloudflare has no consumer auth product (Access is zero-trust for teams), so this
is hand-rolled. It is small because the requirements are small.

| Endpoint | Does |
|---|---|
| `POST /api/login` | body `{email}` → mint token, store **hash**, email the link |
| `GET /api/verify?t=` | validate + consume token, set signed session cookie, redirect home |
| `GET /api/progress` | session → return `{mastered: [...]}` |
| `PUT /api/progress` | session → replace the row |
| `POST /api/logout` | clear cookie |
| `DELETE /api/account` | delete the user, cascading progress |

- Token: 32 random bytes, base64url. Store only `SHA-256(token)`; single use;
  15 minute expiry.
- Session: signed cookie (HMAC-SHA256 via Web Crypto, secret in Workers Secrets),
  `HttpOnly; Secure; SameSite=Lax`. No JWT library needed.
- Rate limit `/api/login` per email and per IP — it sends mail, so it is the abuse
  surface.

**Email is the one external dependency.** Cloudflare sends none. MailChannels'
free Workers API ended in 2024; its replacement free plan is 100 emails/day, and
Cloudflare's docs now point at Resend. Either works from a Worker over `fetch`, so
the choice is reversible — one function.

Deliverability improves a lot once mail comes from openkanji.org with SPF/DKIM,
which is another argument for settling the domain first.

## Client changes

Small, because the shape already fits:

- `SUPABASE_URL` / `SUPABASE_ANON_KEY` → a single `API` base (same origin, so `""`).
- `sendMagicLink` → `POST /api/login`.
- `pushMastered` / `pullMastered` → `PUT` / `GET /api/progress`, sending the id
  array that `allKeys()` already produces.
- Session is a cookie, so `restoreSession()` becomes `GET /api/me`; the
  `openkanji.token` localStorage entry goes away.
- Signed out, Save/Load keep exporting and importing the JSON file.

The union merge is unchanged and still conflict-free.

## DNS

This replaces the earlier GitHub Pages instructions. Cloudflare Pages wants the
zone on Cloudflare, so at Namecheap you change **nameservers** to the pair
Cloudflare gives you — not A records. Cloudflare then manages the DNS, the
certificate and the cache.

## Cost

Free tier covers this comfortably: Workers 100k requests/day, D1 5M row reads and
100k row writes/day with 5GB storage. One Save is one row write, so 100k writes/day
is ~100k saves. Email is the first thing to hit a ceiling, at 100/day free.

## Privacy

Stored: an email address and a list of word ids. The email is still personal data
under GDPR, so the site needs a short note on what is stored and a delete path —
`DELETE /api/account` above.

## Open

- Resend vs MailChannels.
- Copy for the sign-in prompt and the "check your email" state.
- Whether to keep the file export once accounts exist (recommend yes — it is the
  offline and no-account path).
