# Email-only accounts + progress sync — design

Status: **implemented and tested, not yet deployed.** The API lives in
`worker/`; the client half is in `src/app.html`. Sync is inert until
`API_BASE` is filled in (see *Deploying* below).

Everything runs on Cloudflare: Pages for the site, a Worker for the API, D1 for
the data, Email Service for the sign-in mail. One vendor, one dashboard, and
the auth is reusable by the next app on the same account.

## Decisions

| Decision | Choice |
|---|---|
| What syncs | `mastered`, plus the last `deck` and `lang` — not `seen`, not `gamewins` |
| Timestamps | None per word. Booleans only; `updated_at` on the row is informational |
| Sync trigger | Explicit **Save** / **Load**, plus one automatic Load on return from a sign-in link |
| Load semantics | `mastered`: **merge** (union). `deck`/`lang`: server wins |
| Save semantics | `mastered`: union, **server-side too**. `deck`/`lang`: last writer wins |
| Auth | Magic link by email. No password, no third-party identity |
| Session | HttpOnly cookie, HMAC-signed, 180 days |
| Progress files | None. Signed out, progress stays in `localStorage` |

Known consequence of dropping timestamps: **un-mastering doesn't propagate.**
Un-check a word on the laptop, Load on the phone, it comes back. Accepted — and
now enforced on the server as well, which is what makes a save from a device
that never loaded unable to erase another device's progress.

## Shape

```
openkanji.org/*        Pages    the static site (index.html)
openkanji.org/api/*    Worker   this API
                       D1       users, progress, login_tokens
                       Email    the sign-in mail
```

The Worker is routed on **the site's own origin**, which is the load-bearing
choice: the session cookie is then first-party, there is no CORS, and no token
is ever handed to JavaScript. Putting the API on `api.openkanji.org` would work
but costs a CORS preflight on every call and a `SameSite=None` cookie.

## API

| | |
|---|---|
| `POST /api/login` | `{email, lang}` → sends a sign-in link. Uniform reply: never reveals whether an address has an account |
| `GET /api/callback?token=` | verifies, sets the cookie, redirects to `/#signed-in` (or `/#sign-in-failed`) |
| `GET /api/me` | `{email}` — **`{email: null}` with a 200 when signed out**, because the app asks on every page load and an error there is console noise |
| `GET /api/progress` | `{mastered, deck, lang}` |
| `PUT /api/progress` | `{mastered, deck, lang}` — unions `mastered` into the stored set |
| `POST /api/logout` | clears the cookie |
| `DELETE /api/account` | erases the account, its progress and its sign-in rows |

## Schema

```sql
create table users (
  id integer primary key autoincrement,
  email text not null unique,
  created_at integer not null
);
create table progress (
  user_id integer primary key references users(id) on delete cascade,
  mastered text not null default '{}',   -- JSON { "w0226": true }
  deck text, lang text,
  updated_at integer not null
);
create table login_tokens (
  hash text primary key,                 -- SHA-256 of the token, never the token
  email text not null, ip text,
  created_at integer not null, expires_at integer not null, used_at integer
);
```

`mastered` is keyed by **stable word id**, so correcting a reading or a gloss
never invalidates anyone's progress. The full schema, with indexes, is
`worker/schema.sql`.

## Security

Nothing here is sensitive — the worst a stolen session buys is somebody else's
list of mastered words. The care goes somewhere else: **an endpoint that sends
email on demand is an abuse target**, and a magic link is easy to get subtly
wrong. So:

- **Tokens are stored as SHA-256, never in the clear.** A dump of the database
  cannot be replayed to sign in as anyone.
- **Single use, 15 minutes.** Claiming a token and marking it used are one
  `UPDATE ... WHERE used_at IS NULL ... RETURNING`, so two clicks cannot both win.
- **Rate limited in two dimensions**: 5 links per address per hour, 20 per IP
  per hour. `login_tokens` doubles as the ledger, so this needs no extra table
  and no extra write.
- **Sessions are HMAC-signed** (`payload.signature`, verified with WebCrypto)
  and the account is **re-resolved on every request**. A stateless cookie alone
  would keep verifying after the account was deleted; resolving the user is
  what makes deletion final.
- **Cookie is `HttpOnly; Secure; SameSite=Lax`.** `Lax` is also the CSRF
  defence: it withholds the cookie from cross-site `PUT`/`DELETE`.
- **Writes are validated, not just stored.** Keys must look like `w1234`, the
  set is capped at 20,000 entries and the body at 512 KB, and deck/language
  labels are length-capped. Otherwise the row is a free object store.
- **The callback only ever redirects to `SITE_URL`**, so it cannot be turned
  into an open redirect.

Tests for all of the above: `worker/test/worker.test.mjs`, run with `npm test`
in `worker/`. They exercise the real SQL against an in-memory SQLite.

## Deploying

1. **D1**

   ```sh
   npx wrangler d1 create openkanji            # put the id in wrangler.toml
   npx wrangler d1 execute openkanji --remote --file=worker/schema.sql
   ```

2. **Secret and vars** — `SESSION_SECRET` signs the cookie; rotating it signs
   everyone out, which is the intended panic button.

   ```sh
   npx wrangler secret put SESSION_SECRET      # 32+ random bytes
   ```

   Set `MAIL_FROM` and `SITE_URL` in `wrangler.toml`.

3. **Email Service** — verify the sending domain in the dashboard. Sending to
   arbitrary recipients needs the **Workers Paid plan** ($5/month, 3,000 emails
   included); without it only addresses verified in your own account receive
   mail, which is enough to test but not to ship.

4. **Route** — uncomment the `routes` line in `wrangler.toml` so the Worker
   serves `openkanji.org/api/*`, then `npx wrangler deploy`.

5. **Site** — deploy `index.html` to Cloudflare Pages on the same domain.

6. **Switch it on** — set `API_BASE = "/api"` in `src/app.html`, rebuild,
   commit. Until then the app runs exactly as it does today, with progress in
   `localStorage`.

## Privacy

Stored: an email address, a set of mastered word ids, a deck name and a
language code. Nothing else — no timestamps per word, no analytics, no IP
beyond the hour-long rate-limit window in `login_tokens`.

The email is still personal data under GDPR, so the site needs a short note
saying what is stored and offering deletion. `DELETE /api/account` is the
mechanism and it is complete (account, progress and sign-in rows), but **it has
no UI affordance yet** — that is the one piece of this design still to place.

## Open

- Where the delete-account control lives in the nav, and its confirm step.
- Un-mastering does not propagate. If it should, add an `unmastered` tombstone
  set alongside `mastered`; still no timestamps.
