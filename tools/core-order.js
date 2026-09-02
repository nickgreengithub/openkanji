#!/usr/bin/env node
// Regenerates src/data/core-10000.json: every kanji in the record decks that
// has a KANJIDIC newspaper-frequency rank, most frequent first. The Core deck
// is a view over those records (see decks.json), so it defines nothing itself.
//
//   node tools/core-order.js <kanji-frequency.json>
//
// The argument is a JSON object { "漢": rank, ... } (1 = most frequent). Kanji
// without a rank are left out: the deck is the frequent core, not everything.
const fs = require("fs");
const path = require("path");
const SRC = path.join(__dirname, "..", "src");

const freqFile = process.argv[2];
if (!freqFile) { console.error("usage: core-order.js <kanji-frequency.json>"); process.exit(1); }
const freq = JSON.parse(fs.readFileSync(freqFile, "utf8"));
const decks = JSON.parse(fs.readFileSync(path.join(SRC, "data/decks.json"), "utf8"));

const ranked = [];
let unranked = 0;
for (const { file } of decks) {
  if (!file) continue;
  for (const k of JSON.parse(fs.readFileSync(path.join(SRC, "data/kanji", file), "utf8"))) {
    if (freq[k.c]) ranked.push([freq[k.c], k.id]);
    else unranked++;
  }
}
ranked.sort((a, b) => a[0] - b[0]);
const ids = ranked.map((r) => r[1]);
fs.writeFileSync(path.join(SRC, "data/core-10000.json"), JSON.stringify(ids, null, 1) + "\n");
console.log("core-10000.json: " + ids.length + " kanji in frequency order" + (unranked ? " (" + unranked + " unranked kanji left out)" : ""));
