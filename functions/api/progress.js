// GET  /api/progress -> { mastered: ["w0142", ...] }
// PUT  /api/progress    { mastered: [...] }  replaces the row
//
// Progress is a JSON array of stable word ids. Ids rather than word text so
// a reading or gloss can be corrected without invalidating what people have
// already learned.
import { json, bad, requireSession } from "../_lib.js";

// Guard rails: ids are "w" plus digits, and the corpus is a few thousand
// words, so anything far beyond that is malformed or malicious.
const MAX_IDS = 20000;
const VALID = /^w\d{1,6}$/;

export async function onRequestGet(context) {
  const { userId, error } = await requireSession(context);
  if (error) return error;
  const row = await context.env.DB
    .prepare("SELECT mastered, updated_at FROM progress WHERE user_id = ?")
    .bind(userId)
    .first();
  if (!row) return json({ mastered: [], updated_at: null });
  let mastered = [];
  try { mastered = JSON.parse(row.mastered); } catch { mastered = []; }
  return json({ mastered, updated_at: row.updated_at });
}

export async function onRequestPut(context) {
  const { userId, error } = await requireSession(context);
  if (error) return error;

  let body;
  try { body = await context.request.json(); } catch { return bad("expected JSON"); }
  if (!Array.isArray(body?.mastered)) return bad("`mastered` must be an array of word ids");
  if (body.mastered.length > MAX_IDS) return bad("too many ids", 413);

  // Normalise before storing: unique, sorted, and only well-formed ids. This
  // keeps the row small and makes it comparable between devices.
  const ids = [...new Set(body.mastered)].filter((id) => typeof id === "string" && VALID.test(id)).sort();

  const now = Math.floor(Date.now() / 1000);
  await context.env.DB
    .prepare(
      "INSERT INTO progress (user_id, mastered, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET mastered = excluded.mastered, updated_at = excluded.updated_at"
    )
    .bind(userId, JSON.stringify(ids), now)
    .run();

  return json({ ok: true, count: ids.length, updated_at: now });
}
