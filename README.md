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

Two screens, one metaphor: zoom out to the map, zoom in to a set.

**The map** is the home screen. The deck's name, a Continue button in the
header naming the set in hand (or the next unfinished one once that is
done), four progress rings, and every set of the deck as a numbered tile,
ten to a row -- fifty for a thousand-word deck. A tile fills with accent as its
twenty words are learned, turns solid when they all are, and the set in hand
wears a ring. Tapping a tile opens it. There is no other navigation: the map
is the only place that needs to list the sets, and it scales to fifty without
a trick.

**The set** is twenty cards under a quiet header: back to the map, the set's
name and count, a Learn / Recall switch, and one primary button, Practice
(the games and flashcards, scoped to these twenty). Nothing else. A card
is two columns: the word with furigana, its meaning and the Got it pill on
the left; the example sentence with the word lit, and its translation, on
the right, where a Japanese sentence gets a line long enough to hold it
(the earlier word-over-sentence card had to keep the sentence small to
avoid wrapping; that was a width problem). Two across on desktop, stacked
on a phone. Everything shows at once, no hover. The learned control
is a tick in the card's corner, icon only: an empty circle that fills. A
speaker bottom-right of the word column reads the word, then the sentence,
in the browser's own Japanese voice (the Web Speech API: free and instant,
but the voice is whatever the platform has -- good on Apple devices, uneven
elsewhere; pre-rendered audio is the upgrade if the feature earns it). The
focus view has the same button. Neither appears where the browser has no
speech synthesis. Tapping a card opens it large, with arrow keys
to walk the set, Enter to mark, Escape to close. At the foot of the cards,
where reading finishes, are Previous set and Next set; small chevrons either
side of the set's name and the arrow keys do the same. When the twentieth
Got it lands the name takes a check, the subtitle says Set complete, and Next
set becomes the primary button. Recall hides the answers -- meaning, translation, furigana -- and
pointing at a card shows that card's; opened large in Recall, a card is a
flashcard with a Show answer button (or Space).

**Progress saves itself.** There is no Save and no Load. Signed out, progress
lives on the device. Signed in, every mark is pushed after a short debounce
(and flushed if the tab closes mid-run), and the account's copy is loaded on
every start, so a second device simply shows it. The one avatar on every
screen shows who is signed in and, by its dot, the sync state: green synced,
amber saving, red failed, grey local. Its panel holds sign-in (a magic link
by email, no password), sign-out, and the two settings -- interface language
and furigana on or off.

**Practice** is a sheet over the set with three modes, each explained in a
few words (captions tell you what is, never what to do -- nothing says "tap
to reveal"): Flashcards (see the word, recall the meaning; seeing a card's back
twice marks it), Quiz (pick the word for the meaning -- ten rounds, the
first half easy, the second with confusable distractors), and Write (sentences,
checked by AI) -- the same sheet: the set's words as pills that tick as
they are used, a thread, verdicts as cards, a composer pinned to the foot. A finished set is still worth a run: with
nothing left unlearned, practice covers the whole set. The quiz ends on a
results screen that lists what was missed.

**What it is worth.** The top of the map is four rings on one honest 0-100
axis: this deck, then TV & film, anime & manga, books & news, each domain
with the share of everyday words the learner would now recognise as the
solid arc and the share this deck reaches when done as the lighter arc
behind it. A ring shows an 11% ceiling as a real slice where a bar showed a
sliver, which is why they are rings. There is no Continue card: the ringed
tile already says where you are, and a small Continue button in the header
is the one-tap resume. Each word carries `cov: [tv, manga, news]`, its share
of the running content words of each domain in parts per million, from
wordfreq (real token proportions; OpenSubtitles is the film and TV signal
inside it), JPDB and BCCWJ (ranks, given proportions by the wordfreq curve),
with every token folded to its dictionary form so 言っ and いう count for
言う. Coverage is over content words: particles, auxiliaries, symbols,
numerals, interjections and proper nouns are a baseline every learner gets
elsewhere, and counting them would make every number smaller and no more
true. JLPT N4's 451 words
are worth about 10-18% of a domain; the whole JLPT range roughly half. The
gap is the highest-frequency words of all -- する, いる, ある, ない, いい,
こと -- which are kana-only and sit in no kanji deck.

**Motion** only explains where you are or confirms what changed: the set
zooms in from the map and the map zooms back out; cards slide in the
direction of travel between sets; the focus view grows out of the card that
was tapped; the completion check pops once; sheets and the focus view leave with a
short fade rather than a cut, and views inside a sheet cross-fade.
Everything is under 250ms and honours `prefers-reduced-motion`.

**Visually**: one accent, reserved for progress and the primary action;
everything else neutral. Cards and tiles are rounded surfaces with a faint
shadow; there are no hairlines between things. On a phone the map is five
tiles across, the cards are one column, and a bottom bar carries Map, the
mode and Practice.

Sentences live in `words.json` as `sentences: [{ ja, t: { en, es } }]` and are
keyed by word id, so a word can be corrected without invalidating anyone's
progress. A word without a sentence shows its meaning and nothing below it.

## How a set of twenty is chosen

A set should be twenty unrelated words, not twenty ways of saying the same
thing -- 音, 足音 and 音色 in one sitting is one lesson pretending to be three.
So a word carries two more fields:

```
"cat":  1-20   a semantic category from src/data/categories.json
"freq": -2.24  blended corpus frequency, higher is commoner
```

The app deals the deck out like cards: one word from each category in turn,
commonest first. A set therefore holds the widest spread of meaning the deck
can give, and the words worth knowing first come first. Where a category runs
out, the set is topped up from whichever category has most left.

`freq` is a weighted mean of -log10(rank) across three corpora, renormalised
over the ones that have the word (a word missing from one list is usually a
tokenisation artefact -- 研究室 splits into 研究 + 室 -- not evidence of rarity):

```
50%  wordfreq ja   Wikipedia + OpenSubtitles + web + Twitter + Reddit
20%  JPDB v2.2     anime, drama, manga, light novels, visual novels
30%  BCCWJ         books, newspapers, magazines, government, web
```

Both fields are optional and only meaningful together. Tagged words are dealt
first; whatever is untagged follows in the order the deck had, so a partly
tagged deck still opens on its best-spread sets and the tail waits for its
tags. Today the first hundred words of each deck are tagged.

There is deliberately no per-kanji lesson. A kanji does not have a meaning so
much as a distribution of them, so an English gloss under a glyph (`連 = take
along, connect`) is an editorial summary rather than a fact a learner can be
tested on -- and it misdirects when the compound sense dominates. The corpus is
still stored by kanji, because that is how the readings hang together; the app
flattens it into words at load, and sets each kanji's reading above it as
furigana -- おん over 音, がく over 楽. Which sound belongs to which character is
the part of a kanji that does generalise, and ruby is how every Japanese
textbook says it. Where the split is not certain the ruby covers the whole
run instead, which is also the correct answer for a jukujikun like 大人 おとな.

The list runs to the first thousand words of a deck (JLPT N4 has 451, N1
about 3,000), and the deck is whichever one was last saved: deck choice, and
the order of the untagged tail, are open questions, not settled ones.

## Write, and the key behind it

Write (and the kana-to-kanji candidates in its composer) calls Claude. Inside
Claude Design the page got that for free through `window.claude`, which is
the host's bridge to the designer's own account; on the public site there is
no such object, so the app asks the Worker instead: `POST /api/ask` with the
same `{ system, messages }` and the text comes back. The Worker holds the key
as a secret the page never sees, answers only signed-in accounts, caps each
account at `AI_PER_HOUR` calls an hour (150), bounds the prompt size, and
calls the model through the official SDK. A signed-out learner who opens
Write is sent to the sign-in panel.

Setup, once:

```
wrangler secret put ANTHROPIC_API_KEY     # a pay-as-you-go key from console.anthropic.com
```

`AI_MODEL` in `wrangler.jsonc` picks the model (`claude-haiku-4-5` by
default, the app's original choice; `claude-sonnet-5` or `claude-opus-5` for
better marking at higher cost). The per-account meter lives in an `ai_usage`
table the Worker creates on first use, so no migration is needed.

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
