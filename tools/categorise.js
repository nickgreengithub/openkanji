#!/usr/bin/env node
// Files words under the twenty categories, so a set of twenty can be dealt
// one word per category (see "The twenty categories" in the README).
//
// Usage:  node tools/categorise.js batch.json [--force]
//         batch.json is { "<word id>": <1-20> }
//
// A batch is checked whole and applied whole. A category is a judgement, and
// the judgement that matters is the learner's -- 用事 is filed under Society
// rather than Handling because that is where someone would look for it -- so
// the useful check here is not that a number is plausible but that nothing
// was tagged twice, silently overwritten, or left out of the batch it was
// meant to be in.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const WORDS = path.join(SRC, "data", "words.json");

const file = process.argv[2];
const force = process.argv.includes("--force");
if (!file) { console.error("usage: node tools/categorise.js batch.json"); process.exit(2); }

const words = JSON.parse(fs.readFileSync(WORDS, "utf8"));
const cats = JSON.parse(fs.readFileSync(path.join(SRC, "data", "categories.json"), "utf8"));
const ladder = JSON.parse(fs.readFileSync(path.join(SRC, "data", "ladder.json"), "utf8"));
const batch = JSON.parse(fs.readFileSync(file, "utf8"));
const known = new Map(cats.map((c) => [c.id, c.name]));

const problems = [];
for (const [id, cat] of Object.entries(batch)) {
  const w = words[id];
  const at = id + " (" + (w ? w.w : "?") + ")";
  if (!w) { problems.push(at + ": no such word"); continue; }
  if (!known.has(cat)) { problems.push(at + ": " + JSON.stringify(cat) + " is not one of the twenty categories"); continue; }
  if (w.cat !== undefined && w.cat !== cat && !force) {
    problems.push(at + ": already filed under " + w.cat + " (" + known.get(w.cat) + "), asked for " + cat + " (" + known.get(cat) + ")");
  }
}

if (problems.length) {
  console.error("Rejected " + problems.length + " of " + Object.keys(batch).length + ":");
  for (const p of problems.slice(0, 40)) console.error("  " + p);
  if (problems.length > 40) console.error("  ...and " + (problems.length - 40) + " more");
  process.exit(1);
}

let n = 0;
for (const [id, cat] of Object.entries(batch)) {
  if (words[id].cat !== cat) n++;
  words[id].cat = cat;
}
fs.writeFileSync(WORDS, JSON.stringify(words, null, 2) + "\n");

const tagged = Object.values(words).filter((w) => w.cat !== undefined).length;
const onLadder = ladder.filter((id) => words[id].cat !== undefined).length;
console.log("filed " + n + " words; " + tagged + " tagged in all, " + onLadder + " of the ladder's 2000");

// Which categories the ladder is thin on, since a set can only be spread as
// widely as the words available to fill it.
const per = {};
for (const id of ladder) { const c = words[id].cat; if (c !== undefined) per[c] = (per[c] || 0) + 1; }
const thin = cats.filter((c) => (per[c.id] || 0) < onLadder / 40).map((c) => c.id + " " + c.name + " (" + (per[c.id] || 0) + ")");
if (thin.length) console.log("thin so far: " + thin.join(", "));
