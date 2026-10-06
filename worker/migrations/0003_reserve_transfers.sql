CREATE TABLE reserve_transfers (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  ts TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  counterparty TEXT NOT NULL,
  amount TEXT NOT NULL,
  link_usd REAL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX reserve_transfers_ts ON reserve_transfers (ts);

ALTER TABLE daily_totals ADD COLUMN fee_link_usd REAL;
