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

## Pricing tasks (owner decision 2026-10-05: chain map + token-group fallback + a free second source; FREE tiers only)

Dry-run baseline: 115,719 of 1,263,231 token transfers unpriced (9.2%). By cause: no DefiLlama price 53,200; history gap 45,550; chain not mapped 13,521; non-EVM 3,448.

### Task P1: Verified chain slugs (done: fb4ce7c)
13 of 31 unmapped EVM chains verified by a real DefiLlama price, covering 11,021 of 13,521 transfers.

### Task P2: CCIP token-group price fallback (core + Worker + backfill, one shared function)

CCIP's token registry (`/tokens`: `chainSelector`, `address`, `decimals`, `groupId`) groups the copies of one token across chains, and its token pools keep them 1:1. When a token has no price of its own (no llama key, no DefiLlama price, or no price that day), use the price of another member of its group, on the same day for the backfill and the latest price for live data, together with the token's OWN registry decimals.

- **Core:**
  - `buildTokenGroupIndex(entries)` and `groupFallback(index, priceOf)` return a `(chainSelector, address) → PriceInfo | undefined` lookup. Siblings are tried in a deterministic order (sorted by llama key), and only siblings with a non-null llama key count.
  - `valueTokens`, `buildRows` and `priceKeys` accept an optional fallback or index. A sibling-priced token counts as priced.
- **Worker:**
  - Build the index from D1 `tokens` joined with `chains`, once per run.
  - Ingest, details (`ensurePrices` fetches sibling keys for tokens without a price) and finalize use the same fallback.
- **Backfill:**
  - Fetch the full token registry once per build (all `listTokens` pages plus `listChains`) into `.backfill/registry/`.
  - `PriceCache` prefetches sibling keys' history, and the per-day lookup falls back to siblings on that day.
- **Tests:**
  - Core: the sibling price is used with the token's own decimals; no sibling means unpriced; the sibling order is deterministic; a non-EVM token is priced through an EVM sibling.
  - Worker: a token without a price is valued through a sibling in `prices_latest`.
  - Build: a history gap is filled from a sibling's history that day.
  - Live/backfill parity still holds.

### Task P3: Free second price source (after re-measuring)
Candidates (free tiers, checked 2026-10-05): CoinMarketCap Basic (1 year of daily history, 15k credits a month), GeckoTerminal public (180 days, DEX long tail, keyless), DexScreener (live only, keyless), Alchemy Prices (free key; depth unverified), Coinbase candles (majors only). Excluded: CoinGecko Demo's storage terms, and paid-only CryptoCompare, Codex and Pyth. Choose after a dry run with P1 and P2 shows which tokens are still unpriced.

### Task P3 (decided 2026-10-05 after dry run #2): CoinGecko-ID fallback through DefiLlama, plus near-day fill

Dry run #2 (P1 + P2): unpriced messages fell from 115,719 to 75,051. Unpriced token transfers fell from 9.2% to 5.9%: no DefiLlama price 53,691; history gap 20,887; chain not mapped 158. 36,713 of the remaining transfers (121 distinct IDs) have a CoinGecko ID, according to CoinGecko's keyless `/coins/list?include_platform=true`. DefiLlama's own `coingecko:<id>` keys are free and keyless, and often have deeper history than its chain-address keys. Example: `arbitrum:WETH` starts 2024-08-15, while `coingecko:dfx-finance`, `coingecko:zed-run` and `coingecko:banana` reach 2023-07.

- **Mapping (free, keyless, metadata only).** CoinGecko `/asset_platforms` maps an EVM `chain_identifier` to a platform id. `/coins/list?include_platform=true` maps a platform and address to a coin id. EVM addresses are lowercased. Solana uses platform `solana` with the address in exact case. Match only on the token's own platform (never on an address alone). Store the mapping, not CoinGecko prices.
- **Fallback order in the shared core:** own DefiLlama key, then the CCIP group sibling (P2), then DefiLlama `coingecko:<id>`, valued with the token's own decimals (registry decimals, or DefiLlama's for the own key).
- **Backfill.** Fetch the two CoinGecko lists once per build into `.backfill/registry/`. `PriceCache` fetches `coingecko:<id>` history only for tokens still unpriced after P2.
- **Worker.** Once a day, the hourly job refreshes a `coingecko_ids (chain, address, coin_id)` D1 table for registry tokens (keyless fetch; a failure keeps the old rows and alerts). Ingest and details add `coingecko:<id>` keys for tokens still unpriced, through the same lazy path as P2.
- **Near-day fill (backfill only).** If a series has no point for day D, use the nearest point within ±2 days, preferring the earlier one.
- **Tests:** mapping precision (platform-scoped, and an address on another platform is not matched); fallback order (own, then group, then CoinGecko); history-gap fill; near-day fill bounds; Worker table refresh and failure handling; parity.
