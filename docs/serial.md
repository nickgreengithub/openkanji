# 月の写真館 — the serial

One hundred chapters, one to a set of twenty words. Every chapter carries all
twenty; the words the reader has not met are glossed on a tap. Three lines a
page, one sentence to a line, as many pages as the story needs -- the first ten
run seven to nine.

Write it with `node tools/story-brief.js <set>` in front of you: it prints the
twenty, what the reader has already met, and the rules the build enforces.

## The frame

A photograph studio in a small seaside town. In the back room are a hundred
undeveloped negatives, taken across fifty years and never printed. Each chapter
one is developed, and the picture turns out to be about someone in the town.

The studio is quietly failing and the town is quietly emptying. Underneath every
chapter runs the promise of the first one: an old man who has waited at the
river for a friend who never came back.

Each chapter stands on its own. The promise, the studio and the three of them
run underneath, so they add up -- but most readers open a chapter because it is
the set they are on, not because they read the one before. So every chapter
says again, on its first page, who and where: Masao, the studio by the river,
the friend he has waited fifty years for, and whoever else is in it. Two or
three plain lines, never a recap of the plot.

## The three

Small enough to hold, distinct enough to hear without being named.

**ハル** — the child from the first chapter, twelve at the start. She asks the
questions the reader would ask, which is what keeps the explaining from sounding
like a lesson. She grows across the hundred: by the last tier she is the one
keeping the studio.

**正夫** — the photographer, eighty-odd. Slow speech, long memory, keeps promises
past the point of sense. He carries the past, and with it the harder words when
they arrive.

**ミナ** — Haru's neighbour, sharp and practical, wants out of the town. She is
the present tense: phones, exams, money, the city. Where Masao remembers, Mina
argues.

**円** — the studio cat, for the chapters that need one warm thing in them.

## The arc, against the ladder

The ladder ends in institutions and abstractions -- 審議, 廃止, 兵器, 措置 -- and
no story about a kitchen can reach them honestly. A town deciding its own future
can. So the arc is shaped to the vocabulary rather than the vocabulary squeezed
into the arc:

| tier | sets | the town | the words |
|---|---|---|---|
| 入門 | 1-20 | the studio, the street, the seasons | home, food, body, weather |
| 初級 | 21-40 | school, work, the shop that closes | money, jobs, study |
| 中級 | 41-60 | the bridge to be replaced, people leaving | change, society, situations |
| 上中級 | 61-80 | the old negatives: a war, an illness, a loss | the grim words, gently |
| 上級 | 81-100 | the town votes on its future; the promise resolves | institutions, abstractions |

## Chapters one to ten, as written

Each one asks a small question and answers it; underneath, the silent telephone
runs from chapter 2 to its answer in chapter 10.

1. **月の約束** -- Haru, twelve, asks the old photographer why he sits by the
   river every full moon. A promise: he and his friend Takagi were to meet there
   ten years after Takagi left. That was fifty years ago. She says she will come
   next month too.
2. **百の箱** -- A hundred boxes of film Masao never printed. Does he know if
   Takagi is alive? No -- that is the problem. The telephone rings at seven,
   and no one speaks.
3. **五十年前の道** -- The box Haru chose is printed: the main street, fifty
   years ago. In it, a young man with his eyes closed. Takagi, on the morning
   he left. Masao gives her the print.
4. **同じ時間の電話** -- Haru brings Mina, who thinks the studio is frightening.
   Seven is the hour of the promise. Mina answers the silent call herself, and
   by the end she is smiling.
5. **山田及び高木** -- Mina's research: the studio was founded by Yamada and
   Takagi. Masao is Yamada. That night he asks the silence, for the first time,
   whether it is Takagi.
6. **新しい建物** -- The house Takagi grew up in is gone under a company's new
   building. Masao is angry for the first time; Haru makes him rice.
7. **新聞の名前** -- An old newspaper: Takagi came top in the exam for a Tokyo
   university. The gold watch he gave Masao the night before he left. Masao
   writes to him, care of the university.
8. **三日の間** -- For three days the telephone does not ring. Why Masao stayed
   in a shrinking town. On the third night it rings again.
9. **孫** -- Takagi's grandson calls. Takagi is alive, in hospital, unable to
   speak; every night at seven he has the studio called just to hear Masao's
   voice. The three silent days, he was too ill.
10. **町の塩** -- A box of letters Takagi never sent, and salt the two of them
    made from the sea. He came back once, and could not come in. That night
    Masao answers the telephone and talks for fifty years' worth. On the next
    full moon he will go and see him.

The promise is answered in direction, not in the meeting itself: that is
still the serial's to keep.

## House rules

1. **A story first.** The twenty words are the constraint, not the subject. A
   chapter that reads as a list of the set wearing a plot has failed even if it
   passes every check.
2. **Lean on what they have.** Words from earlier sets cost the reader nothing;
   the build reports how many each chapter revises. A serial that never revisits
   is a hundred separate exercises.
3. **Gloss the rest, sparingly.** Anything off the ladder is scenery and needs a
   reading and a meaning. The build names every gloss rarer than the rarest word
   the ladder teaches -- one or two is a story, a dozen is a different story.
4. **One sentence to a line**, because a line is what gets read aloud and lit.
5. **No cliffhangers that need the next chapter to make sense.** A reader who
   stops at set 40 should not be left holding half a thing. Each chapter asks
   one small question and answers it before it ends.
6. **Page one says who and where, and carries a word of the set.** It is the
   page every reader sees, including the ones who skipped the last nine.
7. **A set word inside a longer word lights up as itself.** 事 in 仕事, 木 in
   高木: the page matches the longest span it knows, and a set word is always
   known. Gloss the longer word, or reword.
8. **The recordings follow the text.** Editing a line changes its fingerprint
   and the next voices run replaces the clip (`src/audio/said.json`). Until
   then the build holds the old clip back, so the page reads the new line in
   the browser's voice rather than aloud as the line it used to be.

## Covers

Every chapter opens on a cover: the picture, 第N話 and CHAPTER N, and the title
in both languages. It is the first page, it turns like any other page, and the
box does not change size for it.

The picture is a file in `src/covers/`, named for the set counting from zero --
`0.jpg` is chapter one. A chapter with no file gets a drawn plate instead (a
moon over water, in the app's own colours), so a half-illustrated book still
looks made rather than broken. 1200x750, under 200KB; they are fetched when a
chapter is opened, never with the page. Only files named for a set are
published: the three-megabyte original a cover is cropped from can sit in the
folder without being shipped.

### Drawing them

The covers are meant to be the photograph the chapter is about, which is also
what keeps a hundred of them consistent: a place or an object, rarely a face.
Faces drift between generations; a shelf of boxes does not.

Use the same style block verbatim every time, and change only the subject:

> Hand-painted digital illustration of a Japanese seaside town, quiet and
> melancholy, in the manner of a modern picture book with woodblock influence.
> Flat shapes, visible paper grain, soft haze at the horizon, one clear light
> source. Limited palette: deep teal (#0e2b38 through #12414f to #0891b2), warm
> off-white (#f4f4f1), soft ink black. Generous empty space in the upper third.
> No text, no lettering, no logos, no close-up faces. 16:10.
>
> Subject: <one sentence, the photograph this chapter is about>

For every chapter after the first, attach the previous cover and add: *match the
palette, brushwork and grain of the attached image exactly; same world, a
different scene.* That, and never naming a character's face, is most of what
consistency across a hundred pictures takes.

Ask for full bleed, and expect to be ignored: both of the first two came back
as mounted prints with a cream paper margin and a deckle edge, which is charming
on its own and wrong inside a rounded plate that already mounts them. The margin
is measured off rather than guessed at -- find the first row and column that are
not within a few shades of the corner's colour, step in a little further to clear
the ragged edge, then take the middle of what is left at 16:10 and write it out
at 1200x750 under 200KB. `crop.mjs` in the test scratchpad does this; it needs a
browser to decode the JPEG, which is why it does not live in tools/.

The subjects, chapters one to ten -- all drawn. Each is one photograph, and
the studio itself only when the chapter is about the studio:

- **Chapter 1** — a full moon low over a river, a long wooden bench on the near
  bank seen from behind, two figures sitting apart on it, one small and one
  older, both facing the water. Faint specks of light in the sky.
- **Chapter 2** — a hundred white boxes stacked on a wooden workbench in a dim
  photograph studio, one angled desk lamp lighting them, dust hanging in the
  beam, a tripod in the dark at the edge.
- **Chapter 3** — a wide unpaved town street fifty years ago, shopfronts down
  one side, one tall tree on the right, a single small car parked at the kerb,
  no one close enough to have a face.
- **Chapter 4** — a black rotary telephone on a wooden side table in a dim hall,
  the receiver in its cradle, a long cord hanging, late evening light from one
  window.
- **Chapter 5** — an open civic record book on a desk under a bare bulb, columns
  of handwritten names running down the page, a magnifying glass and a cold cup
  of tea beside it.
- **Chapter 6** — a new concrete and glass building alone on a cleared lot at
  the edge of the old town, a low wire fence, flat pale sky, no one about.
- **Chapter 7** — a folded yellowed newspaper page on a workbench, a gold
  wristwatch and a bunch of cut flowers laid beside it, one desk lamp.
- **Chapter 8** — an empty studio wall in a shaft of window light, dust turning
  in it, a crate of vegetables on the desk below.
- **Chapter 9** — the studio doorway seen from inside, standing open onto a
  bright street, a cat asleep on a chair in the dark foreground.
- **Chapter 10** — an open wooden box on a desk holding a bundle of unopened
  letters and a small heap of sea salt, the telephone behind it in the dark.
