#!/usr/bin/env node
// Merges written example sentences into src/data/words.json.
//
// Sentences are written by hand, in batches, and a batch is only as good as
// what stops a bad one getting in. Every line is checked before it lands:
// the word has to actually appear, the sentence has to be the length of the
// ones already there, and both translations have to exist. A batch with one
// bad line is rejected whole rather than half-applied.
//
// Usage:  node tools/sentences.js batch.json [--force]
//         batch.json is { "<word id>": { "ja": "...", "en": "...", "es": "..." } }

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WORDS = path.join(ROOT, "src", "data", "words.json");

const file = process.argv[2];
const force = process.argv.includes("--force");
if (!file) { console.error("usage: node tools/sentences.js batch.json"); process.exit(2); }

const words = JSON.parse(fs.readFileSync(WORDS, "utf8"));
const batch = JSON.parse(fs.readFileSync(file, "utf8"));

// The shortest and longest of what is already there, so a new batch sits in
// the same register rather than drifting longer every time.
const existing = Object.values(words).filter((w) => w.sentences && w.sentences[0]);
const lens = existing.map((w) => [...w.sentences[0].ja].length).sort((a, b) => a - b);
const MIN = 5, MAX = 24;

const problems = [];
for (const [id, s] of Object.entries(batch)) {
  const w = words[id];
  const at = id + " (" + (w ? w.w : "?") + ")";
  if (!w) { problems.push(at + ": no such word"); continue; }
  if (w.sentences && w.sentences[0] && !force) { problems.push(at + ": already has a sentence"); continue; }
  if (!s || typeof s.ja !== "string" || !s.ja.trim()) { problems.push(at + ": no Japanese"); continue; }
  if (typeof s.en !== "string" || !s.en.trim()) problems.push(at + ": no English");
  if (typeof s.es !== "string" || !s.es.trim()) problems.push(at + ": no Spanish");
  const n = [...s.ja].length;
  if (n < MIN || n > MAX) problems.push(at + ": " + n + " characters, wanted " + MIN + "-" + MAX + " -- " + s.ja);
  if (!/[。？！]$/.test(s.ja)) problems.push(at + ": does not end a sentence -- " + s.ja);
  // The point of the sentence is to show this word, so it has to be in it.
  // A verb or adjective may be conjugated, so its stem is enough.
  const stem = /[぀-ゟ]$/.test(w.w) ? w.w.slice(0, -1) : w.w;
  if (!s.ja.includes(w.w) && !(stem && s.ja.includes(stem))) {
    problems.push(at + ": the word is not in the sentence -- " + s.ja);
  }
  if (/[A-Za-z]/.test(s.ja)) problems.push(at + ": latin letters in the Japanese -- " + s.ja);
}

if (problems.length) {
  console.error("Rejected " + problems.length + " of " + Object.keys(batch).length + ":");
  for (const p of problems.slice(0, 40)) console.error("  " + p);
  if (problems.length > 40) console.error("  ...and " + (problems.length - 40) + " more");
  process.exit(1);
}

let n = 0;
for (const [id, s] of Object.entries(batch)) {
  words[id].sentences = [{ ja: s.ja, t: { en: s.en, es: s.es } }];
  n++;
}
fs.writeFileSync(WORDS, JSON.stringify(words, null, 2) + "\n");
const now = Object.values(words).filter((w) => w.sentences && w.sentences[0]).length;
console.log("added " + n + " sentences; " + now + " words now have one");
