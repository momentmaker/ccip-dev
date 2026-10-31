CREATE TABLE staking_events (
  block_number INTEGER NOT NULL,
  log_index INTEGER NOT NULL,
  pool TEXT NOT NULL CHECK (pool IN ('community', 'operator')),
  kind TEXT NOT NULL CHECK (kind IN ('staked', 'unstaked', 'unbonding', 'reset', 'operator_added', 'operator_removed')),
  staker TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  ts TEXT NOT NULL,
  amount TEXT,
  stake TEXT,
  total TEXT,
  PRIMARY KEY (block_number, log_index)
);
CREATE INDEX staking_events_staker ON staking_events (staker);

CREATE TABLE staking_holders (
  address TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('wallet', 'smart', 'stakelink', 'contract')),
  checked_at TEXT NOT NULL
);
