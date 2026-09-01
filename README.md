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
