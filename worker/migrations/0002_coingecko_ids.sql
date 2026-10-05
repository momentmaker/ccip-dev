-- Which CoinGecko coin each registry token is, refreshed once a day by the hourly job. Ids only: prices come from
-- DefiLlama's coingecko:<id> keys, never from CoinGecko.
CREATE TABLE coingecko_ids (
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  coin_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (chain, address)
);
