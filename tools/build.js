#!/usr/bin/env node
// Rebuilds index.html (the GitHub Pages deploy target) from src/.
//
// The deployed file is a self-contained bundle: a bootstrap shell plus two
// generated lines -- an asset manifest (gzip+base64) and the app document
// (JSON-encoded). src/shell.html carries placeholders for those two lines.
//
// Usage: node tools/build.js [--check]
//   --check  build in memory and diff against index.html; exit 1 if stale.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const OUT = path.join(ROOT, "index.html");

// The template is embedded inside a <script> in the shell. JSON.stringify does
// not escape "/", so a literal "</script>" in the app would close the host tag
// early and blank the page. Escaping every "</" is valid JSON and safe.
const encodeTemplate = (s) => JSON.stringify(s).replace(/<\//g, "<\\u002F");

// Data model (see README):
//   src/data/words.json         every word once, by stable id
//   src/data/kanji/<deck>.json  kanji, referencing words by id
//   src/data/<view>.json        a view deck: existing kanji ids in display order
//   src/data/ui.json            interface strings, {key: {lang: text}}
//   src/data/decks.json         deck order      src/data/langs.json  languages
//
// IDs are stable and never reused: user progress is stored as ids, so the
// text of a word can be corrected without invalidating anyone's progress.
// Every human-readable string is {lang: text}.
const DEFAULT_LANG = "en";

function readJson(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(SRC, rel), "utf8"));
  } catch (e) {
    throw new Error(rel + ": " + e.message);
  }
}

function loadData() {
  const decks = readJson("data/decks.json");

  // A deck of 1031 kanji is not a deck, it is a syllabus. `split: 200` cuts one
  // into chunks of at most that many, which become decks in their own right --
  // "JLPT N1-A", "JLPT N1-B" -- without touching the data files. Chunk names
  // are letters by default; `splitLabel: "range"` numbers them instead, for a
  // deck with no level letter to hang off ("Core 001-200").
  const chunker = (spec, total) => {
    const size = spec.split;
    if (!size || total <= size) return { name: () => spec.deck, chunks: [[spec.deck, 1, total]] };
    const chunks = [];
    for (let from = 0; from < total; from += size) {
      const to = Math.min(from + size, total);
      const pad = (n) => String(n).padStart(3, "0");
      const name = spec.splitLabel === "range"
        ? spec.deck + " " + pad(from + 1) + "-" + pad(to)
        : spec.deck + "-" + String.fromCharCode(65 + chunks.length);
      chunks.push([name, from + 1, to]);
    }
    return { name: (i) => chunks[Math.floor(i / size)][0], chunks };
  };

  // Rail order, and what each tab needs to describe itself. Filled in as the
  // decks are read so it always matches what actually shipped.
  const deckOrder = [];
  const tipKey = (deck) => "tip_" + deck.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "");
  const words = readJson("data/words.json");

  // lang -> count of translated fields carrying it; a language is complete
  // when it covers every one.
  const coverage = {};
  let fields = 0;
  const track = (v, at, field) => {
    fields++;
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(at + ": `" + field + "` must be {lang: text}");
    const codes = Object.keys(v);
    if (!codes.length) throw new Error(at + ": `" + field + "` has no translations");
    for (const c of codes) {
      if (typeof v[c] !== "string" || !v[c].trim()) throw new Error(at + ": `" + field + "." + c + "` is empty");
      coverage[c] = (coverage[c] || 0) + 1;
    }
  };

  for (const [id, w] of Object.entries(words)) {
    const at = "words.json " + id + (w && w.w ? " (" + w.w + ")" : "");
    if (!w || w.id !== id) throw new Error(at + ": `id` must match its key");
    if (!w.w || !w.reading) throw new Error(at + ": needs `w` and `reading`");
    track(w.gloss, at, "gloss");
    (w.sentences || []).forEach((s, i) => {
      if (!s.ja) throw new Error(at + " sentence " + i + ": missing `ja`");
      track(s.t, at + " sentence " + i, "t");
    });
    for (const list of ["alt", "kata"]) {
      (w[list] || []).forEach((x, i) => {
        if (!x.w || !x.reading) throw new Error(at + " " + list + "[" + i + "]: needs `w` and `reading`");
        track(x.gloss, at + " " + list + "[" + i + "]", "gloss");
      });
    }
  }

  const kanji = [];
  const seenChar = new Map();
  const seenId = new Map();
  const used = new Set();
  const byId = {};
  for (const spec of decks) {
    const { deck, file } = spec;
    if (!file) continue; // view decks are resolved below, once every record exists
    const recs = readJson("data/kanji/" + file);
    if (!Array.isArray(recs)) throw new Error(file + ": expected an array");
    const cut = chunker(spec, recs.length);
    cut.chunks.forEach(([name, from, to]) => deckOrder.push([name, tipKey(deck), from + "-" + to]));
    recs.forEach((k, i) => {
      const at = file + "[" + i + "]" + (k && k.c ? " (" + k.c + ")" : "");
      if (!k || !k.id) throw new Error(at + ": missing `id`");
      if (typeof k.c !== "string" || [...k.c].length !== 1) throw new Error(at + ": `c` must be a single character");
      if (seenId.has(k.id)) throw new Error(at + ": id " + k.id + " already used in " + seenId.get(k.id));
      seenId.set(k.id, file);
      if (seenChar.has(k.c)) throw new Error(at + ": already defined in " + seenChar.get(k.c));
      seenChar.set(k.c, file);
      track(k.meaning, at, "meaning");
      track(k.mnemonic, at, "mnemonic");
      if (!Array.isArray(k.g) || !k.g.length) throw new Error(at + ": needs at least one reading group");
      k.g.forEach((g) => {
        if (!g.r) throw new Error(at + ": a reading group is missing `r`");
        if (!Array.isArray(g.w) || !g.w.length) throw new Error(at + " group " + g.r + ": needs at least one word");
        g.w.forEach((id) => {
          // Referential integrity: a kanji may not point at a word that is gone.
          if (!words[id]) throw new Error(at + " group " + g.r + ": unknown word id " + id);
          used.add(id);
        });
      });
      byId[k.id] = k;
      kanji.push(Object.assign({}, k, { deck: cut.name(i) }));
    });
  }

  // View decks: an ordered list of existing kanji ids in data/<order>, no
  // records of their own. A kanji is still defined exactly once; the view
  // re-uses its words, so progress is shared and nothing can drift.
  for (const spec of decks) {
    const { deck, order, limit } = spec;
    if (!order) continue;
    const ids = readJson("data/" + order);
    if (!Array.isArray(ids) || !ids.length) throw new Error(order + ": expected a non-empty array of kanji ids");
    const cut = chunker(spec, Math.min(limit || ids.length, ids.length));
    cut.chunks.forEach(([name, from, to]) => deckOrder.push([name, tipKey(deck), from + "-" + to]));
    const seen = new Set();
    ids.forEach((id, i) => {
      if (!byId[id]) throw new Error(order + "[" + i + "]: unknown kanji id " + id);
      if (seen.has(id)) throw new Error(order + "[" + i + "]: id " + id + " listed twice");
      seen.add(id);
      // `limit` shows only the head of the list; the file keeps the full order.
      if (limit && i >= limit) return;
      kanji.push(Object.assign({}, byId[id], { deck: cut.name(i) }));
    });
  }

  // UI chrome -- labels, tips, status messages -- is translated like any other
  // field, so a language is complete only when it covers the interface too.
  const ui = readJson("data/ui.json");
  for (const [key, v] of Object.entries(ui)) track(v, "ui.json " + key, "text");

  const orphans = Object.keys(words).filter((id) => !used.has(id));
  if (orphans.length) throw new Error("words.json: " + orphans.length + " word(s) referenced by no kanji: " + orphans.slice(0, 5).join(", "));

  const complete = Object.keys(coverage).filter((c) => coverage[c] === fields);
  const partial = Object.keys(coverage).filter((c) => coverage[c] !== fields);
  if (!complete.includes(DEFAULT_LANG))
    throw new Error("default language '" + DEFAULT_LANG + "' is incomplete: " + (coverage[DEFAULT_LANG] || 0) + "/" + fields + " fields");
  return { kanji, words, ui, complete, partial, coverage, fields, deckOrder };
}

const pick = (v, lang) => v[lang] || v[DEFAULT_LANG];

// Join into the shape the app consumes. A word tuple is
// [surface, reading, gloss, id] -- the id is what progress is keyed on.
function flatten(kanji, words, lang) {
  return kanji.map((k) => ({
    id: k.id,
    c: k.c,
    deck: k.deck,
    meaning: pick(k.meaning, lang),
    sentence: pick(k.mnemonic, lang),
    g: k.g.map((g) => ({
      r: g.r,
      w: g.w.map((id) => {
        const w = words[id];
        return [w.w, w.reading, pick(w.gloss, lang), id];
      }),
    })),
  }));
}

function loadKanjiAndLangs() {
  const langs = readJson("data/langs.json");
  const { kanji, words, ui, complete, partial, coverage, fields, deckOrder } = loadData();

  const known = new Set(langs.map((l) => l.code.toLowerCase()));
  for (const c of complete.concat(partial)) {
    if (!known.has(c)) throw new Error("unknown language code '" + c + "' -- add it to data/langs.json");
  }

  const available = langs.filter((l) => complete.includes(l.code.toLowerCase())).map((l) => l.code);
  const i18n = {};
  for (const l of langs) {
    const code = l.code.toLowerCase();
    if (!complete.includes(code) || code === DEFAULT_LANG) continue;
    const t = {};
    for (const k of kanji) {
      const w = {};
      for (const g of k.g) for (const id of g.w) w[id] = pick(words[id].gloss, code);
      t[k.c] = { meaning: pick(k.meaning, code), sentence: pick(k.mnemonic, code), words: w };
    }
    i18n[l.code] = t;
  }

  // Example-sentence translations by word id: { id: { LANG: [t1, t2] } }.
  // The Japanese text itself stays in EXTRA, which holds the furigana tokens.
  const exT = {};
  for (const [id, w] of Object.entries(words)) {
    if (!w.sentences || !w.sentences.length) continue;
    const per = {};
    for (const c of complete) per[c.toUpperCase()] = w.sentences.map((s) => pick(s.t, c));
    exT[id] = per;
  }

  // Interface strings by language: { EN: { key: text }, ES: { ... } }.
  const uiT = {};
  for (const c of complete) {
    const t = {};
    for (const [key, v] of Object.entries(ui)) t[key] = pick(v, c);
    uiT[c.toUpperCase()] = t;
  }

  return { data: flatten(kanji, words, DEFAULT_LANG), exT, i18n, uiT, langs, available, partial, coverage, fields, deckOrder };
}

function build() {
  const meta = JSON.parse(fs.readFileSync(path.join(SRC, "assets/manifest.json"), "utf8"));

  const manifest = {};
  for (const [uuid, info] of Object.entries(meta)) {
    const bytes = fs.readFileSync(path.join(SRC, "assets", info.file));
    const packed = info.compressed ? zlib.gzipSync(bytes, { level: 9 }) : bytes;
    manifest[uuid] = {
      mime: info.mime,
      compressed: info.compressed,
      data: packed.toString("base64"),
    };
  }

  const { data, exT, i18n, uiT, langs, available, partial, coverage, fields, deckOrder } = loadKanjiAndLangs();

  let template = fs.readFileSync(path.join(SRC, "app.html"), "utf8");
  const tokens = {
    __KANJI_DATA__: JSON.stringify(data),
    // [name, ui.json tip key, "from-to"] in rail order, so adding or splitting
    // a deck is a decks.json edit and nothing else.
    __DECKS__: JSON.stringify(deckOrder),
    // Complete non-default languages ride along so the picker can switch
    // without a refetch. Incomplete ones are omitted entirely.
    __KANJI_I18N__: JSON.stringify(i18n),
    __EX_TRANSLATIONS__: JSON.stringify(exT),
    __UI__: JSON.stringify(uiT),
    // code, display name, kanji label, and whether the language is complete.
    __LANGS__: JSON.stringify(
      langs.map((l) => [l.code, l.name, l.ja, available.includes(l.code) ? "" : "soon"])
    ),
  };
  for (const [token, value] of Object.entries(tokens)) {
    if (!template.includes(token)) throw new Error("app.html is missing " + token);
    template = template.replace(token, () => value);
  }
  console.log(
    "  data: " + data.length + " kanji across " + new Set(data.map((k) => k.deck)).size +
    " decks | languages: " + available.join(", ") +
    (available.length < langs.length ? " (" + (langs.length - available.length) + " pending)" : "")
  );
  for (const c of partial) {
    console.log("  note: '" + c + "' is incomplete (" + coverage[c] + "/" + fields + " fields) and will not ship");
  }

  const shell = fs.readFileSync(path.join(SRC, "shell.html"), "utf8");

  for (const token of ["__BUNDLER_MANIFEST__", "__BUNDLER_TEMPLATE__"]) {
    if (!shell.includes(token)) throw new Error("shell.html is missing " + token);
  }

  const out = shell
    .replace("__BUNDLER_MANIFEST__", () => JSON.stringify(manifest))
    .replace("__BUNDLER_TEMPLATE__", () => encodeTemplate(template));

  // Fail loudly rather than shipping a blank page.
  const line = out.split("\n")[381];
  if (JSON.parse(line) !== template) throw new Error("template did not round-trip");
  if (line.includes("</script>")) throw new Error("unescaped </script> in template");

  return out;
}

const out = build();

if (process.argv.includes("--check")) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (cur === out) {
    console.log("index.html is up to date");
  } else {
    console.error("index.html is STALE -- run: node tools/build.js");
    process.exit(1);
  }
} else {
  fs.writeFileSync(OUT, out);
  // dist/ is what Cloudflare Pages deploys: the site only, not the source
  // tree. index.html stays at the repo root for GitHub Pages during the move.
  const dist = path.join(ROOT, "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), out);
  const cname = path.join(ROOT, "CNAME");
  if (fs.existsSync(cname)) fs.copyFileSync(cname, path.join(dist, "CNAME"));
  console.log("built index.html + dist/index.html (" + out.length + " bytes)");
}
