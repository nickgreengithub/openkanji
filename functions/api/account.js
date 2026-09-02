// DELETE /api/account -> removes the user; progress and tokens cascade.
// This is the GDPR deletion path, so it must actually delete rather than
// flag the row.
import { json, clearCookie, requireSession } from "../_lib.js";

export async function onRequestDelete(context) {
  const { userId, error } = await requireSession(context);
  if (error) return error;
  const db = context.env.DB;
  // D1 does not enforce foreign keys by default, so delete children explicitly
  // rather than relying on ON DELETE CASCADE.
  await db.batch([
    db.prepare("DELETE FROM progress WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM login_tokens WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]);
  return json({ ok: true }, 200, { "set-cookie": clearCookie() });
}
