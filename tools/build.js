#!/usr/bin/env node
// Rebuilds index.html (the GitHub Pages deploy target) from src/.
//
// The deployed file is a self-contained bundle: a bootstrap shell plus two
// generated lines -- an asset manifest (base64) and the app document
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
  const catIds = new Set(readJson("data/categories.json").map((c) => c.id));

  // Rail order, and what each tab needs to describe itself. Filled in as the
  // decks are read so it always matches what actually shipped. A deck is whole
  // here; the app slices it into sections of 100 for navigation, which keeps
  // one level ("JLPT N1") from turning into six tabs pretending to be decks.
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
    // `freq` is how common the word is, higher meaning commoner, and every
    // word carries one (tools/freq.js). It used to be hand-tagged in pairs
    // with `cat` and so was required to travel with it; now it is computed
    // for the whole corpus and `cat` is the one still being filled in.
    if (w.freq !== undefined && typeof w.freq !== "number") throw new Error(at + ": `freq` must be a number");
    // `freqEst` says the score came from the word's level because the corpus
    // had no figure for it; `freqVar` that it is a rarer spelling of a word
    // the corpus counted under one reading; `freqKana` that Japanese writes
    // the word in kana, so the figure belongs to a form this entry is not.
    // All three are the tool's own record of where a number is weaker than it
    // looks, and all three are scored the same way.
    for (const flag of ["freqEst", "freqVar", "freqKana"]) {
      if (w[flag] !== undefined && w[flag] !== true) throw new Error(at + ": `" + flag + "` is true or absent");
      if (w[flag] && w.freq === undefined) throw new Error(at + ": `" + flag + "` without a `freq` to qualify");
    }
    // `cat` is a semantic category from categories.json. The app deals a set
    // of twenty one word per category, commonest first, so a word without one
    // waits in the tail until it is tagged.
    if (w.cat !== undefined) {
      if (!catIds.has(w.cat)) throw new Error(at + ": unknown category " + w.cat);
      if (w.freq === undefined) throw new Error(at + ": a categorised word needs a `freq` to be dealt by");
    }
    // Optional: `cov` is [tv, manga, news], the word's share of the running
    // content words of each domain, in parts per million. The map sums them.
    if (w.cov !== undefined) {
      if (!Array.isArray(w.cov) || w.cov.length !== 3 || w.cov.some((x) => !Number.isInteger(x) || x < 0)) throw new Error(at + ": `cov` must be three non-negative integers");
    }
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
    deckOrder.push([deck, tipKey(deck), recs.length]);
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
      kanji.push(Object.assign({}, k, { deck }));
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
    deckOrder.push([deck, tipKey(deck), Math.min(limit || ids.length, ids.length)]);
    const seen = new Set();
    ids.forEach((id, i) => {
      if (!byId[id]) throw new Error(order + "[" + i + "]: unknown kanji id " + id);
      if (seen.has(id)) throw new Error(order + "[" + i + "]: id " + id + " listed twice");
      seen.add(id);
      // `limit` shows only the head of the list; the file keeps the full order.
      if (limit && i >= limit) return;
      kanji.push(Object.assign({}, byId[id], { deck }));
    });
  }

  // UI chrome -- labels, tips, status messages -- is translated like any other
  // field, so a language is complete only when it covers the interface too.
  const ui = readJson("data/ui.json");
  for (const [key, v] of Object.entries(ui)) track(v, "ui.json " + key, "text");

  // Stories are translated too, and by the same rule: a language that cannot
  // tell the story is not a complete language.
  const stories = readJson("data/stories.json");
  const teach = fs.existsSync(path.join(SRC, "data", "teach.json")) ? readJson("data/teach.json") : {};
  for (const [set, s] of Object.entries(stories)) {
    const at = "stories.json " + set;
    // `title.ja` is the story's own name in Japanese, not a translation of
    // anything, so only the rest of it counts towards a language's coverage.
    if (!s.title || !s.title.ja) throw new Error(at + ": needs a Japanese `title.ja`");
    const { ja, ...titleT } = s.title;
    track(titleT, at, "title");
    s.pages.forEach((page, p) => page.forEach((line, i) => {
      track(line.t, at + " page " + (p + 1) + " line " + (i + 1), "t");
    }));
    for (const [w, g] of Object.entries(s.words)) {
      if (g.of) continue; // reading and meaning come from the corpus
      track({ en: g.en, es: g.es }, at + " word " + w, "gloss");
    }
  }

  const orphans = Object.keys(words).filter((id) => !used.has(id));
  if (orphans.length) throw new Error("words.json: " + orphans.length + " word(s) referenced by no kanji: " + orphans.slice(0, 5).join(", "));

  const complete = Object.keys(coverage).filter((c) => coverage[c] === fields);
  const partial = Object.keys(coverage).filter((c) => coverage[c] !== fields);
  if (!complete.includes(DEFAULT_LANG))
    throw new Error("default language '" + DEFAULT_LANG + "' is incomplete: " + (coverage[DEFAULT_LANG] || 0) + "/" + fields + " fields");
  return { kanji, words, ui, stories, teach, complete, partial, coverage, fields, deckOrder };
}

const pick = (v, lang) => v[lang] || v[DEFAULT_LANG];

// Join into the shape the app consumes. A word tuple is
// [surface, reading, gloss, id, freq, cat?] -- the id is what progress is
// keyed on, freq how common the word is (every word has one), and cat its
// semantic category where one has been assigned.
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
        // [surface, reading, gloss, id, frequency, category]
        const t = [w.w, w.reading, pick(w.gloss, lang), id, w.freq];
        if (w.cat !== undefined) t.push(w.cat);
        return t;
      }),
    })),
  }));
}

// The prompts a teacher puts to a student, one set at a time. There are two
// kinds: something to ask, in Japanese, and something to do, in the teacher's
// own language. Only the asking has Japanese in it to get wrong.
function buildTeach(raw, words, complete) {
  const ladder = readJson("data/ladder.json");
  const out = {};
  const byWord = {};
  for (const w of Object.values(words)) {
    if (!byWord[w.w] || (w.freq || 0) > (byWord[w.w].freq || 0)) byWord[w.w] = w;
  }
  for (const [set, t] of Object.entries(raw || {})) {
    const at = "teach.json " + set;
    if (!/^\d+$/.test(set)) throw new Error(at + ": the key is the number of the set the sheet belongs to");
    const first = parseInt(set, 10) * SET_WORDS;
    if (!Array.isArray(t.prompts) || !t.prompts.length) throw new Error(at + ": no prompts");
    const langsOf = (v) => {
      const o = {};
      for (const c of complete) o[c.toUpperCase()] = pick(v, c);
      return o;
    };
    // A prompt the teacher cannot read is no use to them, and a prompt with
    // English inside the Japanese is a typo nobody would catch by eye.
    const ahead = [];
    const prompts = t.prompts.map((q, i) => {
      const where = at + " prompt " + (i + 1);
      if (q.kind !== "ask" && q.kind !== "do") throw new Error(where + ": kind is `ask` or `do`");
      if (q.kind === "ask" && !q.ja) throw new Error(where + ": something to ask needs its Japanese");
      if (!q.en) throw new Error(where + ": no English");
      if (q.ja) {
        const stray = [...q.ja].filter((c) => !JA_ONLY.test(c));
        if (stray.length) throw new Error(where + ": not Japanese -- " + JSON.stringify(stray.join("")) + " in " + q.ja);
        // Words the student has not met are the teacher's to supply, not a
        // fault -- but a prompt built on three of them is one they cannot
        // answer, so they are counted and named.
        for (let n = first + SET_WORDS; n < ladder.length; n++) {
          const w = words[ladder[n]];
          if (w && w.w.length > 1 && q.ja.includes(w.w)) ahead.push(w.w + " (set " + (Math.floor(n / SET_WORDS) + 1) + ")");
        }
      }
      return { k: q.kind, ja: q.ja || "", t: langsOf(q) };
    });
    out[set] = { note: t.note ? langsOf(t.note) : null, prompts: prompts };
    if (ahead.length) {
      console.log("  set " + (parseInt(set, 10) + 1) + " asks with " + ahead.length +
        " words the student has not met: " + [...new Set(ahead)].join(", "));
    }
  }
  return out;
}

// A set is twenty words of the ladder, the same slice the app practises.
const SET_WORDS = 20;
// Only Japanese belongs in the Japanese, and "looks Japanese" is not the same
// as "is Japanese" -- a hangul character sat unnoticed in an example sentence
// until this list was written out (see tools/sentences.js).
const JA_ONLY = /[぀-ゟ゠-ヿ㐀-䶿一-鿿々、。・ー！？（）「」]/;

// Turns the hand-written stories into what the page renders: each line split
// into spans, and a table of what every tappable span means.
//
// The split happens here rather than in the browser because it is where the
// data can be checked. A story that quietly stopped carrying one of its set's
// twenty words would still read perfectly well, and be worthless -- so that
// is an error, as is a gloss written for a word the story never uses.
function buildStories(raw, words, complete) {
  const ladder = readJson("data/ladder.json");
  const out = {};
  const revision = [];
  // the commonest spelling of each word, and the rarest thing the ladder
  // teaches: the line below which a glossed word is rarer than the lesson
  const byWord = {};
  for (const w of Object.values(words)) {
    if (!byWord[w.w] || (w.freq || 0) > (byWord[w.w].freq || 0)) byWord[w.w] = w;
  }
  const floor = Math.min(...ladder.map((id) => (words[id] && words[id].freq) || 0));
  for (const [set, s] of Object.entries(raw)) {
    const at = "stories.json " + set;
    if (!/^\d+$/.test(set)) throw new Error(at + ": the key is the number of the set the story belongs to");
    const first = parseInt(set, 10) * SET_WORDS;
    const ids = ladder.slice(first, first + SET_WORDS);
    if (ids.length !== SET_WORDS) throw new Error(at + ": the ladder has no set " + set);
    const targets = new Map(ids.map((id) => [words[id].w, words[id]]));

    const langsOf = (v) => {
      const t = {};
      for (const c of complete) t[c.toUpperCase()] = pick(v, c);
      return t;
    };

    const gloss = [];
    const at_ = new Map();  // span as written -> its index in `gloss`
    const carried = new Set();
    const spanOf = (span) => {
      if (at_.has(span)) return at_.get(span);
      const note = (s.words || {})[span];
      // A conjugated set word is written out as it appears and pointed back at
      // its dictionary form, so the tip teaches 使う from 使って rather than
      // leaving the reader to guess which word they just met.
      const dict = note && note.of ? note.of : span;
      const w = targets.get(dict);
      let rec;
      if (w) {
        carried.add(dict);
        rec = { w: w.w, r: w.reading, k: 1, t: langsOf(w.gloss) };
      } else {
        if (note && note.of) throw new Error(at + " word " + span + ": `of` names " + note.of + ", which is not one of this set's words");
        if (!note.r) throw new Error(at + " word " + span + ": needs a reading `r`");
        rec = { w: span, r: note.r, t: langsOf({ en: note.en, es: note.es }) };
      }
      at_.set(span, gloss.length);
      gloss.push(rec);
      return gloss.length - 1;
    };

    // Longest first, so 意味 is one word rather than 意 and the 味 of this
    // set, and 注ぎます beats the bare 注ぐ it was written for.
    const spans = [...new Set([...Object.keys(s.words || {}), ...targets.keys()])].sort((a, b) => b.length - a.length);
    const longest = spans.reduce((n, x) => Math.max(n, x.length), 0);
    const met = new Set();

    let line = 0;
    const pages = s.pages.map((page, p) => page.map((l, i) => {
      const where = at + " page " + (p + 1) + " line " + (i + 1);
      if (!l.ja || !l.ja.trim()) throw new Error(where + ": no Japanese");
      const stray = [...l.ja].filter((c) => !JA_ONLY.test(c));
      if (stray.length) throw new Error(where + ": not Japanese -- " + JSON.stringify(stray.join("")) + " in " + l.ja);
      const parts = [];
      let plain = "";
      for (let c = 0; c < l.ja.length; ) {
        let hit = "";
        for (let n = Math.min(longest, l.ja.length - c); n > 0 && !hit; n--) {
          const try_ = l.ja.slice(c, c + n);
          if (spans.includes(try_)) hit = try_;
        }
        if (!hit) { plain += l.ja[c++]; continue; }
        if (plain) { parts.push([plain]); plain = ""; }
        met.add(hit);
        parts.push([hit, spanOf(hit)]);
        c += hit.length;
      }
      if (plain) parts.push([plain]);
      return { id: "story" + set + "-" + ++line, p: parts, t: langsOf(l.t) };
    }));

    const unused = Object.keys(s.words || {}).filter((w) => !met.has(w));
    if (unused.length) throw new Error(at + ": glossed but never used -- " + unused.join(", "));

    // Two numbers about the reading level, reported rather than enforced. A
    // story leaning on a word from a later set is not the fault it first
    // looks like: a word's position on the ladder is how common it is, so a
    // set-40 word is commoner than most of the scenery a story needs, and
    // glossing it costs the reader nothing. What does cost them is a word
    // rarer than anything the ladder ever teaches -- 毎晩 sits below all two
    // thousand -- and that is a judgement per chapter, not a rule. So: count
    // them, name them, and let whoever is writing decide.
    const rare = [];
    for (const span of Object.keys(s.words || {})) {
      const note = s.words[span];
      const spelling = note && note.of ? note.of : span;
      const w = byWord[spelling];
      if (w && w.freq !== undefined && w.freq < floor) rare.push(spelling + " " + w.freq.toFixed(2));
    }

    // How much of the ladder behind it a story puts back in front of the
    // reader. A serial that never revisits is a hundred separate exercises.
    // Counted against the text rather than the glosses: a word from an
    // earlier set needs no gloss -- that is the point of it -- so counting
    // only what is tappable would report nothing and mean nothing.
    const text = s.pages.map((pg) => pg.map((l) => l.ja).join("")).join("");
    const revised = new Set();
    for (let n = 0; n < first; n++) {
      const w = words[ladder[n]];
      if (w && w.w.length > 1 && text.includes(w.w)) revised.add(w.w);
    }
    revision.push({ set: set, revised: revised.size, rare: rare });
    const missed = [...targets.keys()].filter((w) => !carried.has(w));
    if (missed.length) throw new Error(at + ": the story never uses " + missed.length + " of the set's words -- " + missed.join(", ") +
      "\n  (a conjugated one is written out under `words` with `of`, e.g. \"使って\": { \"of\": \"使う\" })");

    out[set] = { ja: s.title.ja, t: langsOf(s.title), g: gloss, pages: pages };
  }
  if (revision.length) {
    const total = revision.reduce((n, r) => n + r.revised, 0);
    console.log("  stories put back " + Math.round(total / revision.length) + " earlier ladder words each" +
      " (by spelling, so a conjugated verb does not count)" +
      (revision.length <= 8 ? " (" + revision.map((r) => "set " + (Number(r.set) + 1) + ": " + r.revised).join(", ") + ")" : ""));
    const rare = revision.filter((r) => r.rare.length);
    for (const r of rare) {
      console.log("  set " + (Number(r.set) + 1) + " glosses " + r.rare.length +
        " words rarer than the whole ladder: " + r.rare.join(", "));
    }
  }
  return out;
}

// The chapters that have a picture, and what it is called. A chapter without
// one is drawn instead, so this list is the only difference between the two.
function readCovers() {
  const dir = path.join(SRC, "covers");
  if (!fs.existsSync(dir)) return {};
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    const m = /^(\d+)\.(jpg|jpeg|png|webp)$/i.exec(f);
    if (m) out[String(parseInt(m[1], 10))] = f;
  }
  return out;
}

// Which sets have a Teacher's Kit to open.
function readKits() {
  const dir = path.join(SRC, "kits");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((f) => /^set-(\d+)\.pdf$/i.exec(f))
    .filter(Boolean)
    .map((m) => parseInt(m[1], 10) - 1)
    .sort((a, b) => a - b);
}

function loadKanjiAndLangs() {
  const langs = readJson("data/langs.json");
  const { kanji, words, ui, stories, teach, complete, partial, coverage, fields, deckOrder } = loadData();

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

  // Example sentences by word id: the Japanese in exJa, its translations in
  // exT as { id: { LANG: [t1, t2] } }.
  const exT = {};
  const exJa = {};
  for (const [id, w] of Object.entries(words)) {
    if (!w.sentences || !w.sentences.length) continue;
    const per = {};
    for (const c of complete) per[c.toUpperCase()] = w.sentences.map((s) => pick(s.t, c));
    exT[id] = per;
    exJa[id] = w.sentences.map((s) => s.ja);
  }

  // Interface strings by language: { EN: { key: text }, ES: { ... } }.
  const uiT = {};
  for (const c of complete) {
    const t = {};
    for (const [key, v] of Object.entries(ui)) t[key] = pick(v, c);
    uiT[c.toUpperCase()] = t;
  }

  return { data: flatten(kanji, words, DEFAULT_LANG), exT, exJa, i18n, uiT, langs, available, partial, coverage, fields, deckOrder,
    stories: buildStories(stories, words, complete), teach: buildTeach(teach, words, complete) };
}

// The recorded clips that shipped, if any have been made yet.
function readVoices() {
  const man = path.join(SRC, "audio", "manifest.json");
  if (!fs.existsSync(man)) return { words: [], sentences: [], stories: [] };
  try {
    const m = JSON.parse(fs.readFileSync(man, "utf8"));
    return { words: m.words || [], sentences: m.sentences || [], stories: m.stories || [] };
  } catch (e) {
    throw new Error("src/audio/manifest.json: " + e.message);
  }
}

function build() {
  const meta = JSON.parse(fs.readFileSync(path.join(SRC, "assets/manifest.json"), "utf8"));

  const manifest = {};
  for (const [uuid, info] of Object.entries(meta)) {
    const bytes = fs.readFileSync(path.join(SRC, "assets", info.file));
    // Assets ship as they are. Gzipping them here needs DecompressionStream
    // in the browser to undo, which Safari only got in 16.4 -- an older
    // iPhone would mint the runtime's gzip bytes as a script and boot to a
    // blank page. The transport already compresses the response, and
    // base64-of-gzip does not compress twice, so this is also smaller on
    // the wire than it looks.
    const packed = info.compressed ? zlib.gzipSync(bytes, { level: 9 }) : bytes;
    manifest[uuid] = {
      mime: info.mime,
      compressed: info.compressed,
      data: packed.toString("base64"),
    };
  }

  const { data, exT, exJa, i18n, uiT, langs, available, partial, coverage, fields, deckOrder, stories, teach } = loadKanjiAndLangs();

  let template = fs.readFileSync(path.join(SRC, "app.html"), "utf8");
  const tokens = {
    __KANJI_DATA__: JSON.stringify(data),
    // Which words have a recording (tools/voices.js). The page checks this
    // list rather than probing for files, so a word without a clip goes
    // straight to the browser's voice instead of waiting on a 404.
    __VOICES__: JSON.stringify(readVoices()),
    __COVERS__: JSON.stringify(readCovers()),
    __KITS__: JSON.stringify(readKits()),
    // [name, ui.json tip key, kanji count] in rail order, so adding a deck or
    // reordering the rail is a decks.json edit and nothing else.
    __DECKS__: JSON.stringify(deckOrder),
    // A story per set, already split into the spans the reader can tap
    // (tools/build.js buildStories). Sets without one simply have no key.
    __STORIES__: JSON.stringify(stories),
    // What a teacher puts to a student for a set: prompts, not answers. Sets
    // without a sheet simply have no key, the way sets without a story do.
    __TEACH__: JSON.stringify(teach),
    // Complete non-default languages ride along so the picker can switch
    // without a refetch. Incomplete ones are omitted entirely.
    __KANJI_I18N__: JSON.stringify(i18n),
    __EX_TRANSLATIONS__: JSON.stringify(exT),
    __EX_JA__: JSON.stringify(exJa),
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
  console.log("  sentences: " + Object.keys(exJa).length + " of " + Object.keys(exT).length + " translated words");
  const storyLines = Object.values(stories).reduce((n, s) => n + s.pages.reduce((m, p) => m + p.length, 0), 0);
  console.log("  stories: " + Object.keys(stories).length + " (" + storyLines + " lines)");
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
  const line = out.split("\n")[shell.split("\n").findIndex((l) => l === "__BUNDLER_TEMPLATE__")];
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
  // Recordings travel with the site, not inside the page: they are served
  // as ordinary files so the browser can cache and reuse them. dist mirrors
  // src rather than accumulating -- a clip removed from src must stop being
  // deployed, and one left behind would be a voice nobody asked for.
  const audioSrc = path.join(SRC, "audio");
  const audioOut = path.join(dist, "audio");
  fs.rmSync(audioOut, { recursive: true, force: true });
  if (fs.existsSync(audioSrc)) {
    fs.mkdirSync(audioOut, { recursive: true });
    let n = 0;
    for (const f of fs.readdirSync(audioSrc)) {
      if (!/\.(mp3|json)$/.test(f)) continue;   // .incomplete is a note to the next run, not an asset
      fs.copyFileSync(path.join(audioSrc, f), path.join(audioOut, f));
      n++;
    }
    if (n) console.log("copied " + n + " voice files into dist/audio");
  }
  // The Teacher's Kits, rendered by tools/kit.mjs and committed, because
  // making a PDF needs a browser and a Japanese font and neither belongs in a
  // deploy. What does belong here is noticing when one has been left behind by
  // an edit to the words or the prompts it was made from.
  const kitSrc = path.join(SRC, "kits");
  const kitOut = path.join(dist, "kits");
  fs.rmSync(kitOut, { recursive: true, force: true });
  if (fs.existsSync(kitSrc)) {
    const pdfs = fs.readdirSync(kitSrc).filter((f) => /\.pdf$/i.test(f));
    if (pdfs.length) {
      fs.mkdirSync(kitOut, { recursive: true });
      for (const f of pdfs) fs.copyFileSync(path.join(kitSrc, f), path.join(kitOut, f));
      console.log("copied " + pdfs.length + " teacher's kits into dist/kits");
    }
    const { kitStamp } = require("./kit-stamp.cjs");
    const made = fs.existsSync(path.join(kitSrc, "made-from.json"))
      ? JSON.parse(fs.readFileSync(path.join(kitSrc, "made-from.json"), "utf8")) : {};
    const stale = [];
    for (const set of Object.keys(readJson("data/teach.json"))) {
      const file = "set-" + (Number(set) + 1) + ".pdf";
      const now = kitStamp(Number(set), { words: readJson("data/words.json"), ladder: readJson("data/ladder.json"),
        teach: readJson("data/teach.json"), stories: readJson("data/stories.json") });
      if (!pdfs.includes(file)) stale.push(file + " (never made)");
      else if (made[file] !== now) stale.push(file + " (made from something else)");
    }
    if (stale.length) console.log("  kits out of date: " + stale.join(", ") + " -- run tools/kit.mjs");
  }

  // Chapter covers, one to a set, fetched when a chapter is opened rather
  // than carried by the page: a hundred of them would be twelve megabytes
  // nobody has read yet.
  const coverSrc = path.join(SRC, "covers");
  const coverOut = path.join(dist, "covers");
  fs.rmSync(coverOut, { recursive: true, force: true });
  if (fs.existsSync(coverSrc)) {
    const art = fs.readdirSync(coverSrc).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));
    if (art.length) {
      fs.mkdirSync(coverOut, { recursive: true });
      for (const f of art) fs.copyFileSync(path.join(coverSrc, f), path.join(coverOut, f));
      console.log("copied " + art.length + " chapter covers into dist/covers");
    }
  }

  const cname = path.join(ROOT, "CNAME");
  if (fs.existsSync(cname)) fs.copyFileSync(cname, path.join(dist, "CNAME"));

  // The icons and the manifest, which are what make the page installable --
  // and an installed page is the only one iOS will run without an address bar
  // and a toolbar taking a fifth of the screen (tools/icon.js).
  for (const [name, data] of Object.entries(require("./icon.js").files())) {
    fs.writeFileSync(path.join(dist, name), data);
  }
  console.log("built index.html + dist/index.html (" + out.length + " bytes)");
}
