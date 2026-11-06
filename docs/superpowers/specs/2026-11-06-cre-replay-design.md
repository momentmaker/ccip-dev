# ccip.dev: CRE-sent messages in the replay

**Status:** Approved design · **Date:** 2026-11-06

CCIP messages sent by Chainlink CRE workflows are tagged (`messages.cre`, spec 2026-11-05-cre-sent-messages-design.md). The live home sky flies them as teal (`#40E0C4`) comets (PR #47). This spec brings them into the replay: the per-day sky that plays CCIP's history, the month page and the monthly video built from it, and the sky drawn on the daily and weekly post images.

The owner approved on 2026-11-06:
- **How CRE appears in replay:** a teal sample of comets, like the live sky.
- **How many:** every lane-day that carried CRE traffic gets its own sample of teal comets, on top of the usual ones. CRE is about 0.6% of messages, and replay samples only about 50 comets a day, so a share proportional to volume would come to about 0.3 teal comets a day. CRE is therefore deliberately over-represented, and the legend says what teal means.
- **Data:** approach A, a new `cre_lane` breakdown dimension. Scanning `messages` on every publish (about 1.6M reads per finalize) and a separate table were both rejected.

## 1. Data layer

**Rollup.**
- `rollupDay` adds `addMessageGroups('cre_lane', (r) => (r.cre === 1 ? `${r.src_chain}>${r.dst_chain}` : null))`, with the same key format as `lane`.
- `'cre_lane'` joins the `Dim` union and `BREAKDOWN_DIMS`, so `rollMonth` and the all-time readers cover it.
- The finalize path adds no reads, because the rollup already iterates the day's rows.

**Re-tag.**
- `store.retagCreDay` also rebuilds the day's `cre_lane` rows in the same atomic batch: `DELETE FROM daily_breakdown WHERE day = ?1 AND dim = 'cre_lane'`, then `CRE_LANE_DAY_SQL`.
- `CRE_LANE_DAY_SQL` sits next to `CRE_BREAKDOWN_DAY_SQL` in `packages/core/src/cre.ts`:

  ```sql
  INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
  SELECT day, 'cre_lane', src_chain || '>' || dst_chain, COUNT(*), SUM(usd_value), SUM(fee_usd)
  FROM messages
  WHERE day = ?1 AND cre = 1 AND EXISTS (SELECT 1 FROM daily_totals d WHERE d.day = ?1)
  GROUP BY src_chain, dst_chain
  ```

  It ends with `BREAKDOWN_CONFLICT`, like the `cre` SQL.
- The conditional unroll still keys off the day's `cre` rows. A day has `cre_lane` rows only when it has `cre` rows, so it is unchanged.
- The rollup and the re-tag must produce identical `cre_lane` rows for a day. A test pins this, as the existing finalize-equals-retag test does for `cre`.

**Re-tag schema version.**
- `worker/src/cre-retag.ts` adds `CRE_RETAG_SCHEMA = 2` and a meta key `cre_retag_schema`.
- **Full pass:**
  - Triggered when the stored schema is missing or differs from `CRE_RETAG_SCHEMA`, even if `cre_keys_version` already matches.
  - The pass runs from `CRE_FIRST_DAY` to today, as on the first ever pass.
  - When it completes, `retagCre` stores both `cre_keys_version` and `cre_retag_schema`.
- **Pass version:** `cre_retag` carries the combined version `<keysVersion>#<schema>`. A pass started under an older schema or key set therefore restarts, exactly as a key change restarts one today.
- **A key change alone** still re-tags only the last 30 days.
- **Existing gates:** the finalize-hour guard, the per-day progress inside the batch and the malformed-pass recovery keep their behaviour.
- **Cost:** one extra scan of each day's messages, about 1.6M more reads over a full pass. The schema-2 pass totals about 4.5M reads once, over roughly 15 hours of hourly runs.

**Read.**
- `store.creLaneHistory(db)` runs `SELECT day, key, messages, usd_value FROM daily_breakdown WHERE dim = 'cre_lane' ORDER BY day, key`.
- It must use the `daily_breakdown_dim (dim, day)` index; an `EXPLAIN QUERY PLAN` test pins this.
- It returns a few thousand rows at most.

No migration: `daily_breakdown` already accepts any dim.

## 2. `replay.json`

- **New optional field:** `cre: { day: string; lanes: [laneIdx: number, messages: number, usd: number][] }[]`, built from `creLaneHistory`.
  - Only days with CRE traffic are listed, sorted by day, with lanes sorted by `laneIdx`.
  - `laneIdx` indexes the existing `lanes` array.
  - `usd` is rounded as in `days`.
  - A `cre_lane` key with no matching lane in `lanes` is skipped. That cannot happen, since every CRE message also has a `lane` row, but the builder must not throw on it.
- **Schema:** `ReplayFileSchema` gains `cre: z.array(z.object({ day: z.string(), lanes: z.array(z.tuple([z.number(), z.number(), z.number()])) })).optional()`.
  - Zod object schemas strip unknown keys. So already-deployed site code, including the replay page that `safeParse`s the file at runtime, keeps working before the site redeploys.
- **Builder:** `buildReplay` (`packages/core/src/replay.ts`) takes the CRE rows as an optional extra argument and emits `cre` only when there are rows. Publish passes `await store.creLaneHistory(db)` in the existing replay step.
- **Size:** about 5 lane-days a day since Aug 2026, a few KB against the file's 1.1 MB.

## 3. Player

In `site/src/replay/timeline.ts`:
- `Spawn` gains `cre?: boolean`.
- A new pure `creSpawns(creLanes, dayIndex): Spawn[]`:
  - For each CRE lane-day it emits `cometCount(messages)` spawns with `cre: true` and `usd = usd / messages`.
  - Offsets come from a seeded RNG distinct from `daySpawns`, for example `mulberry32(dayIndex * 104729 + 1)`, so normal spawns and offsets are unchanged.
  - Results are sorted by offset.
- The timeline merges the day's `daySpawns` and `creSpawns` before `keptSpawns`, so warp thinning applies to both at the same rate.
- The comet kind becomes `cometKind(spawn.usd, spawn.usd > 0 ? 'token' : null, spawn.cre === true)`: teal for CRE, and gold still wins at $1M or more.
- The timeline indexes `replay.cre` by day once, beside `lanesByDay`.
- Without a `cre` field (old file or before the backfill), the player behaves exactly as today: same spawns, same offsets.
- `site/src/replay/cinema/` colours by `kindColor`. So the month page (`/replay/month/`) and the monthly video it records get teal comets with no other change. Verify there is no exhaustive switch on kind there.

## 4. Legend

The replay pages (`site/src/components/ReplayPage.astro` and the player HUD) show a small static key: a teal dot, then "sent by a Chainlink CRE workflow", linking `/methodology/#cre-sent-messages`.
- Rendered only when the build-time `replay.json` has a non-empty `cre`.
- Styled like the existing replay HUD and labels, using the `--cre` token.
- No JS beyond what the page has. Keep `replay/index.html` under its 200 KB gzipped budget.

## 5. Post-image sky

The daily and weekly X/Telegram images draw a sky from `replay.json` (`skyFor(replay, names, from, to)` → `skyNodes` in `site/worker/cards/`).
- Lanes that carried CRE traffic in the card's period are drawn in the CRE colour instead of the default lane colour.
- Same file, no extra fetch.
- With no `cre` data for the period, the card tree is identical to today's.

## 6. Docs

- **`docs/methodology.md`, CRE section:** a bullet saying replay shows CRE-sent messages as their own teal sample per lane-day, over-represented on purpose so they are visible, not to scale.
- **`docs/runbook.md`, CRE section:**
  - what `CRE_RETAG_SCHEMA` / `cre_retag_schema` do
  - that bumping the schema forces a full pass (about 4.5M reads)
  - how to check progress

## 7. Testing

- **core:**
  - `rollupDay` writes `cre_lane` rows keyed `src>dst` for CRE messages only.
  - `buildReplay` emits `cre`, skips unknown lanes, and omits the field without rows.
  - `ReplayFileSchema` parses files with and without `cre`.
- **worker:**
  - `retagCreDay` rebuilds `cre_lane` rows equal to the rollup's for a day.
  - A schema bump with `cre_keys_version` already set starts a full pass from `CRE_FIRST_DAY` and records both meta values when it finishes.
  - A key change alone still covers 30 days.
  - EXPLAIN for `creLaneHistory` and `CRE_LANE_DAY_SQL`.
  - The replay publish includes `cre`.
- **site:**
  - `creSpawns` is deterministic, sized by `cometCount`, and its offsets don't disturb `daySpawns`.
  - The timeline yields teal ('cre') comets on CRE lane-days, gold for $1M+ CRE.
  - No `cre` gives identical spawns to today.
  - The legend hides without CRE data.
  - Card sky lane colours: CRE lanes teal; a no-CRE tree identical to today's.

## Rollout

Ships after #46 and #47. On deploy the schema bump starts a full re-tag pass. Teal appears in replay newest-first as the pass works back through history, and completes in about 15 hours. Watch `rows_read` in the hourly logs.

## Not in this version

- A "CRE only" replay filter.
- Per-sender CRE in replay.
- Teal in the flow pages or the home sky's lane weights.
