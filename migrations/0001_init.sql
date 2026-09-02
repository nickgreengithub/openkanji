-- Accounts are email-only: no passwords are ever stored or handled.
CREATE TABLE users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- Only the SHA-256 of a magic-link token is stored, so a leaked database
-- yields no usable login links. Single use, short expiry.
CREATE TABLE login_tokens (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX login_tokens_expires_at ON login_tokens(expires_at);

-- One row per user. `mastered` is a JSON array of stable word ids ("w0142").
-- Stored whole rather than one row per word: D1's free tier meters rows read,
-- so this is one row read per load regardless of how large the corpus grows.
CREATE TABLE progress (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mastered   TEXT    NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

-- Throttles magic-link sends per email and per IP. Cheap and self-cleaning.
CREATE TABLE send_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  kind    TEXT    NOT NULL,
  subject TEXT    NOT NULL,
  at      INTEGER NOT NULL
);
CREATE INDEX send_log_lookup ON send_log(kind, subject, at);
