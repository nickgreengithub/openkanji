#!/usr/bin/env node
// Gives every word a frequency score, so the ladder can be ordered by how
// common a word is rather than by which kanji happened to introduce it.
//
// Usage:  node tools/freq.js [--check]
//   --check  compute and report, but write nothing
//
// The score lands on each word as `freq`, higher meaning commoner. It is
// log10 of the word's share of running content words in parts per million,
// averaged over the three domains already carried in `cov` -- television and
// film, anime and manga, books and news.
//
// Two things need care, and both are recorded on the word so nothing has to
// be inferred back out of a number:
//
//   `freqEst`  the corpus has no figure for this word, so the score is the
//              median of its JLPT level. That level predicts frequency
//              cleanly (N5 205ppm, N4 114, N3 45, N2 17, N1 10), and the
//              alternative is worse: the words without figures are mostly
//              numbers and place names -- 一 二 三 日本 東京 -- which a
//              floor would bury under 頗梨.
//
//   `freqKana` a word Japanese writes in kana. The corpus counts occurrences
//              of the word, and する is the commonest word in the language,
//              but nobody writes it 為る -- so a ladder ordered by the figure
//              alone opens on a spelling its learners will never meet. These
//              are scored from their level like any other word we have no
//              usable figure for, which drops them below the ladder's cut.
//              A short hand-kept list, seeded from the top of the ladder,
//              and meant to be argued with: it is data, not a rule.
//
//   `freqVar`  a rarer spelling of a commoner word. The corpus counted the
//              reading, not the spelling, so 見る 観る 診る 看る each carry
//              the whole 5941ppm of みる. Nothing in the data says how those
//              occurrences divide, so the standard spelling keeps the figure
//              on the assumption that it dominates, and the rest are treated
//              as what they are -- words we have no figure for -- and scored
//              from their level like any other. A quarter of the figure was
//              tried first and left 診る and 看る in the commonest forty
//              words in the language, which is how you can tell the number
//              was invented rather than measured.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const WORDS = path.join(SRC, "data", "words.json");
const check = process.argv.includes("--check");

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(SRC, rel), "utf8"));

const words = JSON.parse(fs.readFileSync(WORDS, "utf8"));
const decks = readJson("data/decks.json");

// Which deck introduces a word: the first kanji deck that references it.
// Deck order is the syllabus order, so its index is the level.
const level = {};
const levelName = [];
decks.forEach((spec) => {
  if (!spec.file) return; // a view deck re-uses words it does not introduce
  const n = levelName.push(spec.deck) - 1;
  for (const k of readJson("data/kanji/" + spec.file)) {
    for (const g of k.g) for (const id of g.w) if (level[id] === undefined) level[id] = n;
  }
});

// The automatic rule below catches a figure shared between spellings of one
// reading. It cannot see a figure shared between different readings that
// sound alike: 揚げ (deep-fried food) carries 1,011ppm because あげ also
// counts 上げる, 挙げる and the 〜てあげる that ends a thousand sentences, which
// put a niche food noun ahead of 水 in the first set of the ladder. Caught by
// eye, listed here, scored from its level like the rest.
const MISREAD = new Set([
  "w4685", // 揚げ あげ -- the figure is 上げる / 挙げる / 〜てあげる
]);

// Written in kana in practice, by word id so a second reading of the same
// spelling is judged separately -- 眼 as め is ordinary, 眼 as まなこ is not.
const KANA = new Set([
  "w3865", // 為る する
  "w3866", // 為る なる
  "w4645", // 唯 ただ
  "w5105", // 眼 まなこ  (眼 め, w5104, is left alone)
  "w1537", // 因る よる
]);

const ppmOf = (w) => (w.cov ? (w.cov[0] + w.cov[1] + w.cov[2]) / 3 : null);

// The median of each level, for the words that have a figure.
const byLevel = {};
for (const w of Object.values(words)) {
  const p = ppmOf(w);
  if (p === null || level[w.id] === undefined) continue;
  (byLevel[level[w.id]] = byLevel[level[w.id]] || []).push(p);
}
const median = {};
for (const [n, list] of Object.entries(byLevel)) {
  list.sort((a, b) => a - b);
  median[n] = list[Math.floor(list.length / 2)];
}

// A spelling is the standard one if no other spelling of the same reading
// comes from an earlier level -- 見る is taught at N5, 観る at N2 -- and, where
// two share a level, the one the corpus recorded first.
// Grouped by reading AND figure, not by reading alone: きく is 聞く and 聴く
// on one figure, 効く on another and 菊 on a third, and a rule that asked for
// the whole reading to agree would leave 聴く undemoted among the commonest
// words in the language. Two spellings carrying the same figure to the
// decimal is the corpus counting a reading; two carrying different ones were
// counted apart and both keep what they were given.
const spellings = {};
for (const w of Object.values(words)) {
  const p = ppmOf(w);
  if (p === null) continue;
  const key = w.reading + "@" + p;
  (spellings[key] = spellings[key] || []).push(w);
}
const variant = new Set();
for (const list of Object.values(spellings)) {
  if (list.length < 2) continue;
  const ranked = list.slice().sort((a, b) =>
    (level[a.id] ?? 99) - (level[b.id] ?? 99) || (a.id < b.id ? -1 : 1));
  for (const w of ranked.slice(1)) variant.add(w.id);
}

let est = 0, varied = 0, kana = 0;
const scored = [];
for (const w of Object.values(words)) {
  let ppm = ppmOf(w);
  let flags = {};
  if (MISREAD.has(w.id)) {
    ppm = null; // the figure belongs to a word that only sounds like this one
    flags.freqVar = true;
    varied++;
  } else if (KANA.has(w.id)) {
    ppm = null; // the figure belongs to the kana form, not to this spelling
    flags.freqKana = true;
    kana++;
  } else if (variant.has(w.id)) {
    ppm = null; // the figure belongs to the reading, not to this spelling
    flags.freqVar = true;
    varied++;
  }
  if (ppm === null) {
    ppm = median[level[w.id]] ?? 1;
    if (!flags.freqVar && !flags.freqKana) { flags.freqEst = true; est++; }
  }
  // +1 so a word nobody recorded scores 0 rather than running to -infinity
  const freq = Math.round(Math.log10(ppm + 1) * 1000) / 1000;
  scored.push({ w, freq, flags });
}

scored.sort((a, b) => b.freq - a.freq);
console.log("scored " + scored.length + " words: " + est + " with no figure, " + varied + " variant spellings, " +
  kana + " written in kana -- all three scored from their level");
console.log("\ncommonest forty:");
console.log("  " + scored.slice(0, 40).map((s) => s.w.w).join(" "));
console.log("\nrarest ten:");
console.log("  " + scored.slice(-10).map((s) => s.w.w).join(" "));

if (check) process.exit(0);

for (const { w, freq, flags } of scored) {
  const rec = words[w.id];
  rec.freq = freq;
  if (flags.freqEst) rec.freqEst = true; else delete rec.freqEst;
  if (flags.freqVar) rec.freqVar = true; else delete rec.freqVar;
  if (flags.freqKana) rec.freqKana = true; else delete rec.freqKana;
}
fs.writeFileSync(WORDS, JSON.stringify(words, null, 2) + "\n");
console.log("\nwrote freq to every word in words.json");
