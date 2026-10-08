# Fee backfill design

**Status:** draft for owner review, 2026-10-08.
**Goal:** give every historical day, from 2023-07-06 to 2026-10-04, the same fee data live days have since 2026-10-05:
- `messages.fee_*`;
- `daily_totals.fee_usd` and `fee_link_usd`;
- `daily_breakdown.fee_usd`.

The fees chart, the fee tiles, `top/*` fee columns and the LINK share then cover all of history.

**Owner decisions (2026-10-08):**
- Backfill all fees.
- Crawl the CCIP API newest day first, **starting at 3 requests per second and stepping up while the API stays healthy** (owner, 2026-10-08).

## 1. Why this is needed

The original backfill crawled CCIP API *list* pages, which have no fee field. Only the per-message *detail* response (`GET /messages/{id}`) carries `fees.fixedFeesDetails{tokenAddress,totalAmount}`. The live Worker fetches details for new messages, so fees exist only from 2026-10-05. That is why every chart period shows three fee points pinned to the right edge.

## 2. Scope

**In scope:**
- One detail request per historical message: 1,563,242 ids from the local archive.
- Valuing each fee in USD at its send day's price.
- Loading the fee columns into D1.
- Recomputing the fee aggregates for every historical day.

**Captured but not loaded:** the full `tokenAmounts` of each detail.
- List pages recorded only the first token of a multi-token message, so historical `usd_value`, `token_count` and the token breakdown undercount those messages.
- The detail fixes that, but loading it means a full re-rollup of `usd_value` across history, which changes published values the owner should see first.
- The fetch therefore stores the tokens locally, and a later, separate decision can load them with no second crawl.

**Out of scope:** live days (2026-10-05 onward, which the Worker already fills) and anything the Worker does today.

## 3. Pipeline

There are three commands, in the style of the existing backfill (`scripts/backfill/`). They use the data directory `.backfill/fees/`, which is git-ignored. The original backfill data in `.backfill/` is read-only input.

### 3.1 `pnpm backfill:fees:fetch` (runs on the owner's machine, for about 6 days)

- **Input:** message ids from `.backfill/archive/messages/YYYY/MM/DD.jsonl.gz`, processed day by day from 2026-10-04 back to 2023-07-06.
- **Rate** (adaptive: additive increase, multiplicative decrease):
  - Start at 3 req/s, with request starts spaced evenly and up to 6 requests in flight.
  - **Step up:** after each 10-minute window with no 429, an error rate of 1% or less, and a median latency within 2× the first window's median, add 1 req/s, up to a cap of 8 req/s.
  - **Back off:** on a 429, pause for `Retry-After` (capped at 30 s; 5 s when absent), halve the rate (never below 1 req/s), and hold for 10 minutes before stepping up again. 429s that arrive while a pause is active belong to the same burst and only extend the pause. An error rate above 1%, with at least 3 errors over at least 100 requests in a window, also halves the rate.
  - **Retries:** a message whose request fails (5xx, network, a 4xx other than 404, 410, 401, 403 or 451) is retried after 5, 10, 20, 40 and 80 s, then recorded as a skip.
  - **Gone and refused:** 404 and 410 are skips. 401, 403 and 451 stop the crawl.
  - **Stall guard:** if nothing has been answered for 15 minutes, re-fetch the latest message that succeeded (a canary). If it answers, carry on; otherwise stop with a clear message. A rerun resumes.
  - **Degradation ceiling:** a day whose retried-out skips exceed max(5, 5% of its messages) is not sealed. The crawl stops with a message that the API may be degraded, and a rerun retries those messages.
  - Send the `curl/8.7.1` user agent, as the API requires, with a 30 s request timeout.
  - Each rate change is logged. At full speed the crawl takes about 2.5–3 days; if the API never allows more than 3 req/s, about 6.
- **Output per message:** a normalized record in `.backfill/fees/details/YYYY/MM/DD.jsonl.gz`, with `messageId`, `version`, `fee {token, amount} | null`, `feeShapeUnknown` and `tokens[]`.
- **Skips:** a 404 or a schema failure goes to `skipped.jsonl` with its status and reason. Raw bodies of unknown fee shapes go to `unparsed/`, so they can be investigated.
- **Resume:**
  - `state.json` records the finished days and a cursor within the current day, written atomically.
  - A restart continues where it stopped.
  - A finished day file is never rewritten.
- **Progress line:** done and total counts, the current day, the rate, an ETA, a version histogram and the unknown-fee-shape count.
- **Probe first:** `--probe` fetches the newest 2,000 messages and the 2,000 oldest of 2023, then stops and prints the version histogram and the fee-shape coverage. That catches an old `fees` format before a 6-day run commits to it.

### 3.2 `pnpm backfill:fees:build`

This step reads the finished day files and writes SQL to `.backfill/fees/sql/NNNNN.sql`, 20,000 statements per file, like the original build.

- **Prices:**
  - Reuse the original backfill's `PriceCache` and its gap and outlier rules, opened with its exact range (`2023-07-06..2026-10-04`). A different range discards the 19 MB cache.
  - Call `ensure` for the fee-token keys not cached yet, such as wSOL, WBNB, WPOL and WAVAX.
  - Value each fee with `valueFee` on that day's price (`lookupOn(day)`).
  - Fees from Aptos, Sui, TON, Canton and slugless EVM chains, about 7.9k messages, keep `fee_usd` NULL, as live days do.
- **Messages:**
  - One statement per message: `UPDATE messages SET fee_token, fee_amount, fee_usd, detail_fetched_at WHERE message_id = ? AND source = 'backfill' AND detail_fetched_at IS NULL`.
  - Setting `detail_fetched_at` marks the row done, so a rerun skips it.
  - Live rows can't match the predicate.
- **Aggregates per day:** computed locally with the Worker's own `rollupDay` and `linkFeeUsd`, from the archive's list rows plus the fee values. The statements are `UPDATE daily_totals SET fee_usd, fee_link_usd` and `UPDATE daily_breakdown SET fee_usd` for the `src_chain`, `dst_chain`, `lane` and `sender` dims.
- **LINK set:** the LINK fee matcher uses the same set as the Worker: Ethereum LINK, the registry's LINK group from `.backfill/registry/tokens.json`, and `UNLISTED_LINK_FEE_TOKENS`.
- **Batches:** the build is incremental and newest first. Each run emits SQL for the days fetched since the last build. The owner can then load the last 30 days within hours, rather than waiting for the whole crawl.
- **Checks printed per batch:**
  - fees per message by day, flagging any day more than 5× away from its neighbours' median;
  - the share of each day's messages with a priced fee;
  - the 10 largest fees, so a decimals or price error shows up at once.

### 3.3 `pnpm backfill:fees:upload` (owner-run)

- **Applying SQL:** apply `.backfill/fees/sql/*.sql` in order with `wrangler d1 execute ccip-dev --remote --file`. Resume from `.backfill/fees/upload-state.json`, written atomically.
- **Timing:** refuse to start a file between 00:00 and 00:30 UTC or between 05:50 and 06:20 UTC, the finalize windows. D1 is unavailable while a file imports.
- **Publishing:** after the upload, the next finalize publish (00:10 or 06:00 UTC) rebuilds `history.json` and `top/*` from D1. The site workflow then picks up the day pages. No Worker change or manual publish is needed.

## 4. Changes outside the scripts

- **Guard against wiping fees.** Re-running the original `backfill:upload` would reset `daily_totals.fee_usd` to NULL and delete and re-insert each day's `daily_breakdown` rows without fees. A conflict clause can't protect the breakdown, because the original SQL deletes those rows first. So once `.backfill/fees/upload-state.json` records any applied file, the original upload refuses to apply SQL unless it is run with `--allow-fee-wipe`. The runbook says that re-running it means re-running the fee upload afterwards.
- **Fees coverage start comes from the data.** The site's fixed `FEES_SINCE` ("Fees are collected from 2026-10-05 onward") becomes the first day in `history.json` with a non-null `fee_usd`. The note and the "since" labels then follow the backfill as it loads, and disappear once coverage starts at 2023-07-06.
- **Fees chart while loading.** When fee coverage starts inside the chosen period, the fees chart plots from the coverage start rather than from the period start, with a note saying where coverage begins. Once the backfill has loaded a period, that period's chart looks like the others.
- **Runbook:** a "Fee backfill" section covering the commands, the resume behaviour, the finalize windows, "do not re-run the original backfill upload without the guard", and how to check progress.

## 5. Data volume and limits

- **Requests:** 1,563,242 detail requests: about 2.5–3 days at the 8 req/s cap, about 6.0 days at 3 req/s. At about 1.5 KB each, that's about 2.3 GB downloaded.
- **Local storage:** about 300 MB of normalized records, about 60 MB gzipped.
- **D1 writes:** about 1.56M message updates, about 1,182 `daily_totals` updates and about 0.8M breakdown updates, about 2.5M row writes in total. That is well inside the 50M per month limit.
- **SQL:** about 80 files of 20,000 statements, applied over the days of the crawl.

## 6. Risks

| Risk | Mitigation |
|---|---|
| The API throttles or blocks the crawl. It publishes no limit, and the Worker uses the same API from Cloudflare's IPs. | The adaptive rate in §3.1: start at 3, step up only while healthy, halve and hold on a 429. The stall guard stops after 15 minutes without a success. The Worker's IPs are separate from the owner's machine. |
| Old API versions return a different `fees` shape. | `--probe` first, plus a version histogram during the run. Unknown shapes are saved raw and counted, never stored silently as NULL. |
| A mispriced fee token (decimals, a price glitch) inflates a day. | The shared price rules (the outlier filter and the ±2-day gap rule), plus the per-batch checks in §3.2, before anything is uploaded. |
| The laptop sleeps or restarts during a 6-day run. | `caffeinate -i` in the run command, and resume from `state.json`. |
| Re-running the original backfill wipes the fees. | The upload guard in §4. |

## 7. Testing

- **Fetch:**
  - newest-first day order;
  - resume from `state.json` at a cursor inside a day;
  - the pacer's spacing under concurrency;
  - the rate stepping up after a healthy window, halving and holding on a 429, and never passing the cap;
  - 404 and schema skips;
  - an unknown fee shape saved raw.

  These use fake clocks and a fake client.
- **Build:**
  - fee valuation on the send day's price, using the cache's gap rule;
  - non-EVM fees stay NULL;
  - the LINK share includes the unlisted chains;
  - aggregate UPDATEs equal `rollupDay` on fixture days;
  - SQL statements pass a SQLite parse;
  - batches are incremental.
- **Upload:**
  - resume;
  - refusal inside the finalize windows.
- **Upload guard:** the original upload refuses to apply SQL after a fee upload, unless `--allow-fee-wipe` is given.
- **Site:** coverage derived from history, and the fees chart's coverage start and note.

## 8. Rollout

1. Implement and review: scripts, guard, site and runbook. Push. The site and the guard deploy.
2. The owner runs `--probe` for about 15 minutes. Review the version histogram and fee coverage.
3. The owner starts the full fetch, for about 2.5–6 days depending on the rate the API allows.
4. After about 5 hours (the last 30 days), the owner runs build and upload. The 30-day chart is then correct at the next finalize publish.
5. The owner repeats the build and upload as more days finish (90 days after about 14 hours, 1 year after about 2.4 days), then once at the end.
6. Final check:
   - the fee and LINK-share series across the 2026-10-04/05 seam;
   - `history.json` coverage from 2023-07-06;
   - the fees note gone from the site.
