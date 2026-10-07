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
**Status**: Complete (2026-10-07 00:12Z finalize republished top/* since 2023-07-06 with 7d/30d/all windows)

## Stage 4: Backfill load and verification
**Goal**: Top up the crawl, rebuild, and load history before live_start_day into D1 and R2; cross-check recorded; 10–20 hand-written labels (Task 18).
**Success Criteria**: Spec §2 criteria 1, 3 and 5 hold; after the upload, `lag_seconds` is under 120 and `last_finalize_day` is current.
**Tests**: upload (resume and rebuild re-apply).
**Status**: Complete (2026-10-05 re-valued: +0.15% vs CCIPMetrics; cross-check in docs/methodology.md)

## Stage 5: Label candidates
**Goal**: Weekly label-candidate PR (Task 19), built only after Stages 1–4 pass.
**Success Criteria**: A manual workflow run opens or updates one PR with drafts set to verified = false.
**Tests**: label-candidates.
**Status**: Complete (first manual run opened PR #1 with 48 drafts, all verified = false)

## Stage 6: Reserve cost basis and LINK metrics
**Goal**: Price every LINK transfer into and out of the Chainlink Reserve at its block time. Publish cost basis vs value now, pace, weekly deposits, performance and transfers in `reserve.json`, alert on outflows, and add the daily share of CCIP fees paid in LINK (plan `docs/superpowers/plans/2026-10-06-reserve-and-link-metrics.md`).
**Success Criteria**: Spec `2026-10-06-reserve-and-link-metrics-design.md` §1 criteria 1–6 hold. After the backfill, `reserve.json` `cost_basis` is non-null and no `reserve-mismatch` alert has fired.
**Tests**: reserve (RPC reads), prices (historicalAt), reserve-stats, reserve-job, hourly, publish, finalize, rollup (linkFeeUsd).
**Status**: Complete (2026-10-07 01:01Z: scan caught up at block 26,137,072 with no failures; cost basis $67.98M at an average $11.10 over 61 deposits, 0 unpriced; LINK in − out equals the on-chain balance; no reserve-mismatch alert)

## Stage 7: Endpoint maps from chainlist
**Goal**: Commit `config/endpoints.json` (RPC, Blockscout explorer and Ethereum log endpoints per CCIP chain, built from chainlist.org data). Add `pnpm endpoints:refresh`, which keeps working entries and fills new chains or dead ones. A daily `endpoints.yml` workflow opens one PR when the map changes. The label-candidates job and the Worker's Reserve log fallbacks read the file.
**Success Criteria**: A new CCIP chain gets a PR within a day. The label-candidates job runs without the RPC_MAP/EXPLORER_MAP settings. The Reserve uses the file's Ethereum log endpoints after the trusted ones.
**Tests**: endpoint selection rules (keyless, no tracking, chain-id match, keep working entries), file output, label-candidates reading the file.
**Status**: Complete (first run opened PR #2, replacing xrpc.cl with publicnode for Ethereum because xrpc.cl fails from GitHub runners)

## Stage 8: Website (sub-project 2a)
**Goal**: Ship ccip.dev: an Astro static site with the live Constellation, history, top lists, flow, day, record and Reserve pages, a recordable time-lapse, and live share cards rendered by a small Worker (spec `docs/superpowers/specs/2026-10-06-website-design.md`).
**Success Criteria**: Spec §2 criteria 1–7: every launch page is live on ccip.dev (www redirects), comets within 60 s of live.json, a 1200×630 card for every page, a 60 s replay that records an MP4 X accepts, JS and Lighthouse budgets, build-time numbers when data is down, and no new paid services.
**Tests**: core public schemas and replay.json; site libraries (format, data, poller, names, records, charts, layout, scene, instances, scheduler, sound, timeline, recorder, flow, day, reserve view); card content and request handling; a real render in workerd; check-build and budgets in every build.
**Status**: Complete — deployed to ccip.dev on 2026-10-07 (first deploy by wrangler, then CI). Live QA: Lighthouse mobile a11y, best practices and SEO all 100 on 8 pages; no 390 px overflow on 15 page types; six cards verified. Teaser color fix shipped. Owner follow-ups outside the code: www redirect rule, Umami website ID, X upload test of a recorded MP4.

## Stage 9: Chain icons
**Goal**: Each CCIP chain's logo on ccip.dev: logo coins for the busiest chains on every sky (home with a hover/tap card, replay and its MP4s, day pages, share cards), and icons beside chain names in lists (spec `docs/superpowers/specs/2026-10-07-chain-icons-design.md`, plan `docs/superpowers/plans/2026-10-07-chain-icons.md`).
**Success Criteria**: Spec §2 criteria 1–7: 12 coins on wide skies and 8 on narrow ones, by 30-day USD; deterministic replay coins in recordings; coins on static skies and cards; list icons; no fetches from docs.chain.link at build or view time; budgets held; quiet failure.
**Tests**: matcher, cleaner, rasterizer, lettermark; lookup and coin math; skySvg and card coins; card coin validation plus a real workerd render pixel check; overlay, card placement and avoid boxes; replay coin window (fade, 30-day eviction, agreement with star sizes, end-card settle); list helpers; check-build icon files.
**Status**: Complete — 7 tasks plus the final review fix wave (tests: core 189, site 350 + 4 workerd, worker 159, scripts 149; JS 112.6 KB of 150 home, 112.4 of 200 replay; a11y 100 on home and flow). 94 of 95 chains have docs icons (4 rasterized to PNG); Sui uses a lettermark.

## Stage 10: Viral replay (Plan A)
**Goal**: A shareable, directed replay: the director (time warp, beats, camera, leaderboard race, story counters) in `Show`; a story layer (titles, odometer counter, cards, milestone slams, leaderboard, watermark); the Direction A controls kit site-wide and player (chain picker, length 15/30/60 s, shape, scrubber with milestone marks, recording pill); and a page and share card for every chain (spec `docs/superpowers/specs/2026-10-07-viral-replay-design.md`, plan `docs/superpowers/plans/2026-10-07-viral-replay-a.md`). Plans B (cinema renderer) and C (soundtrack) build on `Show`.
**Success Criteria**: A 30 s default cut that loops seamlessly; cards and slams never collide with the counter, board or timeline; a per-chain cut at `/replay/<slug>/` with its own head and card; controls meet the ARIA patterns; budgets hold.
**Tests**: warp, phases, beats, camera, leaderboard, story, show; story layout, odometer and draw; compositor, recorder and camera projector; controls helpers; chain slugs and replay head; card paths, chain card content and a workerd badge render.
**Status**: In progress: all 10 tasks are implemented and task-reviewed; the final review, recordings and QA remain.
