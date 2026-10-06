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

1. **History:** every mainnet message the CCIP API returns is stored in D1 and archived in the private R2 bucket, and a coverage report states the oldest message reached (`coverage_from`).
2. **Freshness:** a message appears in `live.json` within 2 minutes of appearing in the CCIP API.
3. **Accuracy:** daily totals for at least 3 spot-checked days match CCIPMetrics' posts and Chainlink's official metrics within ±2%, or each gap is explained in `docs/methodology.md`.
4. **Public data:** the files in §6.3 are served at `data.ccip.dev` with a `schema_version`.
5. **Labels:** 10–20 labels, written by hand for the top senders in the backfill data, are in `labels/projects/*.toml`, and the Worker uses the verified ones. The weekly candidate pipeline (§8.2) is built after criteria 1–4 and 6 pass.
6. **Alerts:** if ingest falls more than 10 minutes behind, @ccipdevbot sends an alert. This still happens when the whole Worker is down, because an external watchdog checks too (§11).

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
- Label registry, with hand-seeded labels at launch; the candidate pipeline (§8.2) comes after the core criteria pass
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
- **Final status:** `SUCCESS` from the API; `FAILED` when `readyForManualExecution` is false; or our own `UNRESOLVED`, which marks a message still pending 48 hours after it was sent. A `FAILED` message that can still be manually executed is re-checked like a pending message until 48 hours, then keeps its last status. Every other status is treated as pending.

## 5. Architecture

Everything runs on Cloudflare (Workers Paid plan): a Worker with Cron Triggers, D1 and R2, plus a separate watchdog Worker with no bindings (§11). The one-time backfill and the weekly label job run outside Cloudflare: the backfill on the owner's Mac, the label job in GitHub Actions, which also runs a backup watchdog.

### 5.1 Units

These live in `packages/core/` and are shared by the Worker and the scripts. Each unit has a single purpose.

| Unit | Purpose | Interface (sketch) | Depends on |
|---|---|---|---|
| `ccip-client` | Calls the CCIP API v2: messages (cursor paging), message detail, chains, tokens. Sends a curl-style User-Agent (the API returns 403 to Python's default). Retries with backoff and honors `Retry-After`. Validates each response with zod. | `listMessages({cursor, limit})`, `getMessage(id)`, `listChains()`, `listTokens({cursor})` | fetch |
| `prices` | DefiLlama coin prices: latest prices in batches, and daily price history per token | `latest(keys[])`, `dailyHistory(key, from, to)` | fetch, `chain-map` |
| `chain-map` | A curated mapping from CCIP chain name and family to DefiLlama's chain slug | `llamaKey(chain, tokenAddress) → string \| null` | none |
| `reserve` | Reads the LINK balance of the Chainlink Reserve with `eth_call` on Ethereum | `linkBalance() → bigint` | fetch |
| `normalize` | Turns an API message (from the list or detail call) into a `MessageRow` plus `TokenRow[]`. Sanitizes upstream strings (token symbols and names): strips control characters and caps length at 64 | pure | none |
| `value` | BigInt token amount × decimals × price → USD | pure | none |
| `rollup` | Turns one day's messages into `DailyTotals` and `DailyBreakdown[]` | pure | none |
| `labels` | Loads and validates the TOML registry and builds `labels.json` | pure + fs (build time) | none |
| `store` | D1 reads and writes, plus archive writes to the private R2 bucket | repository functions | D1, R2 (archive) |
| `publish` | Builds the public JSON files and writes them to the public R2 bucket with per-file `Cache-Control` | `publishLive()`, `publishToday()`, `publishHistory()`, … | store, R2 (public) |

### 5.2 Schedules (Worker Cron Triggers)

| Cron | Job | Steps |
|---|---|---|
| `* * * * *` | `ingest` | Fetch new messages (§7.1) → write to D1 → publish `live.json`, `today.json` and `status.json` → fill details for due messages (§7.2). Publishing never waits on the detail step |
| `*/5 * * * *` | `prices` | Refresh `prices_latest` for every token seen in the last 30 days, plus fee tokens. Also checks ingest lag and alerts if it's over 10 minutes |
| `0 * * * *` | `hourly` | Snapshot the Reserve balance, snapshot chains and tokens, detect arrivals, publish `reserve.json`, `chains.json` and `tokens.json` |
| `10 0 * * *` | `finalize` | Close out every day not yet finalized, through yesterday (§7.3 steps 1–3 and 5) |
| `0 6 * * *` | `finalize` | Re-run yesterday for late data, and archive every day not yet archived (§7.3, all steps) |

Each job runs on its own and catches its own errors. If one job fails, the others still run.

### 5.3 Data flow

```
CCIP API ─► ccip-client ─► normalize/value ─► store ─► D1 messages, message_tokens
DefiLlama ─► prices ─► D1 prices_latest
Ethereum endpoint ─► reserve ─► D1 reserve_snapshots
finalize: D1 messages ─► rollup ─► D1 daily_totals, daily_breakdown
          re-paged list objects ─► R2 archive bucket (one gzip file per day, 06:00 run)
publish: D1 ─► R2 public bucket (v1/*.json) ─► data.ccip.dev (Cloudflare cache) ─► site, bots, anyone
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
  ready_for_manual_exec INTEGER NOT NULL DEFAULT 0,
  detail_fetched_at TEXT,                  -- null until detail is fetched
  next_check_at TEXT,                      -- live insert: send_ts + 2 min; NULL once final; always NULL for backfill rows
  source TEXT NOT NULL                     -- 'live' | 'backfill'
)
-- indexes: (day), (src_chain, sender, day), (next_check_at) WHERE next_check_at IS NOT NULL

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
                                           -- kind: 'chain'|'token'|'lane'; sub-project 2 sets announced_at;
                                           -- baseline rows (§7.5) are inserted with announced_at already set
reserve_snapshots (ts TEXT PRIMARY KEY, link_balance TEXT)
prices_latest (llama_key TEXT PRIMARY KEY, usd REAL, decimals INTEGER, ts TEXT)
meta (key TEXT PRIMARY KEY, value TEXT)    -- live_start_day, last_ingest_ok_at, ingest_resume_cursor, ingest_resume_stop_id,
                                           -- last_finalize_day, last_archived_day, coverage_from
```

Expected size: about 1–2 million `messages` rows (~1 GB), and roughly 700 `daily_breakdown` rows per day. Both fit within the Workers Paid limits (5 GB storage included, 50 million row writes a month).

### 6.2 R2 layout (two buckets)

R2 public access is set per bucket, not per prefix, so public and private data live in separate buckets.

| Bucket | Keys | Contents | Access |
|---|---|---|---|
| `ccip-dev-public` | `v1/…` | The files in §6.3, written only by `publish` | Public, bound to `data.ccip.dev`, so `v1/live.json` is served at `data.ccip.dev/v1/live.json` |
| `ccip-dev-archive` | `messages/YYYY/MM/DD.jsonl.gz` | The raw list objects for that day, written by the 06:00 finalize (or by the backfill), permanent | Private: no custom domain, no r2.dev |
| `ccip-dev-archive` | `unparsed/{message_id}.json` | Raw detail responses that failed validation or had an unknown fee format (§7.2) | Private |

### 6.3 Public JSON files (`data.ccip.dev/v1/…`)

Every file includes `schema_version`, `updated_at`, and `attribution: "Data: Chainlink CCIP API, DefiLlama"`. All-time figures also carry `since: coverage_from`, because the history may not reach the 2023 launch (§10).

**Serving:** `publish` sets each object's `Cache-Control` to the TTL in the table below. A Cloudflare Cache Rule on `data.ccip.dev` makes `.json` responses cacheable and respects the origin `Cache-Control`. Cloudflare doesn't cache `.json` by default. The public bucket has a CORS policy allowing `GET` from any origin, so browsers and the Mini App can fetch the files.

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
1. Page `listMessages({limit: 200})` from newest to oldest, and stop at the first `message_id` already in D1. Never page past 00:00 UTC of `meta.live_start_day`, which is set on the first deploy. Anything older belongs to the backfill, which also gives the first run (with an empty table) a stop point.
2. Each run fetches at most 20 pages. When a run hits the cap:
   - It saves the cursor where it stopped (`ingest_resume_cursor`), and the newest id that was already stored before the run (`ingest_resume_stop_id`), in `meta`.
   - Later runs page the newest messages first, as usual.
   - With the rest of their page budget, they continue from the saved cursor until they reach the stop id, then clear both keys.
3. `normalize` and `value` each message, then upsert it into `messages`:
   - Live inserts set `next_check_at = send_ts + 2 minutes`.
   - Conflicts use `INSERT … ON CONFLICT DO UPDATE`, limited to the status and receipt fields, so running it twice changes nothing.
4. Publish the live files, then fill details (§7.2). A failure in the detail step never blocks publishing.

### 7.2 Details: fees, extra tokens and status
- **Candidates:** messages with `next_check_at <= now`, ordered by `next_check_at`, at most 10 per run. That covers new live messages from 2 minutes after they're sent, plus pending re-checks. Backfill rows never qualify, because their `next_check_at` is NULL.
- **What to take from `getMessage`:** `fees`, `tokenAmounts` (to write `message_tokens` and recalculate `usd_value`), `status`, `receiptTimestamp` and `readyForManualExecution`.
- **Validate each message on its own.** If a detail response fails validation:
  - write the raw response to `unparsed/{message_id}.json` in the archive bucket
  - push that message's `next_check_at` back 1 hour
  - send one alert per error signature (endpoint plus failing schema path)
  - continue with the remaining candidates

  One bad message never stalls ingest.
- **Still pending,** or `FAILED` with `readyForManualExecution = true`: set `next_check_at` to +10 minutes, then +1 hour, then +6 hours. After 48 hours, pending messages become `UNRESOLVED`, and manually executable `FAILED` messages keep their status.
- **Final** (§4): set `next_check_at = NULL`.
- **Unknown fee format for the message's `version`:** write the raw detail to `unparsed/{message_id}.json`, leave `fee_*` null, and send one alert per version.

### 7.3 Finalize (00:10 UTC, run again at 06:00 UTC)
Finalize works on a range of days, not just yesterday. If a run is missed, the next one catches up.
- **00:10 run:** every day from `meta.last_finalize_day + 1` through yesterday, in order. Steps 1–3 and 5, advancing `last_finalize_day` after each day.
- **06:00 run:** yesterday again, for late data. Then every day from `meta.last_archived_day + 1` through yesterday, with all steps, advancing `last_archived_day` after each day's archive is written.
- **On the first deploy,** both `last_finalize_day` and `last_archived_day` start at the day before `live_start_day`.

Steps for one day:
1. Re-page the list results back to the start of that day. Update status and receipt times, and **insert any message missing from D1**: ingest gaps, or the part of the first deploy day before the Worker started. Keep the fetched raw list objects in memory for step 4.
2. Fill details for any of that day's live messages that still lack them.
3. Run `rollup` over the day's messages, then replace that day's rows in `daily_totals` and `daily_breakdown`.
4. *(06:00 run only)* Write `messages/YYYY/MM/DD.jsonl.gz` to the archive bucket from step 1's raw list objects, one line per message. If the line count differs from the day's row count in D1, send an alert. There are no staging files.
5. Publish `history.json` and the `top/*` files.

Sub-project 2's daily post (00:15 UTC) reads the 00:10 results. The 06:00 run may adjust the numbers slightly afterwards.

### 7.4 Prices
- Every 5 minutes, take the distinct token keys seen in the last 30 days plus the fee tokens, and fetch them from DefiLlama in batches of 100.
- `chain-map` decides each key. A key that maps to `null`, for example a non-EVM chain with no slug, makes that token unpriced.
- The prices job also checks ingest lag. If `now − meta.last_ingest_ok_at` is over 10 minutes, it sends an alert. The check lives outside `ingest`, so it still fires when ingest itself is failing.

### 7.5 Reserve, chains and tokens (hourly)
- Record the Reserve's LINK balance. LINK token: `0x514910771AF9Ca656af840dff83E8264EcF986CA`. Reserve address: `0x9A709B7B69EA42D5eeb1ceBC48674C69E1569eC6`. Use the RPC URL from the `RPC_ETHEREUM` variable, with a fallback list.
- Snapshot the chains (`environment=mainnet`) and every page of tokens. Any chain, token or lane not seen before is inserted into `arrivals` with `announced_at = null`. Lane arrivals come from distinct `(src_chain, dst_chain)` pairs in `messages`.
- **Baseline:** if the `chains` or `tokens` table is empty (the first run), every snapshot row is inserted into `arrivals` with `announced_at = first_seen`. That records it as known, so it is never announced. The backfill upload does the same for every historical chain, token and lane, setting `first_seen` from the earliest message, so only genuine newcomers get announced.

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

At launch, the registry holds 10–20 labels written by hand for the top senders in the backfill data.

### 8.2 Candidate pipeline (weekly GitHub Action, Mondays; built after success criteria 1–4 and 6 pass)
1. Query D1 through the Cloudflare D1 HTTP API, using a read-only token, for senders not in the registry with **≥ $50k moved or ≥ 50 messages** in the last 7 days. These thresholds come from `CANDIDATE_MIN_USD_7D` and `CANDIDATE_MIN_MESSAGES_7D` (§14).
2. For each candidate:
   - Call `eth_getCode` through the chain's RPC from the config map. **If the address has no code (a personal wallet), skip it and never label it.** If no RPC is configured for that chain, flag it `kind = "unknown"`.
   - Enrich it: the contract name from Etherscan's free API (verified-source endpoints work on every supported chain), or from Blockscout where Etherscan doesn't cover the chain. Add the tokens it moves, the chains it was seen on, its 7-day volume, first-seen date and explorer links.
3. Write draft files `labels/projects/_candidate-<chain>-<addr>.toml` on the branch `labels/candidates`, then open or update **one** PR, "Label candidates — week of YYYY-MM-DD", with a summary table. Any sender that appeared in the top 3 of a daily total since the last run goes first in the table.
   - Enrichment strings (contract names, token symbols) are untrusted: strip control characters and cap them at 64 characters.
   - Drafts are written with a TOML serializer, never with string templates, and the pipeline always sets `verified = false` itself.
   - Table cells in the PR are markdown-escaped.
4. The maintainer completes or deletes each draft and merges. Drafts with `verified = false` are never shown publicly.

Third parties can submit labels by pull request, or through a "Label my project" issue template.

## 9. Backfill (`pnpm backfill`, run on the owner's Mac)

Order of work: run the crawl first (step 1 writes local files only), on **Oct 6**, so real coverage is known early. Deploy the live Worker before uploading (step 4).

1. **Crawl (updated 2026-10-05).**
   - The unfiltered list endpoint times out (30 s server limit) for queries older than about December 2025, and a 1,000-message page tripped it at 2026-01-15. Filtered by source chain, the same API serves history back to CCIP's 2023 launch at about 1–3 s per 1,000 messages, so the crawl runs per source chain (`pnpm backfill:sources`).
   - `pnpm backfill:crawl` (global, optional) pages `listMessages` from newest to oldest, at most 1 request per second. Its pages in `.backfill/pages/` are reused.
   - Per source chain, pages go to `.backfill/sources/<selector>/` with a resumable cursor, using an adaptive page size. `.backfill/sources/summary.json` records `complete` and, per source, `done`, `stopped_at_depth_wall`, `coverage_from`, `skipped`, `error` or `unsupported`.
   - Re-run `pnpm backfill:sources` until `complete: true`. Finished sources are skipped and walled ones are retried. A first-page 404 means the API doesn't support that selector, and the source is marked `unsupported`.
   - Some single "poison" messages make the list endpoint return HTTP 500 for any page that contains them (one known: 2026-01-15T01:28:06Z, which the single-message endpoint also 404s). The crawl finds and skips each one with `after` windows and records it with its search window. Messages near a poison message can be missed only inside a recorded window.
   - A 429 waits 30 seconds and doesn't count toward a stop. A schema error or any other 4xx stops the crawl with an error, and a re-run resumes.
   - The build merges all pages into a day spool (`.backfill/days/`) so per-source crawls combine, and writes `.backfill/skipped.json`. The methodology lists the skipped messages. `--top-up` is no longer needed when the per-source crawl ran after `live_start_day`; the build refuses to run if the newest message doesn't reach `live_start_day`.
   - `coverage_from`: if no source walls, it is CCIP's first message (mid-2023). A walled source moves `coverage_from` to the day after its oldest reached day.

2. **Prices.** For each distinct token, look up its key with `chain-map`, then fetch the daily price history once. Cache it in `.backfill/prices/`.
3. **Calculate.** Run `normalize`, `value` (with the daily price for the send day) and `rollup` per day, using the same code as the Worker.
4. **Upload.**
   - `messages` (with `source = 'backfill'`, no fees, `next_check_at` NULL), `message_tokens`, `daily_totals` and `daily_breakdown` go into D1 as batched SQL files.
   - Upserts into `messages` and `message_tokens` update only rows whose message has `source = 'backfill'`. Live rows, which carry fees and detail-based token data, always win, and a corrected rebuild replaces earlier backfill values.
   - Seed `chains`, `tokens` and `arrivals` with every historical chain, token and lane, with `first_seen` taken from the earliest message and `announced_at` already set (§7.5).
   - Set `meta.coverage_from`.
   - Rollups and archive files cover only days before `meta.live_start_day`; the Worker owns `live_start_day` onward. Archive files go into the archive bucket through R2's S3-compatible API.
5. **Cross-check.** Compare at least 3 days against CCIPMetrics' posts and Chainlink's official metrics, and record the results in `docs/methodology.md`.

Expected effort (updated 2026-10-05): about 1–3 s per 1,000 messages per source chain, so the per-source crawl takes minutes to hours, plus extra requests for each poison message. D1 will hold about 1 GB at full history, less if coverage stops early.

## 10. Known limitations
- **Multi-token history:** list results expose only `sourceTokenAmount`, so historical messages carrying more than one token undercount value. Live data uses detail calls and is exact. This is documented in the methodology.
- **Historical fees:** not collected. Fee statistics start on the day live ingest starts.
- **Price method:** live values use the latest price at ingest time, and backfill uses daily prices. The two methods can differ slightly.
- **Pagination depth (updated 2026-10-05):** the unfiltered list endpoint can't reach past about December 2025, but the per-source crawl reaches CCIP's 2023 launch. A source that still walls moves `coverage_from` to the day after its oldest reached day, and all-time figures are labeled "since {coverage_from}" (§6.3). Skipped poison messages are listed in the methodology.
- **Upstream terms:** the CCIP API has no published rate limits or terms for this kind of use. We stay polite (§7.6) and credit the source in every public file.

## 11. Error handling and observability
- **Fail fast at the boundaries:** zod validation on every API response. A schema failure on a list, chain or token response stops that job's writes and sends an alert that includes the endpoint and a short sample of the response. Detail responses are validated per message, so one bad record never stops the job (§7.2).
- **Errors carry context:** log the job, step, message id or cursor, and the upstream status. Workers observability is enabled.
- **Alerts** go to @ccipdevbot, which messages the owner's chat (`TELEGRAM_ALERT_CHAT_ID`). They fire on:
  - ingest lag over 10 minutes, checked by the `prices` job
  - a failed finalize
  - a schema failure (one alert per error signature for detail responses)
  - an unknown fee version
  - a failed Reserve read three hours in a row

  Repeats of the same alert are suppressed for 1 hour.
- **`status.json`** is public, so sub-project 2 can show a "data delayed" notice.
- **External watchdog:** the primary external check is the `ccip-dev-watchdog` Worker. It runs every 5 minutes with no bindings (no D1 or R2, so it still works when either is broken), fetches `data.ccip.dev/v1/status.json`, and sends a Telegram alert when the file is unreachable, `updated_at` is more than 15 minutes old, `lag_seconds` is null, or `lag_seconds` exceeds 15 minutes. It keeps no state: it alerts on the first run after a measured age or lag crosses 900 seconds (up to 1,260 seconds, to allow for cron jitter), then once an hour while the problem lasts. "Unreachable" and "lag_seconds is null" have no measured age, so they alert only at the top of the hour (the first alert can take up to about 60 minutes). An unreadable status is re-fetched once per run before alerting. It catches failures that silence the whole data Worker: a bad deploy, stopped crons, or a disabled Worker. A GitHub Actions workflow with the same checks runs every 15 minutes as a best-effort backup, because GitHub's schedule is irregular (3 runs in about 20 hours were observed on 2026-10-05/06).

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
  - the 20-page cap saves a resume cursor and stop id, and the next run continues from them
  - 429 responses with `Retry-After`
  - 5xx retries
  - schema failures surface as descriptive errors
- **Worker integration,** using `@cloudflare/vitest-pool-workers` with local D1 and R2:
  - one `ingest` run writes rows and public files, and never pages past `live_start_day`, including on the first run with an empty table
  - running it twice leaves the same state
  - `finalize` catches up missed days, inserts messages that ingest missed, produces the rollup, and writes the archive only in the 06:00 run
  - a detail response that fails validation goes to `unparsed/` and is pushed back, without stopping the other candidates or publishing
  - manually executable `FAILED` messages are re-checked until 48 hours
  - the first hourly run seeds the `arrivals` baseline with `announced_at` already set
  - **live/backfill parity:** finalize and the backfill path produce identical `daily_totals` from the same fixture day
- **Candidate pipeline:**
  - threshold filtering
  - skipping wallets with no code
  - the shape of the draft TOML files
  - a hostile contract name (quotes, newlines, `verified = true`) that can't inject keys or markdown
- **Backfill:**
  - the depth wall: stop after 3 failures on the same cursor and write `coverage_from`
  - `coverage.json` rewritten after every page
  - upserts that update backfill rows and leave live rows untouched
- **Canary script** (run by hand, not in CI): small calls against the real APIs to catch changes upstream.

## 13. Repository layout

```
ccip-dev/
  packages/core/src/{ccip-client,prices,chain-map,reserve,normalize,value,rollup,labels}.ts
  worker/src/{index,jobs/*,store,publish,watchdog,telegram}.ts   worker/migrations/*.sql   worker/wrangler.toml   worker/wrangler.watchdog.toml
  scripts/{backfill,label-candidates,canary,build-labels}.ts
  labels/projects/*.toml
  docs/{methodology.md, callsigns/, superpowers/specs/}
  .github/workflows/{ci,deploy,watchdog,label-candidates}.yml
```

This is a pnpm workspace on TypeScript, matching chainlinkmeme. The repo is public (decided 2026-10-05; it was planned to stay private until launch): the code under MIT, and `labels/` under CC BY 4.0.

## 14. Configuration and secrets

| Name | Where | Purpose |
|---|---|---|
| `CCIP_API_BASE` | Worker var | `https://api.ccip.chain.link/v2` |
| `RPC_ETHEREUM`, `RPC_FALLBACKS` | Worker secret | Reserve reads. Only keyless public endpoints may appear in committed config |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID` | Worker secret on both Workers, Actions secret (backup watchdog) | Alerts |
| `CF_DEPLOY_TOKEN` | Actions secret in a protected `production` environment | Deploy both Workers (data and watchdog) and run D1 migrations only |
| `CF_D1_READ_TOKEN` | Actions secret | Read-only D1 queries for the candidate pipeline |
| `CLOUDFLARE_ACCOUNT_ID` | Actions var, owner's Mac (.env) | Account id (not secret) |
| `CF_BACKFILL_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Owner's Mac (.env) only | Backfill uploads. R2 keys are scoped to the archive bucket |
| `ETHERSCAN_API_KEY` | Actions secret | Enriching label candidates |
| `RPC_MAP` | Actions secret (JSON) | `eth_getCode` per chain for the candidate pipeline |
| `CANDIDATE_MIN_USD_7D` (50000), `CANDIDATE_MIN_MESSAGES_7D` (50) | Actions var | Candidate pipeline thresholds |

Secrets are set by the owner with `wrangler secret put` or `gh secret set`, and are never committed or pasted into chat.

**GitHub Actions hardening (the repo is public):**
- Workflows that use secrets (`deploy`, `watchdog`, `label-candidates`) run only on `schedule`, `workflow_dispatch` or a push to `main`. They never run on `pull_request_target` or on fork PRs.
- `ci` on pull requests uses no secrets.
- Every workflow declares least-privilege `permissions:`. The default is `contents: read`. Only `label-candidates` adds `contents: write` and `pull-requests: write`.
- `.gitignore` covers `.env` and `.backfill/`.
- GitHub secret scanning and push protection are switched on before the first push.
