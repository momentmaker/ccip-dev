# ccip.dev — Sub-project 1: Data Core

**Status:** Draft for review · **Date:** 2026-10-05 · **Target:** live by 2026-10-10, ahead of the 2026-10-28 launch

## 1. Context

ccip.dev is an unofficial, community-run stats project for Chainlink CCIP: a website at ccip.dev, @ccipdev on X, the t.me/ccipdev Telegram channel with the @ccipdevbot Mini App, and a Discord app. It earns money from a sponsor slot.

Five sub-projects build it:

| # | Sub-project | Target |
|---|---|---|
| 1 | **Data core** (this spec) | Oct 6–10 |
| 2 | Publishing: site, constellation, X/Telegram/Discord posts, sponsor system, Umami events | Oct 11–20 |
| 3 | Telegram Mini App: enlistment, callsigns, Marine card | Oct 21–27 (only if 1 and 2 are on time) |
| 4 | Oracle game | After launch |
| — | Stretch goal: a 60-second history time-lapse video for launch day | Only if 1 and 2 finish early |

Every other sub-project reads its data from this one.

## 2. Goal and success criteria

The data core is a reliable, complete, self-updating record of every mainnet CCIP message, with derived daily statistics, exposed as public JSON and as queryable tables.

The sub-project is done when:

1. **History:** every mainnet message the CCIP API returns is stored in D1 and archived in R2, and a coverage report states the oldest message reached.
2. **Freshness:** a message appears in `live.json` within 2 minutes of appearing in the CCIP API.
3. **Accuracy:** daily totals for at least 3 spot-checked days match CCIPMetrics' posts and Chainlink's official metrics within ±2%, or each gap is explained in `docs/methodology.md`.
4. **Public data:** the files in §6.3 are served at `data.ccip.dev` with a `schema_version`.
5. **Labels:** the weekly label-candidates PR runs, and verified labels from `labels/projects/*.toml` are used by the Worker.
6. **Alerts:** if ingest falls more than 10 minutes behind, @ccipdevbot sends an alert.

## 3. Scope

**In scope:**
- Live ingest
- History backfill
- Fees, starting from the first day of live ingest (around Oct 8, not the public launch on Oct 28)
- Prices
- Chainlink Reserve balance
- Chain and token snapshots, with detection of new arrivals
- Daily rollups
- Public JSON files
- Label registry and the candidate pipeline
- Health monitoring and alerts

**Out of scope:**
- The website, posts, Discord app, sponsor system and Umami events (sub-project 2)
- The Mini App (sub-project 3)
- The Oracle game (sub-project 4)
- Rival-bridge data
- Fees for historical messages
- Exact multi-token amounts for historical messages (§10)

## 4. Definitions

- **Message:** one CCIP message on a mainnet lane (`environment=mainnet`). Testnets are excluded.
- **Day:** a UTC calendar date, based on the message's `sendTimestamp`.
- **Lane:** `"{sourceChainSelector}>{destChainSelector}"`.
- **Sender:** the pair (source chain selector, `sender` address).
- **Value transferred:** the sum, over a message's tokens, of `amount / 10^decimals × USD price`. For live data, the price is the latest price when the message is ingested. For backfill, it is that day's DefiLlama daily price. Messages that carry only data count as messages and add $0.
- **Unpriced:** a token with no known decimals or price. It adds $0, and its message is flagged `unpriced`. The message's `usd_value` is the sum of its priced tokens, and it still counts toward message totals. `unpriced_messages` in `daily_totals` reports how many messages each day are affected.
- **Fee:** taken from the message detail's `fees`, converted to USD at the latest price of the fee token on the source chain. Fees are only collected for messages ingested live.
- **Delivery time:** `receiptTimestamp − sendTimestamp`, for messages with status `SUCCESS`.
- **Final status:** `SUCCESS` or `FAILED` from the API, or our own `UNRESOLVED`, which marks a message still pending 48 hours after it was sent. Every other status is treated as pending.

## 5. Architecture

Everything runs on Cloudflare (Workers Paid plan): a Worker with Cron Triggers, D1 and R2. The one-time backfill and the weekly label job run outside the Worker: the backfill on the owner's Mac, the label job in GitHub Actions.

### 5.1 Units

These live in `packages/core/` and are shared by the Worker and the scripts. Each unit has a single purpose.

| Unit | Purpose | Interface (sketch) | Depends on |
|---|---|---|---|
| `ccip-client` | Calls the CCIP API v2: messages (cursor paging), message detail, chains, tokens. Sends a curl-style User-Agent (the API returns 403 to Python's default). Retries with backoff and honors `Retry-After`. Validates each response with zod. | `listMessages({cursor, limit})`, `getMessage(id)`, `listChains()`, `listTokens({cursor})` | fetch |
| `prices` | DefiLlama coin prices: latest prices in batches, and daily price history per token | `latest(keys[])`, `dailyHistory(key, from, to)` | fetch, `chain-map` |
| `chain-map` | A curated mapping from CCIP chain name and family to DefiLlama's chain slug | `llamaKey(chain, tokenAddress) → string \| null` | none |
| `reserve` | Reads the LINK balance of the Chainlink Reserve with `eth_call` on Ethereum | `linkBalance() → bigint` | fetch |
| `normalize` | Turns an API message (from the list or detail call) into a `MessageRow` plus `TokenRow[]` | pure | none |
| `value` | BigInt token amount × decimals × price → USD | pure | none |
| `rollup` | Turns one day's messages into `DailyTotals` and `DailyBreakdown[]` | pure | none |
| `labels` | Loads and validates the TOML registry and builds `labels.json` | pure + fs (build time) | none |
| `store` | D1 reads and writes, plus R2 archive and staging writes (Worker side) | repository functions | D1, R2 |
| `publish` | Builds the public JSON files and writes them to R2 | `publishLive()`, `publishToday()`, `publishHistory()`, … | store |

### 5.2 Schedules (Worker Cron Triggers)

| Cron | Job | Steps |
|---|---|---|
| `* * * * *` | `ingest` | Fetch new messages → write to D1 and R2 staging → fill fees and status for pending messages (§7.2) → publish `live.json`, `today.json` and `status.json` |
| `*/5 * * * *` | `prices` | Refresh `prices_latest` for every token seen in the last 30 days, plus fee tokens |
| `0 * * * *` | `hourly` | Snapshot the Reserve balance, snapshot chains and tokens, detect arrivals, publish `reserve.json`, `chains.json` and `tokens.json` |
| `10 0 * * *` | `finalize` | Close out yesterday (§7.3) |
| `0 6 * * *` | `finalize` | Run again for yesterday to pick up late data |

Each job runs on its own and catches its own errors. If one job fails, the others still run.

### 5.3 Data flow

```
CCIP API ─► ccip-client ─► normalize/value ─► store ─► D1 messages, message_tokens
                                                   └► R2 staging (raw, per minute)
DefiLlama ─► prices ─► D1 prices_latest
Ethereum endpoint ─► reserve ─► D1 reserve_snapshots
finalize: D1 messages ─► rollup ─► D1 daily_totals, daily_breakdown
          R2 staging ─► R2 archive (one gzip file per day)
publish: D1 ─► R2 public/*.json ─► data.ccip.dev (Cloudflare cache) ─► site, bots, anyone
```

## 6. Data model

### 6.1 D1 tables

`chain` columns hold CCIP chain selectors, stored as TEXT because they are uint64 values. Token amounts are TEXT holding a decimal BigInt. USD values are REAL. Times are ISO-8601 UTC strings.

```sql
messages (
  message_id TEXT PRIMARY KEY,
  day TEXT NOT NULL,                       -- YYYY-MM-DD (UTC, from send_ts)
  send_ts TEXT NOT NULL,
  receipt_ts TEXT,
  status TEXT NOT NULL,
  src_chain TEXT NOT NULL, dst_chain TEXT NOT NULL,
  sender TEXT NOT NULL, receiver TEXT, origin TEXT,
  token_count INTEGER NOT NULL DEFAULT 0,
  usd_value REAL,                          -- sum of priced tokens; 0 for data-only messages
  unpriced INTEGER NOT NULL DEFAULT 0,     -- 1 if any token lacks decimals or a price
  fee_token TEXT, fee_amount TEXT, fee_usd REAL,
  detail_fetched_at TEXT,                  -- null until detail is fetched
  next_check_at TEXT,                      -- when pending messages are re-checked
  source TEXT NOT NULL                     -- 'live' | 'backfill'
)
-- indexes: (day), (src_chain, sender, day), (next_check_at) WHERE detail_fetched_at IS NULL OR status NOT IN ('SUCCESS','FAILED')

message_tokens (
  message_id TEXT NOT NULL, idx INTEGER NOT NULL,
  chain TEXT NOT NULL, token TEXT NOT NULL, amount TEXT NOT NULL, usd_value REAL,
  PRIMARY KEY (message_id, idx)
)

daily_totals (
  day TEXT PRIMARY KEY,
  messages INTEGER, token_messages INTEGER, usd_value REAL, fee_usd REAL,
  unique_senders INTEGER, median_delivery_s INTEGER, unpriced_messages INTEGER,
  computed_at TEXT
)

daily_breakdown (
  day TEXT NOT NULL, dim TEXT NOT NULL,    -- 'src_chain'|'dst_chain'|'lane'|'token'|'sender'
  key TEXT NOT NULL,
  messages INTEGER, usd_value REAL, fee_usd REAL,
  PRIMARY KEY (day, dim, key)
)

chains (selector TEXT PRIMARY KEY, name TEXT, display_name TEXT, family TEXT, first_seen TEXT, last_seen TEXT)
tokens (chain TEXT, address TEXT, symbol TEXT, name TEXT, decimals INTEGER, group_id TEXT,
        first_seen TEXT, last_seen TEXT, PRIMARY KEY (chain, address))
arrivals (kind TEXT, key TEXT, first_seen TEXT, announced_at TEXT, PRIMARY KEY (kind, key))
                                           -- kind: 'chain'|'token'|'lane'; sub-project 2 sets announced_at
reserve_snapshots (ts TEXT PRIMARY KEY, link_balance TEXT)
prices_latest (llama_key TEXT PRIMARY KEY, usd REAL, decimals INTEGER, ts TEXT)
meta (key TEXT PRIMARY KEY, value TEXT)    -- e.g. newest_message_id, last_ingest_ok_at, last_finalize_day
```

Expected size: about 1–2 million `messages` rows (~1 GB), and roughly 700 `daily_breakdown` rows per day. Both fit within the Workers Paid limits (5 GB storage included, 50 million row writes a month).

### 6.2 R2 layout (bucket `ccip-dev`)

| Prefix | Contents | Visibility |
|---|---|---|
| `staging/YYYY-MM-DD/HHmm.jsonl` | Raw API objects seen in that minute | private |
| `archive/messages/YYYY/MM/DD.jsonl.gz` | The full raw record for that day, permanent | private (may be published later) |
| `public/…` | The files in §6.3 | public at `data.ccip.dev` |

### 6.3 Public JSON files (`data.ccip.dev/v1/…`)

Every file includes `schema_version`, `updated_at`, and `attribution: "Data: Chainlink CCIP API, DefiLlama"`.

| File | Contents | Cache |
|---|---|---|
| `live.json` | Messages from the last 15 minutes: id, send time, source, destination, token symbol, USD value, sender label if verified | 30 s |
| `today.json` | Today's running totals, top 10 by lane, token and sender, and the newest arrivals | 30 s |
| `history.json` | One row per day from `daily_totals` | 5 min |
| `top/{dim}.json` | Top 100 for 7 days, 30 days and all time, per dimension | 5 min |
| `chains.json`, `tokens.json` | Registries with `first_seen` | 1 h |
| `reserve.json` | Latest balance and a 90-day hourly series | 5 min |
| `status.json` | `last_ingest_ok_at`, lag in seconds, `last_finalize_day`, `coverage_from` | 30 s |

Labels in public files only ever come from `verified = true` entries.

## 7. Behavior

### 7.1 Ingest (every minute)
1. Page `listMessages({limit: 200})` from newest to oldest, and stop at the first `message_id` already in D1. Fetch at most 20 pages per run. If the run hits that cap, it resumes on the next run.
2. `normalize` and `value` each message, then upsert it into `messages`. Use `INSERT … ON CONFLICT DO UPDATE` limited to status and receipt fields, so running it twice changes nothing.
3. Append the raw objects to `staging/{day}/{HHmm}.jsonl`.
4. Fill details (§7.2), then publish the live files.

### 7.2 Details: fees, extra tokens and status
- Candidates are live messages at least 2 minutes old that have no detail yet, plus pending messages whose `next_check_at` has passed. Process up to 10 per run, oldest first.
- From `getMessage` take `fees`, `tokenAmounts` (to write `message_tokens` and recalculate `usd_value`), `status` and `receiptTimestamp`.
- If the message is still pending, set `next_check_at` to +10 minutes, then +1 hour, then +6 hours. After 48 hours, set the status to `UNRESOLVED`.
- If the `fees` shape is unknown for that message's `version`, store the raw detail, leave `fee_*` null, and send one alert per version.

### 7.3 Finalize (00:10 UTC, run again at 06:00 UTC)
1. Re-page the list results back to the start of yesterday, and update status and receipt times.
2. Fill details for any of yesterday's live messages that still lack them, with no limit.
3. Run `rollup` over yesterday's messages, then replace yesterday's rows in `daily_totals` and `daily_breakdown`.
4. Build that day's archive file from `staging/{yesterday}/*`, keeping one line per message: the detail object if one was fetched, otherwise the latest list object. Check that the number of lines equals yesterday's row count in D1, then delete the staging files. If the counts differ, keep the staging files and send an alert.
5. Publish `history.json` and the `top/*` files, and set `meta.last_finalize_day`.

Sub-project 2's daily post (00:15 UTC) reads the 00:10 results. The 06:00 run may adjust the numbers slightly afterwards.

### 7.4 Prices
- Every 5 minutes, take the distinct token keys seen in the last 30 days plus the fee tokens, and fetch them from DefiLlama in batches of 100.
- `chain-map` decides each key. A key that maps to `null`, for example a non-EVM chain with no slug, makes that token unpriced.

### 7.5 Reserve, chains and tokens (hourly)
- Record the Reserve's LINK balance. LINK token: `0x514910771AF9Ca656af840dff83E8264EcF986CA`. Reserve address: `0x9A709B7B69EA42D5eeb1ceBC48674C69E1569eC6`. Use the RPC URL from the `RPC_ETHEREUM` variable, with a fallback list.
- Snapshot the chains (`environment=mainnet`) and every page of tokens. Any chain, token or lane not seen before is inserted into `arrivals` with `announced_at = null`.

### 7.6 Politeness and limits
- At most 1 request per second to the CCIP API from each job. Steady state is about 3–5k calls a day.
- Most of the D1 load is the per-minute recalculation of today's totals (about 80 million reads a month), far below the 25 billion included.

## 8. Labels

### 8.1 Registry
There is one file per project at `labels/projects/<slug>.toml`, under CC BY 4.0:

```toml
name = "Maple Finance"
x = "maplefinance"
url = "https://maple.finance"
kind = "protocol"        # protocol | app | institution | exchange | issuer
verified = true

[[addresses]]
chain = "ethereum-mainnet"   # CCIP chain name
address = "0x…"
note = "syrupUSDC token pool"

[[tokens]]
group = "1166b296-…"         # CCIP token group id (covers every chain)
```

CI (`validate-labels`) checks the schema, that each chain name exists in CCIP, EVM address checksums, that no address appears in more than one file, and the X handle format. At deploy, the `labels` unit builds `labels.json`, and the Worker bundles it.

### 8.2 Candidate pipeline (weekly GitHub Action, Mondays)
1. Query D1 through the Cloudflare D1 HTTP API for senders not in the registry, with **≥ $50k moved or ≥ 50 messages** in the last 7 days. These thresholds are config values.
2. For each candidate:
   - Call `eth_getCode` through the chain's RPC from the config map. **If the address has no code (a personal wallet), skip it and never label it.** If no RPC is configured for that chain, flag it `kind = "unknown"`.
   - Enrich it: the contract name from Etherscan's free API (verified-source endpoints work on every supported chain), or from Blockscout where Etherscan doesn't cover the chain. Add the tokens it moves, the chains it was seen on, its 7-day volume, first-seen date and explorer links.
3. Write draft files `labels/projects/_candidate-<chain>-<addr>.toml` with `verified = false` on the branch `labels/candidates`, then open or update **one** PR, "Label candidates — week of YYYY-MM-DD", with a summary table. Any sender that appeared in the top 3 of a daily total since the last run goes first in the table.
4. The maintainer completes or deletes each draft and merges. Drafts with `verified = false` are never shown publicly.

Third parties can submit labels by pull request, or through a "Label my project" issue template.

## 9. Backfill (`pnpm backfill`, run on the owner's Mac)

Order of work: deploy the live Worker first. Overlap with the backfill is harmless because every write is idempotent.

1. **Crawl.** Page `listMessages({limit: 1000})` from newest to oldest, at most 1 request per second. Write each page to `.backfill/pages/NNNNN.json` and save the cursor to `.backfill/state.json`, so the crawl can resume. Stop when `hasNextPage` is false, then write `.backfill/coverage.json` with the oldest message reached and the per-day message counts.
2. **Prices.** For each distinct token, look up its key with `chain-map`, then fetch the daily price history once. Cache it in `.backfill/prices/`.
3. **Calculate.** Run `normalize`, `value` (with the daily price for the send day) and `rollup` per day, using the same code as the Worker.
4. **Upload.**
   - `messages` (with `source = 'backfill'`, no fees), `daily_totals` and `daily_breakdown` go into D1 as batched SQL files.
   - One archive file per day goes into R2 through R2's S3-compatible API.
   - Skip any days the live Worker has already finalized.
5. **Cross-check.** Compare at least 3 days against CCIPMetrics' posts and Chainlink's official metrics, and record the results in `docs/methodology.md`.

Expected effort: ~15–30 minutes of crawling and ~1 GB in D1.

## 10. Known limitations
- **Multi-token history:** list results expose only `sourceTokenAmount`, so historical messages carrying more than one token undercount value. Live data uses detail calls and is exact. This is documented in the methodology.
- **Historical fees:** not collected. Fee statistics start on the day live ingest starts.
- **Price method:** live values use the latest price at ingest time, and backfill uses daily prices. The two methods can differ slightly.
- **Pagination depth:** unverified. The crawl may not reach the 2023 launch. The coverage report makes any gap explicit.
- **Upstream terms:** the CCIP API has no published rate limits or terms for this kind of use. We stay polite (§7.6) and credit the source in every public file.

## 11. Error handling and observability
- **Fail fast at the boundaries:** zod validation on every API response. A schema failure stops that job's writes and sends an alert that includes the endpoint and a short sample of the response.
- **Errors carry context:** log the job, step, message id or cursor, and the upstream status. Workers observability is enabled.
- **Alerts** go to @ccipdevbot, which messages the owner's chat (`TELEGRAM_ALERT_CHAT_ID`). They fire on:
  - ingest lag over 10 minutes
  - a failed finalize
  - a schema failure
  - an unknown fee version
  - a failed Reserve read three hours in a row

  Repeats of the same alert are suppressed for 1 hour.
- **`status.json`** is public, so sub-project 2 can show a "data delayed" notice.

## 12. Testing

The project is test-first, with vitest. CI never makes a real network call.

- **Pure units:**
  - `normalize` against real fixtures captured from the API: a list message, a detail message, a data-only message, a multi-token message, and a non-EVM chain.
  - `value`: BigInt amounts with up to 27 digits, and missing decimals or price.
  - `rollup`:
    - day boundaries (23:59:59.999 versus 00:00:00)
    - duplicates
    - unpriced tokens
    - the median of an even-sized set
    - the unique-sender definition
  - `chain-map`.
  - The `labels` validator, including duplicate addresses and bad checksums.
- **`ccip-client`, with fetch mocked:**
  - paging stops at a known id
  - the 20-page cap
  - 429 responses with `Retry-After`
  - 5xx retries
  - schema failures surface as descriptive errors
- **Worker integration,** using `@cloudflare/vitest-pool-workers` with local D1 and R2:
  - one `ingest` run writes rows, staging files and public files
  - running it twice leaves the same state
  - `finalize` produces the archive and the rollup
  - **live/backfill parity:** finalize and the backfill path produce identical `daily_totals` from the same fixture day
- **Candidate pipeline:** threshold filtering, skipping wallets with no code, and the shape of the draft TOML files.
- **Canary script** (run by hand, not in CI): small calls against the real APIs to catch changes upstream.

## 13. Repository layout

```
ccip-dev/
  packages/core/src/{ccip-client,prices,chain-map,reserve,normalize,value,rollup,labels}.ts
  worker/src/{index,jobs/*,store,publish}.ts   worker/migrations/*.sql   worker/wrangler.toml
  scripts/{backfill,label-candidates,canary,build-labels}.ts
  labels/projects/*.toml
  docs/{methodology.md, callsigns/, superpowers/specs/}
  .github/workflows/{ci,deploy,label-candidates}.yml
```

This is a pnpm workspace on TypeScript, matching chainlinkmeme. The repo stays private until launch, then goes public: the code under MIT, and `labels/` under CC BY 4.0.

## 14. Configuration and secrets

| Name | Where | Purpose |
|---|---|---|
| `CCIP_API_BASE` | Worker var | `https://api.ccip.chain.link/v2` |
| `RPC_ETHEREUM`, `RPC_FALLBACKS` | Worker var | Reserve reads |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID` | Worker secret | Alerts |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Actions secret, owner's Mac (.env) | Deploys, D1 HTTP API, backfill uploads |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Actions secret, owner's Mac (.env) | Backfill archive uploads |
| `ETHERSCAN_API_KEY` | Actions secret | Enriching label candidates |
| `RPC_MAP` | Actions var (JSON) | `eth_getCode` per chain for the candidate pipeline |

Secrets are set by the owner with `wrangler secret put` or `gh secret set`, and are never committed or pasted into chat.
