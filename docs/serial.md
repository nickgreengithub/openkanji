# 月の写真館 — the serial

One hundred chapters, one to a set of twenty words. Every chapter carries all
twenty; the words the reader has not met are glossed on a tap. A chapter is
five pages, three lines a page, one sentence to a line.

Write it with `node tools/story-brief.js <set>` in front of you: it prints the
twenty, what the reader has already met, and the rules the build enforces.

## The frame

A photograph studio in a small seaside town. In the back room are a hundred
undeveloped negatives, taken across fifty years and never printed. Each chapter
one is developed, and the picture turns out to be about someone in the town.

The studio is quietly failing and the town is quietly emptying. Underneath every
chapter runs the promise of the first one: an old man who has waited at the
river for a friend who never came back.

Each chapter is one photograph, so it stands on its own. The promise, the studio
and the three of them run underneath, so they add up.

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
   stops at set 40 should not be left holding half a thing.
6. **The recordings follow the text.** Editing a line changes its fingerprint
   and the next voices run replaces the clip (`src/audio/said.json`).
