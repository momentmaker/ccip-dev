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
**Goal**: Each step's log line names its heaviest queries, so stages 4 and 5 target measured queries, not estimates.
**Success Criteria**: The `publish_step` line carries its top 3 statements by rows read (SQL head, rows, D1 ms). One
production publish shows how sender-identities' 4.52M rows split across `senderTotalsOf`, `viaTokenCreditsOf` and
`topUnlabeledSenders`.
**Tests**: The meter keeps per-statement totals keyed by SQL. The step line lists the top statements in order of rows
read. A step with no queries logs an empty list.
**Status**: In Progress (deployed; waiting on a production publish for the split)

## Stage 2: Fee percentiles in the Worker
**Goal**: cost.json reads its 30-day window once. Today the window-function query reads ~13× the window (843k rows
for 64.8k messages).
**Success Criteria**: `cost` reads about one row per message in the window (~65k today). cost.json is identical for
the same data.
**Tests**: The existing cost.json tests pass unchanged (nearest-rank percentiles, the LINK/gas split from 20 LINK-paid
fees, routes under 5 priced fees left out, four-decimal fractions of a cent). Plus a test that the step issues one
query over the window.
**Status**: Not Started

## Stage 3: Day leaders stored when a day is finalized
**Goal**: day-leaders.json reads 400 stored rows instead of recomputing 400 days of leaders on every publish.
**Success Criteria**: `day-leaders` reads under 10k rows. day-leaders.json is identical to the recomputed file.
Re-finalizing a day replaces that day's row. A change to the labels, projects or label tokens (a deploy that changes
the bundled files) recomputes the stored days in chunks from the hourly run, with a fingerprint of those files kept in
`meta`. Token symbols resolve at publish, as today.
**Tests**: Finalize stores the day's leaders, and a re-finalize replaces them. The published file equals
`dayLeaderEntries` over the same 400 days. A changed fingerprint recomputes the stored days, a chunk per run, and the
file stays complete meanwhile. A day with no stored row is computed on the spot.
**Status**: Not Started

## Stage 4: Indexed sender address and claimed token
**Goal**: Lookups by a set of addresses or claimed tokens (`senderTotalsOf`, `senderDaysOf`, `viaTokenCreditsOf`,
`viaTokenCreditDays`) read only the matching rows instead of scanning every sender or via_token row of the window.
**Success Criteria**: A virtual generated column for the key's address (and the via_token key's token), with an index
on `(dim, address, day)`. Those queries read rows proportional to the labeled and claimed keys. The rows-read drop
shows in sender-identities, projects, day-leaders and moments. Outputs are identical.
**Tests**: The store tests for each of these queries pass unchanged. A query-plan test asserts the new index is used,
as `idx_messages_fee_usd` already is for the largest fees.
**Risk**: An index build over ~1.1M rows inside a migration may time out remotely (7429). Time the build on a scratch D1
database imported from `wrangler d1 export` first. If it is too slow, build it from the Worker in chunks into a side
table instead.
**Status**: Not Started

## Stage 5: Sealed totals for the all-time rankings
**Goal**: The "all" windows (top files, sender identities, projects, first days) read completed months from rollups
and only the current month from `daily_breakdown`.
**Success Criteria**:
- **Lane, token and chain dims:** a `monthly_breakdown` table. Sender and via_token: per-address totals over completed
  months. Stage 1's numbers decide whether these beat the stage-4 indexes enough to keep.
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
