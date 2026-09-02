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

// Kanji data is split so translations can be added without touching structure:
//   src/data/kanji/<deck>.json      language-neutral: character, readings, word surfaces
//   src/data/lang/<lang>/<deck>.json  meaning, mnemonic sentence, gloss per word
//   src/data/decks.json / langs.json  load order and language registry
//
// Adding a deck is a JSON file plus a line in decks.json. Adding a language is
// a src/data/lang/<dir>/ folder covering the same decks. Everything is
// validated here so a bad record or a half-finished translation fails the
// build instead of shipping.
const DEFAULT_LANG = "EN";

function readJson(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(SRC, rel), "utf8"));
  } catch (e) {
    throw new Error(rel + ": " + e.message);
  }
}

function loadBase(decks) {
  const out = [];
  const seen = new Map();
  for (const { deck, file } of decks) {
    const records = readJson("data/kanji/" + file);
    if (!Array.isArray(records)) throw new Error(file + ": expected an array");
    records.forEach((k, i) => {
      const at = "kanji/" + file + "[" + i + "]" + (k && k.c ? " (" + k.c + ")" : "");
      if (!k || typeof k.c !== "string" || [...k.c].length !== 1) throw new Error(at + ": `c` must be a single character");
      if (!Array.isArray(k.g) || !k.g.length) throw new Error(at + ": needs at least one reading group");
      k.g.forEach((g) => {
        if (!g.r) throw new Error(at + ": a reading group is missing `r`");
        if (!Array.isArray(g.w) || !g.w.length) throw new Error(at + " group " + g.r + ": needs at least one word");
        g.w.forEach((w) => {
          if (!Array.isArray(w) || w.length !== 2 || w.some((x) => typeof x !== "string" || !x))
            throw new Error(at + " group " + g.r + ": each word must be [surface, reading]");
        });
      });
      // One deck per kanji: duplicates would double-count progress.
      if (seen.has(k.c)) throw new Error(at + ": already defined in " + seen.get(k.c));
      seen.set(k.c, "kanji/" + file);
      out.push(Object.assign({}, k, { deck }));
    });
  }
  return out;
}

// Returns null when the language has no folder yet -- that is how a language
// stays "coming soon" rather than being an error.
function loadLang(lang, decks, base) {
  if (!fs.existsSync(path.join(SRC, "data/lang", lang.dir))) return null;
  const strings = {};
  for (const { file } of decks) {
    const rel = "data/lang/" + lang.dir + "/" + file;
    if (!fs.existsSync(path.join(SRC, rel))) {
      throw new Error(lang.code + ": missing " + rel + " (a language must cover every deck)");
    }
    Object.assign(strings, readJson(rel));
  }
  // A partial translation is a build error, not a page with blank glosses.
  for (const k of base) {
    const t = strings[k.c];
    const at = lang.code + " " + k.c;
    if (!t) throw new Error(at + ": no translation entry");
    if (!t.meaning) throw new Error(at + ": missing `meaning`");
    if (!t.sentence) throw new Error(at + ": missing `sentence`");
    for (const g of k.g) {
      for (const [surface] of g.w) {
        if (!t.words || !t.words[surface]) throw new Error(at + ": missing gloss for \"" + surface + "\"");
      }
    }
  }
  return strings;
}

// Merge into the shape the app consumes: w = [surface, reading, gloss].
function localize(base, strings) {
  return base.map((k) => {
    const t = strings[k.c];
    return {
      c: k.c,
      deck: k.deck,
      meaning: t.meaning,
      sentence: t.sentence,
      g: k.g.map((g) => ({ r: g.r, w: g.w.map(([s, r]) => [s, r, t.words[s]]) })),
    };
  });
}

function loadKanjiAndLangs() {
  const decks = readJson("data/decks.json");
  const langs = readJson("data/langs.json");
  const base = loadBase(decks);

  const available = [];
  const i18n = {};
  for (const lang of langs) {
    const strings = loadLang(lang, decks, base);
    if (!strings) continue;
    available.push(lang.code);
    if (lang.code !== DEFAULT_LANG) i18n[lang.code] = strings;
  }
  if (!available.includes(DEFAULT_LANG)) throw new Error("the default language " + DEFAULT_LANG + " has no data");

  const def = loadLang(langs.find((l) => l.code === DEFAULT_LANG), decks, base);
  return { data: localize(base, def), i18n, langs, available };
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

  const { data, i18n, langs, available } = loadKanjiAndLangs();

  let template = fs.readFileSync(path.join(SRC, "app.html"), "utf8");
  const tokens = {
    __KANJI_DATA__: JSON.stringify(data),
    // Non-default languages ride along so the picker can switch without a
    // refetch. Empty until a src/data/lang/<dir>/ folder exists.
    __KANJI_I18N__: JSON.stringify(i18n),
    // code, display name, kanji label, and whether data exists yet.
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
  console.log("built index.html (" + out.length + " bytes)");
}
