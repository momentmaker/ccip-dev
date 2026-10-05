# ccip.dev data core: implementation stages

Detailed tasks: `docs/superpowers/plans/2026-10-05-data-core.md`. Spec: `docs/superpowers/specs/2026-10-05-data-core-design.md`.
Delete this file when every stage is Complete.

## Stage 1: Data access and history crawl
**Goal**: Core package, CCIP client, and a resumable history crawl run on Oct 6 (Tasks 1–3).
**Success Criteria**: `pnpm test` passes; `.backfill/coverage.json` shows `complete: true` and a `coverage_from`.
**Tests**: chain-map, http, ccip-client, time, crawl.
**Status**: Not Started

## Stage 2: Core logic
**Goal**: Valuation, normalization, rollup, prices, Reserve, archive helpers, label registry (Tasks 4–8).
**Success Criteria**: All core unit tests pass; `pnpm labels:check` passes.
**Tests**: value, normalize, rows, rollup, prices, reserve, archive, labels.
**Status**: Not Started

## Stage 3: Live Worker
**Goal**: Worker deployed with all five cron jobs publishing to data.ccip.dev, plus the external watchdog (Tasks 9–16).
**Success Criteria**: Spec §2 criteria 2, 4 and 6 hold in production.
**Tests**: store, alerts, publish, ingest, details, prices job, hourly, finalize, index.
**Status**: Not Started

## Stage 4: Backfill load and verification
**Goal**: History before live_start_day in D1 and R2; cross-check recorded; 10–20 hand-written labels (Tasks 17–18).
**Success Criteria**: Spec §2 criteria 1, 3 and 5 hold.
**Tests**: sql, buildRows parity, backfill build, upload.
**Status**: Not Started

## Stage 5: Label candidates
**Goal**: Weekly label-candidate PR (Task 19), built only after Stages 1–4 pass.
**Success Criteria**: A manual workflow run opens or updates one PR with drafts set to verified = false.
**Tests**: label-candidates.
**Status**: Not Started
