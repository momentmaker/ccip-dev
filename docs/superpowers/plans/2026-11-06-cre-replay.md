# CRE in the Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fly CCIP messages sent by CRE workflows as teal comets in the replay (and the month page and video built on it), with a legend, and draw CRE lanes teal on the daily/weekly post-image sky.

**Architecture:**
- A new `cre_lane` breakdown dimension (key `src>dst`) is written by the rollup and the re-tag.
- A re-tag schema version forces one full backfill pass.
- `replay.json` gains an optional `cre` field (`[laneIdx, messages, usd]` per day).
- The player adds a separately seeded teal sample per CRE lane-day, and the card sky opts in to teal lanes.

**Tech Stack:** TypeScript, Cloudflare Workers + D1, vitest (`@cloudflare/vitest-plugin` in worker/), Astro + React site, zod schemas.

**Spec:** `docs/superpowers/specs/2026-11-06-cre-replay-design.md`

## Global Constraints

- **CRE colour** `#40E0C4` (site token `--cre`, sky `COLORS.cre`); comet kind `'cre'`; gold ($1M+) beats CRE.
- **Dim name** `'cre_lane'`, key `${src_chain}>${dst_chain}`, the same format as `'lane'`.
- **Re-tag schema:** `CRE_RETAG_SCHEMA = 2`, meta key `cre_retag_schema`. The pass version stored in `cre_retag` is `${keysVersion}#${CRE_RETAG_SCHEMA}`.
- **When it runs:**
  - Full pass (from `CRE_FIRST_DAY`) when the stored schema ≠ current, or when no keys version is done.
  - Only the last 30 days on a key change alone.
- **`replay.json`:**
  - `cre` is optional, lists only days with CRE, is sorted by day then `laneIdx`, has `usd` rounded, and skips unknown lanes.
  - Old parsers must keep working (zod strips unknown keys).
- **Replay player:**
  - `creSpawns` uses seed `mulberry32(dayIndex * 104729 + 1)`.
  - Thinning uses one keep ratio over normal + CRE spawns. Normal spawns keep their existing seeds (`dayIndex * 7919 + k`); CRE spawns use `dayIndex * 7919 + 500_009 + k`.
  - With no `cre` data, spawns are identical to today.
- **Budgets:** `replay/index.html` ≤ 200 KB gzipped JS, `index.html` ≤ 150 KB.
- **Repo rules:**
  - No migrations and no backfills in migrations; the re-tag does the backfill.
  - Tests use `// #given` / `// #when` / `// #then`.
  - Explicit-path staging only (never `git add -A` / `.` / `commit -a`).
  - Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Branch:** `feat/cre-replay` in worktree `/Users/rubberduck/GitHub/momentmaker/ccip-dev/.worktrees/cre-tagging`. Do not push until the final task.

## Review Focus

1. **Already-deployed site code parsing a new `replay.json` with `cre`.** It must still parse. Pinned in Task 1: `ReplayFileSchema.omit({ cre: true })` parses a file with `cre`.
2. **The production pass in progress, stored under the old version format** (`{"version":"335-…","next":…}` with no `#`). It must restart as a full pass under `<keys>#2`. Pinned in Task 2.
3. **A replay day with no CRE (or an old file).** Spawns, offsets and the kept set must be identical to today's. Pinned in Task 3.
4. **A CRE lane-day with $1M+ average value.** Its comets are gold, not teal. Pinned in Task 3.
5. **A `cre_lane` key whose lane isn't in `lanes`.** It is skipped, and the build never throws. Pinned in Task 1.

## File map

| File | Change |
|---|---|
| `packages/core/src/types.ts` | `Dim` adds `'cre_lane'` |
| `packages/core/src/rollup.ts` | the `cre_lane` group |
| `packages/core/src/cre.ts` | `CRE_LANE_DAY_SQL` |
| `packages/core/src/replay.ts` | `Replay.cre`, `buildReplay(rows, names, creRows = [])` |
| `packages/core/src/public.ts` | `ReplayFileSchema.cre` optional |
| `worker/src/store.ts` | `BREAKDOWN_DIMS`, `retagCreDay` rebuilds `cre_lane`, `creLaneHistory` |
| `worker/src/cre-retag.ts` | `CRE_RETAG_SCHEMA`, full pass on a schema change |
| `worker/src/publish.ts` | the replay step passes `creLaneHistory` |
| `site/src/replay/timeline.ts` | `Spawn.cre`, `creSpawns`, `keepRatio`/`keepWith`, model merge, kind |
| `site/src/lib/cre.ts` | `hasCreReplay` |
| `site/src/components/ReplayPage.astro` | the legend |
| `site/src/sky/weights.ts` | `creLaneKeys` |
| `site/worker/cards/orbit-sky.ts` | `OrbitLane.cre`, teal gradient |
| `site/worker/cards/broadcast-frame.ts` | `skyFor(…, opts)` |
| `site/worker/cards/broadcast-cards.ts` | daily and weekly opt in |
| `docs/methodology.md`, `docs/runbook.md` | docs |

---

### Task 1: Core — `cre_lane` dim, its re-tag SQL, and `replay.json`'s `cre` field

**Files:**
- Modify: `packages/core/src/types.ts`, `packages/core/src/rollup.ts`, `packages/core/src/cre.ts`, `packages/core/src/replay.ts`, `packages/core/src/public.ts`
- Test: `packages/core/test/rollup.test.ts`, `packages/core/test/cre.test.ts`, `packages/core/test/replay.test.ts`, `packages/core/test/public.test.ts` (or whichever file tests `PUBLIC_SCHEMAS`/`ReplayFileSchema`; find it with `grep -rln ReplayFileSchema packages/core/test`)

**Interfaces:**
- Produces:
  - `Dim` includes `'cre_lane'`
  - `CRE_LANE_DAY_SQL: string` (`?1` = day)
  - `Replay.cre?: { day: string; lanes: [number, number, number][] }[]`
  - `buildReplay(rows: LaneDayRow[], names: Map<string, ChainNames>, creRows: readonly LaneDayRow[] = []): Replay`
  - `ReplayFileSchema` with optional `cre`

- [ ] **Step 1: Write the failing tests**

In `packages/core/test/rollup.test.ts`, beside the existing "counts CRE-sent messages…" test, use that test's own `row(id, overrides)` helper and the same 4th `rollupDay` argument it passes:

```ts
it('groups CRE-sent messages by lane under the cre_lane dimension', () => {
  // #given two CRE-sent messages on one lane, one on another, and an ordinary one
  const day = '2026-11-04';
  const rows = [
    row('a', { day, src_chain: '1', dst_chain: '2', cre: 1, usd_value: 10, fee_usd: 1 }),
    row('b', { day, src_chain: '1', dst_chain: '2', cre: 1, usd_value: 5, fee_usd: null }),
    row('c', { day, src_chain: '1', dst_chain: '3', cre: 1, usd_value: 0, fee_usd: null }),
    row('d', { day, src_chain: '1', dst_chain: '2', cre: 0, usd_value: 7, fee_usd: 2 }),
  ];
  // #when
  const { breakdown } = rollupDay(day, rows, [], NO_TOKEN_GROUPS);
  // #then
  expect(breakdown.filter((b) => b.dim === 'cre_lane')).toEqual([
    { day, dim: 'cre_lane', key: '1>2', messages: 2, usd_value: 15, fee_usd: 1 },
    { day, dim: 'cre_lane', key: '1>3', messages: 1, usd_value: 0, fee_usd: null },
  ]);
});
```

If `row` names its first parameter differently or `NO_TOKEN_GROUPS` is imported under another name, match the file.

In `packages/core/test/cre.test.ts`:

```ts
describe('CRE_LANE_DAY_SQL', () => {
  it('rebuilds a rolled-up day’s CRE lanes keyed src>dst', () => {
    expect(CRE_LANE_DAY_SQL).toContain("'cre_lane', src_chain || '>' || dst_chain");
    expect(CRE_LANE_DAY_SQL).toMatch(/WHERE day = \?1 AND cre = 1 AND EXISTS \(SELECT 1 FROM daily_totals d WHERE d\.day = \?1\)/);
    expect(CRE_LANE_DAY_SQL).toContain('GROUP BY src_chain, dst_chain');
  });
});
```

In `packages/core/test/replay.test.ts`:

```ts
describe('buildReplay with CRE lanes', () => {
  const names = new Map();
  const rows = [
    { day: '2026-11-01', key: 'a>b', messages: 10, usd_value: 100.4 },
    { day: '2026-11-01', key: 'a>c', messages: 4, usd_value: 0 },
    { day: '2026-11-02', key: 'a>b', messages: 6, usd_value: 50 },
  ];

  it('lists CRE lane-days by lane index, sorted, rounded', () => {
    // #when
    const r = buildReplay(rows, names, [
      { day: '2026-11-02', key: 'a>b', messages: 2, usd_value: 9.6 },
      { day: '2026-11-01', key: 'a>c', messages: 1, usd_value: 0 },
      { day: '2026-11-01', key: 'a>b', messages: 3, usd_value: 30.2 },
    ]);
    // #then lane 0 is a>b, lane 1 is a>c
    expect(r.cre).toEqual([
      { day: '2026-11-01', lanes: [[0, 3, 30], [1, 1, 0]] },
      { day: '2026-11-02', lanes: [[0, 2, 10]] },
    ]);
  });

  it('skips a CRE lane that has no lane row and never throws', () => {
    expect(buildReplay(rows, names, [{ day: '2026-11-01', key: 'x>y', messages: 1, usd_value: 0 }]).cre).toBeUndefined();
  });

  it('omits cre without CRE rows, so the file is as before', () => {
    expect('cre' in buildReplay(rows, names)).toBe(false);
  });
});
```

In the schema test file:

```ts
it('parses replay.json with and without cre, and old parsers ignore cre', () => {
  // #given
  const base = { schema_version: 1, updated_at: '2026-11-06T00:00:00Z', attribution: 'x', since: '2026-11-01', chains: [], lanes: [[0, 1]], days: [] };
  const withCre = { ...base, cre: [{ day: '2026-11-01', lanes: [[0, 3, 30]] }] };
  // #then
  expect(ReplayFileSchema.safeParse(base).success).toBe(true);
  expect(ReplayFileSchema.safeParse(withCre).success).toBe(true);
  expect(ReplayFileSchema.omit({ cre: true }).safeParse(withCre).success).toBe(true);
});
```

Match `base`'s envelope fields (`schema_version`, `updated_at`, `attribution`) to the `envelope` object in public.ts. Copy the replay fixture the file already uses, if it has one.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm -C packages/core exec vitest run test/rollup.test.ts test/cre.test.ts test/replay.test.ts`, plus the schema test file.
Expected: FAIL. `CRE_LANE_DAY_SQL` is not exported, there are no `cre_lane` rows, `r.cre` is undefined, and `.omit({ cre: true })` errors.

- [ ] **Step 3: Implement**

- **`types.ts`:**

  ```ts
  export type Dim = 'src_chain' | 'dst_chain' | 'lane' | 'token' | 'sender' | 'via_token' | 'cre' | 'cre_lane';
  ```

- **`rollup.ts`:** after `addMessageGroups('cre', …)`, add:

  ```ts
  addMessageGroups('cre_lane', (r) => (r.cre === 1 ? `${r.src_chain}>${r.dst_chain}` : null));
  ```

- **`cre.ts`:** after `CRE_BREAKDOWN_DAY_SQL`, add:

  ```ts
  /** One rolled-up day's cre_lane rows (?1 = day), as rollupDay writes them; a day not rolled up yet gets none. */
  export const CRE_LANE_DAY_SQL = `INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd)
  SELECT day, 'cre_lane', src_chain || '>' || dst_chain, COUNT(*), SUM(usd_value), SUM(fee_usd)
  FROM messages
  WHERE day = ?1 AND cre = 1 AND EXISTS (SELECT 1 FROM daily_totals d WHERE d.day = ?1)
  GROUP BY src_chain, dst_chain
  ${BREAKDOWN_CONFLICT}`;
  ```

- **`replay.ts`:**
  - In `Replay`, add `cre?: { day: string; lanes: [number, number, number][] }[];`.
  - Change the signature to `export function buildReplay(rows: LaneDayRow[], names: Map<string, ChainNames>, creRows: readonly LaneDayRow[] = []): Replay`.
  - Replace the final `return` with:

  ```ts
  const cre: NonNullable<Replay['cre']> = [];
  for (const r of [...creRows].sort((a, b) => compare(a.day, b.day) || compare(a.key, b.key))) {
    const lane = laneIndex.get(r.key);
    if (lane === undefined) continue;
    if (cre.at(-1)?.day !== r.day) cre.push({ day: r.day, lanes: [] });
    cre.at(-1)!.lanes.push([lane, r.messages, Math.round(r.usd_value)]);
  }
  for (const d of cre) d.lanes.sort((a, b) => a[0] - b[0]);
  return cre.length > 0 ? { chains, lanes, days, cre } : { chains, lanes, days };
  ```

- **`public.ts`:** in `ReplayFileSchema`, after `days`, add:

  ```ts
  /** Days with CRE-sent messages: [lane index, messages, usd] per lane. Absent before CRE tagging. */
  cre: z.array(z.object({ day: z.string(), lanes: z.array(z.tuple([z.number(), z.number(), z.number()])) })).optional(),
  ```

- [ ] **Step 4: Run the tests and watch them pass**

Run: the same command as Step 2, then `pnpm -C packages/core test && pnpm typecheck`.
Expected: PASS.

`pnpm typecheck` may flag `Record<Dim, …>` maps elsewhere. If it does, give `cre_lane` the same treatment `cre` got and list the files in your report.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/rollup.ts packages/core/src/cre.ts packages/core/src/replay.ts packages/core/src/public.ts packages/core/test/rollup.test.ts packages/core/test/cre.test.ts packages/core/test/replay.test.ts <schema test file>
git commit -m "Core: a cre_lane breakdown, its re-tag SQL, and CRE lanes in replay.json

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Worker — re-tag rebuilds `cre_lane`, schema-forced full pass, publish

**Files:**
- Modify: `worker/src/store.ts`, `worker/src/cre-retag.ts`, `worker/src/publish.ts`, `docs/runbook.md`
- Test: `worker/test/cre-retag.test.ts`, `worker/test/store.test.ts`, `worker/test/publish.test.ts`

**Interfaces:**
- Consumes: `CRE_LANE_DAY_SQL`, `buildReplay(rows, names, creRows)` (Task 1).
- Produces:
  - `store.creLaneHistory(db: D1Database): Promise<LaneDayRow[]>`
  - `CRE_RETAG_SCHEMA = 2`
  - meta `cre_retag_schema`
  - pass version format `${keys}#${schema}`
  - `replay.json` with `cre`

- [ ] **Step 1: Write the failing tests**

In `worker/test/cre-retag.test.ts`:

- **Update the existing expectations:** the `cre_retag` pass objects `{ version: 'v1', … }` / `'v2'` become `{ version: 'v1#2', … }` / `'v2#2'`.
- **"Already done" setup:** a test that marks a version done with `setMeta('cre_keys_version', 'v1')` must now also set `cre_retag_schema` to `'2'`. Otherwise it is a schema-forced full pass.
- **Re-tag-only-30-days test:** set `cre_retag_schema` to `'2'` before running.
- **Add these tests**, using the file's existing `seed`, `harness`, `keys`, `meta` and `NOW` helpers:

```ts
it('runs a full pass when the re-tag schema changed, even with the key version done', async () => {
  // #given v1 done under schema 1, and a day 40 days back
  await store.setMeta(env.DB, 'cre_keys_version', 'v1');
  await store.setMeta(env.DB, 'cre_retag_schema', '1');
  await seed('2026-09-26', true);
  const { c } = harness({ now: NOW, creKeys: keys('v1') });
  // #when the runs walk back until the pass ends
  for (let run = 0; run < 20 && (await meta('cre_retag_schema')) !== '2'; run++) await retagCre(c);
  // #then the old day is re-tagged and both versions are recorded
  expect((await flags()).find((r: any) => r.message_id === '2026-09-26-cre')).toEqual({ message_id: '2026-09-26-cre', cre: 1 });
  expect(await meta('cre_keys_version')).toBe('v1');
  expect(await meta('cre_retag')).toBeNull();
});

it('restarts a pass stored under the old version format as a full pass', async () => {
  // #given production's in-progress first pass, stored before schema versions existed
  await store.setMeta(env.DB, 'cre_retag', JSON.stringify({ version: 'v1', next: '2026-10-07', from: CRE_FIRST_DAY }));
  const { c } = harness({ now: NOW, creKeys: keys('v1') });
  // #when
  await retagCre(c, 3);
  // #then it starts again from today under v1#2 and covers the whole history
  expect(JSON.parse((await meta('cre_retag'))!)).toEqual({ version: 'v1#2', next: '2026-11-02', from: CRE_FIRST_DAY });
});

it('a key change alone still re-tags only the last 30 days', async () => {
  // #given v1 done under the current schema
  await store.setMeta(env.DB, 'cre_keys_version', 'v1');
  await store.setMeta(env.DB, 'cre_retag_schema', '2');
  const { c } = harness({ now: NOW, creKeys: keys('v2') });
  // #when
  await retagCre(c, 1);
  // #then
  expect(JSON.parse((await meta('cre_retag'))!).from).toBe('2026-10-07');
});
```

Also extend the existing finalize-equals-retag test in this file (the one that seeds an all-NULL-fee sender and a mixed-fee sender, runs `rollupDay` + `replaceDaily`, then `retagCreDay`). Next to its `cre` snapshot, take a `cre_lane` snapshot before and after the re-tag, and assert they are equal and non-empty:

```ts
const creLanes = async (day: string) =>
  (await env.DB.prepare("SELECT key, messages, usd_value, fee_usd FROM daily_breakdown WHERE dim = 'cre_lane' AND day = ? ORDER BY key").bind(day).all()).results;
// before retagCreDay:
const lanesBefore = await creLanes(DAY);
// after retagCreDay:
expect(await creLanes(DAY)).toEqual(lanesBefore);
expect(lanesBefore.length).toBeGreaterThan(0);
```

Use the test's own day constant in place of `DAY`.

In `worker/test/store.test.ts`, beside the other EXPLAIN tests:

```ts
it('reads CRE lane history through the dim index', async () => {
  const plan = (await env.DB.prepare(`EXPLAIN QUERY PLAN SELECT day, key, messages, usd_value FROM daily_breakdown WHERE dim = 'cre_lane' ORDER BY day, key`).all()).results;
  expect(JSON.stringify(plan)).toMatch(/USING (COVERING )?INDEX daily_breakdown_dim/);
});

it('returns CRE lane rows in day and key order', async () => {
  // #given
  await store.replaceDaily(env.DB, { day: '2026-11-04', messages: 2, token_messages: 0, usd_value: 0, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 }, [
    { day: '2026-11-04', dim: 'cre_lane', key: '1>3', messages: 1, usd_value: 0, fee_usd: null },
    { day: '2026-11-04', dim: 'cre_lane', key: '1>2', messages: 1, usd_value: 5, fee_usd: null },
  ], '2026-11-05T00:07:00.000Z');
  // #then
  expect((await store.creLaneHistory(env.DB)).map((r) => r.key)).toEqual(['1>2', '1>3']);
});
```

Also add an EXPLAIN test for `CRE_LANE_DAY_SQL` asserting `USING INDEX messages_day`, mirroring the existing `CRE_BREAKDOWN_DAY_SQL` one.

In `worker/test/publish.test.ts`, in the existing replay or finalize-publish test that seeds CRE messages (the CRE describe block), assert:

```ts
const replay = await readPublic('replay.json');
expect(replay.cre).toEqual([{ day: <the seeded day>, lanes: [[expect.any(Number), 1, 9]] }]);
```

Adapt it to the seeded counts.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm -C worker exec vitest run test/cre-retag.test.ts test/store.test.ts test/publish.test.ts`
Expected: FAIL. Old version strings, no schema logic, no `creLaneHistory`, no `replay.cre`.

- [ ] **Step 3: Implement**

`worker/src/store.ts`:
- Add `'cre_lane'` to `BREAKDOWN_DIMS`.
- Import `CRE_LANE_DAY_SQL`.
- In `retagCreDay`, insert two statements after `db.prepare(CRE_BREAKDOWN_DAY_SQL).bind(day),`:

  ```ts
  db.prepare("DELETE FROM daily_breakdown WHERE day = ?1 AND dim = 'cre_lane'").bind(day),
  db.prepare(CRE_LANE_DAY_SQL).bind(day),
  ```

- Update its doc comment to mention cre_lane.
- After `laneHistory`, add:

  ```ts
  export async function creLaneHistory(db: D1Database): Promise<LaneDayRow[]> {
    const { results } = await db
      .prepare("SELECT day, key, messages, usd_value FROM daily_breakdown WHERE dim = 'cre_lane' ORDER BY day, key")
      .all<LaneDayRow>();
    return results;
  }
  ```

`worker/src/cre-retag.ts`:
- Add:

  ```ts
  /** Bump when the re-tag starts writing something new for every day, so one full pass backfills it. */
  export const CRE_RETAG_SCHEMA = 2;
  const SCHEMA_KEY = 'cre_retag_schema';
  ```

- Replace the body after the guard line with:

  ```ts
  const db = c.env.DB;
  const schema = String(CRE_RETAG_SCHEMA);
  const done = await store.getMeta(db, VERSION_KEY);
  const doneSchema = await store.getMeta(db, SCHEMA_KEY);
  if (done === version && doneSchema === schema) return;
  const passVersion = `${version}#${schema}`;
  const today = dayOf(c.deps.now());
  const full = done === null || doneSchema !== schema;
  const stored = parsePass(await store.getMeta(db, PASS_KEY));
  const pass: RetagPass =
    stored?.version === passVersion ? stored : { version: passVersion, next: today, from: full ? CRE_FIRST_DAY : addDays(today, -(CRE_RETAG_DAYS - 1)) };
  const retagSql = creRetagDaySql(c.creKeys);
  let day = pass.next;
  for (let n = 0; n < maxDays && day >= pass.from; n++, day = addDays(day, -1)) {
    await store.retagCreDay(db, day, retagSql, PASS_KEY, JSON.stringify({ ...pass, next: addDays(day, -1) }));
  }
  if (day < pass.from) {
    await store.setMeta(db, VERSION_KEY, version);
    await store.setMeta(db, SCHEMA_KEY, schema);
    await store.setMeta(db, PASS_KEY, null);
  }
  ```

- Update the function's doc comment to say a schema change also runs the full history.

`worker/src/publish.ts` (replay step, about line 690): pass `await store.creLaneHistory(db)` as the third argument to `buildReplay`.

`docs/runbook.md`, CRE section, add:

```markdown
- **Schema:** `CRE_RETAG_SCHEMA` (worker/src/cre-retag.ts) and `meta.cre_retag_schema`. Bumping it makes the next hourly runs re-tag the whole history from 2025-10-17 (about 4.5M reads over ~15 h), so new per-day CRE rows (schema 2: `cre_lane`) are backfilled. The pass version in `cre_retag` is `<keys version>#<schema>`. Progress: `SELECT key, value FROM meta WHERE key LIKE 'cre_%'`.
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: the Step 2 command, then `pnpm -C worker test && pnpm typecheck`.
Expected: PASS.

A `rollMonth` statement-count or breakdown-snapshot test may need `cre_lane` added. Update it and list it in your report.

- [ ] **Step 5: Commit**

```bash
git add worker/src/store.ts worker/src/cre-retag.ts worker/src/publish.ts docs/runbook.md worker/test/cre-retag.test.ts worker/test/store.test.ts worker/test/publish.test.ts
git commit -m "Re-tag: rebuild CRE lanes per day, a schema version that backfills them, and CRE lanes in replay.json

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Replay player — teal comet sample per CRE lane-day, legend

**Files:**
- Modify: `site/src/replay/timeline.ts`, `site/src/lib/cre.ts`, `site/src/components/ReplayPage.astro`, `docs/methodology.md`
- Test: `site/test/timeline.test.ts`, `site/test/cre.test.ts`

**Interfaces:**
- Consumes: `ReplayFile.cre` (Task 1); `cometKind(usd, token, cre)` and `'cre'` kind (PR #47, already on this branch).
- Produces:
  - `Spawn.cre?: boolean`
  - `creSpawns(lanes: readonly LaneRow[], dayIndex: number): Spawn[]`
  - `keepRatio(count: number, dayLength: number): number`
  - `keepWith(spawns: readonly Spawn[], keep: number, seed: number): Spawn[]`
  - `hasCreReplay(replay: Pick<ReplayFile, 'cre'> | null): boolean`

- [ ] **Step 1: Write the failing tests**

In `site/test/timeline.test.ts` (import `creSpawns`, `daySpawns`, `keptSpawns`, `keepRatio`, `keepWith`, `cometCount`, `ReplayModel`, and reuse the file's existing replay fixture and stars):

```ts
describe('creSpawns', () => {
  it('gives each CRE lane-day its own seeded sample of teal spawns', () => {
    // #when
    const spawns = creSpawns([[0, 3, 30], [1, 15, 0]], 5);
    // #then
    expect(spawns.filter((s) => s.lane === 0)).toHaveLength(cometCount(3));
    expect(spawns.filter((s) => s.lane === 1)).toHaveLength(cometCount(15));
    expect(spawns.every((s) => s.cre === true)).toBe(true);
    expect(spawns.find((s) => s.lane === 0)!.usd).toBe(10);
    expect(creSpawns([[0, 3, 30], [1, 15, 0]], 5)).toEqual(spawns);
    expect(spawns.map((s) => s.offset)).toEqual([...spawns.map((s) => s.offset)].sort((a, b) => a - b));
  });

  it('is empty without CRE lanes', () => {
    expect(creSpawns([], 5)).toEqual([]);
  });
});

describe('keepRatio and keepWith', () => {
  it('reproduce keptSpawns for normal spawns', () => {
    // #given
    const spawns = daySpawns([[0, 5000, 1e6], [1, 3000, 0]], 9);
    // #then
    expect(keepWith(spawns, keepRatio(spawns.length, 0.05), 9 * 7919)).toEqual(keptSpawns(spawns, 9, 0.05));
  });
});
```

Then add `ReplayModel` tests, following how the file already builds a `ReplayModel` and reads a frame's comets at a given time:
- **Unchanged without CRE:** a model built from a fixture **without** `cre`, and one built from the same fixture with `cre: []`, produce identical comet lists at several times.
- **Teal on CRE days:** with `cre: [{ day: <a fixture day>, lanes: [[<a fixture lane>, 4, 0]] }]`, some comet during that day has `kind: 'cre'`.
- **Gold wins:** with `lanes: [[<lane>, 1, 2_000_000]]`, that day's CRE comet has `kind: 'gold'`.

In `site/test/cre.test.ts`:

```ts
describe('hasCreReplay', () => {
  it('is true only when the replay lists CRE days', () => {
    expect(hasCreReplay({ cre: [{ day: '2026-11-01', lanes: [[0, 1, 0]] }] })).toBe(true);
    expect(hasCreReplay({ cre: [] })).toBe(false);
    expect(hasCreReplay({})).toBe(false);
    expect(hasCreReplay(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm -C site exec vitest run test/timeline.test.ts test/cre.test.ts`
Expected: FAIL. The exports don't exist yet.

- [ ] **Step 3: Implement**

`site/src/replay/timeline.ts`:

```ts
export interface Spawn {
  lane: number;
  offset: number;
  usd: number;
  /** A CRE-sent message's comet: its own sample per CRE lane-day, so CRE shows at all (it is under 1% of messages). */
  cre?: boolean;
}

export function creSpawns(lanes: readonly LaneRow[], dayIndex: number): Spawn[] {
  const rng = mulberry32(dayIndex * 104729 + 1);
  const out: Spawn[] = [];
  for (const [lane, messages, usd] of lanes) {
    for (let k = 0; k < cometCount(messages); k++) out.push({ lane, offset: rng(), usd: messages > 0 ? usd / messages : 0, cre: true });
  }
  return out.sort((a, b) => a.offset - b.offset);
}

export function keepRatio(count: number, dayLength: number): number {
  return count === 0 ? 1 : Math.min(1, (COMET_FILL * MAX_REPLAY_COMETS * dayLength) / (count * REPLAY_COMET_S));
}

export function keepWith(spawns: readonly Spawn[], keep: number, seed: number): Spawn[] {
  return spawns.filter((_, k) => mulberry32(seed + k)() < keep);
}

export function keptSpawns(spawns: readonly Spawn[], dayIndex: number, dayLength: number): Spawn[] {
  return keepWith(spawns, keepRatio(spawns.length, dayLength), dayIndex * 7919);
}
```

The new `keptSpawns` replaces the existing one with identical behaviour. `count === 0` returns 1 to avoid a 0/0; an empty list filters to empty either way.

In `ReplayModel`:
- Add a field `private readonly creByDay: Map<string, readonly LaneRow[]>;`.
- In the constructor, after `lanesByDay`: `this.creByDay = new Map((replay.cre ?? []).map((d) => [d.day, d.lanes]));`.
- Replace `spawns`:

  ```ts
  private spawns(i: number, lanes: readonly LaneRow[]): Spawn[] {
    let cached = this.spawnCache.get(i);
    if (!cached) {
      const normal = daySpawns(lanes, i);
      const cre = creSpawns(this.creByDay.get(this.days[i]!) ?? [], i);
      const keep = keepRatio(normal.length + cre.length, this.warp.dayLength(i));
      cached = [...keepWith(normal, keep, i * 7919), ...keepWith(cre, keep, i * 7919 + 500_009)];
      this.spawnCache.set(i, cached);
    }
    return cached;
  }
  ```

- In the comet loop, change the kind line to `const kind = cometKind(spawn.usd, spawn.usd > 0 ? 'token' : null, spawn.cre === true);`.

`site/src/lib/cre.ts`:

```ts
import type { ReplayFile } from '@ccip-dev/core/public';

export const hasCreReplay = (replay: Pick<ReplayFile, 'cre'> | null): boolean => (replay?.cre?.length ?? 0) > 0;
```

Merge the import with any existing `@ccip-dev/core/public` import in the file.

`site/src/components/ReplayPage.astro`:
- Import `hasCreReplay`.
- Inside `.page-head > div`, after the lead `<p>`, add:

  ```astro
  {hasCreReplay(replay) && (
    <p class="replay-legend muted"><span class="cre-dot" aria-hidden="true"></span>Teal comets: sent by a Chainlink CRE workflow, shown larger than their share · <a href="/methodology/#cre-sent-messages">how we count</a></p>
  )}
  ```

- In its `<style>`, add:

  ```css
  .replay-legend { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 13px; }
  .cre-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--cre); }
  ```

`docs/methodology.md`, CRE-sent messages section, add a bullet:

```markdown
- **In the replay**, each lane-day that carried CRE-sent messages gets its own small sample of teal comets on top of the usual ones. CRE is under 1% of messages, so a share to scale would almost never show; the teal comets mark where and when CRE workflows sent CCIP, not how much.
```

Check `site/src/replay/cinema/` for any exhaustive handling of `CometKind` that would need `'cre'`. The earlier review found none, but run `pnpm typecheck` to confirm.

- [ ] **Step 4: Run the tests and watch them pass**

Run: the Step 2 command, then `pnpm -C site test && pnpm typecheck && pnpm -C site build`.
Expected: PASS. `check-budgets` keeps `replay/index.html` ≤ 200 KB and `index.html` ≤ 150 KB; report both numbers.

- [ ] **Step 5: Commit**

```bash
git add site/src/replay/timeline.ts site/src/lib/cre.ts site/src/components/ReplayPage.astro docs/methodology.md site/test/timeline.test.ts site/test/cre.test.ts
git commit -m "Replay: CRE lane-days fly their own teal comets, with a legend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Post-image sky — CRE lanes in teal on daily and weekly cards

**Files:**
- Modify: `site/src/sky/weights.ts`, `site/worker/cards/orbit-sky.ts`, `site/worker/cards/broadcast-frame.ts`, `site/worker/cards/broadcast-cards.ts`
- Test: `site/test/weights.test.ts`, the test file covering `orbitSky` (find it with `grep -rln "orbitSky(" site/test site/worker/test`), `site/test/broadcast-cards.test.ts`

**Interfaces:**
- Consumes: `ReplayFile.cre` (Task 1).
- Produces:
  - `creLaneKeys(replay: ReplayFile, fromDay: string, toDay: string): Set<string>` (keys `src>dst` selectors)
  - `OrbitLane.cre?: true`
  - `skyFor(replay, names, from, to, extra = {}, opts: { cre?: boolean } = {})`

- [ ] **Step 1: Write the failing tests**

In `site/test/weights.test.ts`, using the file's replay fixture with a `cre` field added on one day:

```ts
it('lists the lanes that carried CRE-sent messages in a window, by selector', () => {
  // #given
  const replay = { ...REPLAY, cre: [{ day: REPLAY.days[0]!.day, lanes: [[REPLAY.days[0]!.lanes[0]![0], 2, 0]] }] } as ReplayFile;
  const [src, dst] = REPLAY.lanes[REPLAY.days[0]!.lanes[0]![0]]!;
  // #then
  expect(creLaneKeys(replay, REPLAY.days[0]!.day, REPLAY.days[0]!.day)).toEqual(new Set([`${REPLAY.chains[src]!.selector}>${REPLAY.chains[dst]!.selector}`]));
  expect(creLaneKeys(replay, '1999-01-01', '1999-01-02').size).toBe(0);
  expect(creLaneKeys(REPLAY, REPLAY.days[0]!.day, REPLAY.days[0]!.day).size).toBe(0);
});
```

Use the fixture's real constant name in place of `REPLAY`.

In the `orbitSky` test file:

```ts
it('draws a CRE lane in teal and leaves other lanes as they were', () => {
  // #given the same chains and lanes, once with one lane marked cre
  const base = { chains: [{ selector: 'a', value: 10, name: 'A' }, { selector: 'b', value: 5, name: 'B' }], seed: 1 };
  const plain = orbitSky({ ...base, lanes: [{ src: 'a', dst: 'b', usd: 10 }] });
  const cre = orbitSky({ ...base, lanes: [{ src: 'a', dst: 'b', usd: 10, cre: true }] });
  // #then
  expect(cre.svg).toContain('#40e0c4');
  expect(plain.svg).not.toContain('#40e0c4');
});
```

Adapt `OrbitChain` fields to the real interface.

In `site/test/broadcast-cards.test.ts`:
- A daily card whose day has a `cre` entry in the loaded `replay.json` draws `#40e0c4` in its sky SVG.
- A day without one renders a tree deep-equal to the same inputs without any `cre` field.

Follow how the file loads inputs and inspects the tree; the sky SVG is in the background nodes.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm -C site exec vitest run test/weights.test.ts test/broadcast-cards.test.ts` and the orbitSky test file.
Expected: FAIL.

- [ ] **Step 3: Implement**

`site/src/sky/weights.ts`:

```ts
export function creLaneKeys(replay: ReplayFile, fromDay: string, toDay: string): Set<string> {
  const keys = new Set<string>();
  for (const d of replay.cre ?? []) {
    if (d.day < fromDay || d.day > toDay) continue;
    for (const [lane] of d.lanes) {
      const ends = replay.lanes[lane];
      if (ends) keys.add(`${replay.chains[ends[0]]!.selector}>${replay.chains[ends[1]]!.selector}`);
    }
  }
  return keys;
}
```

`site/worker/cards/orbit-sky.ts`:
- `OrbitLane` gains `cre?: true;`.
- In the gradients map: `const [from, to] = l.cre ? ['#40e0c4', '#7de3ff'] : i % 2 === 0 ? ['#4a7ff0', '#7de3ff'] : ['#7a5cff', '#4a7ff0'];`

`site/worker/cards/broadcast-frame.ts`, `skyFor`:

```ts
export function skyFor(replay: ReplayFile, names: ChainNames, from: string, to: string, extra: SkyExtra = {}, opts: { cre?: boolean } = {}): OrbitSky {
  const weights = windowWeights(replay, from, to);
  const cre = opts.cre ? creLaneKeys(replay, from, to) : new Set<string>();
  return orbitSky({
    chains: [...weights.chains].map(([selector, value]) => ({ selector, value, name: chainName(names, selector) })),
    lanes: weights.lanes.map((l) => (cre.has(`${l.src}>${l.dst}`) ? { ...l, cre: true as const } : l)),
    seed: dayNumber(to),
    ...extra,
  });
}
```

Import `creLaneKeys` the way `windowWeights` is imported. A lane without CRE stays the same object, so the output is unchanged.

`site/worker/cards/broadcast-cards.ts`:
- `dailyTree`: `skyFor(replay, names, day, day, {}, { cre: true })`.
- `weeklyTree`: `skyFor(replay, names, monday, addDays(monday, 6), {}, { cre: true })`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: the Step 2 command, then `pnpm -C site test && pnpm typecheck`.
Expected: PASS. If feasible, render one daily card with CRE lanes to a PNG in the session scratchpad (as the earlier card task did) and describe it. Do not commit the PNG.

- [ ] **Step 5: Commit**

```bash
git add site/src/sky/weights.ts site/worker/cards/orbit-sky.ts site/worker/cards/broadcast-frame.ts site/worker/cards/broadcast-cards.ts site/test/weights.test.ts site/test/broadcast-cards.test.ts <orbitSky test file>
git commit -m "Cards: lanes that carried CRE-sent messages glow teal in the daily and weekly post-image sky

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Open the PR

- [ ] **Step 1:** Run `pnpm test && pnpm typecheck && pnpm -C site build`. Expected: PASS.
- [ ] **Step 2:** `git push -u origin feat/cre-replay`.
- [ ] **Step 3:** `gh pr create --base feat/cre-more --head feat/cre-replay --title "CRE: teal comets in the replay, and teal CRE lanes on post images"`, with a body that says:
  - it is stacked on #47 (merge #46, then #47, then retarget this PR to `main`)
  - the schema bump starts one full re-tag pass on deploy (about 4.5M reads, ~15 h), filling teal newest-first
  - what changed, per the spec
  - it ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
