// GET /api/me -> { email } when signed in, 401 otherwise.
import { json, requireSession } from "../_lib.js";

export async function onRequestGet(context) {
  const { userId, error } = await requireSession(context);
  if (error) return error;
  const row = await context.env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first();
  if (!row) return json({ error: "not signed in" }, 401);
  return json({ email: row.email });
}
