#!/usr/bin/env node
// Everything needed to write one chapter of the serial, printed for a set.
//
//   node tools/story-brief.js 5          the brief for set 5
//   node tools/story-brief.js 5 --json   a skeleton to fill in
//
// The twenty words a chapter must carry, what they mean, and -- just as
// useful -- the words behind them the chapter can lean on for free, because
// the reader has already met them. Everything else it needs must be glossed,
// which costs the reader a tap, so the brief says how much room there is.

const fs = require("fs");
const path = require("path");
const SRC = path.join(__dirname, "..", "src");
const read = (rel) => JSON.parse(fs.readFileSync(path.join(SRC, rel), "utf8"));

const set = parseInt(process.argv[2], 10);
if (!set || set < 1) { console.error("usage: node tools/story-brief.js <set number> [--json]"); process.exit(2); }

const words = read("data/words.json");
const ladder = read("data/ladder.json");
const cats = read("data/categories.json");
const stories = read("data/stories.json");
const catName = {};
cats.forEach((c) => { catName[c.id] = c.name; });

const SET_WORDS = 20;
const first = (set - 1) * SET_WORDS;
const mine = ladder.slice(first, first + SET_WORDS).map((id) => words[id]);
if (mine.length !== SET_WORDS) { console.error("the ladder has no set " + set); process.exit(1); }
const before = ladder.slice(0, first).map((id) => words[id]);
const floor = Math.min(...ladder.map((id) => words[id].freq || 0));

if (process.argv.includes("--json")) {
  const line = { ja: "", en: "", es: "" };
  console.log(JSON.stringify({
    [String(set - 1)]: {
      title: { ja: "", en: "", es: "" },
      words: Object.fromEntries(mine.filter((w) => /[ぁ-ん]$/.test(w.w)).map((w) => [w.w, { of: w.w }])),
      pages: [[line, line, line], [line, line, line], [line, line, line], [line, line, line], [line, line, line]],
    },
  }, null, 1));
  process.exit(0);
}

const tier = ["Beginner", "Elementary", "Intermediate", "Upper", "Advanced"][Math.floor((set - 1) / 20)];
console.log("SET " + set + "  (" + tier + ", words " + (first + 1) + "-" + (first + SET_WORDS) + " of the ladder)");
console.log("\nThe twenty the chapter must carry, every one of them, in any form:");
for (const w of mine) {
  console.log("  " + (w.w + "        ").slice(0, 8) + " " + (w.reading + "          ").slice(0, 10) +
    " " + (w.gloss.en + "                             ").slice(0, 30) +
    " " + (w.cat !== undefined ? catName[w.cat] : ""));
}

// What the reader already has. Nine hundred words of it is not a list anyone
// reads, so it is summarised, and the last set named in full: a chapter that
// picks up where the last one left off is what makes a serial one thing.
console.log("\nAlready met: " + before.length + " words" +
  (before.length ? " (the set before: " + ladder.slice(Math.max(0, first - SET_WORDS), first).map((id) => words[id].w).join(" ") + ")" : " -- this is the first chapter"));
console.log("Anything else has to be glossed. Aim to stay above freq " + floor.toFixed(2) +
  ", the rarest word the ladder ever teaches; the build reports every gloss below it.");

const has = stories[String(set - 1)];
console.log("\nWritten already: " + (has ? "yes -- " + has.title.ja + " (" + has.title.en + ")" : "no"));
console.log("\nThe shape: five pages, three lines a page, one line to a sentence.");
console.log("The build refuses a chapter that drops one of the twenty, glosses a word it never uses,");
console.log("or puts anything but Japanese in the Japanese. Conjugate freely -- 使って points at 使う");
console.log('with { "使って": { "of": "使う" } } and still counts.');
