-- OpenKanji progress sync -- D1 schema.
--
--   wrangler d1 execute openkanji --remote --file=worker/schema.sql
--
-- Three tables. `users` and `progress` are the durable data; `login_tokens` is
-- short-lived and doubles as the rate-limit ledger (see worker/src/index.js).

create table if not exists users (
  id         integer primary key autoincrement,
  email      text    not null unique,
  created_at integer not null
);

create table if not exists progress (
  user_id    integer primary key references users(id) on delete cascade,
  mastered   text    not null default '{}',  -- JSON: { "w0226": true, ... }
  deck       text,                           -- e.g. "JLPT N3"
  lang       text,                           -- e.g. "ES"
  updated_at integer not null
);

-- One row per magic-link request. The raw token never lands here: only its
-- SHA-256, so a leaked database cannot be used to sign in. Rows are kept until
-- they expire (not deleted on use) because recent rows are what the rate
-- limiter counts; expired rows are swept opportunistically on each request.
create table if not exists login_tokens (
  hash       text    primary key,
  email      text    not null,
  ip         text,
  created_at integer not null,
  expires_at integer not null,
  used_at    integer
);

create index if not exists login_tokens_email on login_tokens (email, created_at);
create index if not exists login_tokens_ip    on login_tokens (ip, created_at);
create index if not exists login_tokens_expiry on login_tokens (expires_at);
