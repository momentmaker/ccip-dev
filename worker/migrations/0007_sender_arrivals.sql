-- SQLite cannot alter a CHECK, so arrivals is rebuilt to take kind 'sender': a sender identity's first day in the
-- day's top 10, recorded once for the "New on CCIP" moment.
CREATE TABLE arrivals_new (
  kind TEXT NOT NULL CHECK (kind IN ('chain', 'token', 'lane', 'sender')),
  key TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  announced_at TEXT,
  PRIMARY KEY (kind, key)
);
INSERT INTO arrivals_new (kind, key, first_seen, announced_at) SELECT kind, key, first_seen, announced_at FROM arrivals;
DROP TABLE arrivals;
ALTER TABLE arrivals_new RENAME TO arrivals;
