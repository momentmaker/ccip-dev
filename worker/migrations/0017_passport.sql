-- Token Passport (KTD18). Created empty and never backfilled: the daily passport job fills them from its own readings,
-- and its first run with PASSPORT = "on" clears whatever a dry run left.

-- Per-chain read state. attempts counts today's tries: a failed first try is retried in a later run before failures rises.
CREATE TABLE passport_chains (
  chain TEXT PRIMARY KEY,
  last_block INTEGER,
  ok_day TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  transport TEXT,
  tried_day TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);

-- One registry row's last successful reading, rewritten on each one. changed lists the chain values (party addresses,
-- limit switches, remote tokens and pools) that differ from the reading before it, for telling a change from a
-- re-classification. arrival holds a new row's readings until its arrival confirms on arrival_day.
CREATE TABLE passport_rows (
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  reading TEXT,
  read_day TEXT,
  method INTEGER,
  first_read_day TEXT,
  changed TEXT,
  arrival TEXT,
  arrival_day TEXT,
  delisted_day TEXT,
  PRIMARY KEY (chain, address)
);

-- One flag-capable result and its wire state; chain and address name the result's first row.
CREATE TABLE passport_units (
  unit TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  result TEXT NOT NULL,
  basis TEXT NOT NULL,
  announced TEXT,
  pending TEXT,
  pending_day TEXT,
  wire TEXT NOT NULL
);
CREATE INDEX passport_units_row ON passport_units (chain, address);

CREATE TABLE passport_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE INDEX passport_changes_row ON passport_changes (chain, address);
-- A second evaluation on one day deletes that day's evaluation entries by this index before writing them again.
CREATE INDEX passport_changes_day ON passport_changes (day, kind);

CREATE TABLE passport_posts (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  group_id TEXT,
  facts TEXT NOT NULL,
  state TEXT NOT NULL
);
CREATE INDEX passport_posts_day ON passport_posts (day);
