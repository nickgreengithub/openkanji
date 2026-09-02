# Email-only accounts + progress sync — design

Status: **implemented in the app, inert until configured.** The client is in
`src/app.html`; it activates when `SUPABASE_URL` and `SUPABASE_ANON_KEY` are
filled in. Still needed: a Supabase project with the schema below, and the
site origin(s) registered as redirect URLs.

## Decisions

| Decision | Choice |
|---|---|
| What syncs | `mastered`, plus the last `deck` and `lang` — not `seen`, not `gamewins` |
| Timestamps | None per word. Booleans only; `updated_at` on the row is informational |
| Sync trigger | Explicit **Save** / **Load** buttons, plus one automatic Load on return from the magic link |
| Load semantics | `mastered`: **merge** (union). Local OR server ⇒ mastered. `deck`/`lang`: server wins |
| Save semantics | `mastered`: upsert the local set. `deck`/`lang`: last writer wins |
| Progress files | None. Signed out, progress stays in `localStorage` only |
| Auth | Supabase magic link (email, no password) |
| Domain | Ship on openkanji.org before wiring auth |

Known consequence of dropping timestamps: **un-mastering doesn't propagate.**
Un-check a word on the laptop, Load on the phone, it comes back. Accepted.

## What's already built

The save control exists in the nav (`flex:0 0 13rem` container, click → `saveNow`):

- A text span bound to `userId`, which **already** renders
  `props.userEmail.split("@")[0]` when an email is present and falls back to
  `"Save Progress"` when there are unsaved changes.
- A `2.35rem` icon button — floppy disk, swapping to a checkmark for 1.6s after save.
- A hover tooltip already reading *"Email-only required"*.
- `saveNow` currently writes `localStorage` only; `_savedSig` / `masterSig()` track
  dirty state so the button greys out when there's nothing to save.

So the UI contract is settled. What's missing is a Load button, and a server.

## Why this is simpler than background sync

An earlier sketch assumed automatic sync, which needed a `localStorage` shim and an
interception of the bundler's `DOMContentLoaded` boot to win a race against the
app's one-and-only read of storage at mount.

**Explicit buttons remove all of that.** Load is a user action that happens long
after mount, so it can merge and call `setState({ mastered })` directly — the app
re-renders and `persistMastered()` writes through to `localStorage` as usual. No
shimming, no boot hook, no reload.

## No SDK

The bundle currently has **zero external network dependencies** (React is embedded).
Pulling in the Supabase JS SDK from a CDN would reintroduce one, plus a third-party
request on every page load.

Supabase is a plain REST API, so `fetch` is enough:

| Need | Call |
|---|---|
| Send magic link | `POST /auth/v1/otp` |
| Session | access token arrives in the URL fragment on return |
| Read progress | `GET /rest/v1/progress?select=mastered` |
| Write progress | `POST /rest/v1/progress` with `Prefer: resolution=merge-duplicates` |

~100 lines of `fetch`, no dependency added.

## Schema

```sql
create table public.progress (
  user_id    uuid primary key references auth.users(id) default auth.uid(),
  mastered   jsonb not null default '{}'::jsonb,
  deck       text,
  lang       text,
  updated_at timestamptz not null default now()
);

alter table public.progress enable row level security;
```

`user_id` defaults to `auth.uid()` so the client never sends it: the upsert
body is `{mastered, deck, lang, updated_at}` and the row is the caller's own.
`mastered` is a `{ "w0226": true }` map keyed by stable word id (see README),
so a gloss or reading correction never invalidates a save. `deck` and `lang`
are the app's own labels (`"JLPT N3"`, `"ES"`); the client ignores a value it
no longer recognises. `on delete cascade` means deleting the auth user
deletes their progress — a deletion request needs no extra code.

## Row Level Security

Without policies, RLS denies everything. These three are the entire security model,
enforced in the database, so a client bug cannot expose another user's row.

```sql
create policy "read own progress" on public.progress
  for select using ((select auth.uid()) = user_id);

create policy "insert own progress" on public.progress
  for insert with check ((select auth.uid()) = user_id);

create policy "update own progress" on public.progress
  for update using      ((select auth.uid()) = user_id)
              with check ((select auth.uid()) = user_id);
```

The `anon` key ships in the client and is designed to be public — it grants nothing
by itself. The `service_role` key bypasses RLS entirely and must never reach the
browser or the repo.

## Merge

`mastered` is a `{ "word|reading": true }` map. Union, per the decision above:

```js
const merge = (a = {}, b = {}) => {
  const out = { ...a };
  for (const k of Object.keys(b)) if (b[k]) out[k] = true;
  return out;
};
```

Conflict-free and order-independent, so two devices converge no matter who saves first.

## Session lifetime

The magic link returns `access_token` **and** `refresh_token` in the URL
fragment. Both are stored. An access token lasts an hour; on the first 401 the
client posts the refresh token to `/auth/v1/token?grant_type=refresh_token`,
stores the new pair and retries once. A failed refresh signs the learner out
cleanly rather than leaving a dead session in the nav.

## Redirect URLs

The link must land back on the page that sent it, so the OTP request carries
`redirect_to=<origin>/<path>`. Every origin the site is served from must be on
the Supabase allow list (Authentication → URL Configuration):

- `https://nickgreengithub.github.io/openkanji/`
- `https://openkanji.org/` once the DNS cutover happens

## UI change

The nav container grows from `13rem` to fit a second `2.35rem` button:

```
┌──────────────────────────────────────────┐
│  nickgreenemail        │  💾  │  ⤓  │
│  (userId / "Save Progress")  save   load │
└──────────────────────────────────────────┘
```

The click handler currently sits on the **container**, so it must move onto the save
icon itself — otherwise clicking Load would also trigger a save via bubbling. Each
button then greys out independently (`saveFill` when clean, load greyed when signed
out), consistent with how save already behaves.

## Sign-in flow

1. Signed out, the text span is a click target → prompts for an email.
2. `POST /auth/v1/otp` → "check your email".
3. The emailed link returns to openkanji.org with a token in the URL fragment; the
   app stores it and strips the fragment.
4. `userEmail` is set → the span switches to the local part, per existing `userId`.

Redirect URLs are configured per-origin in Supabase, which is why the domain should
be settled first — otherwise auth gets configured twice.

## Privacy

Stored: an email address and a set of mastered word keys. Nothing else. The email is
still personal data under GDPR, so the site needs a short note saying what's stored
and offering deletion (which is one `delete from auth.users`, cascading).

## Open

- Un-mastering does not propagate (see above). If it should, add a small
  `unmastered` tombstone set alongside `mastered`; still no timestamps.
