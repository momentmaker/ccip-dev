-- daily_breakdown summed per month, so the all-time rankings read about one row per key per month instead of one per
-- key per day. A month is rolled (deleted and rebuilt from daily_breakdown) once its last day is finalized, and the meta
-- pointer breakdown_rolled_through names the last month of the contiguous rolled prefix: all-time readers take monthly
-- rows through it and daily rows after it. Rewriting a day of a rolled month moves the pointer back before that month,
-- in the same batch, until the hourly run rolls it again. `first_day` is the key's first day in the month. The table
-- starts empty; the hourly run rolls the history forward, a few months a run.
CREATE TABLE monthly_breakdown (
  month TEXT NOT NULL,
  dim TEXT NOT NULL,
  key TEXT NOT NULL,
  messages INTEGER NOT NULL,
  usd_value REAL NOT NULL,
  fee_usd REAL,
  first_day TEXT NOT NULL,
  PRIMARY KEY (dim, month, key)
);
CREATE INDEX monthly_breakdown_month ON monthly_breakdown (month);
