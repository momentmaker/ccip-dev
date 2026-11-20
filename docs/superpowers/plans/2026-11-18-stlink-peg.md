# stLINK/LINK Peg Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track the stLINK/LINK peg on Curve: hourly history, live depth and stake.link route state every 5 minutes, episodes with private and public Telegram alerts, staking-event markers, records, a share card, and a "stLINK peg" section on /staking.

**Architecture:** Pure logic lives in `packages/core` (`peg.ts` for Curve history, `peg-episodes.ts` for the episode state machine and history body, `peg-live.ts` for the RPC read and metrics). The Worker adds two jobs (`peg-history` hourly, `peg` every 5 minutes), a small D1 store (`peg-store.ts`) and two public files (`peg.json`, `peg-history.json`). Public posts reuse the broadcast pipeline with a new `peg` target that never goes to X. The site renders a section from both files and polls `peg.json`.

**Tech Stack:** TypeScript, zod 4, Cloudflare Workers + D1 + R2, vitest (`@cloudflare/vitest-plugin` for the Worker), Astro + React for the site, satori-style VNode cards in `site/worker`.

**Spec:** `docs/superpowers/specs/2026-11-17-stlink-peg-design.md`

## Global Constraints

- Free data only: Curve's keyless `prices.curve.finance` API and the public RPC list from `balanceRpcUrls(env)`. No paid plans, no API keys.
- Curve pool `0x7e13876b92f1a62c599c231f783f682e96b91761`: `coins(0)` = LINK, `coins(1)` = stLINK. StakingPool/stLINK `0xb8b295df2cd735b15be5eb419517aa626fc43cd5`, PriorityPool `0xddc796a66e8b83d0bccd97df33a6ccfba8fd60ea`, WithdrawalPool `0xa60b5146e44ff755e32bd51532842ceb41d0c248`, FundFlowController `0xd2e7381d8d3fcc97c1b4d88761bdbc8dd26a0200`.
- History starts `2025-04-19T00:00:00.000Z`; one Curve request covers at most 9 days of hours.
- Thresholds: `PEG_ALERT_PRIVATE_PCT = "0.3"`, `PEG_ALERT_PUBLIC_PCT = "0.75"`; tiers 1%, 2%, 5%. Live episodes need 2 consecutive 5-minute samples; history episodes need 1 bar. An episode closes when the confirming samples are all under half the private threshold or on the other side.
- Public posts go to the Telegram channel only, never X or X drafts. They need `PEG_PUBLIC = "on"` (ships `"off"`) and follow `BROADCASTS` (off/drafts/on). Every public post ends with `Not financial advice.`
- A spot outside 0.5–1.5 is a bad read: dropped, alert `peg-bad-read`. RPC failures alert `peg-rpc` after 3 in a row.
- D1: no backfill inside migrations; every query in the 5-minute job hits a primary key or index.
- Commits stage explicit paths only: never `git add -A`, `git add .` or `git commit -a`. Every commit compiles, passes the touched package's tests and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Comments: none that restate code; doc comments only where they say why, in the repo's voice.
- Each stage ships as its own PR off `main`.

## Review Focus

1. **A Curve page with no bars** (a quiet stretch or an API hiccup that answers `data: []`): the backfill must still advance and finish, and the refresh must not fail or wipe bars. Pinned in Task 4.
2. **A skipped or late 5-minute run:** a previous sample older than 15 minutes must not count as "consecutive", or a stale sample could open an episode. Pinned in Task 7.
3. **The card is not visible yet when a public post is due** (the edge still serves an older `peg.json`): the post must wait quietly and retry, not alert every run or drop the post. Pinned in Task 12.
4. **Misconfigured thresholds** (`"abc"`, `"-1"`, public below private): fall back to the defaults with a warning, never compare against `NaN`, which would silence every alert. Pinned in Task 4.
5. **A side flip within one run** (discount to premium): both episodes are stored with distinct ids, the close message precedes the open message, and the first episode's public recap is still planned. Pinned in Tasks 7 and 12.

## File Structure

| File | Stage | Responsibility |
|---|---|---|
| `packages/core/src/peg.ts` | 1 | Pool and token constants, Curve hourly client, daily bars |
| `packages/core/src/peg-episodes.ts` | 1, 5 | Thresholds, episode state machine, history episodes, records, history body, marker aggregation |
| `packages/core/src/peg-live.ts` | 2 | The 5-minute RPC batch, decoding, depth, route capacities, `peg.json` body |
| `packages/core/src/public.ts` | 1, 2, 4 | `PegHistoryFileSchema`, `PegFileSchema` |
| `packages/core/src/testing.ts` | 2, 4 | `PEG_LIVE_WORDS`, `pegRpc`, `PEG_FILE_FIXTURE`, `PEG_HISTORY_FIXTURE` |
| `packages/core/src/broadcasts.ts` | 5 | The `peg` broadcast target |
| `worker/migrations/0015_peg.sql` | 1 | `peg_hours`, `peg_episodes`, `peg_markers` |
| `worker/src/peg-store.ts` | 1, 3, 5 | Every peg SQL statement |
| `worker/src/peg-config.ts` | 1 | Thresholds and `PEG_PUBLIC` from env; attribution |
| `worker/src/jobs/peg-history.ts` | 1, 5 | Backfill, refresh, markers, `peg-history.json` |
| `worker/src/jobs/peg.ts` | 2, 3, 5 | Live read, guards, episodes, private alerts, `peg.json`, public broadcast |
| `worker/src/peg-copy.ts` | 3, 5 | Private alert text and shared line builders |
| `worker/src/broadcasts/{run,facts,copy}.ts` | 5 | `peg` planning, facts and Telegram copy |
| `site/src/lib/peg-view.ts` | 4 | Formatting, route rows, ranges, chart geometry, records view |
| `site/src/components/staking/Peg.tsx`, `PegChart.tsx` | 4 | The section and the chart |
| `site/worker/cards/peg-card.ts` | 5 | The share and broadcast card |
| `docs/methodology.md`, `docs/runbook.md` | 5 | Docs |

---

# Stage 1: History (PR 1)

Branch: `git switch -c peg-history`

### Task 1: Curve hourly bars

**Files:**
- Create: `packages/core/src/peg.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './peg';` after `export * from './cre';`)
- Test: `packages/core/test/peg.test.ts`

**Interfaces:**
- Consumes: `getJson`, `parseWith`, `HttpDeps` from `./http`; `LINK_TOKEN` from `./reserve`.
- Produces: `PEG_POOL`, `STLINK_TOKEN`, `PEG_HISTORY_START`, `PEG_PAGE_S`, `interface PegBar { hour: string; open: number; high: number; low: number; close: number }`, `type PegBarRow = [string, number, number, number, number]`, `pegBarsUrl(fromS, toS): string`, `fetchPegBars(deps: HttpDeps, fromS: number, toS: number): Promise<PegBar[]>`, `barRow(b: PegBar): PegBarRow`, `pegDays(bars: readonly PegBar[]): PegBar[]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/peg.test.ts
import { describe, expect, it } from 'vitest';
import { UpstreamSchemaError } from '../src/http';
import { barRow, fetchPegBars, PEG_PAGE_S, PEG_POOL, pegDays, STLINK_TOKEN, type PegBar } from '../src/peg';
import { fakeFetch, instantDeps, jsonResponse } from '../src/testing';

const T20 = 1_790_366_400; // 2026-09-25T20:00:00Z

describe('fetchPegBars', () => {
  it('reads hourly bars of stLINK priced in LINK from the main pool', async () => {
    const f = fakeFetch(() => jsonResponse({ chain: 'ethereum', address: PEG_POOL, data: [{ time: T20, open: 0.9916, close: 1.0254, high: 1.0272, low: 0.9913 }] }));
    const bars = await fetchPegBars(instantDeps(f), T20 - 3_600, T20);
    expect(bars).toEqual([{ hour: '2026-09-25T20:00:00.000Z', open: 0.9916, high: 1.0272, low: 0.9913, close: 1.0254 }]);
    const url = new URL(f.calls[0]!.url);
    expect(url.origin + url.pathname).toBe(`https://prices.curve.finance/v1/ohlc/ethereum/${PEG_POOL}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      main_token: STLINK_TOKEN,
      reference_token: '0x514910771af9ca656af840dff83e8264ecf986ca',
      agg_number: '1',
      agg_units: 'hour',
      start: String(T20 - 3_600),
      end: String(T20),
    });
  });

  it('answers a page without swaps or history with no bars', async () => {
    const f = fakeFetch(() => jsonResponse({ chain: 'ethereum', address: PEG_POOL, data: [] }));
    expect(await fetchPegBars(instantDeps(f), T20 - 3_600, T20)).toEqual([]);
  });

  it('drops a bar with a zero price rather than charting a 100% discount', async () => {
    const f = fakeFetch(() => jsonResponse({ data: [{ time: T20, open: 0, close: 0, high: 0, low: 0 }, { time: T20 + 3_600, open: 1, close: 1, high: 1, low: 1 }] }));
    expect((await fetchPegBars(instantDeps(f), T20, T20 + 3_600)).map((b) => b.hour)).toEqual(['2026-09-25T21:00:00.000Z']);
  });

  it('refuses a page longer than one request holds, without calling the API', async () => {
    const f = fakeFetch(() => jsonResponse({ data: [] }));
    await expect(fetchPegBars(instantDeps(f), 0, PEG_PAGE_S + 1)).rejects.toThrow(/over the 777600s/);
    expect(f.calls).toHaveLength(0);
  });

  it('fails loudly on an unexpected shape', async () => {
    const f = fakeFetch(() => jsonResponse({ detail: 'Too big aggregation window for this units' }));
    await expect(fetchPegBars(instantDeps(f), T20 - 3_600, T20)).rejects.toBeInstanceOf(UpstreamSchemaError);
  });
});

describe('pegDays', () => {
  const bar = (hour: string, open: number, high: number, low: number, close: number): PegBar => ({ hour, open, high, low, close });

  it('folds hours into UTC days: first open, highest high, lowest low, last close', () => {
    const days = pegDays([
      bar('2026-09-25T22:00:00.000Z', 1.04, 1.0564, 1.0414, 1.0564),
      bar('2026-09-25T23:00:00.000Z', 1.0564, 1.0559, 1.0186, 1.0186),
      bar('2026-09-26T00:00:00.000Z', 1.0186, 1.0189, 1.0029, 1.0029),
    ]);
    expect(days.map(barRow)).toEqual([
      ['2026-09-25T00:00:00.000Z', 1.04, 1.0564, 1.0186, 1.0186],
      ['2026-09-26T00:00:00.000Z', 1.0186, 1.0189, 1.0029, 1.0029],
    ]);
  });

  it('has no days without hours', () => {
    expect(pegDays([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/peg.test.ts`
Expected: FAIL with "Cannot find module '../src/peg'"

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/peg.ts
import { z } from 'zod';
import { getJson, parseWith, type HttpDeps } from './http';
import { LINK_TOKEN } from './reserve';

/** Curve's stLINK/LINK-ng stableswap pool: coins(0) is LINK, coins(1) is stLINK. */
export const PEG_POOL = '0x7e13876b92f1a62c599c231f783f682e96b91761';
/** stake.link's StakingPool, which is also the rebasing stLINK token. */
export const STLINK_TOKEN = '0xb8b295df2cd735b15be5eb419517aa626fc43cd5';
/** The first hour Curve's price API holds for the pool. */
export const PEG_HISTORY_START = '2025-04-19T00:00:00.000Z';
/** The OHLC endpoint answers HTTP 400 past roughly 250 bars, so a request asks for at most 9 days of hours. */
export const PEG_PAGE_S = 9 * 86_400;
const OHLC_ENDPOINT = 'GET prices.curve.finance/v1/ohlc';

export interface PegBar {
  hour: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** [hour, open, high, low, close], as published. */
export type PegBarRow = [string, number, number, number, number];

const OhlcResponse = z.object({
  data: z.array(z.object({ time: z.number().int(), open: z.number(), high: z.number(), low: z.number(), close: z.number() })),
});

export function pegBarsUrl(fromS: number, toS: number): string {
  const query = new URLSearchParams({
    main_token: STLINK_TOKEN,
    reference_token: LINK_TOKEN.toLowerCase(),
    agg_number: '1',
    agg_units: 'hour',
    start: String(fromS),
    end: String(toS),
  });
  return `https://prices.curve.finance/v1/ohlc/ethereum/${PEG_POOL}?${query}`;
}

/** Hours without swaps repeat the last price. A non-positive price is a gap in Curve's data, not a price, so it is dropped. */
export async function fetchPegBars(deps: HttpDeps, fromS: number, toS: number): Promise<PegBar[]> {
  if (toS - fromS > PEG_PAGE_S) throw new Error(`A Curve OHLC page of ${toS - fromS}s is over the ${PEG_PAGE_S}s one request holds`);
  const json = await getJson(deps, pegBarsUrl(fromS, toS), { endpoint: OHLC_ENDPOINT, maxRetries: 2 });
  return parseWith(OhlcResponse, json, OHLC_ENDPOINT)
    .data.filter((b) => [b.open, b.high, b.low, b.close].every((v) => Number.isFinite(v) && v > 0))
    .map((b) => ({ hour: new Date(b.time * 1000).toISOString(), open: b.open, high: b.high, low: b.low, close: b.close }));
}

export const barRow = (b: PegBar): PegBarRow => [b.hour, b.open, b.high, b.low, b.close];

/** `bars` in hour order. */
export function pegDays(bars: readonly PegBar[]): PegBar[] {
  const days: PegBar[] = [];
  for (const b of bars) {
    const day = `${b.hour.slice(0, 10)}T00:00:00.000Z`;
    const last = days.at(-1);
    if (last?.hour === day) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
    } else {
      days.push({ hour: day, open: b.open, high: b.high, low: b.low, close: b.close });
    }
  }
  return days;
}
```

Then add `export * from './peg';` to `packages/core/src/index.ts` after `export * from './cre';`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/peg.test.ts && pnpm --filter @ccip-dev/core typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/peg.ts packages/core/src/index.ts packages/core/test/peg.test.ts
git commit -m "Peg: read Curve's hourly stLINK/LINK bars

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Episode state machine, history episodes, records and the history body

**Files:**
- Create: `packages/core/src/peg-episodes.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './peg-episodes';` after `export * from './peg';`)
- Test: `packages/core/test/peg-episodes.test.ts`

**Interfaces:**
- Consumes: `barRow`, `pegDays`, `PegBar`, `PegBarRow` from Task 1.
- Produces:
  - `type PegSide = 'discount' | 'premium'`, `pegSide(gap: number): PegSide`
  - `interface PegThresholds { private: number; public: number }` (fractions: 0.003 is 0.3%), `DEFAULT_PEG_THRESHOLDS`, `PEG_TIERS = [0.01, 0.02, 0.05]`
  - `interface PegSample { at: string; gap: number }`
  - `interface PegOpen { side: PegSide; openedAt: string; peakGap: number; peakAt: string; tier: number; public: boolean }` (`tier` counts tiers announced, 0–3)
  - `interface PegMachine { open: PegOpen | null; prev: PegSample | null }`
  - `type PegEvent = { kind: 'opened'; episode: PegOpen } | { kind: 'went_public'; episode: PegOpen } | { kind: 'tier'; episode: PegOpen; tier: number } | { kind: 'closed'; episode: PegOpen; closedAt: string }`
  - `stepPeg(machine: PegMachine, cur: PegSample, t: PegThresholds, confirm: 1 | 2): { machine: PegMachine; events: PegEvent[] }`
  - `interface PegHistoryEpisode { side: PegSide; start: string; end: string | null; peak_gap: number; peak_at: string; hours: number }`
  - `pegEpisodesFromBars(bars: readonly PegBar[], t: PegThresholds): PegHistoryEpisode[]`
  - `interface PegRecords { deepest_discount: { gap: number; hour: string } | null; highest_premium: { gap: number; hour: string } | null; longest: PegHistoryEpisode | null; last_end: string | null }`, `pegRecords(bars, episodes): PegRecords`
  - `type PegMarkerKind = 'stakelink_unbonding' | 'stakelink_deposit'`, `interface PegMarker { hour: string; kind: PegMarkerKind; vaults: number; link: number | null }`
  - `PEG_HOURS_DAYS = 90`, `interface PegHistoryBody { hours: PegBarRow[]; days: PegBarRow[]; markers: PegMarker[]; episodes: PegHistoryEpisode[]; records: PegRecords }`, `pegHistoryBody(input: { bars: readonly PegBar[]; markers: readonly PegMarker[]; thresholds: PegThresholds; now: Date }): PegHistoryBody`

- [ ] **Step 1: Write the failing test**

The replay uses the real hourly closes of 22–26 Sep 2026 (Curve's API, 119 hours), indexed from `2026-09-22T00:00Z`. The expected events were computed by replaying the spec's rules over those closes.

```ts
// packages/core/test/peg-episodes.test.ts
import { describe, expect, it } from 'vitest';
import type { PegBar } from '../src/peg';
import { DEFAULT_PEG_THRESHOLDS, pegEpisodesFromBars, pegHistoryBody, pegRecords, stepPeg, type PegEvent, type PegMachine, type PegSample } from '../src/peg-episodes';

const SEP_CLOSES = [
  1.0, 1.0, 1.0, 1.0, 0.9998, 0.9998, 1.0, 0.9998, 1.0, 0.9986, 0.9981, 0.9981, 0.9964, 0.995, 0.9953, 0.9953, 0.9953, 0.9953, 0.9953, 0.9953,
  0.9953, 0.9953, 0.9953, 0.9951, 0.9951, 0.9957, 0.9957, 0.9962, 0.9962, 0.9967, 0.9967, 0.9967, 0.9967, 0.9967, 0.9971, 0.9949, 0.9949, 0.9918, 0.9914, 0.9916,
  0.9921, 0.9922, 0.9922, 0.9922, 0.9922, 0.9922, 0.9922, 0.9922, 0.9922, 0.9922, 0.993, 0.9931, 0.9939, 0.9939, 0.9939, 0.9939, 0.9939, 0.9939, 0.9939, 0.9939,
  0.9939, 0.9939, 0.9939, 0.9939, 0.9939, 0.9939, 0.9944, 0.9944, 0.9944, 0.9944, 0.9944, 0.9944, 0.9944, 0.9944, 0.9955, 0.9955, 0.9959, 0.9962, 0.9962, 0.9914,
  0.9914, 0.9913, 0.9913, 0.9912, 0.9916, 0.9916, 0.9913, 0.9916, 0.9916, 0.9916, 0.9916, 1.0254, 1.0415, 1.0564, 1.0186, 1.0029, 1.0036, 1.0026, 1.0026, 1.0026,
  1.0022, 1.0022, 1.0022, 1.0017, 1.0017, 1.0016, 1.0016, 1.0016, 1.0016, 1.0016, 1.0016, 1.0016, 1.0014, 1.0014, 1.0014, 1.0014, 1.0014, 1.0016, 1.0018,
];
const hourAt = (i: number) => new Date(Date.UTC(2026, 8, 22, i)).toISOString();
const SEP_BARS: PegBar[] = SEP_CLOSES.map((c, i) => ({ hour: hourAt(i), open: c, high: c, low: c, close: c }));
const T = DEFAULT_PEG_THRESHOLDS;
const EMPTY: PegMachine = { open: null, prev: null };

function replay(samples: readonly PegSample[], confirm: 1 | 2): { events: PegEvent[]; machine: PegMachine } {
  let machine = EMPTY;
  const events: PegEvent[] = [];
  for (const s of samples) {
    const step = stepPeg(machine, s, T, confirm);
    machine = step.machine;
    events.push(...step.events);
  }
  return { events, machine };
}

const brief = (e: PegEvent) => [e.kind, e.episode.side, e.kind === 'closed' ? e.closedAt : e.kind === 'tier' ? e.tier : e.episode.openedAt];

describe('stepPeg on the 22–26 Sep 2026 swing, two samples to confirm', () => {
  const { events, machine } = replay(SEP_BARS.map((b) => ({ at: b.hour, gap: b.close - 1 })), 2);

  it('opens a discount, takes it public, closes it on the flip, then opens and closes a public premium', () => {
    expect(events.map(brief)).toEqual([
      ['opened', 'discount', hourAt(12)],
      ['went_public', 'discount', hourAt(12)],
      ['closed', 'discount', hourAt(92)],
      ['opened', 'premium', hourAt(91)],
      ['went_public', 'premium', hourAt(91)],
      ['tier', 'premium', 0.02],
      ['closed', 'premium', hourAt(113)],
    ]);
    expect(machine.open).toBeNull();
  });

  it('keeps each episode’s peak', () => {
    const closed = events.filter((e) => e.kind === 'closed');
    expect(closed[0]!.episode.peakGap).toBeCloseTo(-0.0088, 6);
    expect(closed[0]!.episode.peakAt).toBe(hourAt(83));
    expect(closed[1]!.episode.peakGap).toBeCloseTo(0.0564, 6);
    expect(closed[1]!.episode.peakAt).toBe(hourAt(93));
  });

  it('never announces the 5% tier, since only one sample reached it', () => {
    expect(events.filter((e) => e.kind === 'tier').map((e) => (e as { tier: number }).tier)).toEqual([0.02]);
  });
});

describe('stepPeg rules', () => {
  const s = (minute: number, gap: number): PegSample => ({ at: new Date(Date.UTC(2026, 10, 18, 0, minute)).toISOString(), gap });

  it('does not open on one spike', () => {
    expect(replay([s(0, 0), s(5, -0.02), s(10, 0)], 2).events).toEqual([]);
  });

  it('does not open across sides', () => {
    expect(replay([s(0, -0.004), s(5, 0.004)], 2).events).toEqual([]);
  });

  it('opens at the first of the two samples, with the deeper one as its peak', () => {
    const { events } = replay([s(0, -0.004), s(5, -0.005)], 2);
    expect(events).toEqual([{ kind: 'opened', episode: { side: 'discount', openedAt: s(0, 0).at, peakGap: -0.005, peakAt: s(5, 0).at, tier: 0, public: false } }]);
  });

  it('stays open while one sample dips under half the threshold, and closes on the second', () => {
    const { events } = replay([s(0, -0.004), s(5, -0.004), s(10, -0.001), s(15, -0.002), s(20, -0.001), s(25, -0.0005)], 2);
    expect(events.map((e) => e.kind)).toEqual(['opened', 'closed']);
    expect((events[1] as { closedAt: string }).closedAt).toBe(s(25, 0).at);
  });

  it('announces each tier once, the highest reached at once', () => {
    const { events } = replay([s(0, -0.004), s(5, -0.004), s(10, -0.021), s(15, -0.022), s(20, -0.012), s(25, -0.025), s(30, -0.03)], 2);
    expect(events.map((e) => (e.kind === 'tier' ? `tier ${e.tier}` : e.kind))).toEqual(['opened', 'went_public', 'tier 0.02']);
  });

  it('goes public once', () => {
    const { events } = replay([s(0, -0.008), s(5, -0.008), s(10, -0.009), s(15, -0.009)], 2);
    expect(events.filter((e) => e.kind === 'went_public')).toHaveLength(1);
  });
});

describe('pegEpisodesFromBars', () => {
  it('finds the same two September episodes in hourly bars, one bar confirming', () => {
    expect(pegEpisodesFromBars(SEP_BARS, T)).toEqual([
      { side: 'discount', start: hourAt(12), end: hourAt(91), peak_gap: expect.closeTo(-0.0088, 6), peak_at: hourAt(83), hours: 79 },
      { side: 'premium', start: hourAt(91), end: hourAt(112), peak_gap: expect.closeTo(0.0564, 6), peak_at: hourAt(93), hours: 21 },
    ]);
  });

  it('leaves an episode still running open-ended, measured to the last bar', () => {
    const episodes = pegEpisodesFromBars(SEP_BARS.slice(0, 20), T);
    expect(episodes).toEqual([{ side: 'discount', start: hourAt(12), end: null, peak_gap: expect.closeTo(-0.005, 6), peak_at: hourAt(13), hours: 7 }]);
  });
});

describe('pegRecords', () => {
  it('takes the deepest low, the highest high, the longest episode and the last end', () => {
    const episodes = pegEpisodesFromBars(SEP_BARS, T);
    const records = pegRecords(SEP_BARS, episodes);
    expect(records.deepest_discount).toEqual({ gap: expect.closeTo(-0.0088, 6), hour: hourAt(83) });
    expect(records.highest_premium).toEqual({ gap: expect.closeTo(0.0564, 6), hour: hourAt(93) });
    expect(records.longest?.side).toBe('discount');
    expect(records.last_end).toBe(hourAt(112));
  });

  it('has no records without bars', () => {
    expect(pegRecords([], [])).toEqual({ deepest_discount: null, highest_premium: null, longest: null, last_end: null });
  });
});

describe('pegHistoryBody', () => {
  it('keeps 90 days of hours and every day', () => {
    const body = pegHistoryBody({ bars: SEP_BARS, markers: [], thresholds: T, now: new Date('2026-12-22T00:00:00Z') });
    expect(body.hours.map((r) => r[0])).toEqual(SEP_BARS.filter((b) => b.hour >= '2026-09-23T00:00:00.000Z').map((b) => b.hour));
    expect(body.days.map((r) => r[0])).toEqual(['2026-09-22T00:00:00.000Z', '2026-09-23T00:00:00.000Z', '2026-09-24T00:00:00.000Z', '2026-09-25T00:00:00.000Z', '2026-09-26T00:00:00.000Z']);
    expect(body.episodes).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/peg-episodes.test.ts`
Expected: FAIL with "Cannot find module '../src/peg-episodes'"

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/peg-episodes.ts
import { barRow, pegDays, type PegBar, type PegBarRow } from './peg';

export type PegSide = 'discount' | 'premium';

/** Fractions of 1 LINK: 0.003 is a 0.3% gap. */
export interface PegThresholds {
  private: number;
  public: number;
}

export const DEFAULT_PEG_THRESHOLDS: PegThresholds = { private: 0.003, public: 0.0075 };
export const PEG_TIERS = [0.01, 0.02, 0.05] as const;

export interface PegSample {
  at: string;
  gap: number;
}

export interface PegOpen {
  side: PegSide;
  openedAt: string;
  peakGap: number;
  peakAt: string;
  /** How many of PEG_TIERS have been announced. */
  tier: number;
  public: boolean;
}

export interface PegMachine {
  open: PegOpen | null;
  prev: PegSample | null;
}

export type PegEvent =
  | { kind: 'opened'; episode: PegOpen }
  | { kind: 'went_public'; episode: PegOpen }
  | { kind: 'tier'; episode: PegOpen; tier: number }
  | { kind: 'closed'; episode: PegOpen; closedAt: string };

export const pegSide = (gap: number): PegSide => (gap < 0 ? 'discount' : 'premium');

const farther = (a: PegSample, b: PegSample) => (Math.abs(b.gap) > Math.abs(a.gap) ? b : a);

/**
 * One sample through the episode rules. `confirm` samples in a row decide every change: 2 for the 5-minute checks, so one
 * trade's spike neither opens nor closes an episode, and 1 for hourly bars. A closing step can open the other side at once.
 */
export function stepPeg(machine: PegMachine, cur: PegSample, t: PegThresholds, confirm: 1 | 2): { machine: PegMachine; events: PegEvent[] } {
  const window: PegSample[] = confirm === 1 ? [cur] : machine.prev ? [machine.prev, cur] : [];
  const full = window.length === confirm;
  const events: PegEvent[] = [];
  let open = machine.open ? { ...machine.open } : null;

  if (open) {
    const side = open.side;
    if (pegSide(cur.gap) === side && Math.abs(cur.gap) > Math.abs(open.peakGap)) open = { ...open, peakGap: cur.gap, peakAt: cur.at };
    if (full && window.every((s) => Math.abs(s.gap) < t.private / 2 || pegSide(s.gap) !== side)) {
      events.push({ kind: 'closed', episode: open, closedAt: cur.at });
      open = null;
    }
  }

  const first = window[0];
  if (open === null && full && first && window.every((s) => Math.abs(s.gap) >= t.private && pegSide(s.gap) === pegSide(first.gap))) {
    const peak = window.reduce(farther);
    open = { side: pegSide(first.gap), openedAt: first.at, peakGap: peak.gap, peakAt: peak.at, tier: 0, public: false };
    events.push({ kind: 'opened', episode: { ...open } });
  }

  if (open) {
    const side = open.side;
    const beyond = (line: number) => full && window.every((s) => pegSide(s.gap) === side && Math.abs(s.gap) >= line);
    if (!open.public && beyond(t.public)) {
      open = { ...open, public: true };
      events.push({ kind: 'went_public', episode: { ...open } });
    }
    const tier = PEG_TIERS.reduce((reached, line, i) => (beyond(line) ? i + 1 : reached), 0);
    if (tier > open.tier) {
      open = { ...open, tier };
      events.push({ kind: 'tier', episode: { ...open }, tier: PEG_TIERS[tier - 1]! });
    }
  }

  return { machine: { open, prev: cur }, events };
}

export interface PegHistoryEpisode {
  side: PegSide;
  start: string;
  end: string | null;
  peak_gap: number;
  peak_at: string;
  hours: number;
}

const HOUR_MS = 3_600_000;

function historyEpisode(o: PegOpen, end: string | null, measuredTo: string): PegHistoryEpisode {
  return { side: o.side, start: o.openedAt, end, peak_gap: o.peakGap, peak_at: o.peakAt, hours: Math.round((Date.parse(measuredTo) - Date.parse(o.openedAt)) / HOUR_MS) };
}

/** Episodes on hourly closes, one bar confirming, so history before launch has them too. `bars` in hour order. */
export function pegEpisodesFromBars(bars: readonly PegBar[], t: PegThresholds): PegHistoryEpisode[] {
  const out: PegHistoryEpisode[] = [];
  let machine: PegMachine = { open: null, prev: null };
  for (const b of bars) {
    const step = stepPeg(machine, { at: b.hour, gap: b.close - 1 }, t, 1);
    for (const e of step.events) if (e.kind === 'closed') out.push(historyEpisode(e.episode, e.closedAt, e.closedAt));
    machine = step.machine;
  }
  const last = bars.at(-1);
  if (machine.open && last) out.push(historyEpisode(machine.open, null, last.hour));
  return out;
}

export interface PegExtreme {
  gap: number;
  hour: string;
}

export interface PegRecords {
  deepest_discount: PegExtreme | null;
  highest_premium: PegExtreme | null;
  longest: PegHistoryEpisode | null;
  last_end: string | null;
}

/** Extremes come from the bars' lows and highs, so a wick inside an hour counts. */
export function pegRecords(bars: readonly PegBar[], episodes: readonly PegHistoryEpisode[]): PegRecords {
  let deepest: PegExtreme | null = null;
  let highest: PegExtreme | null = null;
  for (const b of bars) {
    if (b.low < 1 && (deepest === null || b.low - 1 < deepest.gap)) deepest = { gap: b.low - 1, hour: b.hour };
    if (b.high > 1 && (highest === null || b.high - 1 > highest.gap)) highest = { gap: b.high - 1, hour: b.hour };
  }
  const longest = episodes.reduce<PegHistoryEpisode | null>((a, e) => (a === null || e.hours > a.hours ? e : a), null);
  const ended = episodes.filter((e) => e.end !== null);
  return { deepest_discount: deepest, highest_premium: highest, longest, last_end: ended.at(-1)?.end ?? null };
}

export type PegMarkerKind = 'stakelink_unbonding' | 'stakelink_deposit';

export interface PegMarker {
  hour: string;
  kind: PegMarkerKind;
  vaults: number;
  link: number | null;
}

export const PEG_HOURS_DAYS = 90;

export interface PegHistoryBody {
  hours: PegBarRow[];
  days: PegBarRow[];
  markers: PegMarker[];
  episodes: PegHistoryEpisode[];
  records: PegRecords;
}

export function pegHistoryBody(input: { bars: readonly PegBar[]; markers: readonly PegMarker[]; thresholds: PegThresholds; now: Date }): PegHistoryBody {
  const since = new Date(input.now.getTime() - PEG_HOURS_DAYS * 86_400_000).toISOString();
  const episodes = pegEpisodesFromBars(input.bars, input.thresholds);
  return {
    hours: input.bars.filter((b) => b.hour >= since).map(barRow),
    days: pegDays(input.bars).map(barRow),
    markers: [...input.markers],
    episodes,
    records: pegRecords(input.bars, episodes),
  };
}
```

Then add `export * from './peg-episodes';` to `packages/core/src/index.ts` after `export * from './peg';`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/peg-episodes.test.ts && pnpm --filter @ccip-dev/core typecheck`
Expected: PASS. If the replay's expected events differ, do not edit the expectations to match. The rules in the spec (§4) are the authority: re-read them and fix the code.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/peg-episodes.ts packages/core/src/index.ts packages/core/test/peg-episodes.test.ts
git commit -m "Peg: the episode rules, replayed over September's swing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Migration and the peg store

**Files:**
- Create: `worker/migrations/0015_peg.sql`
- Create: `worker/src/peg-store.ts`
- Modify: `worker/test/helpers.ts` (`TABLES`: append `'peg_hours', 'peg_episodes', 'peg_markers'`)
- Test: `worker/test/peg-store.test.ts`

**Interfaces:**
- Consumes: `PegBar`, `PegOpen`, `PegSide` from core; `chunks`, `runBatch` from `worker/src/store.ts`.
- Produces: `upsertPegHours(db, bars: readonly PegBar[]): Promise<void>`, `pegHours(db): Promise<PegBar[]>`, `interface PegEpisodeRow { id: number; side: PegSide; opened_at: string; closed_at: string | null; peak_gap: number; peak_at: string; best_size: number | null; best_profit: number | null; tier: number; public: number; public_at: string | null }`, `openPegEpisode(db): Promise<PegEpisodeRow | null>`, `insertPegEpisode(db, o: PegOpen): Promise<number>`, `savePegEpisode(db, id: number, fields: PegEpisodeUpdate): Promise<void>` where `interface PegEpisodeUpdate { peak_gap: number; peak_at: string; tier: number; public: boolean; public_at: string | null; best_size: number | null; best_profit: number | null; closed_at: string | null }`, `recentPegEpisodes(db, limit: number): Promise<PegEpisodeRow[]>`.

- [ ] **Step 1: Write the migration**

```sql
-- worker/migrations/0015_peg.sql
-- The stLINK/LINK peg. Created empty: the hourly job backfills peg_hours from Curve's API and peg_markers from
-- staking_events, in chunks, since a large INSERT … SELECT here would time out against remote D1.
CREATE TABLE peg_hours (
  hour TEXT PRIMARY KEY,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL
);

CREATE TABLE peg_episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  side TEXT NOT NULL CHECK (side IN ('discount', 'premium')),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  peak_gap REAL NOT NULL,
  peak_at TEXT NOT NULL,
  best_size REAL,
  best_profit REAL,
  tier INTEGER NOT NULL DEFAULT 0,
  public INTEGER NOT NULL DEFAULT 0,
  public_at TEXT
);
CREATE INDEX peg_episodes_open ON peg_episodes (closed_at) WHERE closed_at IS NULL;

-- Every hour stake.link vaults unbonded or staked, summed; the publish keeps the notable ones.
CREATE TABLE peg_markers (
  hour TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('stakelink_unbonding', 'stakelink_deposit')),
  vaults INTEGER NOT NULL,
  link REAL,
  PRIMARY KEY (hour, kind)
);
```

- [ ] **Step 2: Write the failing test**

```ts
// worker/test/peg-store.test.ts
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import * as pegStore from '../src/peg-store';
import { resetStorage } from './helpers';

beforeEach(resetStorage);

const bar = (hour: string, close: number) => ({ hour, open: close, high: close, low: close, close });

describe('peg_hours', () => {
  it('upserts bars, a later read replacing an hour, and reads them in hour order', async () => {
    await pegStore.upsertPegHours(env.DB, [bar('2026-09-25T21:00:00.000Z', 1.04), bar('2026-09-25T20:00:00.000Z', 1.0254)]);
    await pegStore.upsertPegHours(env.DB, [bar('2026-09-25T21:00:00.000Z', 1.0415)]);
    expect(await pegStore.pegHours(env.DB)).toEqual([bar('2026-09-25T20:00:00.000Z', 1.0254), bar('2026-09-25T21:00:00.000Z', 1.0415)]);
  });

  it('takes no bars without a statement', async () => {
    await pegStore.upsertPegHours(env.DB, []);
    expect(await pegStore.pegHours(env.DB)).toEqual([]);
  });

  it('writes more bars than one statement binds', async () => {
    const many = Array.from({ length: 200 }, (_, i) => bar(new Date(Date.UTC(2026, 0, 1, i)).toISOString(), 1));
    await pegStore.upsertPegHours(env.DB, many);
    expect(await pegStore.pegHours(env.DB)).toHaveLength(200);
  });
});

describe('peg_episodes', () => {
  const OPEN = { side: 'discount' as const, openedAt: '2026-11-18T00:00:00.000Z', peakGap: -0.005, peakAt: '2026-11-18T00:05:00.000Z', tier: 0, public: false };

  it('inserts an open episode and finds it by the open index', async () => {
    const id = await pegStore.insertPegEpisode(env.DB, OPEN);
    expect(await pegStore.openPegEpisode(env.DB)).toEqual({
      id, side: 'discount', opened_at: OPEN.openedAt, closed_at: null, peak_gap: -0.005, peak_at: OPEN.peakAt, best_size: null, best_profit: null, tier: 0, public: 0, public_at: null,
    });
  });

  it('saves the peak, tier, public flag, best size and close', async () => {
    const id = await pegStore.insertPegEpisode(env.DB, OPEN);
    await pegStore.savePegEpisode(env.DB, id, { peak_gap: -0.009, peak_at: '2026-11-18T01:00:00.000Z', tier: 0, public: true, public_at: '2026-11-18T00:40:00.000Z', best_size: 25_000, best_profit: 61.5, closed_at: '2026-11-18T03:00:00.000Z' });
    expect(await pegStore.openPegEpisode(env.DB)).toBeNull();
    expect(await pegStore.recentPegEpisodes(env.DB, 10)).toEqual([
      { id, side: 'discount', opened_at: OPEN.openedAt, closed_at: '2026-11-18T03:00:00.000Z', peak_gap: -0.009, peak_at: '2026-11-18T01:00:00.000Z', best_size: 25_000, best_profit: 61.5, tier: 0, public: 1, public_at: '2026-11-18T00:40:00.000Z' },
    ]);
  });

  it('lists the newest episodes first, up to the limit', async () => {
    const a = await pegStore.insertPegEpisode(env.DB, OPEN);
    const b = await pegStore.insertPegEpisode(env.DB, { ...OPEN, side: 'premium' });
    expect((await pegStore.recentPegEpisodes(env.DB, 1)).map((r) => r.id)).toEqual([b]);
    expect(b).toBeGreaterThan(a);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter worker exec vitest run test/peg-store.test.ts`
Expected: FAIL with "Cannot find module '../src/peg-store'"

- [ ] **Step 4: Write minimal implementation**

```ts
// worker/src/peg-store.ts
import type { PegBar, PegOpen, PegSide } from '@ccip-dev/core';
import { chunks, runBatch } from './store';

const BAR_COLUMNS = 5;
/** D1 binds at most 100 parameters per statement. */
const PARAMS = 90;

export async function upsertPegHours(db: D1Database, bars: readonly PegBar[]): Promise<void> {
  const statements = chunks([...bars], Math.floor(PARAMS / BAR_COLUMNS)).map((chunk) =>
    db
      .prepare(
        `INSERT INTO peg_hours (hour, open, high, low, close) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?)').join(', ')}
         ON CONFLICT(hour) DO UPDATE SET open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close`,
      )
      .bind(...chunk.flatMap((b) => [b.hour, b.open, b.high, b.low, b.close])),
  );
  await runBatch(db, statements);
}

export async function pegHours(db: D1Database): Promise<PegBar[]> {
  const { results } = await db.prepare('SELECT hour, open, high, low, close FROM peg_hours ORDER BY hour').all<PegBar>();
  return results;
}

export interface PegEpisodeRow {
  id: number;
  side: PegSide;
  opened_at: string;
  closed_at: string | null;
  peak_gap: number;
  peak_at: string;
  best_size: number | null;
  best_profit: number | null;
  tier: number;
  public: number;
  public_at: string | null;
}

export interface PegEpisodeUpdate {
  peak_gap: number;
  peak_at: string;
  tier: number;
  public: boolean;
  public_at: string | null;
  best_size: number | null;
  best_profit: number | null;
  closed_at: string | null;
}

const EPISODE_COLUMNS = 'id, side, opened_at, closed_at, peak_gap, peak_at, best_size, best_profit, tier, public, public_at';

export async function openPegEpisode(db: D1Database): Promise<PegEpisodeRow | null> {
  return db.prepare(`SELECT ${EPISODE_COLUMNS} FROM peg_episodes WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1`).first<PegEpisodeRow>();
}

export async function insertPegEpisode(db: D1Database, o: PegOpen): Promise<number> {
  const row = await db
    .prepare('INSERT INTO peg_episodes (side, opened_at, peak_gap, peak_at, tier, public) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(o.side, o.openedAt, o.peakGap, o.peakAt, o.tier, o.public ? 1 : 0)
    .first<{ id: number }>();
  if (row === null) throw new Error('Inserting a peg episode returned no id');
  return row.id;
}

export async function savePegEpisode(db: D1Database, id: number, f: PegEpisodeUpdate): Promise<void> {
  await db
    .prepare('UPDATE peg_episodes SET peak_gap = ?, peak_at = ?, tier = ?, public = ?, public_at = ?, best_size = ?, best_profit = ?, closed_at = ? WHERE id = ?')
    .bind(f.peak_gap, f.peak_at, f.tier, f.public ? 1 : 0, f.public_at, f.best_size, f.best_profit, f.closed_at, id)
    .run();
}

export async function recentPegEpisodes(db: D1Database, limit: number): Promise<PegEpisodeRow[]> {
  const { results } = await db.prepare(`SELECT ${EPISODE_COLUMNS} FROM peg_episodes ORDER BY id DESC LIMIT ?`).bind(limit).all<PegEpisodeRow>();
  return results;
}
```

Append `'peg_hours', 'peg_episodes', 'peg_markers'` to `TABLES` in `worker/test/helpers.ts`. `resetStorage` deletes rows but does not reset `AUTOINCREMENT`, so tests compare ids relatively, as above.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter worker exec vitest run test/peg-store.test.ts && pnpm --filter worker typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/migrations/0015_peg.sql worker/src/peg-store.ts worker/test/helpers.ts worker/test/peg-store.test.ts
git commit -m "Peg: D1 tables for hours, episodes and staking markers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Peg config, the hourly history job and `peg-history.json`

**Files:**
- Create: `worker/src/peg-config.ts`
- Create: `worker/src/jobs/peg-history.ts`
- Modify: `worker/src/env.ts` (add `PEG_ALERT_PRIVATE_PCT?: string; PEG_ALERT_PUBLIC_PCT?: string; PEG_PUBLIC?: string;`)
- Modify: `worker/wrangler.toml` `[vars]` (add `PEG_ALERT_PRIVATE_PCT = "0.3"`, `PEG_ALERT_PUBLIC_PCT = "0.75"`, `PEG_PUBLIC = "off"`)
- Modify: `worker/src/publish.ts` (`TTL`: add `peg: 60, pegHistory: 300`)
- Modify: `worker/src/index.ts` (`'0 * * * *'`: add `['peg-history', runPegHistory]` after `['staking', runStaking]`)
- Modify: `packages/core/src/public.ts` (`PegHistoryFileSchema`, `PUBLIC_SCHEMAS['peg-history.json']`, `export type PegHistoryFile`)
- Test: `worker/test/peg-config.test.ts`, `worker/test/peg-history-job.test.ts`

**Interfaces:**
- Consumes: `fetchPegBars`, `PEG_HISTORY_START`, `PEG_PAGE_S`, `pegHistoryBody`, `DEFAULT_PEG_THRESHOLDS`, `PegThresholds` (core); `upsertPegHours`, `pegHours` (Task 3); `putJson`, `TTL` (publish); `getMeta`, `setMeta` (store).
- Produces: `interface PegConfig { thresholds: PegThresholds; publicPosts: boolean }`, `pegConfig(env): PegConfig`, `PEG_ATTRIBUTION`; `runPegHistory(c)`, `backfillPeg(c)`, `refreshPeg(c)`, `publishPegHistory(c)`, `PEG_PAGES_PER_RUN = 10`, `PEG_REFRESH_S = 21_600`; `PegHistoryFileSchema`, `type PegHistoryFile`.

- [ ] **Step 1: Write the failing config test**

```ts
// worker/test/peg-config.test.ts
import { DEFAULT_PEG_THRESHOLDS } from '@ccip-dev/core';
import { describe, expect, it, vi } from 'vitest';
import { pegConfig } from '../src/peg-config';

describe('pegConfig', () => {
  it('reads the thresholds as percents', () => {
    expect(pegConfig({ PEG_ALERT_PRIVATE_PCT: '0.3', PEG_ALERT_PUBLIC_PCT: '0.75', PEG_PUBLIC: 'on' })).toEqual({ thresholds: { private: 0.003, public: 0.0075 }, publicPosts: true });
  });

  it('defaults when unset, with public posts off', () => {
    expect(pegConfig({})).toEqual({ thresholds: DEFAULT_PEG_THRESHOLDS, publicPosts: false });
  });

  it.each([
    ['not a number', { PEG_ALERT_PRIVATE_PCT: 'abc' }],
    ['negative', { PEG_ALERT_PUBLIC_PCT: '-1' }],
    ['public under private', { PEG_ALERT_PRIVATE_PCT: '1', PEG_ALERT_PUBLIC_PCT: '0.5' }],
  ])('falls back to both defaults, with a warning, when a threshold is %s', (_name, env) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(pegConfig(env).thresholds).toEqual(DEFAULT_PEG_THRESHOLDS);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('posts publicly only on an exact "on"', () => {
    expect(pegConfig({ PEG_PUBLIC: 'yes' }).publicPosts).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter worker exec vitest run test/peg-config.test.ts`
Expected: FAIL with "Cannot find module '../src/peg-config'"

- [ ] **Step 3: Implement the config and env**

```ts
// worker/src/peg-config.ts
import { DEFAULT_PEG_THRESHOLDS, type PegThresholds } from '@ccip-dev/core';
import type { Env } from './env';

export const PEG_ATTRIBUTION = 'Data: Curve (prices.curve.finance), Ethereum mainnet, stake.link contracts';

export interface PegConfig {
  thresholds: PegThresholds;
  publicPosts: boolean;
}

const fraction = (raw: string | undefined): number | null => {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isFinite(n) && n > 0 && n < 50 ? n / 100 : null;
};

/** A threshold that cannot be read falls back with both defaults: comparing against NaN would never alert. */
export function pegConfig(env: Pick<Env, 'PEG_ALERT_PRIVATE_PCT' | 'PEG_ALERT_PUBLIC_PCT' | 'PEG_PUBLIC'>): PegConfig {
  const privateLine = fraction(env.PEG_ALERT_PRIVATE_PCT) ?? (env.PEG_ALERT_PRIVATE_PCT === undefined ? DEFAULT_PEG_THRESHOLDS.private : null);
  const publicLine = fraction(env.PEG_ALERT_PUBLIC_PCT) ?? (env.PEG_ALERT_PUBLIC_PCT === undefined ? DEFAULT_PEG_THRESHOLDS.public : null);
  const usable = privateLine !== null && publicLine !== null && privateLine < publicLine;
  if (!usable) {
    console.warn(`[peg] thresholds PEG_ALERT_PRIVATE_PCT=${env.PEG_ALERT_PRIVATE_PCT} PEG_ALERT_PUBLIC_PCT=${env.PEG_ALERT_PUBLIC_PCT} are unusable; using 0.3% and 0.75%`);
  }
  return { thresholds: usable ? { private: privateLine, public: publicLine } : DEFAULT_PEG_THRESHOLDS, publicPosts: env.PEG_PUBLIC === 'on' };
}
```

Add the three optional fields to `Env` in `worker/src/env.ts`, and the three vars to `worker/wrangler.toml` under `[vars]`:

```toml
PEG_ALERT_PRIVATE_PCT = "0.3"
PEG_ALERT_PUBLIC_PCT = "0.75"
PEG_PUBLIC = "off"
```

Run: `pnpm --filter worker exec vitest run test/peg-config.test.ts`. Expected: PASS.

- [ ] **Step 4: Add the history schema**

In `packages/core/src/public.ts`, before `PUBLIC_SCHEMAS`:

```ts
export const PegSideSchema = z.enum(['discount', 'premium']);
const PegThresholdsSchema = z.object({ private: z.number(), public: z.number() });
const PegBarRowSchema = z.tuple([z.string(), z.number(), z.number(), z.number(), z.number()]);
const PegHistoryEpisodeSchema = z.object({ side: PegSideSchema, start: z.string(), end: z.string().nullable(), peak_gap: z.number(), peak_at: z.string(), hours: z.number() });
const PegExtremeSchema = z.object({ gap: z.number(), hour: z.string() });

export const PegHistoryFileSchema = z.object({
  ...envelope,
  thresholds: PegThresholdsSchema,
  hours: z.array(PegBarRowSchema),
  days: z.array(PegBarRowSchema),
  markers: z.array(z.object({ hour: z.string(), kind: z.enum(['stakelink_unbonding', 'stakelink_deposit']), vaults: z.number(), link: z.number().nullable() })),
  episodes: z.array(PegHistoryEpisodeSchema),
  records: z.object({
    deepest_discount: PegExtremeSchema.nullable(),
    highest_premium: PegExtremeSchema.nullable(),
    longest: PegHistoryEpisodeSchema.nullable(),
    last_end: z.string().nullable(),
  }),
});
```

Add `'peg-history.json': PegHistoryFileSchema,` to `PUBLIC_SCHEMAS`, and `export type PegHistoryFile = z.infer<typeof PegHistoryFileSchema>;` with the other types. Run `pnpm --filter @ccip-dev/core test`: `public.test.ts` iterates `PUBLIC_SCHEMAS`. If it needs a sample per file, add one in the same style as its neighbours.

- [ ] **Step 5: Write the failing job test**

```ts
// worker/test/peg-history-job.test.ts
import { PEG_HISTORY_START, PEG_PAGE_S } from '@ccip-dev/core';
import { PegHistoryFileSchema } from '@ccip-dev/core/public';
import { fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { PEG_PAGES_PER_RUN, PEG_REFRESH_S, runPegHistory } from '../src/jobs/peg-history';
import * as pegStore from '../src/peg-store';
import * as store from '../src/store';
import { harness, readPublic, resetStorage } from './helpers';

beforeEach(resetStorage);

const START_S = Date.parse(PEG_HISTORY_START) / 1000;

/** Answers every page with one bar at the page's last whole hour, priced `close`, or with `data: []`. */
function curve(opts: { close?: number; empty?: boolean; down?: boolean } = {}) {
  return fakeFetch((url) => {
    if (!url.startsWith('https://prices.curve.finance/')) return undefined;
    if (opts.down) return jsonResponse({}, 503);
    const end = Number(new URL(url).searchParams.get('end'));
    const time = end - (end % 3_600);
    const close = opts.close ?? 0.999;
    return jsonResponse({ data: opts.empty ? [] : [{ time, open: close, high: close, low: close, close }] });
  });
}

const pages = (f: { calls: { url: string }[] }) => f.calls.map((c) => new URL(c.url).searchParams).map((q) => [Number(q.get('start')), Number(q.get('end'))]);

describe('runPegHistory', () => {
  it('backfills to the first hour in one run when it is close, then only refreshes', async () => {
    const now = '2025-05-20T00:00:00.000Z';
    const f = curve();
    await runPegHistory(harness({ now, fetch: f }).c);
    const nowS = Date.parse(now) / 1000;
    expect(pages(f)).toEqual([
      [nowS - PEG_PAGE_S, nowS],
      [nowS - 2 * PEG_PAGE_S, nowS - PEG_PAGE_S],
      [nowS - 3 * PEG_PAGE_S, nowS - 2 * PEG_PAGE_S],
      [START_S, nowS - 3 * PEG_PAGE_S],
      [nowS - PEG_REFRESH_S, nowS],
    ]);
    expect(await store.getMeta(env.DB, 'peg_backfill_done')).toBe('1');

    const again = curve();
    await runPegHistory(harness({ now, fetch: again }).c);
    expect(pages(again)).toEqual([[nowS - PEG_REFRESH_S, nowS]]);
  });

  it(`takes at most ${PEG_PAGES_PER_RUN} pages a run and resumes from its cursor`, async () => {
    const now = '2025-07-28T00:00:00.000Z';
    const first = curve();
    await runPegHistory(harness({ now, fetch: first }).c);
    expect(first.calls).toHaveLength(PEG_PAGES_PER_RUN + 1);
    expect(await store.getMeta(env.DB, 'peg_backfill_done')).toBeNull();
    const second = curve();
    await runPegHistory(harness({ now, fetch: second }).c);
    expect(await store.getMeta(env.DB, 'peg_backfill_done')).toBe('1');
    expect(pages(second)[0]![1]).toBe(Date.parse(now) / 1000 - PEG_PAGES_PER_RUN * PEG_PAGE_S);
  });

  it('advances through empty pages and publishes nothing until there are bars', async () => {
    await runPegHistory(harness({ now: '2025-05-20T00:00:00.000Z', fetch: curve({ empty: true }) }).c);
    expect(await store.getMeta(env.DB, 'peg_backfill_done')).toBe('1');
    expect(await env.PUBLIC.get('v1/peg-history.json')).toBeNull();
  });

  it('replaces a corrected recent hour on refresh', async () => {
    const now = '2025-05-20T00:00:00.000Z';
    await runPegHistory(harness({ now, fetch: curve({ close: 0.99 }) }).c);
    await runPegHistory(harness({ now, fetch: curve({ close: 0.995 }) }).c);
    expect((await pegStore.pegHours(env.DB)).at(-1)!.close).toBe(0.995);
  });

  it('publishes peg-history.json with the configured thresholds', async () => {
    await runPegHistory(harness({ now: '2025-05-20T00:00:00.000Z', fetch: curve(), env: { PEG_ALERT_PRIVATE_PCT: '0.4', PEG_ALERT_PUBLIC_PCT: '1' } }).c);
    const file = PegHistoryFileSchema.parse(await readPublic('peg-history.json'));
    expect(file.thresholds).toEqual({ private: 0.004, public: 0.01 });
    expect(file.attribution).toMatch(/Curve/);
    expect(file.days.length).toBeGreaterThan(0);
  });

  it('alerts after six failed runs in a row and still publishes the bars it has', async () => {
    const now = '2025-05-20T00:00:00.000Z';
    await runPegHistory(harness({ now, fetch: curve() }).c);
    await env.PUBLIC.delete('v1/peg-history.json');
    const alerts: string[] = [];
    for (let run = 1; run <= 6; run++) {
      const h = harness({ now, fetch: curve({ down: true }) });
      await runPegHistory(h.c);
      alerts.push(...h.alerts.map((a) => a.signature));
      expect(alerts).toEqual(run < 6 ? [] : ['peg-history']);
    }
    expect(await env.PUBLIC.get('v1/peg-history.json')).not.toBeNull();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter worker exec vitest run test/peg-history-job.test.ts`
Expected: FAIL with "Cannot find module '../src/jobs/peg-history'"

- [ ] **Step 7: Implement the job**

```ts
// worker/src/jobs/peg-history.ts
import { fetchPegBars, PEG_HISTORY_START, PEG_PAGE_S, pegHistoryBody } from '@ccip-dev/core';
import type { RunContext } from '../context';
import { PEG_ATTRIBUTION, pegConfig } from '../peg-config';
import * as pegStore from '../peg-store';
import { putJson, TTL } from '../publish';
import * as store from '../store';

export const PEG_PAGES_PER_RUN = 10;
/** Curve may revise its latest bars, so every run re-reads the last 6 hours. */
export const PEG_REFRESH_S = 6 * 3_600;
const HISTORY_ALERT_AFTER = 6;

/** Hourly: a failed fetch alerts after 6 hours in a row, and the bars already stored are published regardless. */
export async function runPegHistory(c: RunContext): Promise<void> {
  try {
    await backfillPeg(c);
    await refreshPeg(c);
    await store.setMeta(c.env.DB, 'peg_history_failures', '0');
  } catch (err) {
    await recordHistoryFailure(c, err);
  }
  await publishPegHistory(c);
}

export async function backfillPeg(c: RunContext): Promise<void> {
  const db = c.env.DB;
  if ((await store.getMeta(db, 'peg_backfill_done')) === '1') return;
  const startS = Date.parse(PEG_HISTORY_START) / 1000;
  let before = Number((await store.getMeta(db, 'peg_backfill_before')) ?? Math.floor(c.deps.now().getTime() / 1000));
  for (let page = 0; page < PEG_PAGES_PER_RUN && before > startS; page++) {
    const from = Math.max(startS, before - PEG_PAGE_S);
    await pegStore.upsertPegHours(db, await fetchPegBars(c.deps, from, before));
    before = from;
    await store.setMeta(db, 'peg_backfill_before', String(before));
  }
  if (before <= startS) await store.setMeta(db, 'peg_backfill_done', '1');
}

export async function refreshPeg(c: RunContext): Promise<void> {
  const nowS = Math.floor(c.deps.now().getTime() / 1000);
  await pegStore.upsertPegHours(c.env.DB, await fetchPegBars(c.deps, nowS - PEG_REFRESH_S, nowS));
}

export async function publishPegHistory(c: RunContext): Promise<void> {
  const bars = await pegStore.pegHours(c.env.DB);
  if (bars.length === 0) return;
  const now = c.deps.now();
  const { thresholds } = pegConfig(c.env);
  const body = pegHistoryBody({ bars, markers: [], thresholds, now });
  await putJson(c.env.PUBLIC, 'peg-history.json', { attribution: PEG_ATTRIBUTION, thresholds, ...body }, TTL.pegHistory, now);
}

async function recordHistoryFailure(c: RunContext, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`Peg history fetch failed: ${message}`);
  const failures = Number((await store.getMeta(c.env.DB, 'peg_history_failures')) ?? '0') + 1;
  await store.setMeta(c.env.DB, 'peg_history_failures', String(failures));
  if (failures >= HISTORY_ALERT_AFTER) await c.alert('peg-history', `The stLINK peg history has not refreshed for ${failures} hours: ${message}`);
}
```

`putJson` spreads `body` after its own `attribution`, so the peg attribution replaces the CCIP one. Add `peg: 60, pegHistory: 300` to `TTL` in `worker/src/publish.ts`. Register the job in `worker/src/index.ts`:

```ts
import { runPegHistory } from './jobs/peg-history';
// …
  '0 * * * *': [
    ['hourly', runHourly],
    ['staking', runStaking],
    ['peg-history', runPegHistory],
  ],
```

- [ ] **Step 8: Run the tests and typecheck**

Run: `pnpm --filter worker exec vitest run test/peg-history-job.test.ts test/peg-config.test.ts test/index.test.ts && pnpm typecheck`
Expected: PASS. If `index.test.ts` pins the job list, add `peg-history` to its expectation.

- [ ] **Step 9: Commit and open the Stage 1 PR**

```bash
git add worker/src/peg-config.ts worker/src/jobs/peg-history.ts worker/src/env.ts worker/wrangler.toml worker/src/publish.ts worker/src/index.ts packages/core/src/public.ts worker/test/peg-config.test.ts worker/test/peg-history-job.test.ts
git commit -m "Peg: backfill Curve's hourly history and publish peg-history.json

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
pnpm test
git push -u origin peg-history
gh pr create --title "Peg: hourly stLINK/LINK history from Curve (stage 1)" --body "$(cat <<'EOF'
Stage 1 of docs/superpowers/plans/2026-11-18-stlink-peg.md: Curve's hourly bars backfilled from 2025-04-19, refreshed hourly, published as peg-history.json with episodes and records.

Deploy: apply migration 0015 (`pnpm --dir worker exec wrangler d1 migrations apply ccip-dev --remote`) before the Worker.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# Stage 2: Live state (PR 2)

Branch: `git switch main && git pull && git switch -c peg-live`

### Task 5: The live read and its metrics

**Files:**
- Create: `packages/core/src/peg-live.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './peg-live';`)
- Modify: `packages/core/src/testing.ts` (add `PEG_LIVE_WORDS`, `PEG_WORD`, `pegRpc`)
- Test: `packages/core/test/peg-live.test.ts`

**Interfaces:**
- Consumes: `ethRpcBatch`, `onFirstEndpoint`, `Fetcher` (eth-rpc); `PEG_POOL`, `STLINK_TOKEN` (Task 1); `linkUnits` (staking).
- Produces:
  - `PRIORITY_POOL`, `WITHDRAWAL_POOL`, `FUND_FLOW_CONTROLLER`, `PEG_LADDER = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000]`
  - `interface PegReading { spot: number; ema: number; buySt: number[]; sellSt: number[]; poolStatus: number; totalQueued: number; canDeposit: number; strategyDepositRoom: number; unusedDeposits: number; unusedDepositLimit: number; allowInstantWithdrawals: boolean; canWithdraw: number; queuedWithdrawals: number; lastWithdrawalAt: string; minWithdrawalGapS: number; claimPeriodActive: boolean }`
  - `pegCalls()`, `decodePegReading(words: bigint[]): PegReading`, `readPegLive(deps: Fetcher, rpcUrls: string[]): Promise<PegReading>`
  - `curveDepth(outs: readonly number[]): { size: number; profit: number } | null`, `profitAt(outs: readonly number[], x: number): number`, `redeemInstant(r)`, `mintInstant(r)`
  - `interface PegRouteView { depth: number | null; profit: number | null; instant: number; tradeable: number; tradeable_profit: number | null; queued_ahead: number }`
  - `interface PegLiveBody { pool: string; spot: number; ema: number; gap: number; ladder: { size: number; buy_st: number; sell_st: number }[]; discount: PegRouteView & { next_payout_after: string; claim_window_open: boolean }; premium: PegRouteView; routes: { pool_status: 'open' | 'draining' | 'closed'; instant_withdrawals: boolean } }`, `pegLiveBody(r: PegReading): PegLiveBody`
  - testing: `PEG_LIVE_WORDS: readonly string[]` (28 hex results), `PEG_WORD` (index by name), `pegRpc(over?: Partial<Record<number, string>>): FakeRoute`

- [ ] **Step 1: Add the fixture to `packages/core/src/testing.ts`**

These are the results of the 28-call batch read live from mainnet on 2026-11-18 (publicnode). The spot is 0.99975; nothing is queued for deposit; 1,541.04 stLINK waits in the withdrawal queue; instant withdrawals are off.

```ts
// packages/core/src/testing.ts (append)
import { PEG_POOL } from './peg';

const pegWord = (hex: string) => `0x${hex.padStart(64, '0')}`;

/** The 5-minute peg batch as mainnet answered it on 2026-11-18, in pegCalls() order. */
export const PEG_LIVE_WORDS: readonly string[] = [
  '0ddfd468ad68b1a5', '0ddfd3241fe482f5',
  '3637b74cc47eeab8e5', '010f13edc6a35e758acb', '021e2146740dfb94c2ca', '054b220e04b467167cff', '0a959b37e0ab0330a727', '1527ec7c2a1bbf14ff68', '2f562f3987f01aec53f3',
  '3630cf1f9b7e3eb970', '010ef1588d717cff63b3', '021ddbd947f538cb4630', '054a701ed2609e904ff4', '0a94165e8c4e12d5a6d2', '15236cd412fd765be7fe', '29f443b8f4406c889e7b',
  '0', '0', '0', '0', '03d2140b40240175089b', '010f0cf064dd59200000',
  '0', '011f697916460a278ce290', '538a4a8a6d387293b0', '6af9d4b3', '3f480', '1',
].map(pegWord);

export const PEG_WORD = {
  spot: 0, ema: 1, poolStatus: 16, totalQueued: 17, canDeposit: 18, strategyDepositRoom: 19, unusedDeposits: 20, unusedDepositLimit: 21,
  allowInstantWithdrawals: 22, canWithdraw: 23, queuedWithdrawals: 24, lastWithdrawal: 25, minGap: 26, claimActive: 27,
} as const;

/** A word for an 18-decimal amount, for overriding PEG_LIVE_WORDS. */
export const pegAmountWord = (amount: number) => pegWord((BigInt(Math.round(amount * 1e6)) * 10n ** 12n).toString(16));

/** Answers the peg batch (any JSON-RPC batch whose first call is to the Curve pool) with PEG_LIVE_WORDS, some overridden by index. */
export function pegRpc(over: Partial<Record<number, string>> = {}): FakeRoute {
  return (_url, init) => {
    if (init?.body === undefined) return undefined;
    const body = JSON.parse(String(init.body)) as unknown;
    if (!Array.isArray(body) || (body[0] as { params?: [{ to?: string }] })?.params?.[0]?.to !== PEG_POOL) return undefined;
    return jsonResponse((body as { id: number }[]).map((c) => ({ jsonrpc: '2.0', id: c.id, result: over[c.id] ?? PEG_LIVE_WORDS[c.id] })));
  };
}
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/core/test/peg-live.test.ts
import { describe, expect, it } from 'vitest';
import { curveDepth, decodePegReading, mintInstant, PEG_LADDER, pegCalls, pegLiveBody, profitAt, readPegLive, redeemInstant, type PegReading } from '../src/peg-live';
import { fakeFetch, PEG_LIVE_WORDS, PEG_WORD, pegAmountWord, pegRpc } from '../src/testing';

const words = PEG_LIVE_WORDS.map((w) => BigInt(w));
const LIVE = decodePegReading(words);

describe('readPegLive', () => {
  it('reads the pool, both routes and the queues in one batch', async () => {
    const f = fakeFetch(pegRpc());
    const r = await readPegLive({ fetch: f }, ['https://rpc.one']);
    expect(f.calls).toHaveLength(1);
    expect(pegCalls()).toHaveLength(28);
    expect(r.spot).toBeCloseTo(0.999751, 6);
    expect(r.ema).toBeCloseTo(0.99975, 6);
    expect(r.buySt[0]).toBeCloseTo(1000.138942, 6);
    expect(r.sellSt[0]).toBeCloseTo(999.641245, 6);
    expect(r).toMatchObject({ poolStatus: 0, totalQueued: 0, canDeposit: 0, allowInstantWithdrawals: false, claimPeriodActive: true, lastWithdrawalAt: '2026-11-15T15:50:11.000Z', minWithdrawalGapS: 259_200 });
    expect(r.queuedWithdrawals).toBeCloseTo(1541.044687, 6);
  });

  it('tries the next endpoint when one fails', async () => {
    const f = fakeFetch((url) => (url === 'https://rpc.one' ? new Response('', { status: 503 }) : undefined), pegRpc());
    expect((await readPegLive({ fetch: f }, ['https://rpc.one', 'https://rpc.two'])).spot).toBeCloseTo(0.999751, 6);
  });
});

describe('curveDepth and profitAt', () => {
  it('finds the largest rung that beats 1:1, and nothing on the losing side', () => {
    expect(curveDepth(LIVE.buySt)).toEqual({ size: 10_000, profit: expect.closeTo(0.533019, 5) });
    expect(curveDepth(LIVE.sellSt)).toBeNull();
  });

  it('interpolates profit between rungs, from zero below the first', () => {
    expect(profitAt(LIVE.buySt, 500)).toBeCloseTo(0.069471, 5);
    expect(profitAt(LIVE.buySt, 3_000)).toBeCloseTo(0.321304, 5);
    expect(profitAt(LIVE.buySt, PEG_LADDER.at(-1)! * 2)).toBeCloseTo(LIVE.buySt.at(-1)! - PEG_LADDER.at(-1)!, 3);
  });
});

describe('instant capacity', () => {
  const r = (over: Partial<PegReading>): PegReading => ({ ...LIVE, ...over });

  it('redeems instantly only against queued LINK while instant withdrawals are off', () => {
    expect(redeemInstant(r({ totalQueued: 17.88 }))).toBe(17.88);
  });

  it('adds the pool’s withdrawable LINK when instant withdrawals are on and nobody waits', () => {
    expect(redeemInstant(r({ totalQueued: 10, allowInstantWithdrawals: true, queuedWithdrawals: 0, canWithdraw: 500 }))).toBe(510);
    expect(redeemInstant(r({ totalQueued: 10, allowInstantWithdrawals: true, queuedWithdrawals: 1, canWithdraw: 500 }))).toBe(10);
  });

  it('redeems nothing while the pool is closed', () => {
    expect(redeemInstant(r({ poolStatus: 2, totalQueued: 17.88 }))).toBe(0);
  });

  it('mints instantly into the withdrawal queue, then into the room the pool has', () => {
    expect(mintInstant(LIVE)).toBeCloseTo(1541.044687, 6);
    expect(mintInstant(r({ canDeposit: 900, strategyDepositRoom: 400, unusedDeposits: 4_800, unusedDepositLimit: 5_000 }))).toBeCloseTo(1541.044687 + 600, 6);
  });

  it('mints nothing while LINK is queued or the pool is not open', () => {
    expect(mintInstant(r({ totalQueued: 1 }))).toBe(0);
    expect(mintInstant(r({ poolStatus: 1 }))).toBe(0);
  });
});

describe('pegLiveBody', () => {
  it('describes both routes from the mainnet reading', () => {
    const body = pegLiveBody(LIVE);
    expect(body.gap).toBeCloseTo(-0.000249, 6);
    expect(body.ladder).toHaveLength(PEG_LADDER.length);
    expect(body.discount).toEqual({
      depth: 10_000, profit: expect.closeTo(0.533019, 5), instant: 0, tradeable: 0, tradeable_profit: null,
      queued_ahead: expect.closeTo(1541.044687, 6), next_payout_after: '2026-11-18T15:50:11.000Z', claim_window_open: true,
    });
    expect(body.premium).toEqual({ depth: null, profit: null, instant: expect.closeTo(1541.044687, 6), tradeable: 0, tradeable_profit: null, queued_ahead: 0 });
    expect(body.routes).toEqual({ pool_status: 'open', instant_withdrawals: false });
  });

  it('trades the smaller of the Curve depth and the instant capacity', () => {
    const queued = decodePegReading(PEG_LIVE_WORDS.map((w, i) => BigInt(i === PEG_WORD.totalQueued ? pegAmountWord(17.88) : w)));
    const d = pegLiveBody(queued).discount;
    expect(d.tradeable).toBeCloseTo(17.88, 6);
    expect(d.tradeable_profit).toBeCloseTo(0.138942 * 0.01788, 6);
  });

  it('reads an unknown pool status as closed', () => {
    expect(pegLiveBody({ ...LIVE, poolStatus: 7 }).routes.pool_status).toBe('closed');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/peg-live.test.ts`
Expected: FAIL with "Cannot find module '../src/peg-live'"

- [ ] **Step 4: Write minimal implementation**

```ts
// packages/core/src/peg-live.ts
import { ethRpcBatch, onFirstEndpoint, type Fetcher } from './eth-rpc';
import { PEG_POOL, STLINK_TOKEN } from './peg';
import { linkUnits } from './staking';

export const PRIORITY_POOL = '0xddc796a66e8b83d0bccd97df33a6ccfba8fd60ea';
export const WITHDRAWAL_POOL = '0xa60b5146e44ff755e32bd51532842ceb41d0c248';
export const FUND_FLOW_CONTROLLER = '0xd2e7381d8d3fcc97c1b4d88761bdbc8dd26a0200';
/** Swap sizes quoted each check, in LINK (or stLINK) in. */
export const PEG_LADDER = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000] as const;

const SELECTOR = {
  getP: '0xec023862',
  priceOracle: '0x68727653',
  getDy: '0x5e0d443f',
  poolStatus: '0xf0228692',
  totalQueued: '0x53ac4b66',
  canDeposit: '0xe78a5875',
  strategyDepositRoom: '0x050b4d13',
  unusedDeposits: '0x50be8596',
  unusedDepositLimit: '0xb68c7462',
  allowInstantWithdrawals: '0x73ccbcc4',
  canWithdraw: '0xb51459fe',
  totalQueuedWithdrawals: '0xf990f4bf',
  timeOfLastWithdrawal: '0x19855690',
  minTimeBetweenWithdrawals: '0xb9cbd8c4',
  claimPeriodActive: '0xfa8b3d30',
} as const;

const word = (n: bigint) => n.toString(16).padStart(64, '0');
const WEI = 10n ** 18n;
const call = (to: string, data: string) => ({ method: 'eth_call', params: [{ to, data }, 'latest'] });
const getDy = (i: number, j: number, size: number) => call(PEG_POOL, `${SELECTOR.getDy}${word(BigInt(i))}${word(BigInt(j))}${word(BigInt(size) * WEI)}`);

/** In decodePegReading's order: Curve prices and ladders, then the mint route, then the redeem route. */
export function pegCalls() {
  return [
    call(PEG_POOL, `${SELECTOR.getP}${word(0n)}`),
    call(PEG_POOL, `${SELECTOR.priceOracle}${word(0n)}`),
    ...PEG_LADDER.map((size) => getDy(0, 1, size)),
    ...PEG_LADDER.map((size) => getDy(1, 0, size)),
    call(PRIORITY_POOL, SELECTOR.poolStatus),
    call(PRIORITY_POOL, SELECTOR.totalQueued),
    call(STLINK_TOKEN, SELECTOR.canDeposit),
    call(STLINK_TOKEN, SELECTOR.strategyDepositRoom),
    call(STLINK_TOKEN, SELECTOR.unusedDeposits),
    call(STLINK_TOKEN, SELECTOR.unusedDepositLimit),
    call(PRIORITY_POOL, SELECTOR.allowInstantWithdrawals),
    call(STLINK_TOKEN, SELECTOR.canWithdraw),
    call(WITHDRAWAL_POOL, SELECTOR.totalQueuedWithdrawals),
    call(WITHDRAWAL_POOL, SELECTOR.timeOfLastWithdrawal),
    call(WITHDRAWAL_POOL, SELECTOR.minTimeBetweenWithdrawals),
    call(FUND_FLOW_CONTROLLER, SELECTOR.claimPeriodActive),
  ];
}

export interface PegReading {
  spot: number;
  ema: number;
  buySt: number[];
  sellSt: number[];
  poolStatus: number;
  totalQueued: number;
  canDeposit: number;
  strategyDepositRoom: number;
  unusedDeposits: number;
  unusedDepositLimit: number;
  allowInstantWithdrawals: boolean;
  canWithdraw: number;
  queuedWithdrawals: number;
  lastWithdrawalAt: string;
  minWithdrawalGapS: number;
  claimPeriodActive: boolean;
}

function oneWord(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('malformed call result');
  return BigInt(value);
}

export function decodePegReading(w: readonly bigint[]): PegReading {
  const n = PEG_LADDER.length;
  const at = (i: number) => w[i]!;
  const link = (i: number) => linkUnits(at(i));
  const s = 2 + 2 * n;
  return {
    spot: link(0),
    ema: link(1),
    buySt: PEG_LADDER.map((_, k) => link(2 + k)),
    sellSt: PEG_LADDER.map((_, k) => link(2 + n + k)),
    poolStatus: Number(at(s)),
    totalQueued: link(s + 1),
    canDeposit: link(s + 2),
    strategyDepositRoom: link(s + 3),
    unusedDeposits: link(s + 4),
    unusedDepositLimit: link(s + 5),
    allowInstantWithdrawals: at(s + 6) !== 0n,
    canWithdraw: link(s + 7),
    queuedWithdrawals: link(s + 8),
    lastWithdrawalAt: new Date(Number(at(s + 9)) * 1000).toISOString(),
    minWithdrawalGapS: Number(at(s + 10)),
    claimPeriodActive: at(s + 11) !== 0n,
  };
}

export async function readPegLive(deps: Fetcher, rpcUrls: string[]): Promise<PegReading> {
  const calls = pegCalls();
  return onFirstEndpoint(rpcUrls, 'stLINK peg read', async (url) => decodePegReading((await ethRpcBatch(deps, url, calls)).map(oneWord)));
}

/** The largest ladder rung whose swap returns more than it puts in. Pool fees are inside get_dy; gas is not. */
export function curveDepth(outs: readonly number[]): { size: number; profit: number } | null {
  let best: { size: number; profit: number } | null = null;
  for (const [k, size] of PEG_LADDER.entries()) {
    const profit = outs[k]! - size;
    if (profit > 0) best = { size, profit };
  }
  return best;
}

/** Profit at `x`, linear between rungs and from zero below the first. */
export function profitAt(outs: readonly number[], x: number): number {
  let fromSize = 0;
  let fromProfit = 0;
  for (const [k, size] of PEG_LADDER.entries()) {
    const profit = outs[k]! - size;
    if (x <= size) return fromProfit + ((profit - fromProfit) * (x - fromSize)) / (size - fromSize);
    fromSize = size;
    fromProfit = profit;
  }
  return fromProfit;
}

/** stLINK → LINK at 1:1 now (PriorityPool._withdraw): queued LINK first, then the pool only with instant withdrawals on and nobody waiting. */
export function redeemInstant(r: PegReading): number {
  if (r.poolStatus === 2) return 0;
  return r.totalQueued + (r.allowInstantWithdrawals && r.queuedWithdrawals === 0 ? r.canWithdraw : 0);
}

/**
 * LINK → stLINK at 1:1 now (PriorityPool._deposit): only while nothing is queued, first into the withdrawal queue, then into
 * the pool's room. The room's cap by unusedDepositLimit is read from StakingPool.deposit's InvalidDeposit check, not simulated.
 */
export function mintInstant(r: PegReading): number {
  if (r.poolStatus !== 0 || r.totalQueued > 0) return 0;
  const room = Math.min(r.canDeposit, r.strategyDepositRoom + Math.max(0, r.unusedDepositLimit - r.unusedDeposits));
  return r.queuedWithdrawals + room;
}

export interface PegRouteView {
  depth: number | null;
  profit: number | null;
  instant: number;
  tradeable: number;
  tradeable_profit: number | null;
  queued_ahead: number;
}

export interface PegLiveBody {
  pool: string;
  spot: number;
  ema: number;
  gap: number;
  ladder: { size: number; buy_st: number; sell_st: number }[];
  discount: PegRouteView & { next_payout_after: string; claim_window_open: boolean };
  premium: PegRouteView;
  routes: { pool_status: 'open' | 'draining' | 'closed'; instant_withdrawals: boolean };
}

const POOL_STATUS = ['open', 'draining', 'closed'] as const;

function route(outs: readonly number[], instant: number, queuedAhead: number): PegRouteView {
  const depth = curveDepth(outs);
  const tradeable = depth === null ? 0 : Math.min(depth.size, instant);
  return {
    depth: depth?.size ?? null,
    profit: depth?.profit ?? null,
    instant,
    tradeable,
    tradeable_profit: tradeable > 0 ? profitAt(outs, tradeable) : null,
    queued_ahead: queuedAhead,
  };
}

/** A discount is bought on Curve and redeemed at 1:1; a premium is minted at 1:1 and sold on Curve. */
export function pegLiveBody(r: PegReading): PegLiveBody {
  return {
    pool: PEG_POOL,
    spot: r.spot,
    ema: r.ema,
    gap: r.spot - 1,
    ladder: PEG_LADDER.map((size, k) => ({ size, buy_st: r.buySt[k]!, sell_st: r.sellSt[k]! })),
    discount: {
      ...route(r.buySt, redeemInstant(r), r.queuedWithdrawals),
      next_payout_after: new Date(Date.parse(r.lastWithdrawalAt) + r.minWithdrawalGapS * 1000).toISOString(),
      claim_window_open: r.claimPeriodActive,
    },
    premium: route(r.sellSt, mintInstant(r), r.totalQueued),
    routes: { pool_status: POOL_STATUS[r.poolStatus] ?? 'closed', instant_withdrawals: r.allowInstantWithdrawals },
  };
}
```

Add `export * from './peg-live';` to `packages/core/src/index.ts`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/peg-live.test.ts && pnpm --filter @ccip-dev/core typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/peg-live.ts packages/core/src/index.ts packages/core/src/testing.ts packages/core/test/peg-live.test.ts
git commit -m "Peg: read Curve depth and stake.link's two routes in one batch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: The 5-minute job and `peg.json`

**Files:**
- Create: `worker/src/jobs/peg.ts`
- Modify: `packages/core/src/public.ts` (`PegFileSchema`, `PegEpisodeViewSchema`, `PUBLIC_SCHEMAS['peg.json']`, `export type PegFile`, `export type PegEpisodeView`)
- Modify: `worker/src/index.ts` (`'*/5 * * * *'`: `[['prices', runPrices], ['peg', runPeg]]`)
- Test: `worker/test/peg-job.test.ts`

**Interfaces:**
- Consumes: `readPegLive`, `pegLiveBody`, `PegReading` (Task 5); `pegConfig`, `PEG_ATTRIBUTION` (Task 4); `balanceRpcUrls` (rpc); `putJson`, `TTL`.
- Produces: `runPeg(c: RunContext): Promise<void>`, `PEG_RPC_ALERT_AFTER = 3`, `SANE_SPOT = { min: 0.5, max: 1.5 }`; `PegFileSchema`, `type PegFile`, `PegEpisodeViewSchema`, `type PegEpisodeView` (`{ id: number; side; opened_at; closed_at: string | null; peak_gap; peak_at; best_size: number | null; best_profit: number | null; public: boolean; public_at: string | null }`).

- [ ] **Step 1: Add the schema**

In `packages/core/src/public.ts`, after `PegHistoryFileSchema`:

```ts
const PegRouteSchema = z.object({
  depth: z.number().nullable(),
  profit: z.number().nullable(),
  instant: z.number(),
  tradeable: z.number(),
  tradeable_profit: z.number().nullable(),
  queued_ahead: z.number(),
});

export const PegEpisodeViewSchema = z.object({
  id: z.number(),
  side: PegSideSchema,
  opened_at: z.string(),
  closed_at: z.string().nullable(),
  peak_gap: z.number(),
  peak_at: z.string(),
  best_size: z.number().nullable(),
  best_profit: z.number().nullable(),
  public: z.boolean(),
  public_at: z.string().nullable(),
});

export const PegFileSchema = z.object({
  ...envelope,
  thresholds: PegThresholdsSchema,
  pool: z.string(),
  spot: z.number(),
  ema: z.number(),
  gap: z.number(),
  ladder: z.array(z.object({ size: z.number(), buy_st: z.number(), sell_st: z.number() })),
  discount: PegRouteSchema.extend({ next_payout_after: z.string(), claim_window_open: z.boolean() }),
  premium: PegRouteSchema,
  routes: z.object({ pool_status: z.enum(['open', 'draining', 'closed']), instant_withdrawals: z.boolean() }),
  episode: PegEpisodeViewSchema.nullable(),
  recent_episodes: z.array(PegEpisodeViewSchema),
});
```

Register `'peg.json': PegFileSchema,` and export `type PegFile = z.infer<typeof PegFileSchema>;` and `type PegEpisodeView = z.infer<typeof PegEpisodeViewSchema>;`.

- [ ] **Step 2: Write the failing test**

```ts
// worker/test/peg-job.test.ts
import { PegFileSchema } from '@ccip-dev/core/public';
import { fakeFetch, jsonResponse, pegAmountWord, PEG_WORD, pegRpc } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { PEG_RPC_ALERT_AFTER, runPeg } from '../src/jobs/peg';
import * as store from '../src/store';
import { harness, readPublic, resetStorage } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-11-18T01:35:00.000Z';
const RPC_ENV = { RPC_ETHEREUM: 'https://rpc.one', RPC_FALLBACKS: '' };

describe('runPeg', () => {
  it('publishes peg.json from the live read', async () => {
    await runPeg(harness({ now: NOW, fetch: fakeFetch(pegRpc()), env: RPC_ENV }).c);
    const peg = PegFileSchema.parse(await readPublic('peg.json'));
    expect(peg.spot).toBeCloseTo(0.999751, 6);
    expect(peg.discount.depth).toBe(10_000);
    expect(peg.premium.instant).toBeCloseTo(1541.044687, 6);
    expect(peg.thresholds).toEqual({ private: 0.003, public: 0.0075 });
    expect(peg.episode).toBeNull();
  });

  it('drops a read outside 0.5–1.5 and alerts, publishing nothing', async () => {
    const h = harness({ now: NOW, fetch: fakeFetch(pegRpc({ [PEG_WORD.spot]: pegAmountWord(2) })), env: RPC_ENV });
    await runPeg(h.c);
    expect(h.alerts.map((a) => a.signature)).toEqual(['peg-bad-read']);
    expect(await env.PUBLIC.get('v1/peg.json')).toBeNull();
  });

  it(`alerts once the RPC has failed ${PEG_RPC_ALERT_AFTER} runs in a row, and resets on success`, async () => {
    const down = fakeFetch(() => jsonResponse({}, 503));
    const signatures: string[][] = [];
    for (let run = 0; run < PEG_RPC_ALERT_AFTER; run++) {
      const h = harness({ now: NOW, fetch: down, env: RPC_ENV });
      await runPeg(h.c);
      signatures.push(h.alerts.map((a) => a.signature));
    }
    expect(signatures).toEqual([[], [], ['peg-rpc']]);
    await runPeg(harness({ now: NOW, fetch: fakeFetch(pegRpc()), env: RPC_ENV }).c);
    expect(await store.getMeta(env.DB, 'peg_failures')).toBe('0');
  });

  it('asks once for the mint-cap check the first time the pool has room', async () => {
    const roomy = fakeFetch(pegRpc({ [PEG_WORD.canDeposit]: pegAmountWord(800) }));
    const first = harness({ now: NOW, fetch: roomy, env: RPC_ENV });
    await runPeg(first.c);
    const second = harness({ now: NOW, fetch: roomy, env: RPC_ENV });
    await runPeg(second.c);
    expect(first.alerts.map((a) => a.signature)).toEqual(['peg-mint-check']);
    expect(second.alerts).toEqual([]);
  });
});
```

Check `balanceRpcUrls` reads `RPC_ETHEREUM`/`RPC_FALLBACKS` (it does, via `keyedRpcUrls`), so `RPC_ENV` keeps the tests on one fake endpoint.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter worker exec vitest run test/peg-job.test.ts`
Expected: FAIL with "Cannot find module '../src/jobs/peg'"

- [ ] **Step 4: Implement the job**

```ts
// worker/src/jobs/peg.ts
import { pegLiveBody, readPegLive, type PegReading } from '@ccip-dev/core';
import type { RunContext } from '../context';
import { PEG_ATTRIBUTION, pegConfig } from '../peg-config';
import { putJson, TTL } from '../publish';
import { balanceRpcUrls } from '../rpc';
import * as store from '../store';

export const PEG_RPC_ALERT_AFTER = 3;
/** stLINK is redeemable 1:1 in time, so a spot this far off is a bad read, not a market. */
export const SANE_SPOT = { min: 0.5, max: 1.5 } as const;

export async function runPeg(c: RunContext): Promise<void> {
  const reading = await readOrCount(c);
  if (reading === null) return;
  if (!(reading.spot > SANE_SPOT.min && reading.spot < SANE_SPOT.max)) {
    await c.alert('peg-bad-read', `The stLINK peg read a spot of ${reading.spot} LINK, outside ${SANE_SPOT.min}–${SANE_SPOT.max}; the sample was dropped`);
    return;
  }
  await askForMintCapCheck(c, reading);
  const live = pegLiveBody(reading);
  const { thresholds } = pegConfig(c.env);
  await putJson(c.env.PUBLIC, 'peg.json', { attribution: PEG_ATTRIBUTION, thresholds, ...live, episode: null, recent_episodes: [] }, TTL.peg, c.deps.now());
}

async function readOrCount(c: RunContext): Promise<PegReading | null> {
  const db = c.env.DB;
  try {
    const reading = await readPegLive(c.deps, balanceRpcUrls(c.env));
    await store.setMeta(db, 'peg_failures', '0');
    return reading;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failures = Number((await store.getMeta(db, 'peg_failures')) ?? '0') + 1;
    await store.setMeta(db, 'peg_failures', String(failures));
    console.warn(`stLINK peg read failed (${failures} in a row): ${message}`);
    if (failures >= PEG_RPC_ALERT_AFTER) await c.alert('peg-rpc', `The stLINK peg read has failed ${failures} times in a row: ${message}`);
    return null;
  }
}

/** The instant-mint cap was read from the contract, not simulated, because the pool had no room at the time; see the runbook. */
async function askForMintCapCheck(c: RunContext, r: PegReading): Promise<void> {
  if (r.canDeposit <= 0 || (await store.getMeta(c.env.DB, 'peg_mint_cap_checked')) !== null) return;
  await c.alert('peg-mint-check', `StakingPool.canDeposit() is ${r.canDeposit.toFixed(2)} LINK for the first time: run the runbook's "stLINK peg: mint capacity check"`);
  await store.setMeta(c.env.DB, 'peg_mint_cap_checked', c.deps.now().toISOString());
}
```

Register in `worker/src/index.ts`: `import { runPeg } from './jobs/peg';` and `'*/5 * * * *': [['prices', runPrices], ['peg', runPeg]],`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter worker exec vitest run test/peg-job.test.ts test/index.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit and open the Stage 2 PR**

```bash
git add worker/src/jobs/peg.ts worker/src/index.ts packages/core/src/public.ts worker/test/peg-job.test.ts
git commit -m "Peg: read the pool and stake.link every 5 minutes and publish peg.json

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
pnpm test
git push -u origin peg-live
gh pr create --title "Peg: live depth and stake.link route state every 5 minutes (stage 2)" --body "$(cat <<'EOF'
Stage 2 of docs/superpowers/plans/2026-11-18-stlink-peg.md: one 28-call RPC batch every 5 minutes (Curve spot, EMA, get_dy ladder; PriorityPool, StakingPool, WithdrawalPool, FundFlowController), published as peg.json. Bad reads and RPC outages alert.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# Stage 3: Episodes and private alerts (PR 3)

Branch: `git switch main && git pull && git switch -c peg-alerts`

### Task 7: Episodes from the live checks, and private alerts

**Files:**
- Create: `worker/src/peg-copy.ts`
- Modify: `worker/src/jobs/peg.ts`
- Test: `worker/test/peg-copy.test.ts`, `worker/test/peg-episodes-job.test.ts`

**Interfaces:**
- Consumes: `stepPeg`, `PegMachine`, `PegEvent`, `PegOpen`, `PegSample`, `PegThresholds`, `PegLiveBody`, `PegSide` (core); `openPegEpisode`, `insertPegEpisode`, `savePegEpisode`, `recentPegEpisodes`, `PegEpisodeRow` (Task 3); `sendTelegramMessage` (`worker/src/telegram.ts`); `PegEpisodeView` (Task 6).
- Produces:
  - `peg-copy.ts`: `PEG_PAGE_URL`, `utcStamp(iso): string` ("Nov 18 15:50 UTC"), `pctText(gap): string` ("0.84%"), `linkText(n): string`, `pegCurveLine(side, live): string`, `pegRouteLine(side, live): string`, `pegTradeableLine(side, live): string`, `pegAlertText(e: PegEvent, live: PegLiveBody, opts: { publicLine: number; publicPosts: boolean; bestSize: number | null; now: Date }): string`
  - `jobs/peg.ts`: `PEG_PREV_MAX_AGE_MS = 900_000`, `PEG_RECENT = 10`, `episodeView(row: PegEpisodeRow): PegEpisodeView`; `runPeg` now publishes `episode` and `recent_episodes`.

- [ ] **Step 1: Write the failing copy test**

```ts
// worker/test/peg-copy.test.ts
import { decodePegReading, pegLiveBody, type PegLiveBody, type PegOpen } from '@ccip-dev/core';
import { PEG_LIVE_WORDS } from '@ccip-dev/core/testing';
import { describe, expect, it } from 'vitest';
import { linkText, pctText, pegAlertText, utcStamp } from '../src/peg-copy';

const BASE = pegLiveBody(decodePegReading(PEG_LIVE_WORDS.map((w) => BigInt(w))));
const live = (over: Partial<PegLiveBody> & { discountOver?: Partial<PegLiveBody['discount']> } = {}): PegLiveBody => ({
  ...BASE,
  ...over,
  discount: { ...BASE.discount, ...over.discountOver },
});
const OPEN: PegOpen = { side: 'discount', openedAt: '2026-11-18T00:00:00.000Z', peakGap: -0.0091, peakAt: '2026-11-18T01:10:00.000Z', tier: 0, public: false };
const OPTS = { publicLine: 0.0075, publicPosts: true, bestSize: 38_000, now: new Date('2026-11-18T03:20:00.000Z') };

describe('formats', () => {
  it('writes times, gaps and amounts the way the alerts read', () => {
    expect(utcStamp('2026-11-18T15:50:11.000Z')).toBe('Nov 18 15:50 UTC');
    expect(pctText(-0.0084)).toBe('0.84%');
    expect(linkText(17.88)).toBe('17.9');
    expect(linkText(38_000)).toBe('38,000');
  });
});

describe('pegAlertText', () => {
  const discount = live({ spot: 0.9916, gap: -0.0084, discountOver: { depth: 25_000, profit: 61.5, instant: 17.88, tradeable: 17.88, tradeable_profit: 0.15, queued_ahead: 0 } });

  it('opens with the gap, the Curve depth, the redeem route, what trades now and the link', () => {
    expect(pegAlertText({ kind: 'opened', episode: OPEN }, discount, OPTS)).toBe(
      [
        'stLINK at a 0.84% discount (1 stLINK = 0.9916 LINK)',
        'Curve: buying stLINK beats 1:1 up to 25,000 LINK (+61.50 LINK at that size)',
        'Redeem at 1:1: 17.9 LINK instant; the rest queues behind 0.0 stLINK, next payout after Nov 18 15:50 UTC',
        'Tradeable now: 17.9 LINK for +0.15 LINK',
        'https://ccip.dev/staking/#peg',
      ].join('\n'),
    );
  });

  it('says when no Curve size beats 1:1 and no claim window is open', () => {
    const text = pegAlertText({ kind: 'opened', episode: OPEN }, live({ gap: -0.004, spot: 0.996, discountOver: { depth: null, profit: null, tradeable: 0, tradeable_profit: null, claim_window_open: false } }), OPTS);
    expect(text).toContain('Curve: no size beats 1:1 after fees');
    expect(text).toContain('(no claim window open)');
    expect(text).toContain('Tradeable now: none at 1:1 instantly');
  });

  it('describes the mint route for a premium', () => {
    const premium = live({ spot: 1.0254, gap: 0.0254 });
    const text = pegAlertText({ kind: 'opened', episode: { ...OPEN, side: 'premium', peakGap: 0.0254 } }, premium, OPTS);
    expect(text.split('\n')[0]).toBe('stLINK at a 2.54% premium (1 stLINK = 1.0254 LINK)');
    expect(text).toContain('Mint at 1:1: 1,541 LINK instant');
  });

  it('names a crossed tier', () => {
    expect(pegAlertText({ kind: 'tier', episode: OPEN, tier: 0.01 }, discount, OPTS).split('\n')[0]).toBe('stLINK discount past 1%: now 0.84% (1 stLINK = 0.9916 LINK)');
  });

  it('says whether crossing the public line posts to the channel', () => {
    expect(pegAlertText({ kind: 'went_public', episode: OPEN }, discount, OPTS).split('\n')[0]).toBe('stLINK discount past the 0.75% public line: now 0.84%. Posting to the channel.');
    expect(pegAlertText({ kind: 'went_public', episode: OPEN }, discount, { ...OPTS, publicPosts: false }).split('\n')[0]).toBe('stLINK discount past the 0.75% public line: now 0.84%. Public posts are off.');
  });

  it('recaps a close with its length, peak and best size', () => {
    expect(pegAlertText({ kind: 'closed', episode: OPEN, closedAt: '2026-11-18T03:20:00.000Z' }, discount, OPTS)).toBe(
      ['stLINK discount closed after 3h 20m: peak 0.91% at Nov 18 01:10 UTC', 'Best Curve size seen: 38,000 LINK', 'https://ccip.dev/staking/#peg'].join('\n'),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter worker exec vitest run test/peg-copy.test.ts`
Expected: FAIL with "Cannot find module '../src/peg-copy'"

- [ ] **Step 3: Implement the copy**

```ts
// worker/src/peg-copy.ts
import type { PegEvent, PegLiveBody, PegSide } from '@ccip-dev/core';
import { formatCount, formatDuration } from '@ccip-dev/core/format';

export const PEG_PAGE_URL = 'https://ccip.dev/staking/#peg';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

export function utcStamp(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export const pctText = (gap: number) => `${(Math.abs(gap) * 100).toFixed(2)}%`;
export const linkText = (n: number) => (n < 100 ? n.toFixed(1) : formatCount(n));
const price = (live: PegLiveBody) => `1 stLINK = ${live.spot.toFixed(4)} LINK`;

export function pegCurveLine(side: PegSide, live: PegLiveBody): string {
  const r = live[side];
  if (r.depth === null || r.profit === null) return 'Curve: no size beats 1:1 after fees';
  return side === 'discount'
    ? `Curve: buying stLINK beats 1:1 up to ${linkText(r.depth)} LINK (+${r.profit.toFixed(2)} LINK at that size)`
    : `Curve: selling stLINK beats 1:1 up to ${linkText(r.depth)} stLINK (+${r.profit.toFixed(2)} LINK at that size)`;
}

export function pegRouteLine(side: PegSide, live: PegLiveBody): string {
  if (side === 'discount') {
    const d = live.discount;
    const window = d.claim_window_open ? '' : ' (no claim window open)';
    return `Redeem at 1:1: ${linkText(d.instant)} LINK instant; the rest queues behind ${linkText(d.queued_ahead)} stLINK, next payout after ${utcStamp(d.next_payout_after)}${window}`;
  }
  const p = live.premium;
  return p.instant > 0 ? `Mint at 1:1: ${linkText(p.instant)} LINK instant` : `Mint at 1:1: queued behind ${linkText(p.queued_ahead)} LINK, stLINK claimed later`;
}

export function pegTradeableLine(side: PegSide, live: PegLiveBody): string {
  const r = live[side];
  if (r.tradeable <= 0) return 'Tradeable now: none at 1:1 instantly';
  return `Tradeable now: ${linkText(r.tradeable)} LINK${r.tradeable_profit === null ? '' : ` for +${r.tradeable_profit.toFixed(2)} LINK`}`;
}

/** Plain text for the owner's alert chat: one message per episode event. */
export function pegAlertText(e: PegEvent, live: PegLiveBody, opts: { publicLine: number; publicPosts: boolean; bestSize: number | null; now: Date }): string {
  const side = e.episode.side;
  const state = [pegCurveLine(side, live), pegRouteLine(side, live), pegTradeableLine(side, live), PEG_PAGE_URL];
  switch (e.kind) {
    case 'opened':
      return [`stLINK at a ${pctText(live.gap)} ${side} (${price(live)})`, ...state].join('\n');
    case 'tier':
      return [`stLINK ${side} past ${Math.round(e.tier * 100)}%: now ${pctText(live.gap)} (${price(live)})`, ...state].join('\n');
    case 'went_public':
      return [`stLINK ${side} past the ${pctText(opts.publicLine)} public line: now ${pctText(live.gap)}. ${opts.publicPosts ? 'Posting to the channel.' : 'Public posts are off.'}`, ...state].join('\n');
    case 'closed': {
      const lasted = formatDuration((Date.parse(e.closedAt) - Date.parse(e.episode.openedAt)) / 1000);
      const best = opts.bestSize === null ? [] : [`Best Curve size seen: ${linkText(opts.bestSize)} LINK`];
      return [`stLINK ${side} closed after ${lasted}: peak ${pctText(e.episode.peakGap)} at ${utcStamp(e.episode.peakAt)}`, ...best, PEG_PAGE_URL].join('\n');
    }
  }
}
```

Run: `pnpm --filter worker exec vitest run test/peg-copy.test.ts`. Expected: PASS.

- [ ] **Step 4: Write the failing episode job test**

```ts
// worker/test/peg-episodes-job.test.ts
import { PegFileSchema } from '@ccip-dev/core/public';
import { fakeFetch, jsonResponse, pegAmountWord, PEG_WORD, pegRpc } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { runPeg } from '../src/jobs/peg';
import * as pegStore from '../src/peg-store';
import { harness, readPublic, resetStorage } from './helpers';

beforeEach(resetStorage);

const ENV = { RPC_ETHEREUM: 'https://rpc.one', RPC_FALLBACKS: '', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_ALERT_CHAT_ID: '42' };
const at = (minute: number) => new Date(Date.UTC(2026, 10, 18, 0, minute)).toISOString();

/** Runs one check at `minute` with stLINK at `spot` LINK; returns the alert-chat messages it sent. */
async function check(minute: number, spot: number): Promise<string[]> {
  const sent: string[] = [];
  const telegram = (url: string, init?: RequestInit) => {
    if (!url.startsWith('https://api.telegram.org/')) return undefined;
    sent.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return jsonResponse({ ok: true });
  };
  await runPeg(harness({ now: at(minute), fetch: fakeFetch(telegram, pegRpc({ [PEG_WORD.spot]: pegAmountWord(spot) })), env: ENV }).c);
  return sent;
}

const heads = (msgs: string[]) => msgs.map((m) => m.split('\n')[0]);

describe('episodes from the 5-minute checks', () => {
  it('opens on the second sample, goes public and tiers, closes, and keeps one row', async () => {
    expect(await check(0, 0.995)).toEqual([]);
    expect(heads(await check(5, 0.9948))).toEqual(['stLINK at a 0.52% discount (1 stLINK = 0.9948 LINK)']);
    expect(await check(10, 0.99)).toEqual([]);
    expect(heads(await check(15, 0.99))).toEqual(['stLINK discount past the 0.75% public line: now 1.00%. Public posts are off.', 'stLINK discount past 1%: now 1.00% (1 stLINK = 0.9900 LINK)']);
    await check(20, 0.9995);
    expect(heads(await check(25, 0.9995))).toEqual(['stLINK discount closed after 25m 0s: peak 1.00% at Nov 18 00:10 UTC']);
    const rows = await pegStore.recentPegEpisodes(env.DB, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ side: 'discount', opened_at: at(0), closed_at: at(25), tier: 1, public: 1, public_at: at(15) });
  });

  it('publishes the open episode in peg.json while it runs', async () => {
    await check(0, 0.995);
    await check(5, 0.995);
    const peg = PegFileSchema.parse(await readPublic('peg.json'));
    expect(peg.episode).toMatchObject({ side: 'discount', opened_at: at(0), closed_at: null, public: false });
    expect(peg.recent_episodes).toHaveLength(1);
  });

  it('does not count a sample older than 15 minutes as the previous one', async () => {
    await check(0, 0.995);
    expect(await check(20, 0.995)).toEqual([]);
    expect(heads(await check(25, 0.995))).toEqual(['stLINK at a 0.50% discount (1 stLINK = 0.9950 LINK)']);
  });

  it('closes a discount and opens a premium in one run when the price flips', async () => {
    await check(0, 0.995);
    await check(5, 0.995);
    await check(10, 1.004);
    expect(heads(await check(15, 1.004))).toEqual(['stLINK discount closed after 15m 0s: peak 0.50% at Nov 18 00:00 UTC', 'stLINK at a 0.40% premium (1 stLINK = 1.0040 LINK)']);
    const rows = await pegStore.recentPegEpisodes(env.DB, 10);
    expect(rows.map((r) => [r.side, r.closed_at])).toEqual([['premium', null], ['discount', at(15)]]);
  });

  it('keeps the largest Curve depth seen as the best size', async () => {
    await check(0, 0.995);
    await check(5, 0.995);
    expect((await pegStore.openPegEpisode(env.DB))?.best_size).toBe(10_000);
  });
});
```

The ladder in the fixture stays fixed while the spot changes, so `best_size` is the fixture's 10,000.

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm --filter worker exec vitest run test/peg-episodes-job.test.ts`
Expected: FAIL: no messages are sent and no rows are written.

- [ ] **Step 6: Wire episodes into the job**

Replace the body of `runPeg` after `const live = pegLiveBody(reading);` and add the helpers:

```ts
// worker/src/jobs/peg.ts (additions)
import { stepPeg, type PegEvent, type PegLiveBody, type PegMachine, type PegOpen, type PegSample, type PegThresholds } from '@ccip-dev/core';
import type { PegEpisodeView } from '@ccip-dev/core/public';
import { pegAlertText } from '../peg-copy';
import * as pegStore from '../peg-store';
import { sendTelegramMessage } from '../telegram';

/** A previous sample older than this is not "in a row" with the next: a skipped run must not confirm an episode. */
export const PEG_PREV_MAX_AGE_MS = 15 * 60_000;
export const PEG_RECENT = 10;
const PREV_KEY = 'peg_prev';

export async function runPeg(c: RunContext): Promise<void> {
  // … readOrCount, SANE_SPOT and askForMintCapCheck exactly as in Task 6 …
  const live = pegLiveBody(reading);
  const config = pegConfig(c.env);
  const { episodes } = await advanceEpisodes(c, live, config);
  await putJson(
    c.env.PUBLIC,
    'peg.json',
    { attribution: PEG_ATTRIBUTION, thresholds: config.thresholds, ...live, episode: episodes.find((e) => e.closed_at === null) ?? null, recent_episodes: episodes },
    TTL.peg,
    c.deps.now(),
  );
}

export function episodeView(row: pegStore.PegEpisodeRow): PegEpisodeView {
  return {
    id: row.id, side: row.side, opened_at: row.opened_at, closed_at: row.closed_at, peak_gap: row.peak_gap, peak_at: row.peak_at,
    best_size: row.best_size, best_profit: row.best_profit, public: row.public === 1, public_at: row.public_at,
  };
}

function previous(raw: string | null, now: Date): PegSample | null {
  if (raw === null) return null;
  try {
    const prev = JSON.parse(raw) as PegSample;
    return now.getTime() - Date.parse(prev.at) <= PEG_PREV_MAX_AGE_MS ? prev : null;
  } catch {
    console.warn(`[peg] unreadable ${PREV_KEY}: ${raw}`);
    return null;
  }
}

const toOpen = (row: pegStore.PegEpisodeRow): PegOpen => ({ side: row.side, openedAt: row.opened_at, peakGap: row.peak_gap, peakAt: row.peak_at, tier: row.tier, public: row.public === 1 });

interface Tracked {
  id: number;
  best: { size: number | null; profit: number | null };
  publicAt: string | null;
}

/** One check through the episode rules: rows are written before the alerts go, so a failed send never repeats an event. */
async function advanceEpisodes(c: RunContext, live: PegLiveBody, config: { thresholds: PegThresholds; publicPosts: boolean }): Promise<{ episodes: PegEpisodeView[] }> {
  const db = c.env.DB;
  const now = c.deps.now();
  const [row, prevRaw] = await Promise.all([pegStore.openPegEpisode(db), store.getMeta(db, PREV_KEY)]);
  const machine: PegMachine = { open: row ? toOpen(row) : null, prev: previous(prevRaw, now) };
  const step = stepPeg(machine, { at: now.toISOString(), gap: live.gap }, config.thresholds, 2);

  let tracked: Tracked | null = row ? { id: row.id, best: { size: row.best_size, profit: row.best_profit }, publicAt: row.public_at } : null;
  const bestAtClose = new Map<PegEvent, number | null>();
  for (const e of step.events) {
    if (e.kind === 'closed' && tracked) {
      bestAtClose.set(e, tracked.best.size);
      await pegStore.savePegEpisode(db, tracked.id, { ...fields(e.episode, tracked), closed_at: e.closedAt });
      tracked = null;
    }
    if (e.kind === 'opened') tracked = { id: await pegStore.insertPegEpisode(db, e.episode), best: { size: null, profit: null }, publicAt: null };
    if (e.kind === 'went_public' && tracked) tracked.publicAt = now.toISOString();
  }
  const open = step.machine.open;
  if (open && tracked) {
    const route = live[open.side];
    if (route.depth !== null && (tracked.best.size === null || route.depth > tracked.best.size)) tracked.best = { size: route.depth, profit: route.profit };
    await pegStore.savePegEpisode(db, tracked.id, { ...fields(open, tracked), closed_at: null });
  }
  await store.setMeta(db, PREV_KEY, JSON.stringify({ at: now.toISOString(), gap: live.gap } satisfies PegSample));

  for (const e of step.events) {
    const text = pegAlertText(e, live, { publicLine: config.thresholds.public, publicPosts: config.publicPosts, bestSize: bestAtClose.get(e) ?? null, now });
    await sendPegAlert(c, e.kind, text);
  }
  return { episodes: (await pegStore.recentPegEpisodes(db, PEG_RECENT)).map(episodeView) };
}

function fields(o: PegOpen, t: Tracked) {
  return { peak_gap: o.peakGap, peak_at: o.peakAt, tier: o.tier, public: o.public, public_at: t.publicAt, best_size: t.best.size, best_profit: t.best.profit };
}

async function sendPegAlert(c: RunContext, kind: PegEvent['kind'], text: string): Promise<void> {
  const token = c.env.TELEGRAM_BOT_TOKEN;
  const chatId = c.env.TELEGRAM_ALERT_CHAT_ID;
  if (!token || !chatId) {
    console.warn(`[peg] ${text}`);
    return;
  }
  const failure = await sendTelegramMessage(c.deps.fetch, { token, chatId }, text);
  console.log(JSON.stringify(failure === null ? { peg_alert_sent: kind } : { peg_alert_failed: kind, failure, text }));
}
```

A closed episode's `public_at` survives because `fields` reads `tracked.publicAt`, which was loaded from the row.

- [ ] **Step 7: Run all peg Worker tests**

Run: `pnpm --filter worker exec vitest run test/peg-episodes-job.test.ts test/peg-job.test.ts test/peg-copy.test.ts && pnpm typecheck`
Expected: PASS. Task 6's `peg.json` test still expects `episode: null`; it does, because a single sample never opens an episode.

- [ ] **Step 8: Commit and open the Stage 3 PR**

```bash
git add worker/src/peg-copy.ts worker/src/jobs/peg.ts worker/test/peg-copy.test.ts worker/test/peg-episodes-job.test.ts
git commit -m "Peg: episodes from the 5-minute checks, with private Telegram alerts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
pnpm test
git push -u origin peg-alerts
gh pr create --title "Peg: episodes and private alerts (stage 3)" --body "$(cat <<'EOF'
Stage 3 of docs/superpowers/plans/2026-11-18-stlink-peg.md: two 5-minute samples open or close an episode; the alert chat gets one message per open, tier, public crossing and close, with Curve depth, the 1:1 route and what trades now. peg.json carries the open and recent episodes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# Stage 4: The /staking section (PR 4)

Branch: `git switch main && git pull && git switch -c peg-page`. Stages 1–3 must be deployed, so `peg.json` and `peg-history.json` exist at `data.ccip.dev` for the build.

### Task 8: Site view logic

**Files:**
- Create: `site/src/lib/peg-view.ts`
- Modify: `packages/core/src/testing.ts` (add `PEG_FILE_FIXTURE`, `PEG_HISTORY_FIXTURE`)
- Test: `site/test/peg-view.test.ts`

**Interfaces:**
- Consumes: `PegFile`, `PegHistoryFile`, `PegEpisodeView` types (core/public); `formatCount` (site `lib/format`).
- Produces: `formatGap(gap): string` ("−0.84%", "+2.54%", "0.00%"), `priceText(spot): string` ("1 stLINK = 0.99975 LINK"), `linkAmount(n): string`, `utcStamp(iso): string`, `activeSide(gap): 'discount' | 'premium' | null`, `interface RouteRow { label: string; value: string }`, `routeRows(peg: PegFile, side): RouteRow[]`, `type PegRange = '7D' | '30D' | '1Y' | 'All'`, `PEG_RANGES`, `rangeRows(history, range, now): PegBarRow[]`, `markerLabel(m): string`, `interface GapChart`, `gapChart(rows, opts): GapChart | null`, `nearestPoint(chart, x): number`, `recordsView(history, now): { label: string; value: string }[]`, `interface EpisodeRow { side; when: string; length: string; peak: string }`, `episodeRows(history, limit = 10): EpisodeRow[]`.

- [ ] **Step 1: Add the fixtures to `packages/core/src/testing.ts`**

```ts
import type { PegFile, PegHistoryFile } from './public';
import { decodePegReading, pegLiveBody } from './peg-live';

export const PEG_FILE_FIXTURE: PegFile = {
  schema_version: 1,
  updated_at: '2026-11-18T01:35:00.000Z',
  attribution: 'Data: Curve (prices.curve.finance), Ethereum mainnet, stake.link contracts',
  thresholds: { private: 0.003, public: 0.0075 },
  ...pegLiveBody(decodePegReading(PEG_LIVE_WORDS.map((w) => BigInt(w)))),
  episode: null,
  recent_episodes: [
    { id: 2, side: 'premium', opened_at: '2026-09-25T20:00:00.000Z', closed_at: '2026-09-26T16:00:00.000Z', peak_gap: 0.0564, peak_at: '2026-09-25T22:00:00.000Z', best_size: 50_000, best_profit: 1_204.5, public: true, public_at: '2026-09-25T20:05:00.000Z' },
  ],
};

export const PEG_HISTORY_FIXTURE: PegHistoryFile = {
  schema_version: 1,
  updated_at: '2026-11-18T01:00:00.000Z',
  attribution: PEG_FILE_FIXTURE.attribution,
  thresholds: { private: 0.003, public: 0.0075 },
  hours: [
    ['2026-11-17T23:00:00.000Z', 0.9997, 0.9998, 0.9996, 0.9997],
    ['2026-11-18T00:00:00.000Z', 0.9997, 0.9998, 0.9995, 0.9996],
    ['2026-11-18T01:00:00.000Z', 0.9996, 0.9998, 0.9996, 0.99975],
  ],
  days: [
    ['2026-09-23T00:00:00.000Z', 0.9949, 0.9967, 0.9914, 0.9939],
    ['2026-09-25T00:00:00.000Z', 0.9916, 1.0564, 0.9912, 1.0186],
    ['2026-11-17T00:00:00.000Z', 0.9997, 0.9998, 0.9996, 0.9997],
    ['2026-11-18T00:00:00.000Z', 0.9997, 0.9998, 0.9995, 0.99975],
  ],
  markers: [{ hour: '2026-09-23T16:00:00.000Z', kind: 'stakelink_unbonding', vaults: 80, link: null }],
  episodes: [
    { side: 'discount', start: '2026-09-22T12:00:00.000Z', end: '2026-09-25T19:00:00.000Z', peak_gap: -0.0088, peak_at: '2026-09-25T11:00:00.000Z', hours: 79 },
    { side: 'premium', start: '2026-09-25T19:00:00.000Z', end: '2026-09-26T16:00:00.000Z', peak_gap: 0.0564, peak_at: '2026-09-25T21:00:00.000Z', hours: 21 },
  ],
  records: {
    deepest_discount: { gap: -0.0088, hour: '2026-09-25T11:00:00.000Z' },
    highest_premium: { gap: 0.0564, hour: '2026-09-25T21:00:00.000Z' },
    longest: { side: 'discount', start: '2026-09-22T12:00:00.000Z', end: '2026-09-25T19:00:00.000Z', peak_gap: -0.0088, peak_at: '2026-09-25T11:00:00.000Z', hours: 79 },
    last_end: '2026-09-26T16:00:00.000Z',
  },
};
```

Run `pnpm --filter @ccip-dev/core test` to confirm `testing.ts` still compiles.

- [ ] **Step 2: Write the failing test**

```ts
// site/test/peg-view.test.ts
import { PEG_FILE_FIXTURE, PEG_HISTORY_FIXTURE } from '@ccip-dev/core/testing';
import { describe, expect, it } from 'vitest';
import { activeSide, episodeRows, formatGap, gapChart, markerLabel, nearestPoint, priceText, rangeRows, recordsView, routeRows } from '../src/lib/peg-view';

const NOW = new Date('2026-11-18T01:40:00.000Z');

describe('formats', () => {
  it('signs the gap with a true minus and keeps two decimals', () => {
    expect(formatGap(-0.0084)).toBe('−0.84%');
    expect(formatGap(0.0254)).toBe('+2.54%');
    expect(formatGap(0.00004)).toBe('0.00%');
    expect(priceText(0.999751)).toBe('1 stLINK = 0.99975 LINK');
  });

  it('calls the side the gap is on, or none at exactly 1:1', () => {
    expect(activeSide(-0.0002)).toBe('discount');
    expect(activeSide(0.0002)).toBe('premium');
    expect(activeSide(0)).toBeNull();
  });
});

describe('routeRows', () => {
  it('describes the discount route', () => {
    expect(routeRows(PEG_FILE_FIXTURE, 'discount')).toEqual([
      { label: 'Curve, under 1:1', value: 'up to 10,000 LINK · +0.53 LINK' },
      { label: 'Redeem at 1:1 now', value: '0.0 LINK' },
      { label: 'Tradeable now', value: 'none' },
      { label: 'Withdrawal queue', value: '1,541 stLINK ahead · next payout after Nov 18 15:50 UTC' },
    ]);
  });

  it('describes the premium route', () => {
    expect(routeRows(PEG_FILE_FIXTURE, 'premium')).toEqual([
      { label: 'Curve, over 1:1', value: 'no size after fees' },
      { label: 'Mint at 1:1 now', value: '1,541 LINK' },
      { label: 'Tradeable now', value: 'none' },
      { label: 'Deposit queue', value: 'empty' },
    ]);
  });
});

describe('rangeRows', () => {
  it('uses hours for 7 and 30 days and days beyond', () => {
    expect(rangeRows(PEG_HISTORY_FIXTURE, '7D', NOW)).toHaveLength(3);
    expect(rangeRows(PEG_HISTORY_FIXTURE, '1Y', NOW).map((r) => r[0].slice(0, 10))).toEqual(['2026-09-23', '2026-09-25', '2026-11-17', '2026-11-18']);
    expect(rangeRows(PEG_HISTORY_FIXTURE, 'All', NOW)).toHaveLength(4);
  });
});

describe('gapChart', () => {
  const opts = { width: 600, height: 200, pad: { top: 10, right: 10, bottom: 20, left: 40 }, thresholds: PEG_HISTORY_FIXTURE.thresholds, episodes: PEG_HISTORY_FIXTURE.episodes, markers: PEG_HISTORY_FIXTURE.markers };

  it('has no chart without rows', () => {
    expect(gapChart([], opts)).toBeNull();
  });

  it('centres zero, draws the threshold bands and spans the time range', () => {
    const c = gapChart(PEG_HISTORY_FIXTURE.days, opts)!;
    expect(c.zeroY).toBeCloseTo(10 + (200 - 30) / 2, 6);
    expect(c.bands.map((b) => b.line)).toEqual([0.0075, 0.003, -0.003, -0.0075]);
    expect(c.points[0]!.x).toBe(40);
    expect(c.points.at(-1)!.x).toBe(590);
    expect(c.path.startsWith('M40 ')).toBe(true);
  });

  it('shades the episodes and pins the markers inside the range', () => {
    const c = gapChart(PEG_HISTORY_FIXTURE.days, opts)!;
    expect(c.spans.map((s) => s.side)).toEqual(['discount', 'premium']);
    expect(c.pins.map((p) => p.label)).toEqual(['80 stake.link vaults began unbonding']);
  });

  it('finds the nearest point to the pointer', () => {
    const c = gapChart(PEG_HISTORY_FIXTURE.days, opts)!;
    expect(nearestPoint(c, 45)).toBe(0);
    expect(nearestPoint(c, 589)).toBe(3);
  });
});

describe('episodeRows', () => {
  it('lists episodes newest first, marking one still running', () => {
    expect(episodeRows(PEG_HISTORY_FIXTURE)).toEqual([
      { side: 'premium', when: 'Sep 25', length: '21h', peak: '+5.64%' },
      { side: 'discount', when: 'Sep 22', length: '79h', peak: '−0.88%' },
    ]);
    const running = { ...PEG_HISTORY_FIXTURE, episodes: [{ ...PEG_HISTORY_FIXTURE.episodes[0]!, end: null }] };
    expect(episodeRows(running)[0]!.length).toBe('79h, running');
  });
});

describe('markerLabel and recordsView', () => {
  it('words the markers', () => {
    expect(markerLabel({ hour: '', kind: 'stakelink_deposit', vaults: 3, link: 12_500 })).toBe('stake.link vaults staked 12,500 LINK');
  });

  it('lists the records', () => {
    expect(recordsView(PEG_HISTORY_FIXTURE, NOW)).toEqual([
      { label: 'Deepest discount', value: '−0.88% · Sep 25 11:00 UTC' },
      { label: 'Highest premium', value: '+5.64% · Sep 25 21:00 UTC' },
      { label: 'Longest episode', value: '79 hours · discount from Sep 22' },
      { label: 'Since the last one', value: '52 days' },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter site exec vitest run test/peg-view.test.ts`
Expected: FAIL with "Cannot find module '../src/lib/peg-view'"

- [ ] **Step 4: Write the implementation**

```ts
// site/src/lib/peg-view.ts
import type { PegFile, PegHistoryFile } from '@ccip-dev/core/public';
import { formatCount } from './format';

type Side = 'discount' | 'premium';
type Row = PegHistoryFile['hours'][number];
type Marker = PegHistoryFile['markers'][number];
type Episode = PegHistoryFile['episodes'][number];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const DAY_MS = 86_400_000;

export function formatGap(gap: number): string {
  const pct = (Math.abs(gap) * 100).toFixed(2);
  return pct === '0.00' ? '0.00%' : `${gap < 0 ? '−' : '+'}${pct}%`;
}

export const priceText = (spot: number) => `1 stLINK = ${spot.toFixed(5)} LINK`;
export const linkAmount = (n: number) => (n < 100 ? n.toFixed(1) : formatCount(n));

export function utcStamp(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

const shortDay = (iso: string) => `${MONTHS[new Date(iso).getUTCMonth()]} ${new Date(iso).getUTCDate()}`;

export function activeSide(gap: number): Side | null {
  return gap < 0 ? 'discount' : gap > 0 ? 'premium' : null;
}

export interface RouteRow {
  label: string;
  value: string;
}

export function routeRows(peg: PegFile, side: Side): RouteRow[] {
  const r = peg[side];
  const curve = r.depth === null || r.profit === null ? 'no size after fees' : `up to ${linkAmount(r.depth)} ${side === 'discount' ? 'LINK' : 'stLINK'} · +${r.profit.toFixed(2)} LINK`;
  const tradeable = r.tradeable > 0 ? `${linkAmount(r.tradeable)} LINK${r.tradeable_profit === null ? '' : ` · +${r.tradeable_profit.toFixed(2)} LINK`}` : 'none';
  if (side === 'discount') {
    const window = peg.discount.claim_window_open ? '' : ' · no claim window open';
    return [
      { label: 'Curve, under 1:1', value: curve },
      { label: 'Redeem at 1:1 now', value: `${linkAmount(r.instant)} LINK` },
      { label: 'Tradeable now', value: tradeable },
      { label: 'Withdrawal queue', value: `${linkAmount(r.queued_ahead)} stLINK ahead · next payout after ${utcStamp(peg.discount.next_payout_after)}${window}` },
    ];
  }
  return [
    { label: 'Curve, over 1:1', value: curve },
    { label: 'Mint at 1:1 now', value: `${linkAmount(r.instant)} LINK` },
    { label: 'Tradeable now', value: tradeable },
    { label: 'Deposit queue', value: r.queued_ahead > 0 ? `${linkAmount(r.queued_ahead)} LINK ahead` : 'empty' },
  ];
}

export type PegRange = '7D' | '30D' | '1Y' | 'All';
export const PEG_RANGES: readonly PegRange[] = ['7D', '30D', '1Y', 'All'];

export function rangeRows(history: PegHistoryFile, range: PegRange, now: Date): Row[] {
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
  switch (range) {
    case '7D':
      return history.hours.filter((r) => r[0] >= since(7));
    case '30D':
      return history.hours.filter((r) => r[0] >= since(30));
    case '1Y':
      return history.days.filter((r) => r[0] >= since(365));
    case 'All':
      return history.days;
  }
}

export function markerLabel(m: Marker): string {
  return m.kind === 'stakelink_unbonding' ? `${formatCount(m.vaults)} stake.link vaults began unbonding` : `stake.link vaults staked ${formatCount(m.link ?? 0)} LINK`;
}

export interface GapChart {
  path: string;
  zeroY: number;
  bands: { y: number; line: number }[];
  ticks: { y: number; label: string }[];
  points: { x: number; y: number; row: Row }[];
  spans: { x0: number; x1: number; side: Side }[];
  pins: { x: number; label: string }[];
}

export interface GapChartOptions {
  width: number;
  height: number;
  pad: { top: number; right: number; bottom: number; left: number };
  thresholds: { private: number; public: number };
  episodes: readonly Episode[];
  markers: readonly Marker[];
}

/** Closes as a line around zero; the scale is symmetric so a discount and a premium of the same size look the same. */
export function gapChart(rows: readonly Row[], o: GapChartOptions): GapChart | null {
  if (rows.length === 0) return null;
  const t0 = Date.parse(rows[0]![0]);
  const t1 = Date.parse(rows.at(-1)![0]);
  const innerW = o.width - o.pad.left - o.pad.right;
  const innerH = o.height - o.pad.top - o.pad.bottom;
  const reach = Math.max(o.thresholds.public * 1.25, ...rows.flatMap((r) => [Math.abs(r[2] - 1), Math.abs(r[3] - 1)]));
  const x = (ms: number) => o.pad.left + (t1 === t0 ? innerW : ((ms - t0) / (t1 - t0)) * innerW);
  const y = (gap: number) => o.pad.top + ((reach - gap) / (2 * reach)) * innerH;
  const points = rows.map((row) => ({ x: x(Date.parse(row[0])), y: y(row[4] - 1), row }));
  const clamp = (ms: number) => Math.min(Math.max(ms, t0), t1);
  return {
    path: points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' '),
    zeroY: y(0),
    bands: [o.thresholds.public, o.thresholds.private, -o.thresholds.private, -o.thresholds.public].map((line) => ({ y: y(line), line })),
    ticks: [reach, 0, -reach].map((g) => ({ y: y(g), label: formatGap(g) })),
    points,
    spans: o.episodes
      .filter((e) => Date.parse(e.end ?? rows.at(-1)![0]) >= t0 && Date.parse(e.start) <= t1)
      .map((e) => ({ x0: x(clamp(Date.parse(e.start))), x1: x(clamp(Date.parse(e.end ?? rows.at(-1)![0]))), side: e.side })),
    pins: o.markers.filter((m) => Date.parse(m.hour) >= t0 && Date.parse(m.hour) <= t1).map((m) => ({ x: x(Date.parse(m.hour)), label: markerLabel(m) })),
  };
}

export function nearestPoint(chart: GapChart, px: number): number {
  let best = 0;
  for (const [i, p] of chart.points.entries()) if (Math.abs(p.x - px) < Math.abs(chart.points[best]!.x - px)) best = i;
  return best;
}

export function recordsView(history: PegHistoryFile, now: Date): RouteRow[] {
  const r = history.records;
  const rows: RouteRow[] = [];
  if (r.deepest_discount) rows.push({ label: 'Deepest discount', value: `${formatGap(r.deepest_discount.gap)} · ${utcStamp(r.deepest_discount.hour)}` });
  if (r.highest_premium) rows.push({ label: 'Highest premium', value: `${formatGap(r.highest_premium.gap)} · ${utcStamp(r.highest_premium.hour)}` });
  if (r.longest) rows.push({ label: 'Longest episode', value: `${formatCount(r.longest.hours)} hours · ${r.longest.side} from ${shortDay(r.longest.start)}` });
  if (r.last_end) rows.push({ label: 'Since the last one', value: `${formatCount(Math.floor((now.getTime() - Date.parse(r.last_end)) / DAY_MS))} days` });
  return rows;
}

export interface EpisodeRow {
  side: Side;
  when: string;
  length: string;
  peak: string;
}

export function episodeRows(history: PegHistoryFile, limit = 10): EpisodeRow[] {
  return [...history.episodes]
    .reverse()
    .slice(0, limit)
    .map((e) => ({ side: e.side, when: shortDay(e.start), length: `${formatCount(e.hours)}h${e.end === null ? ', running' : ''}`, peak: formatGap(e.peak_gap) }));
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter site exec vitest run test/peg-view.test.ts && pnpm --filter site typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/peg-view.ts site/test/peg-view.test.ts packages/core/src/testing.ts
git commit -m "Peg: the view logic for the /staking section

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: The section, the chart and the page wiring

**Files:**
- Create: `site/src/components/staking/Peg.tsx`, `site/src/components/staking/PegChart.tsx`
- Modify: `site/src/components/staking/StakingView.tsx` (props, `SECTIONS`, render)
- Modify: `site/src/pages/staking/index.astro` (load both files)
- Modify: `site/src/styles/staking.css` (append the peg block)

**Interfaces:**
- Consumes: everything from Task 8; `fetchPublic` (`site/src/lib/data.ts`); `FreshnessNote`.
- Produces: `<Peg initial={PegFile | null} history={PegHistoryFile | null} now={Date | null} />`.

- [ ] **Step 1: Write the chart**

```tsx
// site/src/components/staking/PegChart.tsx
import type { PegHistoryFile } from '@ccip-dev/core/public';
import { useMemo, useState } from 'react';
import { formatGap, gapChart, nearestPoint, PEG_RANGES, rangeRows, utcStamp, type PegRange } from '../../lib/peg-view';

const W = 720;
const H = 260;
const PAD = { top: 14, right: 12, bottom: 22, left: 56 };

export default function PegChart({ history, now }: { history: PegHistoryFile; now: Date }) {
  const [range, setRange] = useState<PegRange>('30D');
  const [hover, setHover] = useState<number | null>(null);
  const chart = useMemo(
    () => gapChart(rangeRows(history, range, now), { width: W, height: H, pad: PAD, thresholds: history.thresholds, episodes: history.episodes, markers: history.markers }),
    [history, range, now],
  );
  const point = chart && hover !== null ? chart.points[hover] : null;
  return (
    <div className="panel peg-chart">
      <div className="panel-head">
        <span className="eyebrow">Gap to 1:1</span>
        <div className="peg-ranges" role="group" aria-label="Range">
          {PEG_RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={r === range} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>
      {chart === null ? (
        <p className="foot">No prices in this range yet.</p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`stLINK's gap to 1 LINK over ${range}`}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setHover(nearestPoint(chart, ((e.clientX - box.left) / box.width) * W));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {chart.spans.map((s, i) => (
            <rect key={i} x={s.x0} y={PAD.top} width={Math.max(1, s.x1 - s.x0)} height={H - PAD.top - PAD.bottom} className={`peg-span ${s.side}`} />
          ))}
          {chart.bands.map((b) => (
            <line key={b.line} x1={PAD.left} x2={W - PAD.right} y1={b.y} y2={b.y} className={Math.abs(b.line) === history.thresholds.public ? 'peg-band public' : 'peg-band'} />
          ))}
          <line x1={PAD.left} x2={W - PAD.right} y1={chart.zeroY} y2={chart.zeroY} className="peg-zero" />
          {chart.ticks.map((t) => (
            <text key={t.label} x={PAD.left - 8} y={t.y + 4} className="peg-tick">
              {t.label}
            </text>
          ))}
          <path d={chart.path} className="peg-line" />
          {chart.pins.map((p, i) => (
            <g key={i} className="peg-pin">
              <line x1={p.x} x2={p.x} y1={PAD.top} y2={H - PAD.bottom} />
              <circle cx={p.x} cy={PAD.top + 4} r={4}>
                <title>{p.label}</title>
              </circle>
            </g>
          ))}
          {point && <circle cx={point.x} cy={point.y} r={4} className="peg-dot" />}
        </svg>
      )}
      <p className="foot peg-readout" aria-live="polite">
        {point
          ? `${utcStamp(point.row[0])} · close ${formatGap(point.row[4] - 1)} · low ${formatGap(point.row[3] - 1)} · high ${formatGap(point.row[2] - 1)}`
          : `Shaded: episodes past ${formatGap(history.thresholds.private).replace('+', '±')}. Pins: stake.link vault activity.`}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Write the section**

```tsx
// site/src/components/staking/Peg.tsx
import type { PegFile, PegHistoryFile } from '@ccip-dev/core/public';
import { useEffect, useState } from 'react';
import { fetchPublic } from '../../lib/data';
import { activeSide, episodeRows, formatGap, priceText, recordsView, routeRows, utcStamp } from '../../lib/peg-view';
import FreshnessNote from '../FreshnessNote';
import PegChart from './PegChart';

const POLL_MS = 60_000;

function Route({ peg, side }: { peg: PegFile; side: 'discount' | 'premium' }) {
  const lit = activeSide(peg.gap) === side;
  return (
    <div className={lit ? 'panel peg-route lit' : 'panel peg-route'}>
      <p className="eyebrow">{side === 'discount' ? 'Discount route' : 'Premium route'}</p>
      <h3>{side === 'discount' ? 'Buy stLINK on Curve → redeem at 1:1' : 'Mint stLINK at 1:1 → sell on Curve'}</h3>
      <dl>
        {routeRows(peg, side).map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function Peg({ initial, history: initialHistory, now }: { initial: PegFile | null; history: PegHistoryFile | null; now: Date | null }) {
  const [peg, setPeg] = useState(initial);
  const [history, setHistory] = useState(initialHistory);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const refresh = () =>
      fetchPublic('peg.json').then(
        (next) => live && (setPeg(next), setFailed(false)),
        () => live && setFailed(true),
      );
    fetchPublic('peg-history.json').then((next) => live && setHistory(next), () => {});
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  if (peg === null && history === null) return null;
  const episode = peg?.episode ?? null;
  return (
    <section className="band" id="peg" aria-labelledby="peg-title">
      <div className="band-head">
        <p className="eyebrow">stLINK peg</p>
        <h2 id="peg-title">{peg ? <>{priceText(peg.spot)} <span className={peg.gap < 0 ? 'peg-gap down' : 'peg-gap up'}>{formatGap(peg.gap)}</span></> : 'stLINK on Curve'}</h2>
        <p className="lead">
          stake.link's stLINK is redeemable 1:1 for LINK in time. On Curve it trades freely: when it drifts, buying the cheap side and closing the loop through stake.link pays, if that route is open now.
          {episode ? ` A ${episode.side} has been running since ${utcStamp(episode.opened_at)}, peaking at ${formatGap(episode.peak_gap)}.` : ''}
        </p>
        {peg && <FreshnessNote updatedAt={peg.updated_at} paused={failed} />}
      </div>
      {peg && (
        <div className="peg-routes">
          <Route peg={peg} side="discount" />
          <Route peg={peg} side="premium" />
        </div>
      )}
      {history && now && <PegChart history={history} now={now} />}
      {history && now && (
        <dl className="peg-records">
          {recordsView(history, now).map((r) => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {history && history.episodes.length > 0 && (
        <div className="table-wrap peg-episodes">
          <table>
            <thead>
              <tr>
                <th>Episode</th>
                <th>From</th>
                <th className="num">Length</th>
                <th className="num">Peak</th>
              </tr>
            </thead>
            <tbody>
              {episodeRows(history).map((e) => (
                <tr key={`${e.side}-${e.when}-${e.length}`}>
                  <td>{e.side}</td>
                  <td>{e.when}</td>
                  <td className="num">{e.length}</td>
                  <td className="num">{e.peak}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="foot">Curve depth is after pool fees, before gas. Not financial advice.</p>
    </section>
  );
}
```

- [ ] **Step 3: Wire the page**

In `site/src/components/staking/StakingView.tsx`:
- Add `['peg', 'stLINK peg'],` to `SECTIONS` after `['queue', 'Exit queue'],`.
- Extend the props with `initialPeg: PegFile | null; initialPegHistory: PegHistoryFile | null` (import the types from `@ccip-dev/core/public`).
- Render `<Peg initial={initialPeg} history={initialPegHistory} now={now} />` right after `{now && <ExitQueue staking={staking} now={now} />}`.

In `site/src/pages/staking/index.astro`:

```astro
const [staking, reserve, peg, pegHistory] = await Promise.all([
  buildDataIfPublished('staking.json'),
  buildData('reserve.json'),
  buildDataIfPublished('peg.json'),
  buildDataIfPublished('peg-history.json'),
]);
---
<!-- … -->
    <StakingView client:load initial={staking} linkPriceUsd={reserve.link_price_usd} initialPeg={peg} initialPegHistory={pegHistory} />
```

- [ ] **Step 4: Style it**

Append to `site/src/styles/staking.css`:

```css
/* stLINK peg */
.stk .peg-gap { font-variant-numeric: tabular-nums; }
.stk .peg-gap.down { color: #e58a8a; }
.stk .peg-gap.up { color: #7fd4a0; }
.stk .peg-routes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.stk .peg-route { opacity: 0.72; }
.stk .peg-route.lit { opacity: 1; border-color: var(--teal); box-shadow: 0 0 22px rgba(46, 211, 195, 0.14); }
.stk .peg-route h3 { margin: 6px 0 12px; font-size: 16px; }
.stk .peg-route dl, .stk .peg-records { display: grid; gap: 8px; margin: 0; }
.stk .peg-route dl div, .stk .peg-records div { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.stk .peg-route dt, .stk .peg-records dt { color: var(--muted); font-size: 13px; }
.stk .peg-route dd, .stk .peg-records dd { margin: 0; font-variant-numeric: tabular-nums; text-align: right; }
.stk .peg-chart { margin-top: 14px; }
.stk .peg-chart svg { display: block; width: 100%; height: auto; touch-action: pan-y; }
.stk .peg-ranges { display: flex; gap: 4px; }
.stk .peg-ranges button { padding: 4px 10px; border-radius: 999px; border: 1px solid var(--stk-line); background: none; color: #c9cfda; font: 600 12px var(--font-sans); cursor: pointer; }
.stk .peg-ranges button[aria-pressed='true'] { border-color: var(--teal); color: var(--fg); }
.stk .peg-line { fill: none; stroke: var(--teal); stroke-width: 1.6; }
.stk .peg-zero { stroke: rgba(255, 255, 255, 0.35); }
.stk .peg-band { stroke: rgba(255, 207, 90, 0.35); stroke-dasharray: 3 4; }
.stk .peg-band.public { stroke: rgba(255, 207, 90, 0.7); }
.stk .peg-tick { fill: var(--muted); font: 10px var(--font-mono); text-anchor: end; }
.stk .peg-span.discount { fill: rgba(229, 138, 138, 0.1); }
.stk .peg-span.premium { fill: rgba(127, 212, 160, 0.1); }
.stk .peg-pin line { stroke: rgba(46, 211, 195, 0.35); }
.stk .peg-pin circle { fill: var(--teal); }
.stk .peg-dot { fill: #fff; }
.stk .peg-records { margin-top: 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.stk .peg-episodes { margin-top: 14px; }
@media (max-width: 720px) {
  .stk .peg-routes, .stk .peg-records { grid-template-columns: minmax(0, 1fr); }
}
```

- [ ] **Step 5: Verify the build and look at it**

Run: `pnpm --filter site typecheck && pnpm --filter site test && pnpm --filter site build`
Expected: PASS, with the budgets check green.

Then run `pnpm --dir site dev`, open `http://localhost:4321/staking/#peg` with the chrome-devtools MCP and take screenshots at 1280px and 390px wide. Check:
- the jump nav has "stLINK peg";
- the lit route card matches the sign of the gap;
- the chart switches between 7D, 30D, 1Y and All;
- hovering the chart updates the readout;
- the chart has a pin on 23 Sep 2026 under 1Y once Stage 5's markers ship (none before);
- nothing scrolls sideways at 390px.

- [ ] **Step 6: Commit and open the Stage 4 PR**

```bash
git add site/src/components/staking/Peg.tsx site/src/components/staking/PegChart.tsx site/src/components/staking/StakingView.tsx site/src/pages/staking/index.astro site/src/styles/staking.css
git commit -m "Staking: an stLINK peg section with both routes, the gap chart and records

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin peg-page
gh pr create --title "Staking: the stLINK peg section (stage 4)" --body "$(cat <<'EOF'
Stage 4 of docs/superpowers/plans/2026-11-18-stlink-peg.md: /staking#peg shows the live peg, the discount and premium routes (Curve depth, instant capacity at 1:1, queues), a gap chart over 7D/30D/1Y/All with episodes shaded, and records. peg.json refreshes every minute.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# Stage 5: Markers, card and public posts (PR 5)

Branch: `git switch main && git pull && git switch -c peg-public`

### Task 10: Staking-event markers

**Files:**
- Modify: `packages/core/src/peg-episodes.ts` (marker aggregation)
- Modify: `worker/src/peg-store.ts` (`pegMarkerEvents`, `addPegMarkers`, `pegMarkers`)
- Modify: `worker/src/jobs/peg-history.ts` (`scanPegMarkers`, markers into the publish)
- Test: `packages/core/test/peg-episodes.test.ts` (append), `worker/test/peg-markers.test.ts`

**Interfaces:**
- Consumes: `linkUnits` (core staking); `store.hasUnclassifiedStakers`, `store.insertStakingEvents`, `store.upsertStakingHolders` (Worker store).
- Produces: `interface PegMarkerEvent { blockNumber: number; ts: string; kind: 'staked' | 'unbonding'; amount: string | null; holder: string | null }`, `PEG_MARKER_MIN_VAULTS = 10`, `PEG_MARKER_MIN_LINK = 10_000`, `pegMarkerHours(events: readonly PegMarkerEvent[]): PegMarker[]`; store `pegMarkerEvents(db, afterBlock, limit)`, `addPegMarkers(db, markers, cursorBlock)`, `pegMarkers(db)` (notable only); job `scanPegMarkers(c)`, `PEG_MARKER_BATCH = 5_000`.

- [ ] **Step 1: Write the failing core test** (append to `packages/core/test/peg-episodes.test.ts`)

```ts
import { pegMarkerHours, type PegMarkerEvent } from '../src/peg-episodes';

describe('pegMarkerHours', () => {
  const e = (ts: string, kind: PegMarkerEvent['kind'], holder: string | null, amount: string | null = null): PegMarkerEvent => ({ blockNumber: 1, ts, kind, amount, holder });

  it('sums stake.link vault unbondings and stakes by hour, leaving everyone else out', () => {
    expect(
      pegMarkerHours([
        e('2026-09-23T16:01:00.000Z', 'unbonding', 'stakelink'),
        e('2026-09-23T16:59:00.000Z', 'unbonding', 'stakelink'),
        e('2026-09-23T16:30:00.000Z', 'unbonding', 'wallet'),
        e('2026-09-26T03:10:00.000Z', 'staked', 'stakelink', '6250000000000000000000'),
        e('2026-09-26T03:20:00.000Z', 'staked', 'stakelink', '6250000000000000000000'),
      ]),
    ).toEqual([
      { hour: '2026-09-23T16:00:00.000Z', kind: 'stakelink_unbonding', vaults: 2, link: null },
      { hour: '2026-09-26T03:00:00.000Z', kind: 'stakelink_deposit', vaults: 2, link: 12_500 },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/peg-episodes.test.ts`
Expected: FAIL: "pegMarkerHours is not a function".

- [ ] **Step 3: Implement the aggregation** (append to `packages/core/src/peg-episodes.ts`)

```ts
import { linkUnits } from './staking';

export interface PegMarkerEvent {
  blockNumber: number;
  ts: string;
  kind: 'staked' | 'unbonding';
  amount: string | null;
  holder: string | null;
}

/** The chart pins an hour when this many stake.link vaults began unbonding in it, or they staked this much LINK. */
export const PEG_MARKER_MIN_VAULTS = 10;
export const PEG_MARKER_MIN_LINK = 10_000;

/** Every hour's stake.link vault activity; the publish keeps the notable hours. Sums add across runs, so nothing is filtered here. */
export function pegMarkerHours(events: readonly PegMarkerEvent[]): PegMarker[] {
  const byKey = new Map<string, PegMarker>();
  for (const e of events) {
    if (e.holder !== 'stakelink') continue;
    const hour = `${e.ts.slice(0, 13)}:00:00.000Z`;
    const kind: PegMarkerKind = e.kind === 'unbonding' ? 'stakelink_unbonding' : 'stakelink_deposit';
    const m = byKey.get(`${hour}|${kind}`) ?? { hour, kind, vaults: 0, link: kind === 'stakelink_deposit' ? 0 : null };
    m.vaults += 1;
    if (m.link !== null && e.amount !== null) m.link += linkUnits(e.amount);
    byKey.set(`${hour}|${kind}`, m);
  }
  return [...byKey.values()].sort((a, b) => a.hour.localeCompare(b.hour) || a.kind.localeCompare(b.kind));
}
```

Check that `peg-episodes.ts` importing `./staking` creates no cycle (`staking.ts` does not import `peg-*`). Run the core test: PASS.

- [ ] **Step 4: Write the failing Worker test**

```ts
// worker/test/peg-markers.test.ts
import { STAKING_FIRST_BLOCK, type StakingEvent } from '@ccip-dev/core';
import { PegHistoryFileSchema } from '@ccip-dev/core/public';
import { fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { PEG_MARKER_BATCH, runPegHistory, scanPegMarkers } from '../src/jobs/peg-history';
import * as pegStore from '../src/peg-store';
import * as store from '../src/store';
import { harness, readPublic, resetStorage } from './helpers';

beforeEach(resetStorage);

const VAULT = (i: number) => `0x${(0xa000 + i).toString(16).padStart(40, '0')}`;
const event = (i: number, block: number, ts: string, kind: StakingEvent['kind'], amount: string | null = null): StakingEvent => ({
  blockNumber: block, logIndex: i, pool: 'community', kind, staker: VAULT(i), txHash: `0x${block.toString(16)}`, ts, amount, stake: null, total: null,
});

async function seed(events: StakingEvent[]) {
  await store.insertStakingEvents(env.DB, events);
  await store.upsertStakingHolders(env.DB, new Map(events.map((e) => [e.staker, 'stakelink' as const])), '2026-09-27T00:00:00.000Z');
}

const NOW = '2026-09-27T00:00:00.000Z';

describe('scanPegMarkers', () => {
  it('pins the hour 80 stake.link vaults began unbonding', async () => {
    await seed(Array.from({ length: 80 }, (_, i) => event(i, STAKING_FIRST_BLOCK + 10, '2026-09-23T16:00:12.000Z', 'unbonding')));
    await scanPegMarkers(harness({ now: NOW }).c);
    expect(await pegStore.pegMarkers(env.DB)).toEqual([{ hour: '2026-09-23T16:00:00.000Z', kind: 'stakelink_unbonding', vaults: 80, link: null }]);
  });

  it('adds an hour split across runs, and keeps quiet hours off the chart', async () => {
    await seed(Array.from({ length: 6 }, (_, i) => event(i, STAKING_FIRST_BLOCK + 1, '2026-09-23T16:00:00.000Z', 'unbonding')));
    await scanPegMarkers(harness({ now: NOW }).c);
    expect(await pegStore.pegMarkers(env.DB)).toEqual([]);
    await seed(Array.from({ length: 6 }, (_, i) => event(100 + i, STAKING_FIRST_BLOCK + 2, '2026-09-23T16:40:00.000Z', 'unbonding')));
    await scanPegMarkers(harness({ now: NOW }).c);
    expect((await pegStore.pegMarkers(env.DB))[0]?.vaults).toBe(12);
  });

  it('waits while any staker is unclassified, so no stake.link vault is missed', async () => {
    await store.insertStakingEvents(env.DB, [event(0, STAKING_FIRST_BLOCK + 1, '2026-09-23T16:00:00.000Z', 'staked', '20000000000000000000000')]);
    await scanPegMarkers(harness({ now: NOW }).c);
    expect(await store.getMeta(env.DB, 'peg_marker_block')).toBeNull();
  });

  it(`never splits a block across batches of ${PEG_MARKER_BATCH}`, async () => {
    const big = Array.from({ length: PEG_MARKER_BATCH + 5 }, (_, i) => event(i, STAKING_FIRST_BLOCK + (i < PEG_MARKER_BATCH - 2 ? 1 : 2), '2026-09-23T16:00:00.000Z', 'unbonding'));
    await seed(big);
    await scanPegMarkers(harness({ now: NOW }).c);
    expect((await pegStore.pegMarkers(env.DB))[0]?.vaults).toBe(PEG_MARKER_BATCH + 5);
  });

  it('publishes the markers in peg-history.json', async () => {
    await seed(Array.from({ length: 10 }, (_, i) => event(i, STAKING_FIRST_BLOCK + 10, '2026-09-23T16:00:12.000Z', 'unbonding')));
    const curve = fakeFetch(() => jsonResponse({ data: [{ time: 1_790_366_400, open: 1, high: 1, low: 1, close: 1 }] }));
    await runPegHistory(harness({ now: NOW, fetch: curve }).c);
    expect(PegHistoryFileSchema.parse(await readPublic('peg-history.json')).markers).toHaveLength(1);
  });
});
```

Check `upsertStakingHolders`' signature (`worker/src/store.ts:1295`): `(db, kinds: ReadonlyMap<string, HolderKind>, checkedAt: string)`. Adjust the seed only if it differs.

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm --filter worker exec vitest run test/peg-markers.test.ts`
Expected: FAIL: `scanPegMarkers` is not exported.

- [ ] **Step 6: Implement the store functions and the scan**

```ts
// worker/src/peg-store.ts (append)
import { PEG_MARKER_MIN_LINK, PEG_MARKER_MIN_VAULTS, type PegMarker, type PegMarkerEvent } from '@ccip-dev/core';

export async function pegMarkerEvents(db: D1Database, afterBlock: number, limit: number): Promise<PegMarkerEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT e.block_number AS blockNumber, e.ts, e.kind, e.amount, h.kind AS holder
       FROM staking_events e LEFT JOIN staking_holders h ON h.address = e.staker
       WHERE e.block_number > ? AND e.kind IN ('staked', 'unbonding')
       ORDER BY e.block_number, e.log_index LIMIT ?`,
    )
    .bind(afterBlock, limit)
    .all<PegMarkerEvent>();
  return results;
}

/** Adds the hours' sums and moves the cursor in one batch, so a retry never counts an event twice. */
export async function addPegMarkers(db: D1Database, markers: readonly PegMarker[], cursorBlock: number): Promise<void> {
  const upserts = markers.map((m) =>
    db
      .prepare(
        `INSERT INTO peg_markers (hour, kind, vaults, link) VALUES (?, ?, ?, ?)
         ON CONFLICT(hour, kind) DO UPDATE SET vaults = peg_markers.vaults + excluded.vaults,
           link = CASE WHEN excluded.link IS NULL THEN peg_markers.link ELSE COALESCE(peg_markers.link, 0) + excluded.link END`,
      )
      .bind(m.hour, m.kind, m.vaults, m.link),
  );
  const cursor = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind('peg_marker_block', String(cursorBlock));
  await db.batch([...upserts, cursor]);
}

export async function pegMarkers(db: D1Database): Promise<PegMarker[]> {
  const { results } = await db
    .prepare(
      `SELECT hour, kind, vaults, link FROM peg_markers
       WHERE (kind = 'stakelink_unbonding' AND vaults >= ?) OR (kind = 'stakelink_deposit' AND link >= ?)
       ORDER BY hour`,
    )
    .bind(PEG_MARKER_MIN_VAULTS, PEG_MARKER_MIN_LINK)
    .all<PegMarker>();
  return results;
}
```

```ts
// worker/src/jobs/peg-history.ts (additions)
import { pegMarkerHours } from '@ccip-dev/core';

export const PEG_MARKER_BATCH = 5_000;
const MARKER_BATCHES_PER_RUN = 10;

/** Reads staking_events past a block cursor (the primary key), never by time. Waits for classification so a vault is never read as nobody's. */
export async function scanPegMarkers(c: RunContext): Promise<void> {
  const db = c.env.DB;
  if (await store.hasUnclassifiedStakers(db)) return;
  let cursor = Number((await store.getMeta(db, 'peg_marker_block')) ?? '0');
  for (let batch = 0; batch < MARKER_BATCHES_PER_RUN; batch++) {
    const events = await pegStore.pegMarkerEvents(db, cursor, PEG_MARKER_BATCH);
    if (events.length === 0) return;
    const last = events.at(-1)!.blockNumber;
    // A full batch may end inside a block; that block is read whole next time.
    const whole = events.length === PEG_MARKER_BATCH ? events.filter((e) => e.blockNumber < last) : events;
    const kept = whole.length > 0 ? whole : events;
    cursor = kept.at(-1)!.blockNumber;
    await pegStore.addPegMarkers(db, pegMarkerHours(kept), cursor);
  }
}
```

In `runPegHistory`, call `await scanPegMarkers(c)` inside the `try` after `refreshPeg(c)`. In `publishPegHistory`, replace `markers: []` with `markers: await pegStore.pegMarkers(c.env.DB)`.

The batch-boundary test seeds 5,005 events in 2 blocks. The first batch of 5,000 ends inside block 2, so it keeps block 1's 4,998 events; the second batch reads block 2 whole (7 events). That is 5,005 in all.

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter worker exec vitest run test/peg-markers.test.ts test/peg-history-job.test.ts && pnpm --filter @ccip-dev/core test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/peg-episodes.ts packages/core/test/peg-episodes.test.ts worker/src/peg-store.ts worker/src/jobs/peg-history.ts worker/test/peg-markers.test.ts
git commit -m "Peg: pin hours of heavy stake.link vault activity on the chart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: The `peg` broadcast target and the cards

**Files:**
- Modify: `packages/core/src/broadcasts.ts` (target, key, card path, parse)
- Create: `site/worker/cards/peg-card.ts`
- Modify: `site/worker/cards/broadcast-cards.ts` (`case 'peg'`)
- Modify: `site/src/lib/card-paths.ts` (a `peg` route), `site/worker/og.ts` (draw it), `site/worker/cache.ts` (`peg: 300`)
- Modify: `site/src/components/staking/Peg.tsx` (share button)
- Test: `packages/core/test/broadcasts.test.ts` (or the file that tests `parseBroadcastPath`; find it with `grep -rln parseBroadcastPath packages/core/test`), `site/test/peg-card.test.ts`, `site/test/card-paths.test.ts`

**Interfaces:**
- Consumes: `PegFile`, `PegHistoryFile` fixtures (Task 8); `formatGap`, `priceText`, `linkAmount`, `utcStamp` (Task 8); `broadcastFrame`, `bold`, `COLORS`, `eyebrow`, `row` (`broadcast-frame.ts`); `h`.
- Produces: `BroadcastTarget` member `{ kind: 'peg'; episode: number; phase: 'open' | 'close' }`; key `broadcast:peg:<id>:<phase>`; card path `broadcast/peg/<id>/<phase>`; `CardRoute` member `{ kind: 'peg' }` (path `peg`); `pegTree(focus: { episode: number; phase: 'open' | 'close' } | null, inputs: BroadcastInputs): Promise<VNode | null>`; `PEG_CTA`.

- [ ] **Step 1: Write the failing core test**

```ts
// in the parseBroadcastPath test file
import { broadcastCardPath, broadcastKey, parseBroadcastPath } from '../src/broadcasts';

describe('the peg target', () => {
  it('keys and paths each phase of an episode', () => {
    const open = { kind: 'peg', episode: 3, phase: 'open' } as const;
    expect(broadcastKey(open)).toBe('broadcast:peg:3:open');
    expect(broadcastCardPath(open)).toBe('broadcast/peg/3/open');
    expect(parseBroadcastPath('broadcast/peg/3/close'.split('/'))).toEqual({ kind: 'peg', episode: 3, phase: 'close' });
  });

  it.each(['broadcast/peg/0/open', 'broadcast/peg/3/middle', 'broadcast/peg/x/open', 'broadcast/peg/3'])('rejects %s', (path) => {
    expect(parseBroadcastPath(path.split('/'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails, then implement**

Run: `pnpm --filter @ccip-dev/core test`. Expected: FAIL.

In `packages/core/src/broadcasts.ts`:
- Add `| { kind: 'peg'; episode: number; phase: 'open' | 'close' }` to `BroadcastTarget`.
- `broadcastKey`: `case 'peg': return \`broadcast:peg:${t.episode}:${t.phase}\`;`
- `broadcastCardPath`: `case 'peg': return \`broadcast/peg/${t.episode}/${t.phase}\`;`
- `parseBroadcastPath`, before `return null;`: `if (kind === 'peg' && /^[1-9]\d{0,9}$/.test(a) && (b === 'open' || b === 'close')) return { kind: 'peg', episode: Number(a), phase: b };`

Run `pnpm typecheck`. Every exhaustive switch over `BroadcastTarget['kind']` now fails to compile; `site/worker/cards/broadcast-cards.ts` is the one known. Fix each in this task.

- [ ] **Step 3: Write the failing card test**

```ts
// site/test/peg-card.test.ts
import { PEG_FILE_FIXTURE, PEG_HISTORY_FIXTURE } from '@ccip-dev/core/testing';
import { describe, expect, it } from 'vitest';
import { broadcastTree } from '../worker/cards/broadcast-cards';
import { pegTree } from '../worker/cards/peg-card';
import { texts } from './fixtures/broadcast';

const inputs = (peg = PEG_FILE_FIXTURE) => ({ load: async (name: string) => (name === 'peg.json' ? peg : PEG_HISTORY_FIXTURE), icon: async () => null }) as never;
const OPEN = { ...PEG_FILE_FIXTURE.recent_episodes[0]!, id: 7, closed_at: null, side: 'discount' as const, peak_gap: -0.0091 };
const opened = { ...PEG_FILE_FIXTURE, gap: -0.0084, spot: 0.9916, episode: OPEN, recent_episodes: [OPEN] };

describe('the peg card', () => {
  it('draws the live peg when shared from the page', async () => {
    const words = texts((await pegTree(null, inputs()))!).join('|');
    expect(words).toContain('1 stLINK = 0.99975 LINK');
    expect(words).toContain('ccip.dev/staking/#peg');
  });

  it('draws an open episode for its public post', async () => {
    const words = texts((await broadcastTree({ kind: 'peg', episode: 7, phase: 'open' }, inputs(opened)))!).join('|');
    expect(words).toContain('DISCOUNT OPEN');
    expect(words).toContain('−0.84%');
  });

  it('draws the recap of a closed episode', async () => {
    const words = texts((await broadcastTree({ kind: 'peg', episode: 2, phase: 'close' }, inputs()))!).join('|');
    expect(words).toContain('PREMIUM CLOSED');
    expect(words).toContain('+5.64%');
  });

  it('has no card for an episode peg.json does not list yet, or a close that has not happened', async () => {
    expect(await broadcastTree({ kind: 'peg', episode: 99, phase: 'open' }, inputs())).toBeNull();
    expect(await broadcastTree({ kind: 'peg', episode: 7, phase: 'close' }, inputs(opened))).toBeNull();
  });
});
```

- [ ] **Step 4: Implement the card**

```ts
// site/worker/cards/peg-card.ts
import type { PegEpisodeView, PegFile, PegHistoryFile } from '@ccip-dev/core/public';
import { formatGap, linkAmount, priceText, utcStamp } from '../../src/lib/peg-view';
import { h, type VNode } from '../h';
import { bold, broadcastFrame, COLORS, eyebrow, row, type BroadcastInputs } from './broadcast-frame';
import type { Cta } from './cta';
import { TEAL } from './staking-cards';

export const PEG_CTA: Cta = { lead: 'Watch the peg:', path: 'ccip.dev/staking/#peg' };
const SPARK_W = 420;
const SPARK_H = 150;

/** The last 30 days of hourly closes around a zero line, as an <img>. */
function gapSpark(history: PegHistoryFile): VNode | null {
  const rows = history.hours.slice(-30 * 24);
  if (rows.length < 2) return null;
  const gaps = rows.map((r) => r[4] - 1);
  const reach = Math.max(history.thresholds.public, ...gaps.map(Math.abs));
  const y = (g: number) => ((reach - g) / (2 * reach)) * SPARK_H;
  const points = gaps.map((g, i) => `${((i / (gaps.length - 1)) * SPARK_W).toFixed(1)},${y(g).toFixed(1)}`).join(' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SPARK_W}" height="${SPARK_H}"><line x1="0" x2="${SPARK_W}" y1="${y(0)}" y2="${y(0)}" stroke="rgba(255,255,255,0.35)" stroke-dasharray="4 5"/><polyline points="${points}" fill="none" stroke="${TEAL}" stroke-width="3"/></svg>`;
  return h('img', { src: `data:image/svg+xml;base64,${btoa(svg)}`, width: SPARK_W, height: SPARK_H, style: { position: 'absolute', right: 56, top: 190 } });
}

function chip(text: string, color: string): VNode {
  return h('div', { style: { display: 'flex', fontSize: 18, fontWeight: 800, letterSpacing: 2, color: '#070a10', backgroundColor: color, borderRadius: 4, padding: '5px 12px' } }, text);
}

function body(peg: PegFile, episode: PegEpisodeView | null, phase: 'open' | 'close' | null): VNode {
  const closing = phase === 'close' && episode !== null;
  const side = episode?.side ?? (peg.gap < 0 ? 'discount' : 'premium');
  const big = closing ? formatGap(episode.peak_gap) : formatGap(peg.gap);
  const color = (closing ? episode.peak_gap : peg.gap) < 0 ? COLORS.down : COLORS.up;
  const label = episode ? `${side.toUpperCase()} ${closing ? 'CLOSED' : 'OPEN'}` : 'stLINK ON CURVE';
  return h(
    'div',
    { style: { position: 'absolute', left: 56, top: 118, width: 640, display: 'flex', flexDirection: 'column' } },
    eyebrow('stLINK / LINK', { color: TEAL }),
    h('div', { style: { display: 'flex', marginTop: 12 } }, chip(label, color)),
    h('div', { style: { display: 'flex', fontSize: 104, fontWeight: 800, letterSpacing: -3, color, marginTop: 14, lineHeight: 1 } }, big),
    row([closing ? 'peak · now ' : '', bold(priceText(peg.spot))], { fontSize: 26, marginTop: 16, color: COLORS.soft }),
  );
}

function insight(peg: PegFile, episode: PegEpisodeView | null, phase: 'open' | 'close' | null, history: PegHistoryFile) {
  if (phase === 'close' && episode?.closed_at) {
    const hours = Math.round((Date.parse(episode.closed_at) - Date.parse(episode.opened_at)) / 3_600_000);
    return ['Lasted ', bold(`${hours}h`), ` · peak at ${utcStamp(episode.peak_at)}`, ...(episode.best_size ? [' · best Curve size ', bold(`${linkAmount(episode.best_size)} LINK`)] : [])];
  }
  const side = peg.gap < 0 ? 'discount' : 'premium';
  const r = peg[side];
  if (episode || Math.abs(peg.gap) >= history.thresholds.private) {
    return ['Curve beats 1:1 up to ', bold(r.depth === null ? 'no size' : `${linkAmount(r.depth)} LINK`), ` · ${side === 'discount' ? 'redeem' : 'mint'} at 1:1 now: `, bold(`${linkAmount(r.instant)} LINK`)];
  }
  const last = history.records.last_end;
  return last ? ['Last episode ended ', bold(utcStamp(last))] : ['No episode yet'];
}

/** The live peg for the page's share button (`focus` null), or one episode's open or close for its public post. */
export async function pegTree(focus: { episode: number; phase: 'open' | 'close' } | null, inputs: BroadcastInputs): Promise<VNode | null> {
  const [peg, history] = await Promise.all([inputs.load('peg.json'), inputs.load('peg-history.json')]);
  const episode = focus === null ? peg.episode : (peg.recent_episodes.find((e) => e.id === focus.episode) ?? null);
  if (focus !== null && (episode === null || (focus.phase === 'close' && episode.closed_at === null))) return null;
  const spark = gapSpark(history);
  return broadcastFrame({
    background: spark ? [spark] : [],
    eyebrow: `Chainlink staking · stLINK peg · ${utcStamp(peg.updated_at)}`,
    body: body(peg, episode, focus?.phase ?? null),
    insight: insight(peg, episode, focus?.phase ?? null, history),
    cta: PEG_CTA,
  });
}
```

Check two things against the real code and adjust only if they differ:
- `TEAL` is exported from `staking-cards.ts`; it is, at line 13.
- `broadcastFrame`'s `insight` takes `readonly Child[]`.

In `site/worker/cards/broadcast-cards.ts`, add `import { pegTree } from './peg-card';` and `case 'peg': return pegTree({ episode: target.episode, phase: target.phase }, inputs);`.

- [ ] **Step 5: The page share route**

- `site/src/lib/card-paths.ts`:
  - Add `| { kind: 'peg' }` to `CardRoute`.
  - In `parseCardPath`, before the `SIMPLE` line: `if (head === 'peg') return parts.length === 1 ? { kind: 'peg' } : null;`
  - `cardPathOf` already returns `route.kind` by default.
- `site/worker/og.ts`:
  - Import `pegTree`.
  - In `handleOg`, after the staker line: `if (route.kind === 'peg') return drawnCard((inputs) => pegTree(null, inputs), route, url, env, ctx, deps);`
  - Change `build()`'s parameter type to `Exclude<CardRoute, { kind: 'broadcast' | 'staker' | 'peg' }>`.
- `site/worker/cache.ts`: `case 'peg': return 300;`.
- `site/test/card-paths.test.ts`: assert `parseCardPath('peg')` is `{ kind: 'peg' }`, `parseCardPath('peg/x')` is `null`, and `cardPathOf({ kind: 'peg' })` is `'peg'`.
- `Peg.tsx`, in the band head after the lead: `<ShareButton view="peg" headline={peg ? \`${priceText(peg.spot)} (${formatGap(peg.gap)})\` : 'stLINK on Curve'} url="https://ccip.dev/staking/#peg" cardUrl="/og/peg.png" />`, importing `ShareButton` from `'../ShareButton'`.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @ccip-dev/core test && pnpm --filter site test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/broadcasts.ts packages/core/test site/worker/cards/peg-card.ts site/worker/cards/broadcast-cards.ts site/src/lib/card-paths.ts site/worker/og.ts site/worker/cache.ts site/src/components/staking/Peg.tsx site/test/peg-card.test.ts site/test/card-paths.test.ts
git commit -m "Peg: a share card for the page and one per public episode post

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Stage only the changed test file under `packages/core/test` by name. Do not stage the directory.

### Task 12: Public posts

**Files:**
- Modify: `worker/src/broadcasts/run.ts` (`BroadcastRequest` `peg`, `planPeg`)
- Modify: `worker/src/broadcasts/facts.ts` (`PegFacts` in `BroadcastFacts`)
- Modify: `worker/src/broadcasts/copy.ts` (`pegTg`, `pegX`, both switches)
- Modify: `worker/src/jobs/peg.ts` (broadcast after the publish)
- Test: `worker/test/peg-broadcasts.test.ts`

**Interfaces:**
- Consumes: `PegLiveBody`, `PegEpisodeView`; `pegConfig`; `pegCurveLine`, `pegRouteLine`, `pctText`, `utcStamp`, `linkText` (`peg-copy.ts`); `broadcastSafely`, `runBroadcasts`.
- Produces: `BroadcastRequest` member `{ kind: 'peg'; live: PegLiveBody; episodes: readonly PegEpisodeView[] }`; `interface PegFacts { kind: 'peg'; phase: 'open' | 'close'; episode: PegEpisodeView; live: PegLiveBody }`; `PEG_CLOSE_MAX_AGE_MS = 86_400_000`; `PEG_CARD_WAIT_MS = 1_800_000`.

- [ ] **Step 1: Write the failing test**

```ts
// worker/test/peg-broadcasts.test.ts
import { decodePegReading, pegLiveBody } from '@ccip-dev/core';
import type { PegEpisodeView } from '@ccip-dev/core/public';
import { fakeFetch, PEG_LIVE_WORDS } from '@ccip-dev/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Broadcast, BroadcastOutput } from '../src/broadcasts/outputs';
import { runBroadcasts } from '../src/broadcasts/run';
import { harness, resetStorage } from './helpers';

beforeEach(resetStorage);

const LIVE = { ...pegLiveBody(decodePegReading(PEG_LIVE_WORDS.map((w) => BigInt(w)))), spot: 0.9916, gap: -0.0084 };
const EPISODE: PegEpisodeView = {
  id: 7, side: 'discount', opened_at: '2026-11-18T00:00:00.000Z', closed_at: null, peak_gap: -0.0091, peak_at: '2026-11-18T00:30:00.000Z',
  best_size: 10_000, best_profit: 0.53, public: true, public_at: '2026-11-18T00:20:00.000Z',
};

function recorder(name: string) {
  const sent: Broadcast[] = [];
  const output: BroadcastOutput = { name, send: async (b) => (sent.push(b), 'sent') };
  return { output, sent };
}

const card = (status = 200) =>
  fakeFetch((url) => (url.startsWith('https://ccip.dev/og/broadcast/peg/') ? new Response(status === 200 ? new Uint8Array([137, 80, 78, 71]) : 'no', { status, headers: { 'content-type': status === 200 ? 'image/png' : 'text/plain' } }) : undefined));

async function pegRun(now: string, episodes: PegEpisodeView[], opts: { publicPosts?: boolean; cardStatus?: number } = {}) {
  const channel = recorder('telegram-channel');
  const x = recorder('x-post');
  const h = harness({ now, fetch: card(opts.cardStatus), env: { BROADCASTS: 'on', PEG_PUBLIC: opts.publicPosts === false ? 'off' : 'on' } });
  await runBroadcasts(h.c, { kind: 'peg', live: LIVE, episodes }, { channel: [channel.output], xPost: [x.output], drafts: [], preview: [] });
  return { channel: channel.sent, x: x.sent, alerts: h.alerts };
}

describe('public peg posts', () => {
  it('posts an open public episode to the channel only, never to X, ending with the disclaimer', async () => {
    const { channel, x } = await pegRun('2026-11-18T00:25:00.000Z', [EPISODE]);
    expect(channel.map((b) => b.key)).toEqual(['broadcast:peg:7:open']);
    expect(x).toEqual([]);
    expect(channel[0]!.telegramHtml).toContain('stLINK trades at a 0.84% discount on Curve');
    expect(channel[0]!.telegramHtml.trimEnd().split('\n').at(-2)).toBe('Not financial advice.');
  });

  it('posts each phase once', async () => {
    await pegRun('2026-11-18T00:25:00.000Z', [EPISODE]);
    expect((await pegRun('2026-11-18T00:30:00.000Z', [EPISODE])).channel).toEqual([]);
  });

  it('posts nothing while PEG_PUBLIC is off', async () => {
    expect((await pegRun('2026-11-18T00:25:00.000Z', [EPISODE], { publicPosts: false })).channel).toEqual([]);
  });

  it('posts nothing for an episode that never went public', async () => {
    expect((await pegRun('2026-11-18T00:25:00.000Z', [{ ...EPISODE, public: false, public_at: null }])).channel).toEqual([]);
  });

  it('waits quietly for a card the edge does not serve yet, then alerts once it is late', async () => {
    const early = await pegRun('2026-11-18T00:25:00.000Z', [EPISODE], { cardStatus: 404 });
    expect([early.channel, early.alerts]).toEqual([[], []]);
    const late = await pegRun('2026-11-18T01:00:00.000Z', [EPISODE], { cardStatus: 404 });
    expect(late.alerts.map((a) => a.signature)).toEqual(['broadcast-image:broadcast:peg:7:open']);
  });

  it('recaps a closed public episode, skipping an open post it no longer needs', async () => {
    const closed = { ...EPISODE, closed_at: '2026-11-18T03:20:00.000Z' };
    const { channel } = await pegRun('2026-11-18T03:25:00.000Z', [closed]);
    expect(channel.map((b) => b.key)).toEqual(['broadcast:peg:7:close']);
    expect(channel[0]!.telegramHtml).toContain('The stLINK discount closed after 3h 20m');
  });

  it('recaps the first episode of a flip as well as opening the second', async () => {
    const closed = { ...EPISODE, closed_at: '2026-11-18T03:20:00.000Z' };
    const premium = { ...EPISODE, id: 8, side: 'premium' as const, peak_gap: 0.009, opened_at: '2026-11-18T03:15:00.000Z', public_at: '2026-11-18T03:20:00.000Z' };
    const { channel } = await pegRun('2026-11-18T03:25:00.000Z', [premium, closed]);
    expect(channel.map((b) => b.key).sort()).toEqual(['broadcast:peg:7:close', 'broadcast:peg:8:open']);
  });

  it('does not recap an episode that closed over a day ago', async () => {
    expect((await pegRun('2026-11-20T00:00:00.000Z', [{ ...EPISODE, closed_at: '2026-11-18T03:20:00.000Z' }])).channel).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter worker exec vitest run test/peg-broadcasts.test.ts`
Expected: FAIL: a type error, or `runBroadcasts` treats `peg` as the staking request.

- [ ] **Step 3: Implement facts, planning and copy**

`worker/src/broadcasts/facts.ts`:

```ts
import type { PegLiveBody } from '@ccip-dev/core';
import type { PegEpisodeView } from '@ccip-dev/core/public';

export interface PegFacts {
  kind: 'peg';
  phase: 'open' | 'close';
  episode: PegEpisodeView;
  live: PegLiveBody;
}

export type BroadcastFacts = DailyFacts | WeeklyFacts | RecordFacts | MilestoneFacts | ReserveFacts | StakingFacts | OperatorFacts | PegFacts;
```

`worker/src/broadcasts/run.ts`:

```ts
import type { PegLiveBody } from '@ccip-dev/core';
import type { PegEpisodeView } from '@ccip-dev/core/public';
import { pegConfig } from '../peg-config';

/** A recap older than this is news no one needs. */
export const PEG_CLOSE_MAX_AGE_MS = 86_400_000;
/** The card reads peg.json through the edge cache; for this long after the post is due, a missing card is waited for quietly. */
export const PEG_CARD_WAIT_MS = 30 * 60_000;

export type BroadcastRequest =
  | { kind: 'finalize'; days: readonly string[] }
  | { kind: 'reserve'; reserve: ReserveBody }
  | { kind: 'staking'; staking: StakingFile }
  | { kind: 'peg'; live: PegLiveBody; episodes: readonly PegEpisodeView[] }
  | { kind: 'monthly' };

/** An open post only while the episode runs; a recap for a day after it closes. Sent keys make a re-plan harmless. */
function planPeg(c: RunContext, request: Extract<BroadcastRequest, { kind: 'peg' }>): Planned[] {
  if (!pegConfig(c.env).publicPosts) return [];
  const now = c.deps.now().getTime();
  return request.episodes.flatMap((episode): Planned[] => {
    if (!episode.public) return [];
    const phase = episode.closed_at === null ? 'open' : 'close';
    const due = phase === 'open' ? episode.public_at ?? episode.opened_at : episode.closed_at!;
    if (phase === 'close' && now - Date.parse(due) > PEG_CLOSE_MAX_AGE_MS) return [];
    return [{ target: { kind: 'peg', episode: episode.id, phase }, facts: { kind: 'peg', phase, episode, live: request.live }, retriesLater: now - Date.parse(due) < PEG_CARD_WAIT_MS }];
  });
}
```

In `runBroadcasts`, replace the `planned` ternary with a switch that includes `request.kind === 'peg' ? planPeg(c, request) : …`. Keep the existing branches in their order.

`worker/src/broadcasts/copy.ts` (`bold`, `tgText` and `Line` are already in this file):

```ts
import { linkText, pctText, pegCurveLine, pegRouteLine, utcStamp } from '../peg-copy';
import type { PegFacts } from './facts';
// formatDuration is already in copy.ts's '@ccip-dev/core/format' import.

const PEG_DROP = { route: 1, closing: 6 } as const;

function pegLines(f: PegFacts, text: (s: string) => string): Line[] {
  const { episode: e, live } = f;
  if (f.phase === 'close') {
    const lasted = formatDuration((Date.parse(e.closed_at!) - Date.parse(e.opened_at)) / 1000);
    return [
      { text: text(`The stLINK ${e.side} closed after ${lasted}.`) },
      { text: text(`Peak: ${pctText(e.peak_gap)} at ${utcStamp(e.peak_at)}${e.best_size ? ` · best Curve size ${linkText(e.best_size)} LINK` : ''}`) },
      { text: text(`Now: 1 stLINK = ${live.spot.toFixed(4)} LINK`) },
    ];
  }
  return [
    { text: text(`stLINK trades at a ${pctText(live.gap)} ${e.side} on Curve: 1 stLINK = ${live.spot.toFixed(4)} LINK`) },
    { text: text(pegCurveLine(e.side, live)) },
    { text: text(pegRouteLine(e.side, live)), drop: PEG_DROP.route },
  ];
}

function pegTg(f: PegFacts): Line[] {
  return [{ text: bold('stLINK peg watch') }, ...pegLines(f, tgText), { text: '' }, { text: 'Not financial advice.' }, { text: '#Chainlink #stLINK $LINK', drop: PEG_DROP.closing }];
}

/** Never posted, since peg is not among X_KINDS, but composeCopy builds both texts for every broadcast. */
function pegX(f: PegFacts): Line[] {
  return [...pegLines(f, noLinks), { text: 'Not financial advice.' }];
}
```

Add `case 'peg': return pegX(f);` to `xLines` and `case 'peg': return pegTg(f);` to `telegramLines`. The test asserts that the second-to-last line is the disclaimer: `fitLines` drops the hashtag line first, but only when the caption is over Telegram's limit, so with a normal caption the hashtags are last and the disclaimer is just above them.

- [ ] **Step 4: Broadcast from the job**

In `worker/src/jobs/peg.ts`, after the `putJson` of `peg.json`:

```ts
import { broadcastSafely } from '../broadcasts/run';
// …
  await broadcastSafely(c, { kind: 'peg', live, episodes });
```

`broadcastSafely` never throws. A broadcast failure alerts under `broadcast-run`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter worker exec vitest run test/peg-broadcasts.test.ts test/peg-episodes-job.test.ts test/broadcasts.test.ts && pnpm typecheck`
Expected: PASS. In `test/peg-episodes-job.test.ts`, `PEG_PUBLIC` is unset, so no public post is planned and no card is fetched.

- [ ] **Step 6: Commit**

```bash
git add worker/src/broadcasts/run.ts worker/src/broadcasts/facts.ts worker/src/broadcasts/copy.ts worker/src/jobs/peg.ts worker/test/peg-broadcasts.test.ts
git commit -m "Peg: public channel posts when an episode crosses the public line, and a recap when it closes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: Docs, then the Stage 5 PR

**Files:**
- Modify: `docs/methodology.md` (a "stLINK peg" section after "Chainlink staking")
- Modify: `docs/runbook.md` (a "stLINK peg" section before "Website (ccip.dev)")
- Modify: `docs/superpowers/specs/2026-11-17-stlink-peg-design.md` (status line: `**Status:** Implemented · …`)

- [ ] **Step 1: Write the methodology section**

```markdown
## stLINK peg

stLINK is stake.link's rebasing liquid-staking token, redeemable 1:1 for LINK through stake.link in time. ccip.dev tracks
its price on Curve's stLINK/LINK-ng pool (`0x7e13…1761`), the main market.

- **History:** hourly OHLC of stLINK in LINK from Curve's price API (`prices.curve.finance`), from 2025-04-19. Hours
  without swaps repeat the last price.
- **Live:** every 5 minutes, one batch of `eth_call`s: the pool's spot (`get_p`) and EMA (`price_oracle`), swap quotes
  (`get_dy`) for 1k–250k in each direction, and stake.link's PriorityPool, StakingPool, WithdrawalPool and
  FundFlowController state.
- **Gap** is spot − 1: negative is a discount, positive a premium.
- **Curve depth** is the largest quoted size whose swap beats 1:1 after the pool's fees. Gas is not counted.
- **The 1:1 leg.** A discount is closed by redeeming stLINK at 1:1. That is instant only against LINK queued for deposit
  (or from the pool, when stake.link allows instant withdrawals and nobody waits); the rest joins the withdrawal queue,
  paid out at most every 3 days inside a claim window. A premium is closed by minting at 1:1, instant only while no LINK
  is queued, into the withdrawal queue and then the pool's room. **Tradeable now** is the smaller of the Curve depth and
  the instant capacity.
- **Episodes.** An episode opens when the gap stays at or past 0.3% for two 5-minute checks in a row, and closes when it
  stays under 0.15% or flips side for two. History before launch uses the same rule on hourly closes with one bar, so
  the episode list and an alert's numbers can differ slightly.
- **Markers** pin hours when 10 or more stake.link vaults began unbonding, or they staked 10,000 LINK or more. They show
  timing, not cause.
- Not financial advice.
```

- [ ] **Step 2: Write the runbook section**

```markdown
## stLINK peg

- **Thresholds** are wrangler vars: `PEG_ALERT_PRIVATE_PCT` (default 0.3) and `PEG_ALERT_PUBLIC_PCT` (0.75), in
  percent. An unreadable value, or public at or under private, falls back to both defaults with a warning in the logs.
- **Public posts** need `PEG_PUBLIC = "on"` and follow `BROADCASTS` (off, drafts to the drafts chat, on to the
  channel). They never go to X.
- **`peg-rpc`**: the 5-minute read failed 3 times in a row on every RPC endpoint. Check `RPC_ETHEREUM` and the
  fallbacks.
- **`peg-bad-read`**: a spot outside 0.5–1.5 was dropped. One is noise; repeats mean a contract changed. Check the pool
  on Etherscan.
- **`peg-history`**: Curve's price API has failed for 6 hours. The page keeps the last published history.
- **Re-backfill the history**: `wrangler d1 execute ccip-dev --remote --command "DELETE FROM meta WHERE key IN ('peg_backfill_before', 'peg_backfill_done')"`.
  The next hourly runs page back to 2025-04-19, 10 pages an hour.
- **Rebuild the markers**: `DELETE FROM peg_markers; DELETE FROM meta WHERE key = 'peg_marker_block';` in one execute.
- **stLINK peg: mint capacity check** (`peg-mint-check`). The instant-mint figure caps the pool's room by
  `unusedDepositLimit`, read from the contract rather than simulated. When the alert fires:
  1. Read `premium.instant` from `https://data.ccip.dev/v1/peg.json`.
  2. Simulate LINK `transferAndCall(PriorityPool, amount, abi.encode(false, FundFlowController.getDepositData(amount)))`
     with `eth_call` from an address holding enough LINK (the Curve pool works), for `amount` = `premium.instant` and
     for `premium.instant + 1000`.
  3. If the first reverts, the cap is too high: fix `mintInstant` in `packages/core/src/peg-live.ts` with a test. If
     the second succeeds, the cap is too low.
```

- [ ] **Step 3: Verify, commit, PR**

```bash
pnpm test
pnpm typecheck
git add docs/methodology.md docs/runbook.md docs/superpowers/specs/2026-11-17-stlink-peg-design.md
git commit -m "Docs: the stLINK peg in the methodology and the runbook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin peg-public
gh pr create --title "Peg: markers, share card and public channel posts (stage 5)" --body "$(cat <<'EOF'
Stage 5 of docs/superpowers/plans/2026-11-18-stlink-peg.md: stake.link vault markers on the chart, the /og/peg.png share card and per-episode cards, public Telegram posts when an episode crosses 0.75% (channel only, never X, "Not financial advice."), and docs. Ships with PEG_PUBLIC = "off"; switch it on after the private alerts have been seen behaving.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

After merge and deploy, check the `/og/peg.png` card in a browser. Then confirm with the owner before setting `PEG_PUBLIC = "on"`: that change is outward-facing.
