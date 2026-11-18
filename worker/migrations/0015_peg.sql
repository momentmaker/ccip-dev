-- The stLINK/LINK peg. Created empty: the hourly job backfills peg_hours from Curve's API and peg_markers from
-- staking_events, in chunks, since a large INSERT … SELECT here would time out against remote D1.
CREATE TABLE peg_hours (
  hour TEXT PRIMARY KEY,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL
);

CREATE TABLE peg_episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  side TEXT NOT NULL CHECK (side IN ('discount', 'premium')),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  peak_gap REAL NOT NULL,
  peak_at TEXT NOT NULL,
  best_size REAL,
  best_profit REAL,
  tier INTEGER NOT NULL DEFAULT 0,
  public INTEGER NOT NULL DEFAULT 0,
  public_at TEXT
);
CREATE INDEX peg_episodes_open ON peg_episodes (closed_at) WHERE closed_at IS NULL;

-- Every hour stake.link vaults unbonded or staked, summed; the publish keeps the notable ones.
CREATE TABLE peg_markers (
  hour TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('stakelink_unbonding', 'stakelink_deposit')),
  vaults INTEGER NOT NULL,
  link REAL,
  PRIMARY KEY (hour, kind)
);
