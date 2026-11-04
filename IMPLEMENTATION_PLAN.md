# Bounded publish reads

Every history publish (finalize at 00:07 and 06:00, and the hourly catch-up) re-reads whole tables of history, so its D1
load grows with every day and every sender. On 2026-11-04 that load overloaded D1 three times in one night (#33–#35
made the publish survive it). The goal is a publish whose reads grow with the window it publishes, not with all of
history.

## Baseline (06:00 late finalize, 2026-11-04, from the `publish_step` logs of #36)

11.6M rows read in 249 queries, 11.9 s of D1 time over 65 s of wall time.

| Step | Rows read | D1 time |
|---|---:|---:|
| sender-identities | 4.52M | 3.3 s |
| day-leaders | 2.43M | 3.2 s |
| top/sender | 1.36M | 1.3 s |
| cost | 0.84M | 1.0 s (1 query) |
| projects | 0.81M | 1.2 s |
| moments | 0.66M | 1.0 s |
| top/lane, top/token, replay, top/src_chain, top/dst_chain | 0.95M | 0.9 s |

`daily_breakdown` by dim (2026-11-04): sender 277k rows / 94.6k keys, via_token 229k / 103k, token 101k / 1.8k,
lane 87k / 934, src_chain and dst_chain 22k / 92 each. Monthly rollups shrink lane, token and chain rows 9–16×, but
sender and via_token only about 2×, since most senders appear on one day. The sender dims need indexes and per-address
totals instead.

Rank steps from any run with the Workers Logs query: group by `publish_step`, sum `rows_read`, filter
`$workers.event.cron`.

## Stage 1: Per-query numbers in the publish log
**Goal**: Each step's log line names its heaviest queries, so the later stages target measured queries, not estimates.
**Success Criteria**: The `publish_step` line carries its top 3 statements by rows read (SQL head, rows, D1 ms). One
production publish shows how sender-identities' 4.52M rows split across `senderTotalsOf`, `viaTokenCreditsOf` and
`topUnlabeledSenders`.
**Tests**: The meter keeps per-statement totals keyed by SQL. The step line lists the top statements in order of rows
read. A step with no queries logs an empty list.
**Status**: Complete (#37)
**Findings** (manual publish against production, 2026-11-04 16:30 UTC: 13.8M rows, 258 queries, 20.1 s of D1 time):
- **Unlabeled-sender rankings are half of all reads.** The queries built on `unlabeledSenderRowsSql` read 6.5M rows:
  the daily top unlabeled senders in day-leaders (2.72M rows, 2 queries) and `topUnlabeledSenders` by value and by fees
  (1.88M each, 3 queries each). Each unions every sender and via_token row of its window, then groups them in a `net`
  CTE that the query reads twice. The labeled lookups (`senderTotalsOf`) never make a top three; the via-token credits
  do (431k in sender-identities, 407k in projects, 514k in day-leaders).
- **Other heavy statements:** the cost query (844k rows in one query), the daily leaders' `ROW_NUMBER()` over 400 days
  (840k), the top files' all-time sums (681k per order for senders, 184k for lanes, 218k for tokens), the first-days
  `MIN(day) GROUP BY key` in moments (379k), and the lane history behind replay.json (174k).
- **The overload trigger:** D1 was overloaded twice in this run, both times recovered by a retry. The first came in
  day-leaders, straight after cost: about 4.4 s of D1 time back to back with no pause. The 4.6M rows logged for
  day-leaders include the retry's second read (2.4M at 06:00).

## Stage 2: Day leaders stored when a day is finalized
**Goal**: day-leaders.json reads 400 stored rows instead of recomputing 400 days of leaders on every publish. First,
because day-leaders is both the largest step without a retry (2.4M rows) and where D1 overloads.
**Success Criteria**: `day-leaders` reads under 10k rows. day-leaders.json is identical to the recomputed file.
Re-finalizing a day replaces that day's row. A change to the labels, projects or label tokens (a deploy that changes
the bundled files) recomputes the stored days in chunks from the hourly run, with a fingerprint of those files kept in
`meta`. Token symbols resolve at publish, as today.
**Tests**: Finalize stores the day's leaders, and a re-finalize replaces them. The published file equals
`dayLeaderEntries` over the same 400 days. A changed fingerprint recomputes the stored days, a chunk per run, and the
file stays complete meanwhile. A day with no stored row is computed on the spot.
**Status**: In Progress (deployed; waiting on the 00:07 publish to confirm the rows read)

## Stage 3: Fee percentiles in the Worker
**Goal**: cost.json reads its 30-day window once. Today the window-function query reads ~13× the window (843k rows
for 64.8k messages).
**Success Criteria**: `cost` reads about one row per message in the window (~65k today). cost.json is identical for
the same data.
**Tests**: The existing cost.json tests pass unchanged (nearest-rank percentiles, the LINK/gas split from 20 LINK-paid
fees, routes under 5 priced fees left out, four-decimal fractions of a cent). Plus a test that the step issues one
query over the window.
**Status**: In Progress (deployed; the new query read 64.8k rows on production against 844k, in 0.78 s against 1.2 s)

## Stage 4: Unlabeled-sender rankings and via-token lookups
**Goal**: `topUnlabeledSenders` reads its window's sender and via_token rows once instead of twice, and the via-token
queries read only the claimed groups' rows.
**Success Criteria**:
- **Compute `net` once:** try `AS MATERIALIZED` on the `net` CTE (supported since SQLite 3.35), and check that rows
  read halve on production data before keeping it.
- **Index the claimed group:** a virtual generated column for the via_token key's group, indexed on `(dim, grp, day)`,
  so `viaTokenCreditsOf`, `viaTokenCreditDays` and the claimed half of `unlabeledSenderRowsSql` seek the claimed groups'
  rows instead of scanning all 229k via_token rows.
- **Measured win:** the drop shows in sender-identities, top/sender, projects and moments. Outputs are identical.
**Tests**: The store tests for these queries pass unchanged. A query-plan test asserts the group index is used, as
`idx_messages_fee_usd` already is for the largest fees.
**Risk**: Building an index over the ~1.1M-row table inside a migration may time out remotely (7429). Time the build on
a scratch D1 database imported from `wrangler d1 export` first. If it's too slow, build a side table from the Worker in
chunks instead.
**Status**: Not Started

## Stage 5: Sealed totals for the all-time rankings
**Goal**: The "all" windows (top files, sender identities, projects, first days) read completed months from rollups
and only the current month from `daily_breakdown`.
**Success Criteria**:
- **Lane, token and chain dims:** a `monthly_breakdown` table. Sender and via_token: per-address totals over completed
  months, if the unlabeled-sender rankings are still the heaviest reads after stage 4.
- **Building:** a month is rolled up once it completes, and again whenever a day in it is re-finalized, always from
  `daily_breakdown`, so a retry or rewind can never double-count. A `meta` pointer names the last rolled-up month;
  readers take rolled-up months through it and daily rows after it, so an unfinished backfill is never read.
- **Backfill:** the Worker fills the months in chunks, never a migration.
- **Switch-over:** each reader moves only after its output matches the current query's on production data.
- **Cleanup:** the old full-history queries are removed, and PUBLISH_PAUSE_MS is re-evaluated against the new numbers.
**Tests**:
- Rolling up a month from its days, idempotently: a second rollup changes nothing.
- Re-finalizing a day in a completed month re-rolls that month.
- Readers return the same rankings with the pointer at, before and after a month boundary.
- The backfill resumes from its cursor.
- Every top file, the identities, projects.json and the first days match the old queries on the test fixtures.
**Status**: Not Started

## Done when
A full publish reads under 2M rows (stage targets: cost ~65k, day-leaders under 10k, the all-time windows bounded by
the current month plus the rollups), and the 00:07 run logs no `D1 is overloaded` warning for a week. Delete this file
then.
