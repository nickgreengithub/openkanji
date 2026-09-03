# OpenKanji

JLPT kanji and vocabulary study. Live at
<https://nickgreengithub.github.io/openkanji/>.

## Layout

```
index.html          generated deploy target -- DO NOT EDIT BY HAND
src/app.html        the app: styles, template, and all logic
src/shell.html      bundler bootstrap, with two generated-line placeholders
src/assets/         fonts + React UMD, plus manifest.json describing them
tools/build.js      src/ -> index.html
worker/             the progress-sync API (Cloudflare Worker + D1)
```

`index.html` is a single self-contained file (GitHub Pages serves it as a static
page, no build step on their side). It embeds the app document JSON-encoded on
one line and the assets gzip+base64 on another, so editing it directly is
impractical and every diff reads as "1 line changed".

**Edit `src/`, then rebuild.**

## What the app is

One screen: a grid of word cards, five across and four down. Words come in
sets of twenty -- a sitting -- picked from the sidebar, with a study game,
flashcards and writing practice scoped to the set on screen. Progress is the
set of words you have marked mastered, and nothing else.

A card at rest is the word, its kana and its meaning. Hovering swaps the lower
half for the example sentence and raises the tick that marks the word learned;
the word itself never moves. A card with no example sentence keeps its meaning
on hover rather than emptying.

There is deliberately no per-kanji lesson. A kanji does not have a meaning so
much as a distribution of them, so an English gloss under a glyph (`連 = take
along, connect`) is an editorial summary rather than a fact a learner can be
tested on -- and it misdirects when the compound sense dominates. The corpus is
still stored by kanji, because that is how the readings hang together; the app
flattens it into words at load. A word written with two or more kanji shows its
kana split at the character boundaries (関連 -> かん・れん), which is the part of
a kanji that does generalise.

The list is capped at the first hundred words of a deck, and the deck is
whichever one was last saved: word ordering and deck choice are open
questions, not settled ones.

## Kanji data

```
src/data/decks.json          deck load order
src/data/langs.json          language registry
src/data/kanji/<deck>.json   the kanji, with every translation inline
src/data/ui.json             interface strings, {key: {lang: text}}
```

Each record holds everything about one kanji, translations included:

```json
{ "c": "一",
  "meaning":  { "en": "one", "es": "uno" },
  "sentence": { "en": "One person alone took one thing." },
  "g": [{ "r": "イチ", "w": [["一", "いち", { "en": "one", "es": "uno" }]] }] }
```

Translated fields are `{lang: text}`. There are no keys to match between files,
so nothing can drift out of sync.

**Add a deck**: write `src/data/kanji/<deck>.json`, add a line to `decks.json`.
It stops showing "coming soon" on its own once it has kanji.

**View decks** re-order kanji that already exist instead of defining any:
`decks.json` gives `order` instead of `file`, pointing at a JSON array of
kanji ids in `src/data/`. A kanji is still defined exactly once, and the view
shares its words, so progress is shared with the level decks.
`src/data/core-10000.json` is every ranked kanji in frequency order; the
Core 1000 deck shows its first 1000 (`limit` in `decks.json`). Regenerate it
after adding kanji with

```sh
node tools/core-order.js <kanji-frequency.json>   # { "漢": rank, ... }
```

**Add a language**: add its code to every translated field (kanji, words and
`ui.json`), and to `langs.json`. The `ja` label is the language's full Japanese
name (英語, not 英). A language ships only when it is *complete* -- a partial one is
reported and omitted, so the picker never offers half-translated content.

`build.js` validates every build and names the file, index and kanji:

```
Error: jlpt-n5.json[92] (生): already defined in jlpt-n5.json
Error: jlpt-n5.json[8] (一): `meaning.es` is empty
Error: unknown language code 'klingon' -- add it to data/langs.json
  note: 'es' is incomplete and will not ship
```

## Build

```sh
npm run build     # regenerate index.html from src/
npm run check     # fail if index.html is stale (no write)
npm run serve     # serve locally on :8080
```

No dependencies -- `build.js` is plain Node.

## Deploying

Cloudflare Worker `openkanji`, serving both the site and the API at
openkanji.org. Static assets come from `dist/`; `/api/*` is handled by
`worker/src/index.js`.

Pushing to `main` deploys, through `.github/workflows/deploy.yml`: it runs
`npm run check` and the worker tests, then builds and ships with
`cloudflare/wrangler-action`. Pull requests run the checks without deploying,
and `workflow_dispatch` re-deploys `main` by hand from the Actions tab.

Two repository secrets are required (Settings -> Secrets and variables ->
Actions):

| Secret | Where it comes from |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare -> My Profile -> API Tokens, **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | the dashboard URL, or `npx wrangler whoami` |

The build step is not optional: `dist/` is gitignored, so the built page never
travels with the commit and anything that deploys has to rebuild first.

**One deploy path only.** If Cloudflare's Workers Builds git integration is
also connected in the dashboard, turn one of the two off -- otherwise every
push deploys twice and the two can race.

To deploy by hand:

```sh
npm run build && npx wrangler deploy
```

`npx wrangler deploy` is the Workers command -- `wrangler pages deploy` is for
Pages projects and will fail here.

Secrets live on the Worker, never in the repo:

```sh
npx wrangler secret put RESEND_API_KEY --name openkanji
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET --name openkanji
```

Worker tests:

```sh
cd worker && npm test
```

## Progress sync

Progress lives in `localStorage` (`openkanji.seen`, `openkanji.mastered`,
`openkanji.gamewins`, plus the last deck and language). Optional email-only
accounts sync the mastered set, last deck and language through `worker/` -- a
Cloudflare Worker over D1, with magic-link sign-in and an HttpOnly session
cookie. See [docs/sync-design.md](docs/sync-design.md) for the API, schema,
security notes and deployment steps.

```sh
cd worker && npm test     # 24 tests, real SQL against an in-memory SQLite
```

Sync is inert until `API_BASE` is set in `src/app.html`; until then the app
keeps progress on the device, exactly as it does now.
