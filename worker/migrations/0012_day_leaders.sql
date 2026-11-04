-- Each finalized day's leaders as day-leaders.json lists them, so a publish reads 400 rows instead of recomputing 400
-- days. `fingerprint` names the labels, projects, label tokens and claimed groups the sender leader was resolved with;
-- a row under another fingerprint is served until the hourly refresh replaces it. `entry` is the day's JSON entry, or
-- 'null' for a day without leaders. Rewriting a day's breakdown deletes its row. The table starts empty: the hourly
-- refresh fills it, a chunk an hour.
CREATE TABLE day_leaders (
  day TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  entry TEXT NOT NULL
);
