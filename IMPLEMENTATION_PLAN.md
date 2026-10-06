# ccip.dev data core: implementation stages

Detailed tasks: `docs/superpowers/plans/2026-10-05-data-core.md`. Spec: `docs/superpowers/specs/2026-10-05-data-core-design.md`.
Delete this file when every stage is Complete.
Execution order: Tasks 1–8, 17, 9–16, 18, 19.

## Stage 1: Data access and history crawl
**Goal**: Core package, CCIP client, and a resumable per-source history crawl run on Oct 6 (Tasks 1–3, H1–H2).
**Success Criteria**: `pnpm test` passes; `pnpm backfill:sources` reaches `complete: true` in `.backfill/sources/summary.json`, with a `coverage_from` and any skipped poison messages recorded. A depth-wall stop was re-run once to confirm it.
**Tests**: chain-map, http, ccip-client, time, crawl.
**Status**: Complete

## Stage 2: Core logic and backfill build
**Goal**: Valuation, normalization, rows (including the shared `buildRows`), rollup, prices, Reserve, archive helpers, label registry, and the backfill build dry-run against the Oct 6 crawl (Tasks 4–8, then 17).
**Success Criteria**: All core and script tests pass; `pnpm labels:check` passes; the dry-run build finishes with an acceptable `unpricedMessages`.
**Tests**: value, normalize, rows, buildRows, rollup, prices, reserve, archive, labels, sql, backfill build (with parity, top-up and gap guard).
**Status**: Complete

## Stage 3: Live Worker
**Goal**: Worker deployed with all five cron jobs publishing to data.ccip.dev, plus the external watchdog (Tasks 9–16).
**Success Criteria**: Spec §2 criteria 2, 4 and 6 hold in production.
**Tests**: store, alerts, publish, ingest, details, prices job (including the status.json refresh), hourly, finalize, index.
**Status**: In Progress

## Stage 4: Backfill load and verification
**Goal**: Top up the crawl, rebuild, and load history before live_start_day into D1 and R2; cross-check recorded; 10–20 hand-written labels (Task 18).
**Success Criteria**: Spec §2 criteria 1, 3 and 5 hold; after the upload, `lag_seconds` is under 120 and `last_finalize_day` is current.
**Tests**: upload (resume and rebuild re-apply).
**Status**: In Progress

## Stage 5: Label candidates
**Goal**: Weekly label-candidate PR (Task 19), built only after Stages 1–4 pass.
**Success Criteria**: A manual workflow run opens or updates one PR with drafts set to verified = false.
**Tests**: label-candidates.
**Status**: Not Started
