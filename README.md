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

**On a phone there are no dialogs -- everything is a page.** Practice, a
word opened large, Write and Settings each take the whole screen, arriving
from the right with their own header: a close or back control top-left, the
title centred, and the primary action in a bar at the foot where a thumb
is. Each pushed page takes a history entry, so the phone's own Back button
closes it instead of leaving the app. The map's foot carries Continue; the
set's carries the Learn / Recall switch and Practice. Swiping left or right
moves a set on the set page and a word on the word page. Touch targets are
44px, the layout honours the notch and the home indicator on every edge,
and the app is sized to the dynamic viewport so the keyboard cannot push
the composer off-screen. The map is five tiles across with the four rings
two by two; cards are one column, word over sentence, with the speaker at
the card's bottom-right.

**Visually**: one accent, reserved for progress and the primary action;
everything else neutral. Cards and tiles are rounded surfaces with a faint
shadow; there are no hairlines between things.

Sentences live in `words.json` as `sentences: [{ ja, t: { en, es } }]` and are
keyed by word id, so a word can be corrected without invalidating anyone's
progress. A word without a sentence shows its meaning and nothing below it.

## The story of a set

Twenty words drilled one at a time are twenty things to remember. The same
twenty inside a story are one thing, and the story is what pulls them back out
later. So a set can carry one, in `src/data/stories.json`:

```json
{ "0": {
    "title": { "ja": "音の味", "en": "The Taste of Sound", "es": "El sabor del sonido" },
    "pages": [ [ { "ja": "田中先生は不思議な学者です。",
                   "t": { "en": "Professor Tanaka is a strange scholar.",
                          "es": "El profesor Tanaka es un erudito peculiar." } } ] ],
    "words": { "不思議": { "r": "ふしぎ", "en": "strange, curious", "es": "extraño, curioso" },
               "使って":  { "of": "使う" } } } }
```

A story is written to read like a story, not to stay inside the twenty words a
learner has -- at set 1 that vocabulary is nearly empty, and prose written out
of it comes out as a list wearing a plot. Anything past the set is glossed
instead, under `words`, keyed by the span **as it appears in the line** so no
stemming is needed to recognise it. A conjugated form of one of the set's own
words points home with `of`, and the reader who taps 使って is told about 使う.

Each translation belongs to one sentence rather than a paragraph, so the eye
can fall to the line under the one it is reading and come back.

The build (`tools/build.js`, `buildStories`) splits every line into spans
against that table and refuses the story if a gloss is never used, if a line
holds anything that is not Japanese, or -- the one that matters -- if the story
has quietly stopped carrying one of its set's twenty words.

The serial these chapters belong to -- its town, its three people, and the
rules a chapter is written to -- is `docs/serial.md`.

## The teacher's sheet

A set can also be opened as something to teach from: `src/data/teach.json` holds
ten prompts for it, and the app draws the rest of the sheet from the set itself
-- the twenty words with their readings, meanings and example sentences, and the
chapter they belong to. Nothing on it is written twice, so it cannot fall out of
step with the set it describes.

The prompts are questions, not answers, and that is the whole design: the teacher
is a native speaker who can take any answer apart better live than we could write
it down. Two kinds, `ask` (Japanese to put to the student, with a translation for
a tutor who is not a native speaker) and `do` (something to do, in the teacher's
own language). The build rejects English inside the Japanese, and reports the
words a prompt leans on that the student has not met yet -- teacher's speech is
allowed to run ahead, but not by much, and the number is worth watching.

It prints. The print stylesheet drops the app's chrome and opens the sheet out
flat, so `Cmd-P` is the PDF nobody has to maintain.

## How a set of twenty is chosen

The ladder is the two thousand commonest words the corpus has, and nothing
else decides which two thousand. Every word carries a score:

```
"freq":  3.774   log10 of the word's share of running content words, in ppm
"cat":   1-20    a semantic category from src/data/categories.json (optional)
```

`freq` is computed for the whole corpus by `tools/freq.js` from the `cov`
figures each word already carries -- its share of television and film, of
anime and manga, and of books and news, averaged. Three cases are scored from
the median of the word's JLPT level instead, each flagged on the word so a
weak number is never mistaken for a measured one:

```
freqEst   the corpus has no figure at all (numbers and place names, mostly:
          一 二 三 日本 東京 -- a floor would bury them under 頗梨)
freqVar   a rarer spelling of a word the corpus counted under one reading, so
          the figure is not this spelling's: 見る 観る 診る 看る all carry the
          whole 5,941ppm of みる
freqKana  a word Japanese writes in kana. する is the commonest word in the
          language and nobody writes it 為る, so the figure belongs to a form
          this entry is not. A short hand-kept list -- data, to be argued with
```

### The twenty categories

`src/data/categories.json` is the list; this is what each one is taken to mean
when a word is tagged, so the same word lands in the same place every time.
Ten noun categories, five verb, two adjective, two feeling and one for the
rest -- the shape follows what a set of twenty needs to feel varied, not any
outside taxonomy.

| # | kind | name | what goes here |
|---|---|---|---|
| 1 | noun | Food & drink | anything eaten or drunk, and the meals themselves: 肉, 米, 昼ご飯, 酒 |
| 2 | noun | Body & health | body parts, illness, medicine, the physical self: 顔, 血, 病気, 薬 |
| 3 | noun | Home, objects & clothing | things you own, wear or keep: 服, 紙, 道具, 電池 |
| 4 | noun | Places, buildings & directions | where something is, and what stands there: 駅, 建物, 中, 港 |
| 5 | noun | Nature, weather & living things | outside and alive: 雪, 木, 鳥, 海 |
| 6 | noun | People, family & roles | who someone is: 人, 母, 医者, 友達 |
| 7 | noun | Work, school, money & shopping | the day's business: 仕事, 学校, 円, 店 |
| 8 | noun | Time, calendar & quantity | when and how much: 時, 年, 月, 半分 |
| 9 | noun | Society, events & situations | what happens between people: 事故, 会議, 場合, 政治 |
| 10 | noun | Ideas, information & communication | what is thought, said or recorded: 意味, 話, 問題, 情報 |
| 11 | verb | Movement | going, coming, carrying something there: 行く, 来る, 走る, 運ぶ |
| 12 | verb | Body & domestic | what a body does, and what is done at home: 食べる, 寝る, 洗う, 着る |
| 13 | verb | Handling & making | acting on a thing: 持つ, 作る, 使う, 開ける |
| 14 | verb | Speech, thought & social | acting on a person or an idea: 言う, 思う, 教える, 会う |
| 15 | verb | Change & occurrence | what happens rather than what is done: 起こる, 変わる, 始まる, 増える |
| 16 | adjective | Physical | measurable of a thing: 大きい, 重い, 暑い, 速い |
| 17 | adjective | Evaluative & character | a judgement of it: 良い, 難しい, 大切, 正しい |
| 18 | feeling | Positive states | 好き, 楽しい, 安心, 幸せ |
| 19 | feeling | Negative states | 怖い, 寂しい, 心配, 悲しい |
| 20 | other | Adverbs & degree | everything that modifies rather than names: 少し, とても, 主に, 必ず |

A word gets the category a learner would file it under, not the one its kanji
suggests: 用事 is Society rather than Handling, 気分 is a feeling rather than a
noun about the body. Where two fit, the commoner sense wins.

All two thousand words of the ladder are filed, in batches through
`tools/categorise.js`, which takes `{ "<word id>": <1-20> }`, applies a batch
whole or not at all, refuses to overwrite a judgement already made without
`--force`, and reports which categories the ladder is thin on -- a set can
only be spread as widely as the words there are to fill it. Food & drink is
the thinnest at 23 words, which is what it means for a set of twenty to draw
one word from each: the first set takes 水, the commonest word the corpus has
in that category, and the twenty-third set takes what is left.

The sets are then dealt from that order: each set of twenty takes the
commonest word whose category it has not used yet, and simply the commonest
one left when every category is spoken for or the word has no category. **The
order is the frequency order; categories only choose between words of similar
standing.** A set should be twenty unrelated words rather than twenty ways of
saying the same thing -- 音, 足音 and 音色 in one sitting is one lesson
pretending to be three -- but diversity is not worth teaching 漢語 before 私.

Two spellings of one word are one card: 開く is ひらく and あく, 市 is いち and
し, and the commoner reading stands for the spelling while the other keeps its
entry for lookup.

This was got wrong once, in a way worth recording. The ladder used to be
whichever words the first kanji of the deck happened to carry, taken in deck
order until there were two thousand, and only a hand-tagged hundred were ever
dealt by category at all -- so 漢語, the 5,296th commonest word of 5,876, was
taught in the fifth session while する, なる, 僕 and 姿 were not on the ladder
at all. The dealing was right and the pool it dealt from was not. Ordering by
score took the first hundred words from 2.3% of running content words to
20.5%, and the whole ladder from 39% to 49%.

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

## The story of a set

Twenty words drilled one at a time are twenty things to remember. The same
twenty inside a story are one thing, and the story is what pulls them back out
later. So a set can carry one, in `src/data/stories.json`:

```json
{ "0": {
    "title": { "ja": "音の味", "en": "The Taste of Sound", "es": "El sabor del sonido" },
    "pages": [ [ { "ja": "田中先生は不思議な学者です。",
                   "t": { "en": "Professor Tanaka is a strange scholar.",
                          "es": "El profesor Tanaka es un erudito peculiar." } } ] ],
    "words": { "不思議": { "r": "ふしぎ", "en": "strange, curious", "es": "extraño, curioso" },
               "使って":  { "of": "使う" } } } }
```

A story is written to read like a story, not to stay inside the twenty words a
learner has -- at set 1 that vocabulary is nearly empty, and prose written out
of it comes out as a list wearing a plot. Anything past the set is glossed
instead, under `words`, keyed by the span **as it appears in the line** so no
stemming is needed to recognise it. A conjugated form of one of the set's own
words points home with `of`, and the reader who taps 使って is told about 使う.

Each translation belongs to one sentence rather than a paragraph, so the eye
can fall to the line under the one it is reading and come back.

The build (`tools/build.js`, `buildStories`) splits every line into spans
against that table and refuses the story if a gloss is never used, if a line
holds anything that is not Japanese, or -- the one that matters -- if the story
has quietly stopped carrying one of its set's twenty words.

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

Write (and the kana-to-kanji candidates in its composer) calls a model. Inside
Claude Design the page got that for free through `window.claude`, which is
the host's bridge to the designer's own account; on the public site there is
no such object, so the app asks the Worker instead: `POST /api/ask` with the
same `{ system, messages }` and the text comes back. The Worker holds the key
as a secret the page never sees, answers only signed-in accounts, caps each
account at `AI_PER_HOUR` calls an hour (150), and bounds the prompt size. A
signed-out learner who opens Write is sent to the sign-in panel.

Upstream is DeepSeek, whose API is the OpenAI chat-completions shape -- one
POST, one JSON body -- so the Worker calls it over plain `fetch` and has no
dependencies at all.

Setup, once:

```
wrangler secret put DEEPSEEK_API_KEY   # a pay-as-you-go key from platform.deepseek.com
```

`AI_MODEL` in `wrangler.jsonc` picks the model (`deepseek-v4-flash` by
default); any name DeepSeek serves works, since it is an operator setting and
not user input. The per-account meter lives in an `ai_usage` table the Worker
creates on first use, so no migration is needed.

## Kanji data

```
src/data/decks.json          deck load order
src/data/langs.json          language registry
src/data/kanji/<deck>.json   the kanji, with every translation inline
src/data/ui.json             interface strings, {key: {lang: text}}
src/data/stories.json        a story per set, keyed by set number
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

## Listening

Words are read from a recording where one exists, and by the browser's own
speech engine where one does not.

Recordings win because they are the same on every machine and start at once.
`tools/voices.js` makes them with Google Cloud Text-to-Speech, reading each
word from its **kana reading** -- so the learner hears the reading the app
teaches, rather than whichever one an engine guesses for a kanji standing
alone -- and each example sentence as written, where context settles the
reading by itself. Clips land in `src/audio/<word id>.mp3` (and `.s.mp3` for
the sentence), the build copies them to `dist/audio/` and embeds the list of
what exists so a word without a clip never waits on a 404, and
`src/data/ladder.json` fixes which words come first. A story is recorded line
by line, as `story<set>-<n>.mp3`, so the page can light the line being read.

```sh
GOOGLE_TTS_KEY=... npm run voices -- --words 400
```

It skips anything already recorded, so a re-run costs nothing and a wider
`--words` only adds the new ones. The `Record voices` workflow does the same
on a runner from a `GOOGLE_TTS_KEY` secret and commits the result; it is
manual-dispatch only, because it spends money on that key.

The workflow deploys what it recorded itself, rather than leaving it to the
push: a commit made with `GITHUB_TOKEN` starts no workflow, so the clips
would otherwise sit on `main` until something unrelated happened to push.

A big run will meet rate limits whatever the pacing -- neural voices are
quota'd by characters per minute -- so clips retry with a long backoff, and
**a run that still loses some keeps the ones it got**. They are committed
before anything complains, and the workflow then fails with a count so you
know to run it again; the second run picks up only what is missing. Lower
`--lanes` if the quota keeps biting. Losing a run's work because a handful
of clips failed means paying for all of it twice.

### When there is no recording

Not every Japanese voice
a browser lists is on the machine: Chrome offers Google's network voices,
whose audio is fetched from Google's servers when you press play. That fetch
is the wait, and when it does not arrive the utterance ends instantly having
made no sound -- which looks exactly like a broken button. So an installed
voice always wins over a better-sounding one that is not, and when only a
network voice exists and it fails, the page says which voice and what to do
about it.

The engine can fail in other ways the page cannot see coming: no voices at all, voices but none Japanese, a
voice that refuses the language, or one that accepts the text and makes no
sound. All four used to look identical -- a button that did nothing -- which
made the difference between "your machine has no Japanese voice" and "the
app is broken" impossible to tell from the outside. Every failure now names
itself in a toast and logs the detail (`why`, the chosen voice, how many
voices exist) to the console. A voice that works says nothing at all.

## On a phone

Every overlay is a page rather than a dialog, and two rules keep it honest:

- **The page's own height is `100svh`** -- the viewport with the browser's
  chrome showing -- so a header can never begin underneath the address bar.
  `dvh` is the viewport the browser would like to have, which is not the same
  thing.
- **Surfaces a keyboard can cover follow `visualViewport`,** because on iOS
  neither `dvh` nor `svh` shrinks for the keyboard, and a focused field
  otherwise pushes the thing it is about off the bottom. A listener publishes
  `--ok-vh` (what is visible) and `--ok-kb` (what the keyboard covers); the
  sheets measure against the first, and everything pinned to the bottom
  offsets by the second. `--ok-vh` is published only when it looks sane, and
  every rule that reads it falls back to `100svh`: a browser that reports
  nonsense for its own viewport must not be able to collapse the page to
  nothing. `e2e.mjs` feeds it 0, 1, nothing, and an absurd number, and
  requires the map to stay readable through all four.
- **The page is drawn under the notch** (`viewport-fit=cover`), so every
  header pays for its own `env(safe-area-inset-top)`.

The word page centres its content, which only holds still because the block
is the same height every time: all 6112 glosses and all 520 example
sentences fit one line at phone width, and the six translations that take
two lines have that second line reserved for them.

## Build

```sh
npm run build     # regenerate index.html from src/
npm run check     # fail if index.html is stale (no write)
npm run serve     # serve locally on :8080
```

No dependencies -- `build.js` is plain Node.

The page carries its fonts and its runtime inside itself, base64'd in an
asset manifest. **Those assets ship uncompressed on purpose.** Gzipping them
means the browser has to undo it with `DecompressionStream`, which Safari
only got in 16.4 -- an iPhone older than that mints the runtime's compressed
bytes as a script, the parser rejects it, and the app boots to a blank page
with nothing on screen to say why. It costs about 20KB over the wire, since
the response is compressed anyway and base64-of-gzip does not compress
twice. `e2e.mjs` fails if any asset in the built page is marked compressed,
and again if the page does not boot with `DecompressionStream` removed.

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

`API_BASE` in `src/app.html` is `/api` -- the prefix the Worker routes its
endpoints under. It has to be that: with an empty string the page calls
`/login`, `/me` and `/ask`, the Worker 404s them, and sign-in and Write both
fail with a generic error.
