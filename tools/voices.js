#!/usr/bin/env node
// Records the spoken form of each word, once, so playback is a file rather
// than a guess about what the visitor's browser can say.
//
// The browser's own speech engine is not dependable for this: a machine may
// have no Japanese voice at all, and the one Chrome offers by default is
// fetched from Google's servers at press time -- slow when it works, silent
// when it does not. A recording is the same for everybody and arrives at
// once.
//
// Usage:  GOOGLE_TTS_KEY=... node tools/voices.mjs [--words 400] [--voice ja-JP-Neural2-B]
//
// Words are read from their kana reading, so the learner hears the reading
// the app teaches rather than whichever one the engine guesses for a kanji
// standing on its own. Sentences are read as written, where the context
// settles the reading by itself.
//
// Already-recorded clips are skipped, so a re-run costs nothing and an
// interrupted run can simply be repeated.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "src", "audio");
const API = process.env.TTS_URL || "https://texttospeech.googleapis.com/v1/text:synthesize";

const arg = (name, fallback) => {
  const i = process.argv.indexOf("--" + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const WORDS = parseInt(arg("words", "400"), 10);
const VOICE = arg("voice", "ja-JP-Neural2-B");
const RATE = parseFloat(arg("rate", "0.92"));
const KEY = process.env.GOOGLE_TTS_KEY;

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

async function say(text) {
  const body = {
    input: { text },
    voice: { languageCode: "ja-JP", name: VOICE },
    audioConfig: { audioEncoding: "MP3", speakingRate: RATE, sampleRateHertz: 24000 },
  };
  for (let attempt = 0; attempt < 7; attempt++) {
    const res = await fetch(API + "?key=" + encodeURIComponent(KEY), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = await res.json();
      if (!json.audioContent) throw new Error("no audio came back for " + JSON.stringify(text));
      return Buffer.from(json.audioContent, "base64");
    }
    // Rate limits and upstream hiccups are worth waiting out; a bad request
    // or a bad key never becomes good, so say so at once.
    if (res.status !== 429 && res.status < 500) {
      throw new Error("text-to-speech refused (" + res.status + "): " + (await res.text()).slice(0, 300));
    }
    // Neural voices are quota'd by characters per minute, so a big run will
    // meet 429s no matter how it is paced. Wait as long as the service asks,
    // or back off steeply, rather than burning the attempt.
    const asked = parseFloat(res.headers.get("retry-after") || "0");
    const wait = asked > 0 ? asked * 1000 : Math.min(30000, 700 * Math.pow(2, attempt));
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error("text-to-speech kept failing for " + JSON.stringify(text));
}

async function main() {
  if (!KEY) {
    console.error("GOOGLE_TTS_KEY is not set. This script spends money on that key,\n" +
      "so it will not run without one being handed to it deliberately.");
    process.exit(2);
  }
  const ladder = readJson("src/data/ladder.json");
  const words = readJson("src/data/words.json");
  fs.mkdirSync(OUT, { recursive: true });

  const jobs = [];
  for (const id of ladder.slice(0, WORDS)) {
    const w = words[id];
    if (!w) continue;
    const reading = w.reading || w.w;
    if (reading) jobs.push({ file: id + ".mp3", text: reading });
    const s = w.sentences && w.sentences[0];
    if (s && s.ja) jobs.push({ file: id + ".s.mp3", text: s.ja });
  }

  const todo = jobs.filter((j) => !fs.existsSync(path.join(OUT, j.file)));
  const chars = todo.reduce((n, j) => n + j.text.length, 0);
  console.log(WORDS + " words: " + jobs.length + " clips, " + todo.length + " still to record (" +
    chars + " characters, about $" + ((chars / 1e6) * 16).toFixed(2) + ")");

  let done = 0, failed = 0;
  const LANES = parseInt(arg("lanes", "3"), 10);
  await Promise.all(Array.from({ length: LANES }, async () => {
    while (todo.length) {
      const job = todo.shift();
      try {
        fs.writeFileSync(path.join(OUT, job.file), await say(job.text));
        if (++done % 50 === 0) console.log("  recorded " + done + "...");
      } catch (e) {
        failed++;
        console.error("  " + job.file + ": " + e.message);
      }
    }
  }));

  // What the page is allowed to reach for. A clip missing from here is never
  // requested, so a learner never waits on a 404 before the fallback voice.
  const have = fs.readdirSync(OUT).filter((f) => f.endsWith(".mp3"));
  // "<id>.mp3" and "<id>.s.mp3" both reduce to the id. The suffix is
  // optional, not the dot before it -- get that wrong and every word without
  // a sentence drops out of the manifest and its recording never plays.
  const ids = [...new Set(have.map((f) => f.replace(/\.(s\.)?mp3$/, "")))].sort();
  const manifest = {
    voice: VOICE,
    rate: RATE,
    words: ids.filter((id) => have.includes(id + ".mp3")),
    sentences: ids.filter((id) => have.includes(id + ".s.mp3")),
  };
  const clips = manifest.words.length + manifest.sentences.length;
  if (clips !== have.length) {
    throw new Error("manifest lists " + clips + " clips but " + have.length + " are on disk -- " +
      "every recording must be reachable or it is dead weight");
  }
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 0) + "\n");
  const bytes = have.reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
  console.log("recorded " + done + ", failed " + failed + "; " + have.length + " clips on disk (" +
    (bytes / 1048576).toFixed(1) + "MB)");
  console.log("now run: npm run build");
  // Every clip recorded is one already paid for. A run that loses some must
  // still hand back the ones it got -- they are skipped next time, so a
  // second run only picks up what is missing. Nothing recorded at all is the
  // only outright failure.
  if (failed) {
    console.log(failed + " clip(s) did not record. Run this again to pick them up.");
    fs.writeFileSync(path.join(OUT, ".incomplete"), String(failed) + "\n");
  } else {
    fs.rmSync(path.join(OUT, ".incomplete"), { force: true });
  }
  if (!done && failed) process.exit(1);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
