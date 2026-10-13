CREATE TABLE marines (
  serial INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  user_id TEXT NOT NULL,
  callsign TEXT NOT NULL,
  tag_key TEXT NOT NULL UNIQUE,
  tags TEXT NOT NULL,
  tier TEXT NOT NULL,
  score REAL NOT NULL,
  percentile REAL NOT NULL,
  memes TEXT NOT NULL,
  blood TEXT NOT NULL,
  faith TEXT NOT NULL,
  display_name TEXT NOT NULL,
  snapshot_version INTEGER NOT NULL,
  enlisted_at TEXT NOT NULL,
  card_key TEXT,
  UNIQUE (platform, user_id)
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
