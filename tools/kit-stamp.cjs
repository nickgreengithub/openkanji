// What a Teacher's Kit was made from, in ten characters.
//
// The PDFs are committed, so nothing about building or deploying the site
// notices when a set's words, sentences or prompts change underneath one. This
// is what lets the build notice: the same inputs, hashed the same way, on both
// sides -- tools/kit.mjs writes it when it renders, tools/build.js checks it.
const crypto = require("crypto");

function kitInputs(set, { words, ladder, teach, stories }) {
  const sheet = teach[String(set)];
  if (!sheet) return null;
  const mine = ladder.slice(set * 20, set * 20 + 20).map((id) => {
    const w = words[id];
    const ex = (w.sentences || [])[0];
    return [w.w, w.reading, w.gloss.en, ex ? ex.ja : "", ex && ex.t ? ex.t.en : ""];
  });
  const story = stories[String(set)];
  return JSON.stringify({ set, note: sheet.note || null, prompts: sheet.prompts, words: mine,
    story: story ? [story.title.ja, story.title.en] : null });
}

module.exports = {
  kitInputs,
  kitStamp: (set, data) => {
    const raw = kitInputs(set, data);
    return raw === null ? null : crypto.createHash("sha1").update(raw).digest("hex").slice(0, 10);
  },
};
