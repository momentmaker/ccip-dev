# Chainlink Reserve cost basis and LINK metrics — design

Status: draft for owner review (2026-10-06). Extends the data core (`2026-10-05-data-core-design.md`, §6.3 `reserve.json`, §7.5).

## 1. Goal and success criteria

LINK holders want to see what the Chainlink Reserve's LINK was worth when it arrived, what it is worth now, and how fast it
grows. The data core already records the Reserve's LINK balance every hour (`reserve_snapshots`, `reserve.json`). This adds
the Reserve's transfer history, priced at deposit time, plus one CCIP metric about LINK's use as a fee token.

Done when:
1. **History:** every LINK `Transfer` into or out of the Reserve since block 23,039,541 (its first transfer,
   2025-07-31) is stored in D1. Once the scan has caught up, Σ in − Σ out equals the Reserve's `balanceOf` at the scan
   cursor block; a mismatch raises an alert.
2. **Prices:** each transfer carries DefiLlama's LINK price at its block time, or is retried every hour until it does.
3. **Public data:** `reserve.json` gains the cost-basis, pace, weekly, performance and transfer fields of §5, computed
   from the stored transfers.
4. **Alerts:** LINK leaving the Reserve raises a Telegram alert to the owner within the hour.
5. **Fees in LINK:** daily totals carry the USD value of CCIP fees paid in LINK from the live start day (2026-10-05),
   published in `today.json` and `history.json`.
6. **Free only:** keyless RPC endpoints and DefiLlama; no paid plans.

Not in scope: tracing the swaps that bought the LINK (the owner chose deposit-time market prices); any website visuals
or posts (sub-project 2 reads `latest_transfer` to announce deposits).

## 2. Facts this design relies on (measured 2026-10-06)

- 93 transfers in and 1 out since 2025-07-31; they net to 6,122,201.43 LINK, exactly the balance the hourly job reads.
- Deposits come weekly, on Thursdays at about 15:35 UTC, from `0x5680681ed3767b96914ce741a308155c7fb9171d` (62 transfers,
  99.9996% of the LINK). Apart from one 1-LINK test, its transfers are 41,105–153,956 LINK. The other 31 inbound
  transfers come from 16 addresses and are all ≤ 7 LINK. The one outbound transfer returned 1 LINK on 2025-08-02.
- Keyless log access: `https://rpc.mevblocker.io` and `https://0xrpc.io/eth` serve `eth_getLogs` over 10,000-block
  ranges at archive depth, and each log includes `blockTimestamp`. mevblocker sometimes answers "service temporarily
  unavailable". publicnode requires a token for archive logs; drpc refused log queries.
- DefiLlama `batchHistorical` priced all 93 inbound transfers in one request, each within 58 s of its block time.

## 3. Storage

Migration `0003_reserve_transfers.sql`:

```sql
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
```

- `amount` is the raw 18-decimal integer as a decimal string. `counterparty` is the lowercase sender for `in` and the
  lowercase recipient for `out`. `ts` is the block time in ISO 8601 UTC. `link_usd` is null until priced.
- Meta keys:
  - `reserve_scan_block`: the last block fully scanned. When absent, the scan starts at block 23,039,541.
  - `reserve_scan_failures`: consecutive hourly runs whose scan failed.
  - `reserve_scan_caught_up`: set to `1` the first time the cursor reaches the confirmed head.

## 4. Hourly job

New order of `runHourly`:
1. Record the balance (unchanged).
2. Scan transfers.
3. Price transfers.
4. Reconcile.
5. Then, unchanged: snapshot the registry, publish the registry files (`reserve.json` now includes §5), and refresh
   the CoinGecko ids.

Each new step catches its own errors, so a failure never stops the steps after it.

### 4.1 Scan (`packages/core/src/reserve.ts` for the RPC calls, `worker/src/jobs/reserve.ts` for the job)
- `head` = `eth_blockNumber` − 12 confirmations.
- From `reserve_scan_block + 1`, scan chunks of at most 10,000 blocks, up to 50 chunks per run. That covers 500,000
  blocks per run, so the backfill of about 3.1 million blocks finishes in about 7 hourly runs; afterwards each run
  scans about 300 blocks.
- Each chunk makes two `eth_getLogs` calls on the LINK token for topic0 `Transfer`: one with the Reserve as topic2
  (`in`) and one with it as topic1 (`out`). Logs with `removed: true` are ignored.
- Endpoints, tried in order until one answers both calls: `RPC_ETHEREUM` and `RPC_FALLBACKS` (when set), then
  `LOG_RPC_URLS = ['https://rpc.mevblocker.io', 'https://0xrpc.io/eth']`.
- `blockTimestamp` comes from the log. When an endpoint omits it, use `eth_getBlockByNumber` for that block.
- Rows are inserted with `INSERT OR IGNORE`. `reserve_scan_block` is written after every chunk, so progress survives a
  failed run.
- When every endpoint fails on a chunk, the scan stops for this run and `reserve_scan_failures` goes up by one. At 3,
  alert `reserve-scan`. A run with no failure resets it to 0.
- **Outflow alert:** for each newly inserted `out` row whose block time is within 24 hours of now, alert
  `reserve-outflow:<tx_hash>`: "LINK left the Chainlink Reserve: <amount> LINK to <counterparty> (tx <hash>)". The
  24-hour window keeps the backfill's August 2025 test return from alerting.

### 4.2 Price
- Select up to 200 rows with `link_usd IS NULL`, oldest first. Price them with one DefiLlama `batchHistorical` call for
  `ethereum:0x514910771AF9Ca656af840dff83E8264EcF986CA`, with `searchWidth=600` and each row's block time, and
  store the returned prices.
- A row DefiLlama does not return stays null and is retried next hour. A failed call is logged and retried next hour,
  with no alert. `reserve.json` reports the count of unpriced transfers.

### 4.3 Reconcile
- Runs only when the scan has caught up (the cursor is at or past `head`). Compare Σ in − Σ out (BigInt over the
  stored raw amounts) with `balanceOf(Reserve)` read by `eth_call` at the cursor block. That block is the last one
  scanned, so it is always on-chain and covered by the stored transfers.
- A mismatch alerts `reserve-mismatch` with both values.
- A failed read is logged and skipped.

## 5. `reserve.json` additions

The existing fields stay as they are (`token`, `reserve`, `latest`, `series`). `schema_version` stays 1, because all
the changes are additions.

```jsonc
{
  "link_price_usd": 14.0584,              // latest DefiLlama price for ethereum:0x5149…
  "cost_basis": {                          // null until reserve_scan_caught_up
    "link_in": 6122202.43,
    "link_out": 1.0,
    "cost_usd": 67978245.12,               // Σ in at deposit-time price − Σ out at its own time price
    "value_usd": 86068521.30,              // (link_in − link_out) × link_price_usd
    "change_usd": 18090276.18,
    "change_pct": 26.61,
    "avg_deposit_price_usd": 11.1036,      // over deposits (see definitions)
    "unpriced_transfers": 0
  },
  "pace": {                                // null until caught up
    "deposits": 61,
    "last_deposit": { "ts": "…", "tx": "0x…", "link": 74703.04, "price_usd": 14.2564, "usd": 1065007.88 },
    "days_since_last_deposit": 5.02,
    "avg_weekly_link_4w": 87845.85,
    "avg_weekly_usd_4w": 1186514.52,
    "annualized_link": 4567984.2,
    "supply_share_pct": 0.6122,            // balance / 1,000,000,000 LINK
    "next_milestone": { "link": 7000000, "eta": "2026-12-24" },
    "avg_days_between_deposits": 7.0,
    "next_expected_deposit": "2026-10-08T15:35:00.000Z",
    "deposit_overdue": false,
    "deposit_streak": 60
  },
  "weekly": [ { "week": "2026-09-28", "deposits": 1, "link": 74703.04, "usd": 1065007.88 } ],
  "performance": {
    "best": { "ts": "…", "tx": "0x…", "price_usd": 9.87 },
    "worst": { "ts": "…", "tx": "0x…", "price_usd": 17.65 },
    "above": 40,
    "below": 21
  },
  "transfers": [
    { "ts": "…", "tx": "0x…", "direction": "in", "counterparty": "0x5680…", "link": 74703.04,
      "price_usd": 14.2564, "usd": 1065007.88, "value_now_usd": 1050208.31, "change_pct": -1.39 }
  ],
  "latest_transfer": { /* the last element of transfers */ }
}
```
(The values shown are illustrations of the shape, not measurements.)

Definitions:
- **Deposit:** an inbound transfer of at least 1,000 LINK (`DEPOSIT_MIN_LINK`). That excludes the 1-LINK test and the
  small gifts. Pace, weekly and performance use deposits. Cost basis uses every transfer, so it reconciles with the
  balance.
- `value_usd` uses the scanned net LINK, not the hourly balance read, so cost and value always cover the same
  transfers. Reconciliation (§4.3) checks that the two agree.
- `usd` of a transfer is `link × price_usd`, where `price_usd` is the price at its block time. `value_now_usd` is
  `link × link_price_usd`.
- `change_pct` on a transfer, and `above`/`below`, compare the deposit price with the current price. Outflows have no
  `value_now_usd` and no `change_pct`.
- `weekly` buckets deposits by UTC week starting Monday. It runs from the first deposit's week to the current week and
  includes weeks with no deposits. `usd` is the deposit-time value; the methodology describes it as "USD value of LINK
  deposited, at deposit-time price", never as revenue.
- `avg_weekly_*_4w` averages the last 4 complete weeks. `annualized_link` = `avg_weekly_link_4w × 52`.
- `next_milestone.link` is the next multiple of 1,000,000 LINK above the balance. `eta` is the UTC date when the
  balance reaches it at `avg_weekly_link_4w`. It is null when that average is 0.
- `days_since_last_deposit` is measured from the file's `updated_at`.
- `avg_days_between_deposits` is the mean gap between consecutive deposits, rounded to 2 decimals. Null with fewer than 2 deposits.
- `next_expected_deposit` is the last deposit's time plus the median gap between all consecutive deposits (exact milliseconds). With an even number of gaps, the median is the mean of the two middle gaps. Null with fewer than 2 deposits.
- `deposit_overdue` is true when `next_expected_deposit` is not null and now is more than 24 hours after it. False otherwise.
- `deposit_streak` is the count of consecutive deposits from the latest, each with a gap to the previous of at most 8 days. 0 with no deposits, 1 with one deposit.
- Rounding: LINK to 2 decimals, USD to 2, percentages to 2 (except `supply_share_pct`, to 4), prices to 4.
- Before the first catch-up, `cost_basis`, `pace`, `performance` and `latest_transfer` are null, and `weekly` and
  `transfers` are empty arrays.
- If any transfer is unpriced, `cost_usd`, `change_*` and the affected `usd` values are computed over the priced rows
  only, and `unpriced_transfers` says how many rows are missing.

## 6. CCIP fees paid in LINK

- **LINK fee tokens:** the registry tokens in the CCIP token group that contains `ethereum-mainnet`'s LINK
  (`0x514910771AF9Ca656af840dff83E8264EcF986CA`), as a set of `chain:address` with lowercase EVM addresses.
- **Rollup:** a pure function `linkFeeUsd(messages, day, isLinkFee)` sits next to `rollupDay`. `rollupDay` and the
  shared `DailyTotals` type stay unchanged, so the backfill's SQL is untouched.
  - It returns Σ `fee_usd` of the day's messages whose fee token matches.
  - It returns null exactly when no message of the day has a `fee_usd` (no fee data, e.g. history before
  2026-10-05).
  - Finalize stores it with `UPDATE daily_totals SET fee_link_usd`. The backfill never writes the column, so its days
  stay null.
- **Publish:**
  - `today.json` `totals` gains `fee_link_usd` and `fee_link_share_pct` (= `fee_link_usd / fee_usd × 100`, null when
    `fee_usd` is null or 0).
  - `history.json` `days[]` gains `fee_link_usd`.

## 7. Error handling
- Every new step is wrapped so that ingest, the registry snapshot and publishing never stop because of it. Failures
  log with context: chunk range, endpoint index, HTTP status or RPC error.
- Alerts use the existing alerter, so repeats are suppressed for 1 hour:
  - `reserve-scan` (3 failed runs in a row)
  - `reserve-outflow:<tx>`
  - `reserve-mismatch`

## 8. Testing
- **Core:**
  - log parsing (in/out, counterparty, raw amount, `blockTimestamp` present and absent)
  - chunk planning (cursor, cap, head)
  - endpoint fallback on error
  - the cost, pace, weekly, performance and milestone math against a fixed transfer list, including an outflow, a
    sub-threshold gift and an unpriced row
- **Worker (workerd + D1):**
  - a backfill split across two runs resumes from the cursor
  - an outflow alert fires only inside 24 hours
  - reconcile alerts on a mismatch and stays quiet when values match
  - `reserve.json` keeps its existing fields and gains the new ones
  - `cost_basis` is null before catch-up
  - `fee_link_usd` and the share in `today.json`/`history.json`, null on backfill days
- CI makes no real network calls; RPC and DefiLlama are faked.

## 9. Docs
- `docs/methodology.md`: a "Chainlink Reserve" section covering sources, the deposit-time price definition and its
  limits (market price, not purchase price), the deposit threshold, and reconciliation.
- Data-core spec §6.3: point `reserve.json`'s row to this document.
- Runbook: a health check that `cost_basis` is non-null after the backfill and that the reconcile alert is quiet.
