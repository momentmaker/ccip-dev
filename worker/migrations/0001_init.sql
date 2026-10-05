CREATE TABLE messages (
  message_id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  send_ts TEXT NOT NULL,
  receipt_ts TEXT,
  status TEXT NOT NULL,
  src_chain TEXT NOT NULL,
  dst_chain TEXT NOT NULL,
  sender TEXT NOT NULL,
  receiver TEXT,
  origin TEXT,
  token_count INTEGER NOT NULL DEFAULT 0,
  usd_value REAL NOT NULL DEFAULT 0,
  unpriced INTEGER NOT NULL DEFAULT 0,
  fee_token TEXT,
  fee_amount TEXT,
  fee_usd REAL,
  ready_for_manual_exec INTEGER NOT NULL DEFAULT 0,
  detail_fetched_at TEXT,
  next_check_at TEXT,
  source TEXT NOT NULL CHECK (source IN ('live', 'backfill'))
);
CREATE INDEX messages_day ON messages (day);
CREATE INDEX messages_sender ON messages (src_chain, sender, day);
CREATE INDEX messages_send_ts ON messages (send_ts);
CREATE INDEX messages_next_check ON messages (next_check_at) WHERE next_check_at IS NOT NULL;

CREATE TABLE message_tokens (
  message_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  chain TEXT NOT NULL,
  token TEXT NOT NULL,
  amount TEXT NOT NULL,
  usd_value REAL,
  PRIMARY KEY (message_id, idx)
);

CREATE TABLE daily_totals (
  day TEXT PRIMARY KEY,
  messages INTEGER NOT NULL,
  token_messages INTEGER NOT NULL,
  usd_value REAL NOT NULL,
  fee_usd REAL,
  unique_senders INTEGER NOT NULL,
  median_delivery_s INTEGER,
  unpriced_messages INTEGER NOT NULL,
  computed_at TEXT NOT NULL
);

CREATE TABLE daily_breakdown (
  day TEXT NOT NULL,
  dim TEXT NOT NULL,
  key TEXT NOT NULL,
  messages INTEGER NOT NULL,
  usd_value REAL NOT NULL,
  fee_usd REAL,
  PRIMARY KEY (day, dim, key)
);
CREATE INDEX daily_breakdown_dim ON daily_breakdown (dim, day);

CREATE TABLE chains (
  selector TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  family TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

CREATE TABLE tokens (
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  group_id TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (chain, address)
);

CREATE TABLE arrivals (
  kind TEXT NOT NULL CHECK (kind IN ('chain', 'token', 'lane')),
  key TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  announced_at TEXT,
  PRIMARY KEY (kind, key)
);

CREATE TABLE reserve_snapshots (ts TEXT PRIMARY KEY, link_balance TEXT NOT NULL);

CREATE TABLE prices_latest (
  llama_key TEXT PRIMARY KEY,
  usd REAL NOT NULL,
  decimals INTEGER NOT NULL,
  ts TEXT NOT NULL,
  seen_at TEXT NOT NULL
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
