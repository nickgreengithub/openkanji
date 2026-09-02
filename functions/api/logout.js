// POST /api/logout -> clears the session cookie.
import { json, clearCookie } from "../_lib.js";

export async function onRequestPost() {
  return json({ ok: true }, 200, { "set-cookie": clearCookie() });
}
