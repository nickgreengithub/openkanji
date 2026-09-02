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
src/data/decks.json              deck load order
src/data/langs.json              language registry
src/data/kanji/<deck>.json       language-neutral: character, readings, word surfaces
src/data/lang/<lang>/<deck>.json meaning, mnemonic sentence, gloss per word
```

Structure and translation are separate files, so adding a language never
touches the kanji themselves and two translators never conflict.

**Add a deck**: write `src/data/kanji/<deck>.json`, add the matching
`src/data/lang/en/<deck>.json`, add a line to `decks.json`. The deck stops
showing "coming soon" on its own once it has kanji.

**Add a language**: create `src/data/lang/<dir>/` with one file per deck, using
the same shape as `en/`. The language stops showing "soon" once its folder
covers every deck.

`build.js` validates on every build and fails with the file, index and kanji:

```
Error: kanji/jlpt-n5.json[92] (生): already defined in kanji/jlpt-n5.json
Error: ES 一: missing gloss for "一人"
Error: ES: missing data/lang/es/jlpt-n4.json (a language must cover every deck)
```

A half-finished translation is a build failure, not a page with blank glosses.
Untranslated languages simply don't ship.

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
`openkanji.gamewins`). Optional email-only accounts sync the mastered set via
Supabase -- see [docs/sync-design.md](docs/sync-design.md). Inert until
`SUPABASE_URL` and `SUPABASE_ANON_KEY` are set in `src/app.html`.
