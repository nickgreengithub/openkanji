#!/usr/bin/env node
// Appends kanji to a deck from a compact definition file, assigning stable ids
// and reusing existing word ids where a surface+reading already exists.
//
//   node tools/add-kanji.js <deck-file> <definitions.json>
//
// Definition shape:
//   { "c":"悪", "en":["bad, evil","mnemonic..."], "es":["malo","mnemonic..."],
//     "g":[{ "r":"アク", "w":[["悪い","わるい","bad","malo"]] }] }
const fs = require("fs");
const path = require("path");
const SRC = path.join(__dirname, "..", "src");

const [, , deckFile, defsFile] = process.argv;
if (!deckFile || !defsFile) { console.error("usage: add-kanji.js <deck-file> <defs.json>"); process.exit(1); }

const words = JSON.parse(fs.readFileSync(path.join(SRC, "data/words.json"), "utf8"));
const deckPath = path.join(SRC, "data/kanji", deckFile);
const deck = JSON.parse(fs.readFileSync(deckPath, "utf8"));
const defs = JSON.parse(fs.readFileSync(defsFile, "utf8"));

// Existing ids and surface|reading index, so nothing is duplicated or reused.
const byKey = {};
let maxW = 0;
for (const [id, w] of Object.entries(words)) {
  byKey[w.w + "|" + w.reading] = id;
  maxW = Math.max(maxW, Number(id.slice(1)));
}
let maxK = 0;
const haveChar = new Set();
for (const f of fs.readdirSync(path.join(SRC, "data/kanji"))) {
  for (const k of JSON.parse(fs.readFileSync(path.join(SRC, "data/kanji", f), "utf8"))) {
    maxK = Math.max(maxK, Number(k.id.slice(1)));
    haveChar.add(k.c);
  }
}
const pad = (n) => String(n).padStart(4, "0");

let added = 0, skipped = [], newWords = 0, reused = 0;
for (const d of defs) {
  if (haveChar.has(d.c)) { skipped.push(d.c); continue; }
  const rec = {
    id: "k" + pad(++maxK),
    c: d.c,
    meaning: { en: d.en[0], es: d.es[0] },
    mnemonic: { en: d.en[1], es: d.es[1] },
    g: d.g.map((g) => ({
      r: g.r,
      w: g.w.map(([surface, reading, en, es]) => {
        const key = surface + "|" + reading;
        if (byKey[key]) { reused++; return byKey[key]; }
        const id = "w" + pad(++maxW);
        words[id] = { id, w: surface, reading, gloss: { en, es } };
        byKey[key] = id;
        newWords++;
        return id;
      }),
    })),
  };
  deck.push(rec);
  haveChar.add(d.c);
  added++;
}

fs.writeFileSync(path.join(SRC, "data/words.json"), JSON.stringify(words, null, 1) + "\n");
fs.writeFileSync(deckPath, JSON.stringify(deck, null, 1) + "\n");
console.log("added " + added + " kanji to " + deckFile + " | " + newWords + " new words, " + reused + " reused"
  + (skipped.length ? " | skipped (already present): " + skipped.join("") : ""));
