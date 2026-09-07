#!/usr/bin/env node
// The Teacher's Kit: one page of A4 per set, as a PDF.
//
// NOT SHIPPED. The app offered this and no longer does -- the entry, the
// rendered kits and the build's checks on them are gone. What is left is this
// renderer and the prompts in src/data/teach.json, kept because they are
// written work and the idea may come back. Wiring it up again means putting
// the __TEACH__ and __KITS__ tokens, buildTeach and readKits back in
// tools/build.js and the row back in the practice menu; git remembers all of
// it. Until then nothing runs this but a person.
//
//   node tools/kit.mjs            every set that has prompts
//   node tools/kit.mjs 2          just that set
//
// A kit is a document, not a screen, so it is rendered rather than styled at
// the reader: Chromium lays out an A4 page and embeds the glyphs it used, and
// what comes out is a file a teacher can mail, print or ignore. The alternative
// -- building the PDF in the browser -- founders on Japanese: the core PDF
// fonts have no kanji, and shipping one to the page costs megabytes before a
// single lesson is taught.
//
// Needs Playwright and a Japanese font. Both are development tools, like the
// text-to-speech key: the kits themselves are committed, so nobody needs either
// to build or deploy the site.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const { kitStamp } = createRequire(import.meta.url)("./kit-stamp.cjs");

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const OUT = path.join(SRC, "kits");
const FONTS = process.env.OK_FONTS || path.join(process.env.HOME || "/root", ".cache", "openkanji");
const BROWSER = process.env.OK_CHROMIUM || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";

const read = (rel) => JSON.parse(readFileSync(path.join(SRC, rel), "utf8"));
const words = read("data/words.json");
const ladder = read("data/ladder.json");
const teach = read("data/teach.json");
const stories = read("data/stories.json");

const arg = process.argv.slice(2).find((a) => /^\d+$/.test(a));
const only = arg ? parseInt(arg, 10) - 1 : null;
const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The font has to be installed, not linked: a face that arrives as a data: URL
// is one Chromium will draw with and then leave out of the file.
//
// Even installed, Skia writes the Japanese as Type3 fonts -- the glyphs as
// drawings rather than a subset of the original -- which is what it does with
// CFF and variable fonts, and Noto Sans JP is both. It costs about 150KB a
// page and buys correctness: every kit carries its own glyphs, and the
// /ToUnicode map beside them keeps the words selectable and searchable. A
// static TrueType Japanese face would embed properly and halve the size, if
// one ever turns up that is worth the swap.
const installFonts = () => {
  const home = process.env.HOME || "/root";
  const dir = path.join(home, ".fonts");
  const want = ["NotoSansJP-Regular.otf", "NotoSansJP-Medium.otf"];
  const missing = want.filter((f) => !existsSync(path.join(dir, f)));
  if (!missing.length) return;
  for (const f of missing) {
    const from = path.join(FONTS, f);
    if (!existsSync(from)) {
      console.error("missing " + from + "\n  the kits need a Japanese font to embed. Fetch one:\n" +
        "  mkdir -p " + FONTS + " && curl -o " + from +
        " https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/JP/" + f);
      process.exit(2);
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, f), readFileSync(from));
  }
  try { execFileSync("fc-cache", ["-f"], { stdio: "ignore" }); } catch (e) {}
  console.log("  installed " + missing.length + " font(s) into ~/.fonts");
};

// The mark from the icons, drawn rather than fetched, so a kit is one file
// with nothing to go missing.
const MARK = '<svg viewBox="0 0 512 512" width="26" height="26" aria-hidden="true"><rect width="512" height="512" rx="96" fill="#0891b2"/>' +
  [[0.21, 0.21, 0.58, 0.078], [0.21, 0.712, 0.58, 0.078], [0.21, 0.21, 0.078, 0.58], [0.712, 0.21, 0.078, 0.58], [0.21, 0.461, 0.58, 0.078]]
    .map(([x, y, w, h]) => '<rect x="' + x * 512 + '" y="' + y * 512 + '" width="' + w * 512 + '" height="' + h * 512 + '" fill="#fff"/>').join("") +
  "</svg>";

const page = (set) => {
  const sheet = teach[String(set)];
  const first = set * 20;
  const mine = ladder.slice(first, first + 20).map((id) => words[id]);
  const story = stories[String(set)];
  const line = (q, i) =>
    '<li><span class="k">' + esc(q.kind) + '</span><span class="b">' +
    (q.ja ? '<span class="ja">' + esc(q.ja) + "</span>" : "") +
    '<span class="en">' + esc(q.en) + "</span></span></li>";
  const word = (w) => {
    const ex = (w.sentences || [])[0];
    const en = ex && ex.t ? ex.t.en : "";
    return '<div class="w"><div class="wt"><b>' + esc(w.w) + '</b><i>' + esc(w.reading) + "</i>" + esc(w.gloss.en) + "</div>" +
      (ex ? '<div class="wx">' + esc(ex.ja) + (en ? " — " + esc(en) : "") + "</div>" : "") + "</div>";
  };
  return `<!doctype html><meta charset="utf-8"><style>
@page{size:A4;margin:11mm 12mm}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Sans JP',system-ui,sans-serif;color:#1b1f24;font-size:10pt;line-height:1.4;-webkit-print-color-adjust:exact;print-color-adjust:exact;display:flex;flex-direction:column;min-height:275mm}
header{display:flex;align-items:center;gap:12px;border-bottom:2px solid #0891b2;padding-bottom:8px;margin-bottom:12px}
.brand{font-weight:500;font-size:17pt;letter-spacing:.005em;line-height:1.1}
.brand span{color:#0891b2}
.kit{font-size:8.5pt;letter-spacing:.16em;text-transform:uppercase;color:#6b7280;margin-top:2px}
header .right{margin-left:auto;text-align:right;font-size:8.5pt;color:#6b7280;line-height:1.35}
header .right b{display:block;font-weight:500;font-size:15pt;color:#1b1f24;letter-spacing:0;line-height:1.15}
.note{color:#4b5563;font-size:9.5pt;margin-bottom:10px;max-width:150mm}
h2{font-size:8pt;font-weight:400;letter-spacing:.16em;text-transform:uppercase;color:#0891b2;margin:0 0 6px;border-bottom:.75px solid #d8d8d2;padding-bottom:3px}
section{margin-bottom:11px}
ol{list-style:none;counter-reset:q;display:grid;grid-template-columns:1fr 1fr;gap:7px 16px}
li{counter-increment:q;display:flex;gap:6px;break-inside:avoid}
li::before{content:counter(q);flex:0 0 11px;text-align:right;color:#9aa0a6;font-size:8pt;padding-top:2px}
.k{flex:0 0 17px;font-size:7pt;letter-spacing:.06em;text-transform:uppercase;color:#9aa0a6;padding-top:2.5px}
.b{flex:1 1 auto;min-width:0}
.ja{display:block;font-size:12pt;line-height:1.4}
.en{display:block;color:#4b5563;font-size:9pt;line-height:1.35}
.words{display:grid;grid-template-columns:1fr 1fr;gap:6px 16px}
.w{break-inside:avoid}
.wt b{font-weight:500;font-size:12pt;margin-right:5px}
.wt i{font-style:normal;color:#0891b2;margin-right:6px;font-size:9.5pt}
.wt{font-size:9.5pt;color:#3b4149;line-height:1.35}
.wx{color:#6b7280;font-size:8.5pt;line-height:1.35}
footer{margin-top:auto;border-top:.75px solid #d8d8d2;padding-top:6px;display:flex;gap:10px;font-size:8pt;color:#6b7280}
footer .ch{flex:1 1 auto}
</style>
<header>${MARK}<div><div class="brand">Open<span>Kanji</span></div><div class="kit">Teacher's Kit</div></div>
<div class="right"><b>Set ${set + 1}</b>words ${first + 1}–${first + 20} of 2,000</div></header>
${sheet.note ? '<p class="note">' + esc(sheet.note.en) + "</p>" : ""}
<section><h2>Ask them</h2>
<ol>${sheet.prompts.map(line).join("")}</ol></section>
<section><h2>The twenty</h2>
<div class="words">${mine.map(word).join("")}</div></section>
<footer><span class="ch">${story ? "Chapter " + (set + 1) + " · " + esc(story.title.ja) + " — " + esc(story.title.en) : ""}</span><span>openkanji.org</span></footer>`;
};

installFonts();
const sets = only !== null ? [only] : Object.keys(teach).map(Number).sort((a, b) => a - b);
// Playwright is not a dependency of this repository -- the kits it makes are
// committed, so building and deploying the site needs neither it nor a
// browser. Point OK_PLAYWRIGHT at an installation to regenerate them.
const { chromium } = await import(process.env.OK_PLAYWRIGHT || "playwright").catch(() => {
  console.error("no Playwright. Install it, or point OK_PLAYWRIGHT at one:\n" +
    "  OK_PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs node tools/kit.mjs");
  process.exit(2);
});
const browser = await chromium.launch({ executablePath: BROWSER });
mkdirSync(OUT, { recursive: true });
const stamp = {};
for (const set of sets) {
  if (!teach[String(set)]) { console.error("no prompts for set " + (set + 1)); process.exit(1); }
  const html = page(set);
  const p = await browser.newPage();
  await p.setContent(html, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  const pdf = await p.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  // A kit is one page. Two means it stopped being a kit and became a handout.
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  if (pages !== 1) { console.error("set " + (set + 1) + ": came out on " + pages + " pages, and a kit is one"); process.exit(1); }
  // a picture of the page, when someone wants to look at it rather than open it
  if (process.argv.includes("--png")) {
    await p.setViewportSize({ width: 794, height: 1123 });
    await p.screenshot({ path: path.join(OUT, "set-" + (set + 1) + ".png"), fullPage: true });
  }
  const file = "set-" + (set + 1) + ".pdf";
  writeFileSync(path.join(OUT, file), pdf);
  // what it was made from, so a kit left behind by an edit can be spotted --
  // the inputs, not the rendering, since the build can recompute those without
  // a browser
  stamp[file] = kitStamp(set, { words, ladder, teach, stories });
  console.log("  " + file + "  " + Math.round(pdf.length / 1024) + "KB, 1 page");
  await p.close();
}
await browser.close();
const stampFile = path.join(OUT, "made-from.json");
const was = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, "utf8")) : {};
writeFileSync(stampFile, JSON.stringify(Object.assign(was, stamp), null, 1) + "\n");
console.log("wrote " + sets.length + " kit(s) into src/kits");
