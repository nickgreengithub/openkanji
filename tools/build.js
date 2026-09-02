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

// Kanji data lives in src/data/kanji/<deck>.json, one file per deck, with every
// translation inline on the record it belongs to:
//
//   { "c":"\u4e00", "meaning":{"en":"one","es":"uno"},
//     "sentence":{"en":"..."},
//     "g":[{"r":"\u30a4\u30c1","w":[["\u4e00","\u3044\u3061",{"en":"one","es":"uno"}]]}] }
//
// Everything about a kanji is in one place -- there are no keys to match up
// between files and so nothing to drift. src/data/decks.json gives load order,
// src/data/langs.json is the language registry.
//
// Adding a deck: a JSON file plus a line in decks.json.
// Adding a language: add its code to every translated field. A language ships
// only once it is complete; a partial one fails the build.
const DEFAULT_LANG = "en";

function readJson(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(SRC, rel), "utf8"));
  } catch (e) {
    throw new Error(rel + ": " + e.message);
  }
}

// A translated field is {lang: string}. Returns the set of languages present.
function langsOf(value, at, field) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(at + ": `" + field + "` must be an object of {lang: text}");
  const codes = Object.keys(value);
  if (!codes.length) throw new Error(at + ": `" + field + "` has no translations");
  for (const c of codes) {
    if (typeof value[c] !== "string" || !value[c].trim())
      throw new Error(at + ": `" + field + "." + c + "` is empty");
  }
  return codes;
}

function loadKanji() {
  const decks = readJson("data/decks.json");
  const out = [];
  const seen = new Map();
  // lang -> number of translated fields carrying it. A language is complete
  // when it covers every field, which is how "coming soon" is decided.
  const coverage = {};
  let fields = 0;

  for (const { deck, file } of decks) {
    const records = readJson("data/kanji/" + file);
    if (!Array.isArray(records)) throw new Error(file + ": expected an array");

    records.forEach((k, i) => {
      const at = file + "[" + i + "]" + (k && k.c ? " (" + k.c + ")" : "");
      if (!k || typeof k.c !== "string" || [...k.c].length !== 1)
        throw new Error(at + ": `c` must be a single character");
      if (!Array.isArray(k.g) || !k.g.length) throw new Error(at + ": needs at least one reading group");

      const count = (v, field) => {
        fields++;
        for (const c of langsOf(v, at, field)) coverage[c] = (coverage[c] || 0) + 1;
      };
      count(k.meaning, "meaning");
      count(k.sentence, "sentence");

      k.g.forEach((g) => {
        if (!g.r) throw new Error(at + ": a reading group is missing `r`");
        if (!Array.isArray(g.w) || !g.w.length) throw new Error(at + " group " + g.r + ": needs at least one word");
        g.w.forEach((w) => {
          if (!Array.isArray(w) || w.length !== 3 || typeof w[0] !== "string" || typeof w[1] !== "string")
            throw new Error(at + " group " + g.r + ": each word must be [surface, reading, {lang: gloss}]");
          count(w[2], "gloss for \"" + w[0] + "\"");
        });
      });

      // One deck per kanji: duplicates would double-count progress.
      if (seen.has(k.c)) throw new Error(at + ": already defined in " + seen.get(k.c));
      seen.set(k.c, file);
      out.push(Object.assign({}, k, { deck }));
    });
  }

  const complete = Object.keys(coverage).filter((c) => coverage[c] === fields);
  const partial = Object.keys(coverage).filter((c) => coverage[c] !== fields);
  if (!complete.includes(DEFAULT_LANG))
    throw new Error(
      "the default language '" + DEFAULT_LANG + "' is incomplete: " +
      (coverage[DEFAULT_LANG] || 0) + "/" + fields + " fields"
    );
  return { records: out, complete, partial, fields };
}

// Flatten to the shape the app consumes: meaning/sentence/gloss as plain
// strings in `lang`. Missing entries fall back to the default language.
const pick = (v, lang) => v[lang] || v[DEFAULT_LANG];
function flatten(records, lang) {
  return records.map((k) => ({
    c: k.c,
    deck: k.deck,
    meaning: pick(k.meaning, lang),
    sentence: pick(k.sentence, lang),
    g: k.g.map((g) => ({ r: g.r, w: g.w.map((w) => [w[0], w[1], pick(w[2], lang)]) })),
  }));
}

function loadKanjiAndLangs() {
  const langs = readJson("data/langs.json");
  const { records, complete, partial, fields } = loadKanji();

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
    for (const k of records) {
      const words = {};
      for (const g of k.g) for (const w of g.w) words[w[0]] = pick(w[2], code);
      t[k.c] = { meaning: pick(k.meaning, code), sentence: pick(k.sentence, code), words };
    }
    i18n[l.code] = t;
  }

  return { data: flatten(records, DEFAULT_LANG), i18n, langs, available, partial, fields };
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

  const { data, i18n, langs, available, partial, fields } = loadKanjiAndLangs();

  let template = fs.readFileSync(path.join(SRC, "app.html"), "utf8");
  const tokens = {
    __KANJI_DATA__: JSON.stringify(data),
    // Complete non-default languages ride along so the picker can switch
    // without a refetch. Incomplete ones are omitted entirely.
    __KANJI_I18N__: JSON.stringify(i18n),
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
    console.log("  note: '" + c + "' is incomplete and will not ship");
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
  console.log("built index.html (" + out.length + " bytes)");
}
