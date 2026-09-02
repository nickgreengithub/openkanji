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

// Kanji data lives in src/data/*.json, one file per deck, assembled here.
// Validated on every build so a malformed record fails loudly instead of
// shipping a blank page.
function loadKanji() {
  const decks = JSON.parse(fs.readFileSync(path.join(SRC, "data/decks.json"), "utf8"));
  const out = [];
  const seen = new Map();

  for (const { deck, file } of decks) {
    let records;
    try {
      records = JSON.parse(fs.readFileSync(path.join(SRC, "data", file), "utf8"));
    } catch (e) {
      throw new Error(file + ": " + e.message);
    }
    if (!Array.isArray(records)) throw new Error(file + ": expected an array");

    records.forEach((k, i) => {
      const at = file + "[" + i + "]" + (k && k.c ? " (" + k.c + ")" : "");
      if (!k || typeof k.c !== "string" || [...k.c].length !== 1) throw new Error(at + ": `c` must be a single character");
      if (!k.meaning) throw new Error(at + ": missing `meaning`");
      if (!k.sentence) throw new Error(at + ": missing `sentence`");
      if (!Array.isArray(k.g) || !k.g.length) throw new Error(at + ": needs at least one reading group");
      k.g.forEach((g, gi) => {
        if (!g.r) throw new Error(at + " group " + gi + ": missing reading `r`");
        if (!Array.isArray(g.w) || !g.w.length) throw new Error(at + " group " + gi + " (" + g.r + "): needs at least one word");
        g.w.forEach((w) => {
          if (!Array.isArray(w) || w.length !== 3 || w.some((x) => typeof x !== "string" || !x))
            throw new Error(at + " group " + g.r + ": each word must be [surface, reading, gloss]");
        });
      });
      // A kanji belongs to exactly one deck -- duplicates would double-count
      // progress and show the character in two places.
      if (seen.has(k.c)) throw new Error(at + ": already defined in " + seen.get(k.c));
      seen.set(k.c, file);

      out.push(Object.assign({}, k, { deck }));
    });
  }
  return out;
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

  const kanji = loadKanji();
  let template = fs.readFileSync(path.join(SRC, "app.html"), "utf8");
  if (!template.includes("__KANJI_DATA__")) throw new Error("app.html is missing __KANJI_DATA__");
  template = template.replace("__KANJI_DATA__", () => JSON.stringify(kanji));

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
