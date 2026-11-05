# ccip.dev: CCIP messages sent by CRE workflows

**Status:** Approved design · **Date:** 2026-11-05

The Chainlink Runtime Environment (CRE) runs workflows on Chainlink DONs. A workflow reaches a chain by having a DON node submit a signed report to that chain's `KeystoneForwarder`. The forwarder then calls the workflow's consumer contract, and that contract (or one it calls) can call the CCIP Router. So a CCIP message whose source transaction a CRE node key signed was sent by a CRE workflow.

A probe on 2026-11-05 found 975 such messages in D1 (2026-05-19 to 2026-11-04, about $52M, 101 with tokens). All 20 sampled node-key messages had `tx.to` equal to that chain's forwarder, and all 10 sampled messages from the same senders signed by other wallets did not. The senders are Re's reUSD NAV broadcasters, Lido Direct Staking on Base and Arbitrum, and Aave's governance CrossChainController, plus about 30 unlabeled senders. Chainlink publishes no CRE usage numbers, so these are the first public ones.

Matching on the CCIP `sender` does not work: no CCIP sender was a forwarder receiver, because the consumer hands off to another contract that sends. Matching on `origin` (the transaction signer) does.

The owner approved on 2026-11-05:
- **Scope:** CRE-sent CCIP messages only. A CRE workflow directory and a forwarder write feed are a later project.
- **Key refresh:** a daily GitHub workflow that opens a PR.
- **Home page:** a feed badge, a today tile and a compact band.

Research behind this is in `reports/Chainlink CRE product opportunities.md` (untracked).

## 1. The node key list

`config/cre-keys.json` is code, reviewed like labels:

```json
{
  "source": "Built by pnpm cre-keys:refresh from KeystoneForwarder ReportProcessed logs; a key is the signer of a forwarder report() transaction",
  "chains": {
    "ethereum-mainnet": {
      "selector": "5009297550715157269",
      "forwarder": "0x0b93082d9b3c7c97facd250082899bacf3af3885",
      "keys": [{ "address": "0x…", "first_seen": "2026-11-05", "last_seen": "2026-11-05" }]
    }
  }
}
```

- Addresses are lowercase.
- Keys are never deleted. A rotated-out key still marks the messages it signed, and its `last_seen` stops moving.
- The 24 chains and forwarders come from the CRE Forwarder Directory (docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts), checked into the script. Only production `KeystoneForwarder` addresses are used, never the `MockKeystoneForwarder` simulation addresses.
- Each selector is resolved from ccip.dev's own `https://data.ccip.dev/v1/chains.json`. A chain CCIP does not list is skipped, since none of its messages could be in D1.

**`pnpm cre-keys:refresh`** (`scripts/cre-keys/refresh.ts`) runs once per chain:
1. Reads `ReportProcessed(address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result)` logs from the forwarder over the last ~24 hours. It walks back from the head in windows that shrink on a range error (start 5,000 blocks, floor 100).
2. Fetches up to 80 of those transactions, spread evenly, and takes `tx.from` as the node key.
3. Merges the result: new keys are added with today's `first_seen`, known keys get today's `last_seen`.

It uses the keyless `rpc` map in `config/endpoints.json`, then a per-chain fallback list (publicnode first). A chain that fails on every endpoint keeps its keys unchanged, and the script prints it in the run summary. The script never removes a key.

**`.github/workflows/cre-keys.yml`** runs the script daily and opens a PR when the file changed, the same way `endpoints.yml` does. The PR body lists new keys per chain and the chains that failed.

**Build.** `scripts/build-labels.ts` also writes `worker/src/generated/cre-keys.json`, a sorted list of `selector:address` strings plus a `version` (a hash of that list). The Worker loads it into a `Set` at import, so checking a key costs no D1 reads.

## 2. Schema, tagging and rollups

**Migration `0014_cre.sql`** adds columns only:

```sql
ALTER TABLE messages ADD COLUMN cre INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_totals ADD COLUMN cre_messages INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_totals ADD COLUMN cre_usd REAL NOT NULL DEFAULT 0;
```

`ADD COLUMN` with a constant default does not rewrite the table. The migration has no index and no backfill, following the 7429 rule (backfills run from the Worker in chunks). No CRE query needs an index on `messages`: every read goes through rollups, or through rows the live job already fetches.

**Tagging at ingest.** `isCreOrigin(srcChain, origin)` in `packages/core/src/cre.ts` checks the generated set. `toMessageRow` sets `cre` from it, which covers:
- the live ingest
- the finalize list sweeps
- the offline backfill scripts in `scripts/backfill/build.ts`

`origin` is written only on first insert, and the upserts never update it, so they leave `cre` alone too.

**Rollups.**
- `rollupDay` counts `cre_messages` and `cre_usd` into `DailyTotals`.
- It also adds a new `Dim`, `'cre'`, through `addMessageGroups('cre', …)`. The key is `src:sender`, over CRE-sent messages only, with messages, `usd_value` and `fee_usd`.
- `'cre'` joins `BREAKDOWN_DIMS`, so `rollMonth` and the all-time readers (`allTimeSource`, `rolledSourceSql`) cover it unchanged.
- `writeDaily` writes the two new totals columns.

**Back-tagging and re-tagging: `retagCre`, a new step in the hourly job.**
- The meta keys `cre_keys_version` and `cre_retag:before` hold its state.
- When the generated `version` differs from `cre_keys_version`, it starts a pass:
  - It covers every day from 2025-10-17 (the CRE Workflow Registry's first record) to today when `cre_keys_version` has never been set.
  - Otherwise it covers the last 30 days.
- Each run handles up to 30 days, newest first, within a time budget. Per day it runs these steps in one batch:

  ```sql
  UPDATE messages SET cre = CASE WHEN src_chain || ':' || origin IN (…) THEN 1 ELSE 0 END WHERE day = ?;
  -- recompute that day's CRE totals and its 'cre' breakdown rows from messages WHERE day = ? AND cre = 1
  ```

  - The key list is inlined as string literals rather than bound in `PARAM_CHUNK` chunks. Chunked binding would need several statements per day, and a `CASE … ELSE 0` in a later chunk would clear matches from an earlier one.
  - Inlining is safe because the generated file is built only from strings matching `^\d+:0x[0-9a-f]{40}$`. The build rejects anything else, and `cre.ts` asserts it again before writing SQL.
  - At 223 keys the list is about 21 KB of SQL, well under D1's statement limit.
  - Recomputing the day's totals rereads that day's rows, again through the day index.
  - The batch ends with the existing `unrollStatement(day)`, so `rollForwardMonths` rebuilds the touched months.
- When the pass reaches its oldest day, it stores the new version and clears the cursor.
- A pass that starts while another is still running restarts from today with the newer version.
- Cost: the first pass reads each message about twice (the update and the recompute), about 3M rows spread over a day or two of hourly runs. A key change costs about 300k rows. Otherwise it costs nothing.
- `day_leaders` does not use the `cre` dim, so it needs no reset.

## 3. Published data

| File | Addition | Source |
|---|---|---|
| `live.json` | `cre: true` on CRE-sent rows | One more column in the `liveSince` SELECT |
| `today.json` | `totals.cre_messages`, `totals.cre_usd` | `rollupToday` (runs `rollupDay` over today) |
| `history.json` | `cre_messages`, `cre_usd` per day | The same `daily_totals` read |
| `top/cre.json` (new) | Top CRE-driven senders for 7d, 30d and all time, with identities | `topBetween` and the all-time readers over the `cre` dim, as the other top files do |
| `projects.json` | `cre_messages` and `cre_share` for 7d and 30d per project | The `cre` dim, beside the existing sender sums |

Every addition gets a schema in `PUBLIC_SCHEMAS` (`packages/core/src/public.ts`). New fields are optional, so a site build that reads an older file still works.

## 4. Posts

The daily and weekly facts gain `cre: { messages, usd, share, top } | null`. `top` is the day's or week's top CRE sender by messages, with the same identity resolution as "Top sender". The facts are `null` when there were no CRE-sent messages, and then the line is omitted.

**Daily, X** (under "Top sender"):
```
CRE workflows: 32 messages (2.4%) · top: Re
```

**Daily, Telegram:**
```
Sent by CRE workflows: 32 messages · $41k (2.4%) · top: Re
```

**Weekly** (X and Telegram), using the same ▲/▼ helper as the totals lines against the previous week:
```
CRE workflows: 140 messages ▲ 12% · top: Re
```

The line's drop rank sits after `lane` and before `sender`:

```
DROP = { lane: 1, cre: 2, sender: 3, token: 4, feeChains: 5, closing: 6 }
```

## 5. Site

- **Feed badge** (`Feed` and `HomeTicker`): a small "CRE" chip on rows with `cre: true`. Its title text is "Sent by a Chainlink CRE workflow".
- **Today tile** (`TodayTiles`): "Sent by CRE · N · x% of today". It renders only when `cre_messages > 0`.
- **CRE band** (`components/home/HomeCre.astro`, after `HomeLive`, before the Vault band). It contains:
  - CRE share of messages over the last 90 days, as a small chart from `history.json`;
  - total CRE-sent messages to date;
  - the top 5 CRE-driven projects for 30 days, from `top/cre.json` joined to `projects.json`, with logos and links to project pages;
  - one line on what CRE is, with a link to the methodology section.

  The band is hidden when `history.json` has no CRE-sent messages in the window.
- **Project pages** (`projects/[slug].astro`): a "x% sent by CRE workflows" stat in the 7d/30d tiles, shown when the project has CRE traffic.
- **Day pages** (`day/[day].astro`): a "Sent by CRE workflows: N" line, shown when non-zero.

## 6. Docs

- **`docs/methodology.md`**, a new section "CRE-sent messages":
  - the node-key test, and how it was checked against forwarder `tx.to`;
  - **the counts are a lower bound**;
  - what is missed: a workflow whose consumer queues a request and sends CCIP in a later transaction;
  - the lag between a key rotation and the PR merge, and that the 30-day re-tag closes it;
  - why matching on `sender` does not work.
- **`docs/runbook.md`**, a section covering:
  - refreshing keys by hand;
  - the `retagCre` meta keys and how to force a full pass (delete `cre_keys_version`);
  - its alert, `job-failed:hourly` with the step named.

## 7. Testing

- `isCreOrigin`: a hit, the same address on another selector, letter case, and a null origin.
- `toMessageRow` and `buildRows` set `cre`.
- `rollupDay`: CRE totals, `cre` breakdown rows, and a day without CRE.
- `retagCre`, against the real D1 test migrations:
  - first pass from 2025-10-17, paced 30 days per run;
  - a re-run of the last 30 days on a version change;
  - a restart when the version changes mid-pass;
  - totals and breakdown recomputed, and the rolled pointer moved back.
- `EXPLAIN QUERY PLAN`: the per-day `UPDATE` and the recompute use `messages_day`.
- Refresh merge (`scripts/test/`): adds keys, bumps `last_seen`, never deletes, keeps a failed chain's keys, resolves selectors, skips chains CCIP does not list.
- Copy fixtures:
  - daily and weekly posts on X and Telegram, with and without the CRE line;
  - the drop order at X's 280 characters.
- Public schema tests for the five files.
- Site tests: the tile and band hide when there are no CRE messages; the badge renders for `cre: true`.

## 8. Rollout

1. Merge the key list from the refresh script, seeded with today's probe (223 keys on 24 chains).
2. Deploy migration 0014 and the Worker. New messages are tagged right away.
3. `retagCre` back-tags history over the next hourly runs. Watch `rows_read` in the `publish_step` and job logs.
4. Ship the posts and site once the back-tag pass is done, so the first posts and the band show full history.

## Not in this version

- A CRE workflow directory from the Ethereum Workflow Registry.
- A forwarder write feed, with failure alerts.
- Decoding workflow IDs and owners from the `report()` calldata.
- CRE moments and records.
