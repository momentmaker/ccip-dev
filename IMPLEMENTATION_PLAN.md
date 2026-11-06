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
**Status**: Complete (#38). The 2026-11-05 00:07 publish read 12.4k rows for day-leaders, against 2.4M.

## Stage 3: Fee percentiles in the Worker
**Goal**: cost.json reads its 30-day window once. Today the window-function query reads ~13× the window (843k rows
for 64.8k messages).
**Success Criteria**: `cost` reads about one row per message in the window (~65k today). cost.json is identical for
the same data.
**Tests**: The existing cost.json tests pass unchanged (nearest-rank percentiles, the LINK/gas split from 20 LINK-paid
fees, routes under 5 priced fees left out, four-decimal fractions of a cent). Plus a test that the step issues one
query over the window.
**Status**: Complete (#39). The 2026-11-05 00:07 publish read 64.3k rows for cost, against 844k.

## Stage 4: Unlabeled-sender rankings and via-token lookups
**Goal**: `topUnlabeledSenders` reads its window's sender and via_token rows once instead of twice, and the via-token
queries read only the claimed groups' rows.
**Success Criteria**:
- ~~**Compute `net` once:** try `AS MATERIALIZED` on the `net` CTE.~~ Dropped on 2026-11-04. A local benchmark at
  production scale (223k sender rows over 94k keys, 176k via_token rows) gave identical query plans and results:
  SQLite already materializes `net`, since it is referenced twice. The reads come from the base searches over every
  sender and claimed via_token row of the window, plus their temp B-trees, so only fewer rows (the group index below,
  or stage 5's totals) can lower them. Never benchmark these queries on production: a single all-time run overloaded D1
  on its own.
- **Index the claimed group:** a virtual generated column for the via_token key's group, indexed on `(dim, grp, day)`,
  so `viaTokenCreditsOf`, `viaTokenCreditDays` and the claimed half of `unlabeledSenderRowsSql` seek the claimed groups'
  rows instead of scanning all 229k via_token rows.
- **Measured win:** the drop shows in sender-identities, top/sender, projects and moments. Outputs are identical.
**Tests**: The store tests for these queries pass unchanged. A query-plan test asserts the group index is used, as
`idx_messages_fee_usd` already is for the largest fees.
**Risk**: Building an index over the ~1.1M-row table inside a migration may time out remotely (7429). Time the build on
a scratch D1 database imported from `wrangler d1 export` first. If it's too slow, build a side table from the Worker in
chunks instead.
**Status**: Dropped (2026-11-05). In the week to 2026-11-03, claimed groups held 1,264 of 1,998 via_token rows (63%)
and 72% of their messages: 47 of 165 groups, 139 claimed keys. Measured with small reads of the chains and grouped tokens
tables and one week of via_token rows, and the Worker's own `tokenClaims`. A group index would skip only the unclaimed
37% of the via_token side, while the unlabeled-sender query still reads every sender row. That's an estimated 15–25% of
sender-identities, not worth an index build over the 1.1M-row table inside a migration.

## Stage 5: Monthly rollups behind the all-time rankings
**Goal**: The "all" windows (top files, sender identities, projects, first days) read completed months from
`monthly_breakdown` and only the days after them from `daily_breakdown`.
**Design** (2026-11-05):
- **Monthly rows for every dim.** For senders, a monthly table holds 133k rows against 95k for one row per key: most
  senders appear on a single day, so any time bucket bottoms out near the key count. Per-key totals would buy only
  1.4× more, at the cost of a 200k-row rebuild whenever a sealed day changes. Monthly rows rebuild one month at a time.
- **Rolled prefix:** the meta pointer `breakdown_rolled_through` names the last month of the contiguous rolled prefix.
  Readers take `monthly_breakdown` rows through it and `daily_breakdown` rows after its last day, so the daily part
  stays an index range.
- **Idempotent upkeep:** rolling a month deletes and rebuilds its rows in one batch. `replaceDaily` and the via-token
  backfill move the pointer back before a rewritten day's month in the same batch, and the hourly run rolls forward
  months whose last day is finalized, three a run, outside the finalize hours. The pointer advances only from the month
  before, so a concurrent rewind wins.
**PR A** (table and upkeep, no reader changes):
- **Success Criteria:** after deploy the hourly runs roll every month through the last complete one. Spot checks on
  production match `daily_breakdown` month by month, through small index-range reads.
- **Tests:** a month's sums and first days; a second roll changes nothing; oldest first at three a run; it stops at the
  open month; it skips the finalize hours; the pointer doesn't advance past a rewind; rewriting a rolled day (finalize or
  via-token backfill) moves the pointer back, and a later day doesn't.
- **Status:** In Progress.
**PR B** (readers):
- **Success Criteria:** `topBetween`, `senderTotalsOf`, `viaTokenCreditsOf`, `topUnlabeledSenders` and `firstDays` read
  the rolled prefix for an all-time window. Every published file is identical. The local production-scale benchmark
  returns the same rows both ways. The publish log shows sender-identities, top/*, projects and moments down.
- **Tests:** every reader returns the same rows with the pointer absent, before, at and after a month boundary, and with
  a rewound month.
- **Benchmark** (local, production scale, rolled through 2026-09): every reader returned the same rows (keys, order and
  values to 1e-6), 2–6× faster: unlabeled 870 → 358 ms, labeled 242 → 42 ms, top senders 292 → 103 ms, credits 218 → 123
  ms. The sums differ only by float noise around 1e-10, which could show only at a rounding boundary or as a different
  order between two keys with exactly equal totals.
- **Status:** In Progress.

## Done when
A full publish reads well under the 8.4M of 2026-11-05 (stage 5 estimate: about 5M, with the all-time windows bounded
by the monthly rows plus the current month), and the 00:07 run logs no `D1 is overloaded` warning for a week. Delete this file
then.

## CRE-sent messages (plan: docs/superpowers/plans/2026-11-05-cre-sent-messages.md)

### Stage C1: Data layer (PR A)
**Goal**: tag CRE-sent messages at ingest, back-tag history, roll CRE totals up
**Success Criteria**: `meta.cre_keys_version` equals the generated version; `daily_totals.cre_messages` matches the 2026-11-05 probe for Aug–Oct 2026 (252 / 271 / 389, or more)
**Tests**: core cre, rows, rollup, retag, EXPLAIN plans
**Status**: In Progress

### Stage C2: Published files, posts, site (PR B)
**Goal**: CRE lines in the posts, a CRE band and tile on the home page, CRE stats on project and day pages
**Success Criteria**: schemas parse; post fixtures pass; the band renders with data and hides without
**Tests**: publish, broadcast copy and facts, site components
**Status**: Not Started
