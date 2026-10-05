# ccip.dev Data Core — History Extension (per-source crawl)

Addendum to `2026-10-05-data-core.md`. Spec: `docs/superpowers/specs/2026-10-05-data-core-design.md` §9–§10 (updated by Task H3).

**Goal:** back-fill the full CCIP mainnet history (launch, mid-2023, to `live_start_day`), not just the ~9 months the unfiltered crawl reached.

## Evidence (probes on 2026-10-05)

- The unfiltered crawl (`GET /v2/messages?environment=mainnet&limit=1000`) stopped at 2026-01-15: the API has a 30 s server timeout, and unfiltered queries slow down with depth (2025-09-01 and older time out even at `limit=10`).
- The same API filtered by source chain is fast at every depth. With `sourceChainSelector`, a 1,000-message page took 0.9–3.3 s for Ethereum at 2023-08 and 2024-08, BNB at 2025-02, and Base at 2025-05.
- The cursor is base58 (Bitcoin alphabet) of a query string, e.g. `sourceNetworkName=ethereum-mainnet&environment=mainnet&oldestSeenTimestamp=<ms>&oldestSeenMessageId=0x…&totalCount=1000&isCountCapped=true`. Paging is a timestamp/messageId keyset: the next page holds messages with `ts < T`, or `ts = T` and `id < I`, newest first. When a cursor is sent, the filters come from the cursor.
- **Poison messages.** Some single messages make the list endpoint return HTTP 500 in about 1 s, whatever the page size (one is at 2026-01-15T01:28:06Z). Every page that contains such a message fails. A crafted cursor positioned exactly at the poison message skips it.
- Search filters (from `@chainlink/ccip-sdk` `searchMessages`): `sender`, `receiver`, `sourceChainSelector`, `destChainSelector`, `sourceTransactionHash`, `sourceTokenAddress`, `readyForManualExecOnly`, `q`. There is no time-range filter.

## Task H1: Source-filtered client, cursor codec, poison skipper, per-source crawl

**Files:** `packages/core/src/ccip/client.ts`, new `packages/core/src/ccip/cursor.ts` (exported from the core index), `scripts/backfill/crawl.ts`, new `scripts/backfill/sources.ts`, `package.json` (script `backfill:sources`). Tests in `packages/core/test/`, `scripts/test/crawl.test.ts`, new `scripts/test/sources.test.ts`.

1. **Client filter.** `listMessages({ limit, cursor?, sourceChainSelector? })` adds `sourceChainSelector` only when there is no cursor, because the cursor already encodes the filters. Existing behaviour is otherwise unchanged.
2. **Cursor codec** (`cursor.ts`):
   - `decodeCursor(cursor): URLSearchParams`
   - `encodeCursor(params): string`
   - `cursorAt(cursor, sendTimestampMs, messageId): string`, which keeps every other parameter of `cursor` and replaces `oldestSeenTimestamp` and `oldestSeenMessageId`
   - Test with a real cursor sample: round trip, and `cursorAt` changes only those two parameters.
3. **Poison skipper** in `crawl()`. The new `CrawlOptions.skipPoison?: boolean` defaults to false, so the global crawl is unchanged. With it enabled, when a page fails at the page-size floor and the cursor is non-null, `crawl()` runs `findPoison` before declaring a depth wall:
   - **Probe:** `listMessages({ limit: 1, cursor: crafted })`. An `UpstreamHttpError` 500 means "contains the poison message". A success, empty or not, means "past it". Any other error is retried up to 3 times, then the search gives up and the depth wall stands.
   - **(a) Timestamp.** With `id = 0x00…00` (everything at `T` excluded), step `T` back from the cursor's timestamp by 1 s, 2 s, 4 s, … until a probe succeeds. Then bisect whole seconds between the last failing and the first succeeding `T`. `P.ts` is the smallest failing-to-succeeding boundary.
   - **(b) Message ID.** At `P.ts`, bisect the 256-bit id in `[0, hi)`. `hi` is the cursor's own id if `P.ts` equals the cursor's timestamp, else 2²⁵⁶. The smallest failing `I` is `P.id + 1`.
   - **Budget:** at most 400 probes per poison message, then give up (depth wall).
   - **Result:** continue from `cursorAt(cursor, P.ts, P.id)`. Append `{ messageId, sendTimestamp }` to `state.skipped` (persisted, and copied into `coverage.json` as `skipped`). If the client has `getMessageRaw`, try it for `P.id` and, on success, write the JSON to `<dir>/poison/<messageId>.json`; a failure is only logged.
   - **Tests:** a fake API with real keyset semantics over an in-memory list (it decodes crafted cursors with the codec) and one poison message. The crawl skips exactly that message, keeps every other message, and records it in `skipped`. A poison message at the same timestamp as the cursor message is skipped too. If no boundary is found within the budget, the result is a depth wall.
4. **Per-source crawl** (`sources.ts`, CLI `pnpm backfill:sources`):
   - **Source list.** Take the union of the `listChains()` selectors and the distinct `sourceNetworkInfo.chainSelector` values in `.backfill/pages/*.json` and `.backfill/topup/*.json`. Write it to `.backfill/sources/sources.json` as `[{ selector, name }]`.
   - **Crawl each selector**, sorted, with `crawl({ dir: '.backfill/sources/<selector>', client: <client that adds sourceChainSelector on the first page>, limit: 1000, minLimit: 1, skipPoison: true })`. A selector already marked `done` and not walled is skipped. Errors for one selector (for example a 404 for a retired chain) are recorded in the summary, and the loop moves on.
   - **Summary.** `.backfill/sources/summary.json` holds `{ complete, sources: [{ selector, name, done, stopped_at_depth_wall, coverage_from, messages, pages, skipped, error? }] }`. `complete` is true only when every source is `done`, none is walled, and none errored. Exit non-zero if `complete` is false.
   - **Tests:** two fake sources, one with a poison message. Both are crawled into their own directories, the summary is correct, a re-run skips the finished sources, and an erroring source is recorded without stopping the others.

## Task H2: Day spool and build by day

**Files:** `scripts/backfill/build.ts`, `scripts/test/build.test.ts`.

1. **Spool.** Remove and recreate `.backfill/days/`, then read page files in this order: `pages/`, `topup/`, `sources/*/pages/` (later files win on duplicate ids). Validate each raw object with `ListMessage`. For every message whose day is before `liveStartDay`, buffer its raw JSON line by day. Append a day's buffer to `days/YYYY-MM-DD.jsonl` when it passes 5,000 lines, and flush everything at the end. Memory stays bounded by the buffers.
2. **Build by day.** For each day file (ascending), read the lines, dedupe by `messageId` (the last line wins), and run the existing per-day pipeline: `buildRows`, rollup unless the day is incomplete, archive, first-seen, chains. Remove the one-day-lag flush and the flushed-day guard; the spool makes them unnecessary.
3. **Coverage.** If `sources/summary.json` exists, it decides coverage:
   - The build refuses unless every source is `done` with no `error` (each source's crawl is `complete`).
   - If no source is walled, there is no incomplete day, and `meta.coverage_from` is the earliest message's day.
   - Otherwise `meta.coverage_from` is the day after the latest walled source's `coverage_from` day, and days before it get messages and archives but no rollups.

   If `sources/` is absent, the existing global-crawl coverage rules apply unchanged (`complete === true`, and the partial oldest day after a depth wall).
4. **Skipped poison messages.** Write their union to `.backfill/skipped.json`, and include a count in `BuildResult`.
5. **Tests:**
   - Interleaved sources covering the same days are deduped and rolled up correctly.
   - The old global-only fixture still builds.
   - A walled source makes earlier days rollup-free and sets `coverage_from`.
   - A complete source set uses the earliest day.
   - An erroring source is refused.
   - The parity test still passes.

## Task H3: Spec, runbook and tracker

- **Spec §9 step 1:** the backfill crawls per source chain, with the poison skipper. The global crawl's pages are kept as an extra input.
- **Spec §10:** history reaches CCIP's launch unless a source walls; poison messages are skipped and listed.
- **Runbook:** a "History crawl" section covering `pnpm backfill:crawl` (global, optional), `pnpm backfill:sources`, re-running, and `summary.json`.
- **`IMPLEMENTATION_PLAN.md` Stage 1:** add the per-source crawl to the goal and success criteria.

Execution order: H1 → H2 → H3 → the owner runs `pnpm backfill:sources` → Task 17 Step 10 dry run → Task 18.
