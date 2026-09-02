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
```

`index.html` is a single self-contained file (GitHub Pages serves it as a static
page, no build step on their side). It embeds the app document JSON-encoded on
one line and the assets gzip+base64 on another, so editing it directly is
impractical and every diff reads as "1 line changed".

**Edit `src/`, then rebuild.**

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

GitHub Pages serves `index.html` from `main`. Commit the rebuilt `index.html`
alongside the `src/` change; `npm run check` catches a forgotten rebuild.

## Progress sync

Progress lives in `localStorage` (`openkanji.seen`, `openkanji.mastered`,
`openkanji.gamewins`, plus the last deck and language). Optional email-only
accounts sync the mastered set, last deck and language via Supabase -- see
[docs/sync-design.md](docs/sync-design.md) for the schema, policies and
redirect URLs. Inert until `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set in
`src/app.html`.
