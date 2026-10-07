# Viral Replay, Plan A (director, story layer, controls, chain pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/replay/` into a 30-second shareable video:
- a hook title card, a time-warped camera story, beat cards and milestone slams, a rolling counter, a timeline bar and a leaderboard race, a finale that loops;
- a your-chain cut with per-chain pages and cards;
- Direction A player controls, and a shared controls kit used site-wide.

Everything is drawn with the existing sky renderer. Plans B (cinema renderer) and C (soundtrack) build on this plan's `Show`.

**Architecture:**
- **Director** (`site/src/replay/director/`, pure and deterministic): turns `replay.json`, `history.json`, the length and an optional focus chain into a `Show`, whose `frameAt(t)` returns a `ShowFrame`. It covers the time warp, beats, cards, slams, camera, leaderboard and story values.
- **`ReplayModel`** is refactored to read time through a `Warp`. A linear warp keeps today's behavior and tests.
- **Compositor:** draws the sky through a camera projector, then coins, then a new **story layer** (`site/src/replay/story/`), then the loop cross-fade.
- **Player:** rebuilt with the Direction A controls from the new controls kit (`site/src/components/controls/`, `site/src/styles/controls.css`).
- **Chain pages:** `/replay/<slug>/` pages, plus a build-time `/replay-cards.json` that feeds new `/og/replay/<slug>.png` cards.

**Tech Stack:** Astro 7, React 19, TypeScript 7 (tsgo), Vitest 4, existing WebGL2/2D sky renderers, mediabunny 1.61.3, `@cf-wasm/og` cards in the Cloudflare Worker.

**Spec:** `docs/superpowers/specs/2026-10-07-viral-replay-design.md`. This plan covers §6 (director, story layer, player, recorder length, chain pages, controls kit), §7, §9, §11, §12, §13 and the parts of §14 and §15 that apply. Cinema (§8) is Plan B and the score (§10) is Plan C.

## Global Constraints

**Repo and workflow**
- Repo `/Users/rubberduck/GitHub/momentmaker/ccip-dev`, branch `main`, pnpm workspace; the site package is `@ccip-dev/site` in `site/`.
- Never push and never deploy; the controller does both.
- Commit messages end with a blank line and a `Co-Authored-By:` trailer naming your model.
- Before each commit, run `pnpm --filter @ccip-dev/site test` and `pnpm --filter @ccip-dev/site typecheck`.
- Run `pnpm --filter @ccip-dev/site build` before the last commit of any task that touches pages, styles, the player or the Worker. It runs check-build and check-budgets, and both must pass.

**Dependencies and code style**
- No new runtime or dev dependencies.
- Test first (RED, then GREEN) for logic. There are no React component tests in this repo; pure helpers get tests, and components are verified by build and browser checks.
- Follow the surrounding code. Add no comments that restate code.

**Determinism and data**
- The same `t` gives the same `ShowFrame`. All randomness uses `mulberry32` from `site/src/replay/timeline.ts`, seeded by data.
- Replay USD values are rounded integers.

**Colors and type**
- Gold only for $1M+ moments: comets and record-day ripples.
- One brand blue (`--blue` #2f62df, `--blue-2` #4a7ff0); text `--fg` #e8eaed and `--muted` #8892a0; background `--bg` #0c0f14; cards `--card` #161b23; active control fill `#13244d`.
- Fonts: Inter and JetBrains Mono, via the existing `--font-sans` and `--font-mono` stacks.

**Budgets**
- `/replay/` JS ≤ 200 KB gzipped (112.4 KB today); home ≤ 150 KB (112.6 KB today); chain pages ≤ 200 KB.
- Lighthouse mobile accessibility ≥ 95.
- No horizontal scroll at 390 px.

**Verbatim copy**
- Hook title: `${years} of Chainlink CCIP` / `in ${length} seconds`. Focus mode: `${name} × Chainlink CCIP` / `since ${formatUtcDay(firstDay)}`.
- Join cards: `Base joins`, `Base and Arbitrum join`, `+${n} chains: A · B · C`.
- Lane cards (focus): `Arbitrum ↔ Base`, `+${n} lanes to Base: A · B · C`.
- Record card: `Record day · ${formatCount(n)} messages`.
- Watermark: `ccip.dev · @ccipdev`. End title: `ccip.dev`.
- Recording without audio support (Plan C) — not in this plan.

**Lengths and timing**
- Lengths are `[15, 30, 60]`, default 30.
- Shot timing (hook/finale seconds): 15 → 1.5/2, 30 → 2/3, 60 → 2/3.
- The video length equals the chosen length exactly; there is no separate end card.

## Review Focus

1. **A chain with almost no history,** for example one that joined last week, or a focus chain with one lane. The show still has a hook, a story and a finale; its counters start at 0; and no card or slam is scheduled outside the story.
   - Task 2: `scheduleCards` with an empty or one-event list.
   - Task 5: a `Show` over a 2-day replay in focus mode.
2. **Many joins packed into a few days,** as in 2025. Cards never overlap, each card holds at least 1.0 s, and a join card never starts more than 1.0 s after its moment. Extra joins batch into "+n chains" cards.
   - Task 2: a test with 20 joins in 3 days.
3. **Scrubbing backwards and forwards, or seeking straight to the finale.** `frameAt` is pure, so any `t` order gives identical frames.
   - Task 5: compare `frameAt(20)` before and after evaluating other times.
4. **Phone width with the 9:16 and 1:1 shapes.** Story boxes never overlap, and text stays inside the canvas.
   - Task 6: a `layoutFor` intersection test for every aspect at 1080p and at 390×390 and 390×693.
5. **A focus chain whose slug collides or has odd characters,** like `B^2 Mainnet` or two `Mind` chains. Slugs are unique and URL-safe, and an unknown slug returns 404 on cards.
   - Task 10: `chainSlug` and `slugMap` tests, and the Worker card route test.

---

## Task 1: Time warp and shot phases

**Files:**
- Create: `site/src/replay/director/warp.ts`, `site/src/replay/director/phases.ts`
- Test: `site/test/director-warp.test.ts`

**Interfaces:**
- Produces:
  - `interface DayFlags { join: boolean; milestone: boolean; record: boolean }`;
  - `interface Warp { readonly dayCount: number; readonly start: number; readonly end: number; dayStart(index: number): number; dayLength(index: number): number; dayAt(t: number): { index: number; progress: number } }`;
  - `durationWarp(durations: readonly number[], start: number): Warp`;
  - `linearWarp(dayCount: number, start: number, end: number): Warp`;
  - `dayWeight(messages: number, flags: DayFlags): number`;
  - `storyWarp(messages: readonly number[], flags: readonly DayFlags[], start: number, end: number, length: number): Warp`;
  - the constants `WARP_MESSAGES`, `WARP_JOIN`, `WARP_MILESTONE`, `WARP_RECORD` and `WARP_DWELL_S`;
  - `type Phase = 'hook' | 'story' | 'finale'`, `interface ShotTiming { hook: number; finale: number }`, `shotTiming(length: number): ShotTiming`, `phaseAt(t: number, length: number): Phase`.

- [ ] **Step 1: Write the failing tests**

`site/test/director-warp.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { phaseAt, shotTiming } from '../src/replay/director/phases';
import { dayWeight, durationWarp, linearWarp, storyWarp, WARP_DWELL_S } from '../src/replay/director/warp';

const none = { join: false, milestone: false, record: false };

describe('durationWarp', () => {
  const warp = durationWarp([1, 3, 2], 2);

  it('lays days end to end from the start', () => {
    expect([warp.dayStart(0), warp.dayStart(1), warp.dayStart(2), warp.dayStart(3)]).toEqual([2, 3, 6, 8]);
    expect(warp.end).toBe(8);
    expect(warp.dayLength(1)).toBe(3);
  });

  it('maps a time to its day and the progress through it', () => {
    expect(warp.dayAt(4.5)).toEqual({ index: 1, progress: 0.5 });
    expect(warp.dayAt(6)).toEqual({ index: 2, progress: 0 });
  });

  it('clamps before the start and after the end', () => {
    expect(warp.dayAt(0)).toEqual({ index: 0, progress: 0 });
    expect(warp.dayAt(99)).toEqual({ index: 2, progress: 1 });
  });

  it('is monotonic', () => {
    let last = { index: 0, progress: 0 };
    for (let t = 0; t <= 9; t += 0.05) {
      const now = warp.dayAt(t);
      expect(now.index > last.index || (now.index === last.index && now.progress >= last.progress)).toBe(true);
      last = now;
    }
  });
});

describe('linearWarp', () => {
  it('splits the span evenly', () => {
    const warp = linearWarp(4, 0, 8);
    expect(warp.dayStart(2)).toBe(4);
    expect(warp.dayAt(5)).toEqual({ index: 2, progress: 0.5 });
  });
});

describe('dayWeight', () => {
  it('grows with activity and with each flag', () => {
    expect(dayWeight(0, none)).toBe(1);
    expect(dayWeight(999, none)).toBeCloseTo(1 + 0.6 * 3, 6);
    expect(dayWeight(0, { join: true, milestone: true, record: true })).toBeCloseTo(1 + 1.5 + 2.5 + 1.5, 6);
  });
});

describe('storyWarp', () => {
  it('fills the story exactly and gives busy and flagged days more time', () => {
    const warp = storyWarp([0, 999, 0, 0], [none, none, { ...none, milestone: true }, none], 2, 27, 30);
    expect(warp.start).toBe(2);
    expect(warp.end).toBeCloseTo(27, 9);
    expect(warp.dayLength(1)).toBeGreaterThan(warp.dayLength(0));
    expect(warp.dayLength(2)).toBeGreaterThan(warp.dayLength(1));
  });

  it('adds the milestone dwell, scaled by length', () => {
    const flat = storyWarp([0, 0], [none, none], 0, 10, 60);
    const dwell = storyWarp([0, 0], [none, { ...none, milestone: true }], 0, 10, 60);
    expect(dwell.end).toBeCloseTo(10, 9);
    expect(dwell.dayLength(1) - flat.dayLength(1)).toBeGreaterThan(WARP_DWELL_S);
  });
});

describe('shot phases', () => {
  it.each([[15, 1.5, 2], [30, 2, 3], [60, 2, 3]])('length %s has a %ss hook and a %ss finale', (length, hook, finale) => {
    expect(shotTiming(length)).toEqual({ hook, finale });
  });

  it('names the phase at a time', () => {
    expect(phaseAt(0, 30)).toBe('hook');
    expect(phaseAt(2, 30)).toBe('story');
    expect(phaseAt(26.99, 30)).toBe('story');
    expect(phaseAt(27, 30)).toBe('finale');
  });
});
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/director-warp.test.ts`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 2: Implement**

`site/src/replay/director/warp.ts`:

```ts
export interface DayFlags {
  join: boolean;
  milestone: boolean;
  record: boolean;
}

export interface Warp {
  readonly dayCount: number;
  readonly start: number;
  readonly end: number;
  dayStart(index: number): number;
  dayLength(index: number): number;
  dayAt(t: number): { index: number; progress: number };
}

export const WARP_MESSAGES = 0.6;
export const WARP_JOIN = 1.5;
export const WARP_MILESTONE = 2.5;
export const WARP_RECORD = 1.5;
export const WARP_DWELL_S = 0.6;
const MIN_PLAIN_SHARE = 0.5;
const NO_FLAGS: DayFlags = { join: false, milestone: false, record: false };

export function durationWarp(durations: readonly number[], start: number): Warp {
  const starts = [start];
  for (const d of durations) starts.push(starts.at(-1)! + d);
  const dayCount = durations.length;
  const end = starts[dayCount]!;
  return {
    dayCount,
    start,
    end,
    dayStart: (index) => starts[Math.max(0, Math.min(dayCount, index))]!,
    dayLength: (index) => durations[index] ?? 0,
    dayAt(t) {
      if (dayCount === 0 || t <= start) return { index: 0, progress: 0 };
      if (t >= end) return { index: dayCount - 1, progress: 1 };
      let lo = 0;
      let hi = dayCount - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid]! <= t) lo = mid;
        else hi = mid - 1;
      }
      const length = durations[lo]!;
      return { index: lo, progress: length > 0 ? (t - starts[lo]!) / length : 0 };
    },
  };
}

export function linearWarp(dayCount: number, start: number, end: number): Warp {
  return durationWarp(Array.from({ length: dayCount }, () => (end - start) / Math.max(1, dayCount)), start);
}

export function dayWeight(messages: number, flags: DayFlags): number {
  return (
    1 +
    WARP_MESSAGES * Math.log10(1 + Math.max(0, messages)) +
    (flags.join ? WARP_JOIN : 0) +
    (flags.milestone ? WARP_MILESTONE : 0) +
    (flags.record ? WARP_RECORD : 0)
  );
}

export function storyWarp(messages: readonly number[], flags: readonly DayFlags[], start: number, end: number, length: number): Warp {
  const span = end - start;
  const milestoneDays = flags.filter((f) => f.milestone).length;
  const totalDwell = Math.min(milestoneDays * WARP_DWELL_S * (length / 30), span * (1 - MIN_PLAIN_SHARE));
  const dwell = milestoneDays > 0 ? totalDwell / milestoneDays : 0;
  const weights = messages.map((m, i) => dayWeight(m, flags[i] ?? NO_FLAGS));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const rest = span - totalDwell;
  return durationWarp(
    weights.map((w, i) => (rest * w) / sum + ((flags[i] ?? NO_FLAGS).milestone ? dwell : 0)),
    start,
  );
}
```

`site/src/replay/director/phases.ts`:

```ts
export type Phase = 'hook' | 'story' | 'finale';

export interface ShotTiming {
  hook: number;
  finale: number;
}

const TIMING: Record<number, ShotTiming> = {
  15: { hook: 1.5, finale: 2 },
  30: { hook: 2, finale: 3 },
  60: { hook: 2, finale: 3 },
};

export function shotTiming(length: number): ShotTiming {
  return TIMING[length] ?? { hook: Math.min(2, length * 0.1), finale: Math.min(3, length * 0.1) };
}

export function phaseAt(t: number, length: number): Phase {
  const { hook, finale } = shotTiming(length);
  return t < hook ? 'hook' : t < length - finale ? 'story' : 'finale';
}
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/director-warp.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

Run the site suite and the typecheck, then:

```bash
git add site/src/replay/director/warp.ts site/src/replay/director/phases.ts site/test/director-warp.test.ts
git commit -m "feat(site): replay director time warp and shot phases"
```

---

## Task 2: Beats, cards and slams

**Files:**
- Create: `site/src/replay/director/beats.ts`
- Test: `site/test/director-beats.test.ts`

**Interfaces:**
- Consumes: `Warp` and `DayFlags` (Task 1); `Milestone` (`site/src/lib/records.ts`); `shortChainName` (`site/src/lib/names.ts`); `formatCount` (`site/src/lib/format.ts`).
- Produces:
  - `type EventKind = 'join' | 'milestone' | 'record' | 'lane'`;
  - `interface DayEvent { kind: EventKind; dayIndex: number; label: string; selectors: string[] }`;
  - `joinEvents(chains, days): DayEvent[]`;
  - `milestoneEvents(milestones, days): DayEvent[]`;
  - `recordEvents(history, days): DayEvent[]`;
  - `laneOpenEvents(replay, focus, days): DayEvent[]`;
  - `dayFlags(events, dayCount): DayFlags[]`;
  - `interface Card { kind: 'join' | 'record' | 'lane'; time: number; start: number; end: number; label: string; selectors: string[]; count: number }`;
  - `scheduleCards(events, warp, focusName: string | null): Card[]`;
  - `interface Slam { start: number; label: string }`;
  - `scheduleSlams(events, warp): Slam[]`;
  - the constants `JOIN_BATCH_S = 1.0`, `CARD_S = 1.6`, `CARD_MIN_S = 1.0`, `CARD_MAX_LAG_S = 1.0`, `SLAM_S = 1.4`, `RECORD_SKIP_DAYS = 30` and `MAX_RECORDS = 3`.

- [ ] **Step 1: Write the failing tests**

`site/test/director-beats.test.ts`:

```ts
import type { ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import {
  CARD_MAX_LAG_S,
  CARD_MIN_S,
  dayFlags,
  joinEvents,
  laneOpenEvents,
  MAX_RECORDS,
  milestoneEvents,
  recordEvents,
  scheduleCards,
  scheduleSlams,
  type DayEvent,
} from '../src/replay/director/beats';
import { linearWarp } from '../src/replay/director/warp';

const days = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'];
const chain = (selector: string, display_name: string, first_day: string) => ({ selector, name: `${selector}-mainnet`, display_name, first_day });

describe('day events', () => {
  it('turns each chain first day into a join, ordered by day', () => {
    const events = joinEvents([chain('b', 'Base Mainnet', '2024-01-03'), chain('e', 'Ethereum Mainnet', '2024-01-01')], days);
    expect(events).toEqual([
      { kind: 'join', dayIndex: 0, label: 'Ethereum', selectors: ['e'] },
      { kind: 'join', dayIndex: 2, label: 'Base', selectors: ['b'] },
    ]);
  });

  it('keeps threshold milestones and drops joins from the milestone list', () => {
    const events = milestoneEvents(
      [
        { kind: 'messages', day: '2024-01-02', label: '1,000 messages', threshold: 1000 },
        { kind: 'join', day: '2024-01-01', label: 'Ethereum joins', threshold: null },
      ],
      days,
    );
    expect(events).toEqual([{ kind: 'milestone', dayIndex: 1, label: '1,000 messages', selectors: [] }]);
  });

  it('picks the biggest jumps in the all-time daily record after the first month', () => {
    const series = Array.from({ length: 60 }, (_, i) => {
      const d = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
      return { day: d, messages: i === 40 ? 500 : i === 45 ? 600 : i === 50 ? 2000 : i === 55 ? 2100 : 10 };
    });
    const allDays = series.map((s) => s.day);
    const events = recordEvents(series, allDays);
    expect(events.length).toBeLessThanOrEqual(MAX_RECORDS);
    expect(events.map((e) => e.dayIndex)).toEqual([40, 45, 50]);
    expect(events[2]!.label).toBe('Record day · 2,000 messages');
  });

  it('opens one lane event per partner chain, on its first day', () => {
    const replay = {
      chains: [chain('e', 'Ethereum Mainnet', '2024-01-01'), chain('b', 'Base Mainnet', '2024-01-01'), chain('a', 'Arbitrum Mainnet', '2024-01-02')],
      lanes: [[0, 1], [2, 1], [1, 0]],
      days: [
        { day: '2024-01-01', lanes: [[0, 1, 5]] },
        { day: '2024-01-02', lanes: [[2, 1, 5], [1, 1, 5]] },
      ],
    } as unknown as ReplayFile;
    expect(laneOpenEvents(replay, 'b', days)).toEqual([
      { kind: 'lane', dayIndex: 0, label: 'Ethereum', selectors: ['e'] },
      { kind: 'lane', dayIndex: 1, label: 'Arbitrum', selectors: ['a'] },
    ]);
  });

  it('flags days that hold joins, lanes, milestones and records', () => {
    const flags = dayFlags(
      [
        { kind: 'join', dayIndex: 0, label: 'E', selectors: [] },
        { kind: 'milestone', dayIndex: 2, label: 'x', selectors: [] },
        { kind: 'record', dayIndex: 3, label: 'r', selectors: [] },
      ],
      4,
    );
    expect(flags).toEqual([
      { join: true, milestone: false, record: false },
      { join: false, milestone: false, record: false },
      { join: false, milestone: true, record: false },
      { join: false, milestone: false, record: true },
    ]);
  });
});

describe('scheduleCards', () => {
  const join = (dayIndex: number, label: string): DayEvent => ({ kind: 'join', dayIndex, label, selectors: [label] });

  it('labels single, double and batched joins', () => {
    const warp = linearWarp(30, 0, 30);
    const cards = scheduleCards([join(0, 'Ethereum'), join(10, 'Base'), join(10, 'Arbitrum'), join(20, 'A'), join(20, 'B'), join(20, 'C'), join(20, 'D')], warp, null);
    expect(cards.map((c) => c.label)).toEqual(['Ethereum joins', 'Base and Arbitrum join', '+4 chains: A · B · C']);
    expect(cards[2]!.selectors).toEqual(['A', 'B', 'C']);
    expect(cards[2]!.count).toBe(4);
  });

  it('never overlaps cards, holds each at least the minimum, and lets a join lag at most the limit', () => {
    const warp = linearWarp(3, 0, 1.5);
    const events = Array.from({ length: 20 }, (_, i) => join(i % 3, `C${i}`)).sort((a, b) => a.dayIndex - b.dayIndex);
    const cards = scheduleCards(events, warp, null);
    for (let i = 1; i < cards.length; i++) expect(cards[i]!.start).toBeGreaterThanOrEqual(cards[i - 1]!.end - 1e-9);
    for (const c of cards) {
      expect(c.end - c.start).toBeGreaterThanOrEqual(CARD_MIN_S - 1e-9);
      expect(c.start - c.time).toBeLessThanOrEqual(CARD_MAX_LAG_S + 1e-9);
    }
    expect(cards.reduce((n, c) => n + c.count, 0)).toBe(20);
  });

  it('labels focus lane cards with the focus chain', () => {
    const warp = linearWarp(10, 0, 10);
    const lane = (dayIndex: number, label: string): DayEvent => ({ kind: 'lane', dayIndex, label, selectors: [label] });
    expect(scheduleCards([lane(1, 'Arbitrum')], warp, 'Base')[0]!.label).toBe('Arbitrum ↔ Base');
    expect(scheduleCards([lane(1, 'A'), lane(1, 'B'), lane(1, 'C')], warp, 'Base')[0]!.label).toBe('+3 lanes to Base: A · B · C');
  });

  it('keeps record cards separate and handles empty input', () => {
    const warp = linearWarp(10, 0, 10);
    const record: DayEvent = { kind: 'record', dayIndex: 1, label: 'Record day · 5 messages', selectors: [] };
    expect(scheduleCards([record, { ...record }], warp, null)).toHaveLength(2);
    expect(scheduleCards([], warp, null)).toEqual([]);
  });
});

describe('scheduleSlams', () => {
  it('places milestones at their day and spaces close ones apart', () => {
    const warp = linearWarp(10, 0, 10);
    const slams = scheduleSlams(
      [
        { kind: 'milestone', dayIndex: 2, label: '$1B moved', selectors: [] },
        { kind: 'milestone', dayIndex: 2, label: '50 chains', selectors: [] },
        { kind: 'join', dayIndex: 3, label: 'x', selectors: [] },
      ],
      warp,
    );
    expect(slams).toEqual([
      { start: 2, label: '$1B moved' },
      { start: 3.4, label: '50 chains' },
    ]);
  });
});
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/director-beats.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 2: Implement**

`site/src/replay/director/beats.ts`:

```ts
import type { ReplayFile } from '@ccip-dev/core/public';
import { formatCount } from '../../lib/format';
import { shortChainName } from '../../lib/names';
import type { Milestone } from '../../lib/records';
import type { DayFlags, Warp } from './warp';

export type EventKind = 'join' | 'milestone' | 'record' | 'lane';

export interface DayEvent {
  kind: EventKind;
  dayIndex: number;
  label: string;
  selectors: string[];
}

export interface Card {
  kind: 'join' | 'record' | 'lane';
  time: number;
  start: number;
  end: number;
  label: string;
  selectors: string[];
  count: number;
}

export interface Slam {
  start: number;
  label: string;
}

export const JOIN_BATCH_S = 1.0;
export const CARD_S = 1.6;
export const CARD_MIN_S = 1.0;
export const CARD_MAX_LAG_S = 1.0;
export const SLAM_S = 1.4;
export const RECORD_SKIP_DAYS = 30;
export const MAX_RECORDS = 3;

type Chain = ReplayFile['chains'][number];
const indexOf = (days: readonly string[]) => new Map(days.map((d, i) => [d, i]));
const byDay = (a: { day: string }, b: { day: string }) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);

export function joinEvents(chains: readonly Chain[], days: readonly string[]): DayEvent[] {
  const at = indexOf(days);
  return chains
    .flatMap((c) => {
      const i = at.get(c.first_day);
      return i === undefined ? [] : [{ kind: 'join' as const, dayIndex: i, label: shortChainName(c), selectors: [c.selector] }];
    })
    .sort((a, b) => a.dayIndex - b.dayIndex || (a.selectors[0]! < b.selectors[0]! ? -1 : 1));
}

export function milestoneEvents(milestones: readonly Milestone[], days: readonly string[]): DayEvent[] {
  const at = indexOf(days);
  return milestones.flatMap((m) => {
    const i = at.get(m.day);
    return m.kind === 'join' || i === undefined ? [] : [{ kind: 'milestone' as const, dayIndex: i, label: m.label, selectors: [] }];
  });
}

export function recordEvents(history: readonly { day: string; messages: number }[], days: readonly string[]): DayEvent[] {
  const at = indexOf(days);
  let best = 0;
  const jumps: { day: string; messages: number; ratio: number }[] = [];
  [...history].sort(byDay).forEach((d, i) => {
    if (d.messages <= best) return;
    if (i >= RECORD_SKIP_DAYS && best > 0) jumps.push({ day: d.day, messages: d.messages, ratio: d.messages / best });
    best = d.messages;
  });
  return jumps
    .sort((a, b) => b.ratio - a.ratio || byDay(a, b))
    .slice(0, MAX_RECORDS)
    .flatMap((j) => {
      const i = at.get(j.day);
      return i === undefined ? [] : [{ kind: 'record' as const, dayIndex: i, label: `Record day · ${formatCount(j.messages)} messages`, selectors: [] }];
    })
    .sort((a, b) => a.dayIndex - b.dayIndex);
}

export function laneOpenEvents(replay: Pick<ReplayFile, 'chains' | 'lanes' | 'days'>, focus: string, days: readonly string[]): DayEvent[] {
  const at = indexOf(days);
  const focusIndex = replay.chains.findIndex((c) => c.selector === focus);
  if (focusIndex < 0) return [];
  const seen = new Set<number>();
  const out: DayEvent[] = [];
  for (const d of [...replay.days].sort(byDay)) {
    const i = at.get(d.day);
    if (i === undefined) continue;
    for (const [lane] of d.lanes) {
      const ends = replay.lanes[lane];
      if (!ends || (ends[0] !== focusIndex && ends[1] !== focusIndex)) continue;
      const partner = ends[0] === focusIndex ? ends[1] : ends[0];
      if (partner === focusIndex || seen.has(partner)) continue;
      seen.add(partner);
      const c = replay.chains[partner]!;
      out.push({ kind: 'lane', dayIndex: i, label: shortChainName(c), selectors: [c.selector] });
    }
  }
  return out;
}

export function dayFlags(events: readonly DayEvent[], dayCount: number): DayFlags[] {
  const flags = Array.from({ length: dayCount }, () => ({ join: false, milestone: false, record: false }));
  for (const e of events) {
    const f = flags[e.dayIndex];
    if (!f) continue;
    if (e.kind === 'join' || e.kind === 'lane') f.join = true;
    if (e.kind === 'milestone') f.milestone = true;
    if (e.kind === 'record') f.record = true;
  }
  return flags;
}

function cardLabel(kind: Card['kind'], names: readonly string[], focusName: string | null): string {
  if (kind === 'record') return names[0]!;
  if (kind === 'lane') {
    return names.length === 1 ? `${names[0]} ↔ ${focusName}` : `+${names.length} lanes to ${focusName}: ${names.slice(0, 3).join(' · ')}`;
  }
  if (names.length === 1) return `${names[0]} joins`;
  if (names.length === 2) return `${names[0]} and ${names[1]} join`;
  return `+${names.length} chains: ${names.slice(0, 3).join(' · ')}`;
}

interface Group {
  kind: Card['kind'];
  time: number;
  start: number;
  end: number;
  names: string[];
  selectors: string[];
}

export function scheduleCards(events: readonly DayEvent[], warp: Warp, focusName: string | null): Card[] {
  const timed = events
    .filter((e): e is DayEvent & { kind: Card['kind'] } => e.kind !== 'milestone')
    .map((e) => ({ e, time: warp.dayStart(e.dayIndex) }))
    .sort((a, b) => a.time - b.time);
  const groups: Group[] = [];
  for (const { e, time } of timed) {
    const prev = groups.at(-1);
    const sameKind = prev !== undefined && prev.kind === e.kind && e.kind !== 'record';
    const wouldStart = prev ? Math.max(time, prev.start + CARD_MIN_S) : time;
    if (prev && sameKind && (time - prev.time < JOIN_BATCH_S || wouldStart - time > CARD_MAX_LAG_S)) {
      prev.names.push(e.label);
      prev.selectors.push(...e.selectors);
      continue;
    }
    if (prev) prev.end = Math.max(prev.start + CARD_MIN_S, Math.min(prev.end, time));
    const start = Math.max(time, prev?.end ?? time);
    groups.push({ kind: e.kind, time, start, end: start + CARD_S, names: [e.label], selectors: [...e.selectors] });
  }
  return groups.map((g) => ({
    kind: g.kind,
    time: g.time,
    start: g.start,
    end: g.end,
    label: cardLabel(g.kind, g.names, focusName),
    selectors: g.selectors.slice(0, 3),
    count: g.names.length,
  }));
}

export function scheduleSlams(events: readonly DayEvent[], warp: Warp): Slam[] {
  const out: Slam[] = [];
  for (const e of events.filter((x) => x.kind === 'milestone').sort((a, b) => a.dayIndex - b.dayIndex)) {
    const prev = out.at(-1);
    out.push({ start: Math.max(warp.dayStart(e.dayIndex), prev ? prev.start + SLAM_S : -Infinity), label: e.label });
  }
  return out;
}
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/director-beats.test.ts`
Expected: PASS.

If the record-day test's numbers disagree with the code, re-derive them from the series and report it; don't loosen the assertion. In the series, i = 40 (500 messages, ratio 50), 45 (600, 1.2), 50 (2000, 3.33) and 55 (2100, 1.05) are the only new highs after day 30. The top 3 ratios are days 40, 50 and 45, sorted back by day to [40, 45, 50].

- [ ] **Step 3: Commit**

```bash
git add site/src/replay/director/beats.ts site/test/director-beats.test.ts
git commit -m "feat(site): replay director beats, cards and milestone slams"
```

---

## Task 3: `ReplayModel` reads time through a `Warp`

**Files:**
- Modify: `site/src/replay/timeline.ts`
- Test: `site/test/timeline.test.ts`

**Interfaces:**
- Consumes: `Warp`, `linearWarp` (Task 1).
- Produces: the `ReplayModel` constructor gains a 7th parameter, `warp?: Warp`. The default is `linearWarp(days.length, 0, length)`, which gives exactly today's behavior. `ReplayModel.warp` is public and read-only. `secondsPerDay` is removed; any caller must use `warp.dayLength(i)`.

- [ ] **Step 1: Write the failing tests**

Append to `site/test/timeline.test.ts`. It already imports `ReplayModel`, `buildLayout` and the fixture `replay`, and builds `history` and `stars`. Add `durationWarp` to the imports from `'../src/replay/director/warp'`.

```ts
describe('ReplayModel with a warp', () => {
  const warp = durationWarp([1, 10, 1, 1], 2);
  const warped = () => new ReplayModel(replay, history, [], stars, 60, { count: 1, eligible: () => true }, warp);

  it('maps time to days through the warp', () => {
    expect(warped().frameAt(2.5).dayIndex).toBe(0);
    expect(warped().frameAt(3.5).dayIndex).toBe(1);
    expect(warped().frameAt(12.9).dayIndex).toBe(1);
    expect(warped().frameAt(13.5).dayIndex).toBe(2);
  });

  it('spreads a long day’s comets across its whole length', () => {
    const m = warped();
    const early = m.frameAt(4).sky.comets.length + m.frameAt(5).sky.comets.length;
    const late = m.frameAt(11).sky.comets.length + m.frameAt(12).sky.comets.length;
    expect(early + late).toBeGreaterThan(0);
    expect(m.frameAt(11)).toEqual(m.frameAt(11));
  });

  it('starts the day clock at the warp start', () => {
    expect(warped().frameAt(0).sky.comets).toEqual([]);
    expect(warped().warp).toBe(warp);
  });
});
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/timeline.test.ts`
Expected: FAIL. TypeScript reports the 7th argument, and `warp` is undefined.

- [ ] **Step 2: Implement**

In `site/src/replay/timeline.ts`:
- Add `import { linearWarp, type Warp } from './director/warp';`.
- Remove the `readonly secondsPerDay: number;` field and its assignment, and add `readonly warp: Warp;`.
- Add the constructor parameter `warp?: Warp` after `coinOptions`, and as the first statement after `this.days` is set, add `this.warp = warp ?? linearWarp(this.days.length, 0, length);`.
- Replace `dayStart(i)`'s body with `return this.warp.dayStart(i);`.
- In `coinsAt`, replace the two `Math.floor(… / this.secondsPerDay)` expressions with the warp. Keep the existing `firstDay` clamp to the last day:

```ts
    const firstDay = Math.min(this.days.length - 1, this.warp.dayAt(Math.max(this.warp.start, start)).index);
    const lastDay = Math.min(this.days.length - 1, this.warp.dayAt(Math.max(this.warp.start, end)).index);
```

- In `frameAt`, replace the `dayIndex` computation with:

```ts
    const dayIndex = Math.min(this.warp.dayAt(Math.min(time, this.warp.end - 1e-9)).index, this.days.length - 1);
```

- Replace the comet lookback and progress with the warp-aware form:

```ts
    const firstSpawnDay = this.warp.dayAt(Math.max(this.warp.start, time - REPLAY_COMET_S)).index;
    for (let d = firstSpawnDay; d <= dayIndex; d++) {
      const dayLanes = this.lanesByDay.get(this.days[d]!);
      if (!dayLanes) continue;
      for (const spawn of this.spawns(d, dayLanes)) {
        const progress = (time - (this.dayStart(d) + spawn.offset * this.warp.dayLength(d))) / REPLAY_COMET_S;
```

  The rest of the comet loop is unchanged.

- Grep the repo for `secondsPerDay` and update any other reader to `warp.dayLength(index)`. Expected: `timeline.ts` only.

Run: `pnpm --filter @ccip-dev/site exec vitest run test/timeline.test.ts test/compose.test.ts`
Expected: PASS. Every existing replay test must pass unchanged, because the default linear warp reproduces the old `secondsPerDay` math exactly.

- [ ] **Step 3: Commit**

Run the site suite, the typecheck and the build, then:

```bash
git add site/src/replay/timeline.ts site/test/timeline.test.ts
git commit -m "refactor(site): replay model reads time through a warp; the linear warp keeps today's behavior"
```

---
## Task 4: Camera, leaderboard and story values

**Files:**
- Create: `site/src/replay/director/camera.ts`, `site/src/replay/director/leaderboard.ts`, `site/src/replay/director/story.ts`
- Test: `site/test/director-camera.test.ts`, `site/test/director-board.test.ts`, `site/test/director-story.test.ts`

**Interfaces:**
- Consumes: `Warp` and `durationWarp`/`linearWarp` (Task 1); `topSelectors` (`site/src/sky/weights.ts`).
- Produces:
  - from `camera.ts`:
    - `interface Camera { cx: number; cy: number; extent: number; rotation: number }`;
    - the constants `ORBIT_RAD`, `PUNCH = 0.06`, `PUNCH_IN_S = 0.3`, `PUNCH_OUT_S = 0.8`, `FOCUS_PAN = 0.35`, `FOCUS_FROM = 0.75` and `FINALE_EASE_S = 2`;
    - `punch(age: number): number`;
    - `interface CameraInput { t: number; baseExtent: number; fullExtent: number; storyStart: number; storyEnd: number; slamStarts: readonly number[]; focus: { x: number; y: number } | null }`;
    - `cameraAt(input: CameraInput): Camera`;
  - from `leaderboard.ts`: `BOARD_ROWS = 5`, `BOARD_FADE_S = 0.4`, `interface BoardRow { selector: string; value: number; rank: number; alpha: number; focus: boolean }`, and `class Leaderboard`:
    - `constructor(replay: Pick<ReplayFile, 'chains' | 'lanes' | 'days'>, days: readonly string[], eligible: (selector: string) => boolean)`;
    - `at(t: number, warp: Warp, focus: string | null): BoardRow[]`;
  - from `story.ts`: `interface StoryValues { usd: number; messages: number; chains: number; day: string; timeline: number }`, and `class StoryCounter`:
    - `constructor(days: readonly string[], history: readonly { day: string; messages: number; usd_value: number }[], replay: Pick<ReplayFile, 'chains' | 'lanes' | 'days'>, focus: string | null)`;
    - `at(t: number, warp: Warp): StoryValues`;
    - `dailyMessages(): number[]`;
    - `dailyTotals(): { day: string; messages: number; usd_value: number }[]`.

- [ ] **Step 1: Write the failing tests**

`site/test/director-camera.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cameraAt, ORBIT_RAD, punch, PUNCH } from '../src/replay/director/camera';

const base = { baseExtent: 2, fullExtent: 3, storyStart: 2, storyEnd: 27, slamStarts: [] as number[], focus: null };

describe('punch', () => {
  it('rises over 0.3 s, then falls back to 0 by 1.1 s', () => {
    expect(punch(-1)).toBe(0);
    expect(punch(0.3)).toBeCloseTo(1, 6);
    expect(punch(1.1)).toBe(0);
    expect(punch(0.15)).toBeGreaterThan(0);
  });
});

describe('cameraAt', () => {
  it('starts centered with no rotation, then orbits through the story', () => {
    expect(cameraAt({ ...base, t: 2 })).toEqual({ cx: 0, cy: 0, extent: 2, rotation: 0 });
    expect(cameraAt({ ...base, t: 14.5 }).rotation).toBeCloseTo(ORBIT_RAD / 2, 6);
  });

  it('eases to the full shot with no rotation in the finale', () => {
    const c = cameraAt({ ...base, t: 29.5 });
    expect(c.extent).toBeCloseTo(3, 6);
    expect(c.rotation).toBeCloseTo(0, 6);
  });

  it('pushes in on a milestone', () => {
    expect(cameraAt({ ...base, t: 10.3, slamStarts: [10] }).extent).toBeCloseTo(2 * (1 - PUNCH), 6);
  });

  it('pans toward the focus chain late in the story, widening to keep the network in view', () => {
    const early = cameraAt({ ...base, t: 10, focus: { x: 1, y: 0 } });
    const late = cameraAt({ ...base, t: 27, focus: { x: 1, y: 0 } });
    expect(early.cx).toBe(0);
    expect(late.cx).toBeCloseTo(0.35, 6);
    expect(late.extent).toBeCloseTo(2 + 0.35, 6);
  });

  it('moves smoothly: no jump over 2% of the extent between frames', () => {
    let prev = cameraAt({ ...base, t: 0, slamStarts: [8, 15], focus: { x: 0.6, y: 0.4 } });
    for (let t = 1 / 30; t <= 30; t += 1 / 30) {
      const now = cameraAt({ ...base, t, slamStarts: [8, 15], focus: { x: 0.6, y: 0.4 } });
      expect(Math.abs(now.extent - prev.extent)).toBeLessThan(0.02 * prev.extent);
      prev = now;
    }
  });
});
```

`site/test/director-board.test.ts`:

```ts
import type { ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { BOARD_ROWS, Leaderboard } from '../src/replay/director/leaderboard';
import { linearWarp } from '../src/replay/director/warp';

const days = ['2024-01-01', '2024-01-02', '2024-01-03'];
const replay = {
  chains: ['A', 'B', 'C'].map((s) => ({ selector: s, name: s, display_name: s, first_day: '2024-01-01' })),
  lanes: [[0, 0], [1, 1], [2, 2]],
  days: [
    { day: '2024-01-01', lanes: [[0, 1, 100], [1, 1, 50], [2, 1, 10]] },
    { day: '2024-01-02', lanes: [[1, 1, 200]] },
    { day: '2024-01-03', lanes: [[2, 1, 5]] },
  ],
} as unknown as ReplayFile;
const warp = linearWarp(3, 0, 3);

describe('Leaderboard', () => {
  it('ranks chains by trailing value and settles after the fade', () => {
    const rows = new Leaderboard(replay, days, () => true).at(0.9, warp, null);
    expect(rows.map((r) => [r.selector, r.rank])).toEqual([['A', 0], ['B', 1], ['C', 2]]);
    expect(rows[0]!.value).toBe(200);
  });

  it('slides ranks smoothly when a chain overtakes', () => {
    const rows = new Leaderboard(replay, days, () => true).at(1.2, warp, null);
    const a = rows.find((r) => r.selector === 'A')!;
    const b = rows.find((r) => r.selector === 'B')!;
    expect(a.rank).toBeCloseTo(0.5, 6);
    expect(b.rank).toBeCloseTo(0.5, 6);
  });

  it('skips chains without an icon and pins an off-board focus chain', () => {
    const board = new Leaderboard(replay, days, (s) => s !== 'A');
    expect(board.at(0.9, warp, null).map((r) => r.selector)).toEqual(['B', 'C']);
    const pinned = board.at(0.9, warp, 'A');
    expect(pinned.at(-1)).toMatchObject({ selector: 'A', rank: BOARD_ROWS, focus: true, alpha: 1 });
  });

  it('is empty before the story starts', () => {
    expect(new Leaderboard(replay, days, () => true).at(-1, linearWarp(3, 0, 3), null)).toEqual([]);
  });
});
```

The numbers follow from the data. On day 0, A has 200 because its self-lane counts twice (as the star sizes do), B has 100 and C has 20. At t = 0.9 the 0.4 s window lies within day 0, so the ranks are exact. On day 1, B adds 400 for a total of 500 and overtakes A, which stays at 200. At t = 1.2 the window [0.8, 1.2] is half day 0 and half day 1, so A and B both average 0.5.

`site/test/director-story.test.ts`:

```ts
import type { ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { StoryCounter } from '../src/replay/director/story';
import { linearWarp } from '../src/replay/director/warp';

const days = ['2024-01-01', '2024-01-02'];
const history = [
  { day: '2024-01-01', messages: 10, usd_value: 1000 },
  { day: '2024-01-02', messages: 30, usd_value: 3000 },
];
const replay = {
  chains: [
    { selector: 'A', name: 'a', display_name: 'A', first_day: '2024-01-01' },
    { selector: 'B', name: 'b', display_name: 'B', first_day: '2024-01-02' },
    { selector: 'C', name: 'c', display_name: 'C', first_day: '2024-01-02' },
  ],
  lanes: [[0, 1], [2, 0], [1, 2], [0, 0]],
  days: [
    { day: '2024-01-01', lanes: [[3, 4, 40]] },
    { day: '2024-01-02', lanes: [[0, 5, 500], [1, 6, 600], [2, 7, 700]] },
  ],
} as unknown as ReplayFile;
const warp = linearWarp(2, 2, 4);

describe('StoryCounter', () => {
  it('counts the whole network, interpolated within the day', () => {
    const at = new StoryCounter(days, history, replay, null).at(3.5, warp);
    expect(at).toEqual({ usd: 1000 + 3000 * 0.5, messages: 10 + 30 * 0.5, chains: 3, day: '2024-01-02', timeline: 0.75 });
  });

  it('starts at zero before the story', () => {
    expect(new StoryCounter(days, history, replay, null).at(0, warp)).toMatchObject({ usd: 0, messages: 0, timeline: 0 });
  });

  it('counts only lanes touching the focus chain, and its partners so far', () => {
    const counter = new StoryCounter(days, history, replay, 'A');
    expect(counter.at(4, warp)).toMatchObject({ usd: 40 + 500 + 600, messages: 4 + 5 + 6, chains: 2 });
    expect(counter.dailyMessages()).toEqual([4, 11]);
  });
});
```

The focus numbers follow from the data. Day 0's self-lane (lane 3) counts once, giving 40 USD and 4 messages. Day 1 adds lanes 0 (A to B) and 1 (C to A); lane 2 (B to C) doesn't touch A. A's partners by day 1 are B and C, so `chains` is 2.

Run: `pnpm --filter @ccip-dev/site exec vitest run test/director-camera.test.ts test/director-board.test.ts test/director-story.test.ts`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 2: Implement**

`site/src/replay/director/camera.ts`:

```ts
export interface Camera {
  cx: number;
  cy: number;
  extent: number;
  rotation: number;
}

export interface CameraInput {
  t: number;
  baseExtent: number;
  fullExtent: number;
  storyStart: number;
  storyEnd: number;
  slamStarts: readonly number[];
  focus: { x: number; y: number } | null;
}

export const ORBIT_RAD = (20 * Math.PI) / 180;
export const PUNCH = 0.06;
export const PUNCH_IN_S = 0.3;
export const PUNCH_OUT_S = 0.8;
export const FOCUS_PAN = 0.35;
export const FOCUS_FROM = 0.75;
export const FINALE_EASE_S = 2;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

export function punch(age: number): number {
  if (age < 0 || age >= PUNCH_IN_S + PUNCH_OUT_S) return 0;
  if (age < PUNCH_IN_S) return smoothstep(age / PUNCH_IN_S);
  return 1 - smoothstep((age - PUNCH_IN_S) / PUNCH_OUT_S);
}

export function cameraAt(i: CameraInput): Camera {
  const story = clamp01((i.t - i.storyStart) / Math.max(1e-9, i.storyEnd - i.storyStart));
  const finale = smoothstep((i.t - i.storyEnd) / FINALE_EASE_S);
  const pan = i.focus ? FOCUS_PAN * smoothstep((story - FOCUS_FROM) / (1 - FOCUS_FROM)) : 0;
  const cx = i.focus ? i.focus.x * pan : 0;
  const cy = i.focus ? i.focus.y * pan : 0;
  const push = Math.max(0, ...i.slamStarts.map((s) => punch(i.t - s)));
  const extent = (i.baseExtent + (i.fullExtent - i.baseExtent) * finale) * (1 - PUNCH * push) + Math.hypot(cx, cy);
  return { cx, cy, extent, rotation: ORBIT_RAD * story * (1 - finale) };
}
```

`site/src/replay/director/leaderboard.ts`:

```ts
import type { ReplayFile } from '@ccip-dev/core/public';
import { topSelectors } from '../../sky/weights';
import type { Warp } from './warp';

export const BOARD_ROWS = 5;
export const BOARD_FADE_S = 0.4;
const WINDOW_DAYS = 30;

export interface BoardRow {
  selector: string;
  value: number;
  rank: number;
  alpha: number;
  focus: boolean;
}

type Source = Pick<ReplayFile, 'chains' | 'lanes' | 'days'>;

export class Leaderboard {
  private readonly ranks: Map<string, number>[];
  private readonly values: Map<string, number>[];

  constructor(replay: Source, days: readonly string[], eligible: (selector: string) => boolean) {
    const lanesByDay = new Map(replay.days.map((d) => [d.day, d.lanes]));
    const running = new Map<string, number>();
    const shift = (dayIndex: number, sign: 1 | -1) => {
      for (const [lane, , usd] of lanesByDay.get(days[dayIndex]!) ?? []) {
        for (const chain of replay.lanes[lane] ?? []) {
          const selector = replay.chains[chain]?.selector;
          if (selector) running.set(selector, (running.get(selector) ?? 0) + sign * usd);
        }
      }
    };
    this.values = [];
    this.ranks = days.map((_, d) => {
      shift(d, 1);
      if (d >= WINDOW_DAYS) shift(d - WINDOW_DAYS, -1);
      const snapshot = new Map([...running].filter(([, v]) => v > 0));
      this.values.push(snapshot);
      const top = topSelectors(new Map([...snapshot].filter(([s]) => eligible(s))), BOARD_ROWS);
      return new Map(top.map((s, rank) => [s, rank]));
    });
  }

  at(t: number, warp: Warp, focus: string | null): BoardRow[] {
    if (this.ranks.length === 0 || t <= warp.start) return [];
    const start = t - BOARD_FADE_S;
    const last = this.ranks.length - 1;
    const sums = new Map<string, number>();
    const spans: { ranks: Map<string, number>; weight: number }[] = [];
    const pre = Math.max(0, Math.min(t, warp.start) - start) / BOARD_FADE_S;
    const first = warp.dayAt(Math.max(start, warp.start)).index;
    const current = warp.dayAt(t).index;
    for (let d = first; d <= current; d++) {
      const to = d === last ? t : Math.min(t, warp.dayStart(d + 1));
      const overlap = to - Math.max(start, warp.dayStart(d));
      if (overlap > 0) spans.push({ ranks: this.ranks[d]!, weight: overlap / BOARD_FADE_S });
    }
    const candidates = new Set(spans.flatMap((s) => [...s.ranks.keys()]));
    for (const selector of candidates) {
      let avg = pre * BOARD_ROWS;
      for (const s of spans) avg += s.weight * (s.ranks.get(selector) ?? BOARD_ROWS);
      sums.set(selector, avg);
    }
    const values = this.values[current]!;
    const rows = [...sums]
      .filter(([, rank]) => rank < BOARD_ROWS)
      .sort(([a, ra], [b, rb]) => ra - rb || (a < b ? -1 : 1))
      .map(([selector, rank]) => ({
        selector,
        value: values.get(selector) ?? 0,
        rank,
        alpha: Math.min(1, BOARD_ROWS - rank),
        focus: selector === focus,
      }));
    if (focus && !rows.some((r) => r.selector === focus)) {
      rows.push({ selector: focus, value: values.get(focus) ?? 0, rank: BOARD_ROWS, alpha: 1, focus: true });
    }
    return rows;
  }
}
```

`site/src/replay/director/story.ts`:

```ts
import type { ReplayFile } from '@ccip-dev/core/public';
import type { Warp } from './warp';

export interface StoryValues {
  usd: number;
  messages: number;
  chains: number;
  day: string;
  timeline: number;
}

type Source = Pick<ReplayFile, 'chains' | 'lanes' | 'days'>;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export class StoryCounter {
  private readonly daily: { day: string; messages: number; usd_value: number }[];
  private readonly cumUsd: number[];
  private readonly cumMessages: number[];
  private readonly chainsByDay: number[];

  constructor(
    private readonly days: readonly string[],
    history: readonly { day: string; messages: number; usd_value: number }[],
    replay: Source,
    focus: string | null,
  ) {
    const focusIndex = focus === null ? -1 : replay.chains.findIndex((c) => c.selector === focus);
    if (focusIndex >= 0) {
      const lanesByDay = new Map(replay.days.map((d) => [d.day, d.lanes]));
      const partners = new Set<number>();
      this.chainsByDay = [];
      this.daily = days.map((day) => {
        let messages = 0;
        let usd = 0;
        for (const [lane, m, u] of lanesByDay.get(day) ?? []) {
          const ends = replay.lanes[lane];
          if (!ends || (ends[0] !== focusIndex && ends[1] !== focusIndex)) continue;
          messages += m;
          usd += u;
          const partner = ends[0] === focusIndex ? ends[1] : ends[0];
          if (partner !== focusIndex) partners.add(partner);
        }
        this.chainsByDay.push(partners.size);
        return { day, messages, usd_value: usd };
      });
    } else {
      const byDay = new Map(history.map((h) => [h.day, h]));
      const firstDays = replay.chains.map((c) => c.first_day).sort();
      let joined = 0;
      this.chainsByDay = days.map((day) => {
        while (joined < firstDays.length && firstDays[joined]! <= day) joined++;
        return joined;
      });
      this.daily = days.map((day) => ({ day, messages: byDay.get(day)?.messages ?? 0, usd_value: byDay.get(day)?.usd_value ?? 0 }));
    }
    let usd = 0;
    let messages = 0;
    this.cumUsd = this.daily.map((d) => (usd += d.usd_value));
    this.cumMessages = this.daily.map((d) => (messages += d.messages));
  }

  dailyMessages(): number[] {
    return this.daily.map((d) => d.messages);
  }

  dailyTotals(): { day: string; messages: number; usd_value: number }[] {
    return this.daily.map((d) => ({ ...d }));
  }

  at(t: number, warp: Warp): StoryValues {
    const { index, progress } = warp.dayAt(t);
    const p = t <= warp.start ? 0 : progress;
    const lerp = (cum: number[]) => {
      const before = index > 0 ? cum[index - 1]! : 0;
      return before + ((cum[index] ?? before) - before) * p;
    };
    return {
      usd: lerp(this.cumUsd),
      messages: lerp(this.cumMessages),
      chains: this.chainsByDay[index] ?? 0,
      day: this.days[index] ?? '',
      timeline: clamp01((t - warp.start) / Math.max(1e-9, warp.end - warp.start)),
    };
  }
}
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/director-camera.test.ts test/director-board.test.ts test/director-story.test.ts`
Expected: PASS.

If an expected number disagrees with the code, re-derive it from the explanations under each test and report the difference; don't loosen the test. The network `chains` value at day 1 is 3 because chains B and C both have `first_day` 2024-01-02.

- [ ] **Step 3: Commit**

```bash
git add site/src/replay/director/camera.ts site/src/replay/director/leaderboard.ts site/src/replay/director/story.ts site/test/director-camera.test.ts site/test/director-board.test.ts site/test/director-story.test.ts
git commit -m "feat(site): replay director camera, leaderboard race and story counters"
```

---

## Task 5: The `Show`

**Files:**
- Create: `site/src/replay/director/show.ts`
- Test: `site/test/director-show.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 4; `ReplayModel`, `REPLAY_COINS` and `ReplayFrameState` (`timeline.ts`, after Task 3); `computeMilestones`; `daysBetween` (`site/src/lib/days.ts`); `formatUtcDay`; `shortChainName`; `StarPoint`.
- Produces:
  - `interface ShowInput { replay: ReplayFile; history: readonly DayTotals[]; stars: readonly StarPoint[]; length: number; focus: string | null; eligible: (selector: string) => boolean }`;
  - `interface ShowCard extends Card { progress: number }`;
  - `interface ShowSlam extends Slam { progress: number }`;
  - `interface Hook { title: string; subtitle: string; progress: number }`;
  - `interface ShowFrame { t: number; phase: Phase; base: ReplayFrameState; camera: Camera; card: ShowCard | null; slam: ShowSlam | null; story: StoryValues; board: BoardRow[]; hook: Hook | null; finale: number; loop: number; punch: number; focus: string | null; focusStar: number }`;
  - `class Show`:
    - read-only fields `length`, `timing`, `warp`, `model`, `cards`, `slams`, `days`, `focus`, `focusName`;
    - `frameAt(t: number): ShowFrame`;
    - `milestoneMarks(): { time: number; label: string; day: string }[]`;
    - `yearTicks(): { time: number; label: string }[]`;
  - `yearsLabel(from: string, to: string): string`;
  - the constant `LOOP_S = 0.5`.

- [ ] **Step 1: Write the failing tests**

`site/test/director-show.test.ts`:

```ts
import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { Show, yearsLabel } from '../src/replay/director/show';
import { buildLayout } from '../src/sky/layout';
import replayJson from './fixtures/replay.json';

const replay = replayJson as ReplayFile;
const history: DayTotals[] = [
  ['2023-07-06', 2, 0],
  ['2023-07-07', 35, 1500],
  ['2023-07-08', 15, 1_502_000],
  ['2023-07-09', 8, 1000],
].map(([day, messages, usd]) => ({
  day: day as string, messages: messages as number, token_messages: messages as number, usd_value: usd as number, fee_usd: null, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null,
}));
const stars = buildLayout(replay.chains);
const show = (focus: string | null = null, length = 30) => new Show({ replay, history, stars, length, focus, eligible: () => true });

describe('yearsLabel', () => {
  it.each([
    ['2023-07-06', '2026-10-06', '3 years'],
    ['2023-07-06', '2027-01-10', '3½ years'],
    ['2025-01-01', '2026-01-02', '1 year'],
    ['2026-01-01', '2026-12-01', '11 months'],
    ['2026-09-01', '2026-10-01', '1 month'],
  ])('%s → %s is "%s"', (from, to, label) => {
    expect(yearsLabel(from, to)).toBe(label);
  });
});

describe('Show', () => {
  it('opens on the hook with the title and the first message in flight', () => {
    const f = show().frameAt(1);
    expect(f.phase).toBe('hook');
    expect(f.hook).toEqual({ title: '1 month of Chainlink CCIP', subtitle: 'in 30 seconds', progress: 0.5 });
    expect(f.base.sky.comets.length).toBeGreaterThan(0);
  });

  it('tells the story between the hook and the finale', () => {
    const s = show();
    expect(s.warp.start).toBe(2);
    expect(s.warp.end).toBeCloseTo(27, 9);
    expect(s.frameAt(15).phase).toBe('story');
    expect(s.frameAt(15).hook).toBeNull();
  });

  it('runs the finale and cross-fades into the loop at the very end', () => {
    const s = show();
    expect(s.frameAt(28).finale).toBeCloseTo(1 / 3, 6);
    expect(s.frameAt(29).loop).toBe(0);
    expect(s.frameAt(29.99).loop).toBeGreaterThan(0.9);
  });

  it('is a pure function of t, whatever was asked before', () => {
    const s = show();
    const first = s.frameAt(20);
    s.frameAt(3);
    s.frameAt(29.5);
    expect(s.frameAt(20)).toEqual(first);
  });

  it('keeps every card and slam inside the story', () => {
    const s = show();
    for (const c of s.cards) {
      expect(c.start).toBeGreaterThanOrEqual(s.warp.start - 1e-9);
      expect(c.start).toBeLessThan(s.length);
    }
    for (const m of s.milestoneMarks()) expect(m.time).toBeGreaterThanOrEqual(s.warp.start - 1e-9);
  });

  it('starts the timeline with the first year', () => {
    expect(show().yearTicks()[0]).toEqual({ time: 2, label: '2023' });
  });

  it('follows a focus chain: its title, its counters and the lane cards', () => {
    const ethereum = '5009297550715157269';
    const s = show(ethereum);
    expect(s.frameAt(1).hook!.title).toBe('Ethereum × Chainlink CCIP');
    expect(s.frameAt(1).hook!.subtitle).toBe('since Jul 6, 2023');
    expect(s.cards.every((c) => c.kind === 'lane' || c.kind === 'record')).toBe(true);
    expect(s.frameAt(26.9).story.messages).toBeGreaterThan(0);
    expect(s.frameAt(26.9).focus).toBe(ethereum);
  });

  it('handles a 15 s cut', () => {
    const s = show(null, 15);
    expect(s.warp.start).toBe(1.5);
    expect(s.warp.end).toBeCloseTo(13, 9);
  });
});
```

The fixture spans 3 days, and `yearsLabel` never says less than one month, so the hook title is `1 month of Chainlink CCIP`.

Run: `pnpm --filter @ccip-dev/site exec vitest run test/director-show.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 2: Implement**

`site/src/replay/director/show.ts`:

```ts
import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { daysBetween } from '../../lib/days';
import { formatUtcDay } from '../../lib/format';
import { shortChainName } from '../../lib/names';
import { computeMilestones, type DayStats } from '../../lib/records';
import type { StarPoint } from '../../sky/layout';
import { REPLAY_COINS, ReplayModel, type ReplayFrameState } from '../timeline';
import {
  joinEvents,
  laneOpenEvents,
  milestoneEvents,
  recordEvents,
  scheduleCards,
  scheduleSlams,
  SLAM_S,
  dayFlags,
  type Card,
  type Slam,
} from './beats';
import { cameraAt, punch, type Camera } from './camera';
import { Leaderboard, type BoardRow } from './leaderboard';
import { phaseAt, shotTiming, type Phase, type ShotTiming } from './phases';
import { StoryCounter, type StoryValues } from './story';
import { storyWarp, type Warp } from './warp';

export const LOOP_S = 0.5;

export interface ShowInput {
  replay: ReplayFile;
  history: readonly DayTotals[];
  stars: readonly StarPoint[];
  length: number;
  focus: string | null;
  eligible: (selector: string) => boolean;
}

export interface ShowCard extends Card {
  progress: number;
}

export interface ShowSlam extends Slam {
  progress: number;
}

export interface Hook {
  title: string;
  subtitle: string;
  progress: number;
}

export interface ShowFrame {
  t: number;
  phase: Phase;
  base: ReplayFrameState;
  camera: Camera;
  card: ShowCard | null;
  slam: ShowSlam | null;
  story: StoryValues;
  board: BoardRow[];
  hook: Hook | null;
  finale: number;
  loop: number;
  punch: number;
  focus: string | null;
  focusStar: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

export function yearsLabel(from: string, to: string): string {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  const years = Math.floor((days / 365.25) * 2) / 2;
  if (years < 1) {
    const months = Math.max(1, Math.round(days / 30.44));
    return `${months} ${months === 1 ? 'month' : 'months'}`;
  }
  const whole = Math.floor(years);
  const text = years === whole ? String(whole) : `${whole}½`;
  return `${text} ${years === 1 ? 'year' : 'years'}`;
}

export class Show {
  readonly length: number;
  readonly timing: ShotTiming;
  readonly warp: Warp;
  readonly model: ReplayModel;
  readonly cards: Card[];
  readonly slams: Slam[];
  readonly days: string[];
  readonly focus: string | null;
  readonly focusName: string | null;
  private readonly board: Leaderboard;
  private readonly counter: StoryCounter;
  private readonly fullExtent: number;
  private readonly focusPoint: StarPoint | null;
  private readonly focusStar: number;
  private readonly title: { title: string; subtitle: string };
  private readonly hookLane: { from: number; to: number } | null;

  constructor(input: ShowInput) {
    const { replay, history, stars, length } = input;
    const first = replay.since ?? replay.days[0]?.day;
    const last = replay.days.at(-1)?.day;
    this.days = first && last ? daysBetween(first, last) : [];
    this.length = length;
    this.timing = shotTiming(length);
    const focusChain = input.focus ? replay.chains.find((c) => c.selector === input.focus) ?? null : null;
    this.focus = focusChain?.selector ?? null;
    this.focusName = focusChain ? shortChainName(focusChain) : null;
    this.counter = new StoryCounter(this.days, history, replay, this.focus);
    const milestones = this.focus
      ? computeMilestones(this.counter.dailyTotals() as unknown as DayStats[], [])
      : computeMilestones(history, replay.chains);
    const events = [
      ...(this.focus ? laneOpenEvents(replay, this.focus, this.days) : joinEvents(replay.chains, this.days)),
      ...milestoneEvents(milestones, this.days),
      ...(this.focus ? [] : recordEvents(history, this.days)),
    ];
    this.warp = storyWarp(this.counter.dailyMessages(), dayFlags(events, this.days.length), this.timing.hook, length - this.timing.finale, length);
    this.model = new ReplayModel(replay, history, [], stars, length, { count: REPLAY_COINS, eligible: input.eligible }, this.warp);
    this.cards = scheduleCards(events, this.warp, this.focusName);
    this.slams = scheduleSlams(events, this.warp);
    this.board = new Leaderboard(replay, this.days, input.eligible);
    this.fullExtent = Math.max(1e-6, ...stars.map((s) => Math.hypot(s.x, s.y)));
    this.focusPoint = this.focus ? stars.find((s) => s.selector === this.focus) ?? null : null;
    this.focusStar = this.focus ? stars.findIndex((s) => s.selector === this.focus) : -1;
    this.title = focusChain
      ? { title: `${this.focusName} × Chainlink CCIP`, subtitle: `since ${formatUtcDay(focusChain.first_day)}` }
      : { title: `${yearsLabel(first ?? '', last ?? '')} of Chainlink CCIP`, subtitle: `in ${length} seconds` };
    const starOf = new Map(stars.map((s, i) => [s.selector, i]));
    const firstDay = [...replay.days].sort((a, b) => (a.day < b.day ? -1 : 1))[0];
    const lane = firstDay ? replay.lanes[firstDay.lanes[0]?.[0] ?? -1] : undefined;
    const from = lane ? starOf.get(replay.chains[lane[0]]?.selector ?? '') : undefined;
    const to = lane ? starOf.get(replay.chains[lane[1]]?.selector ?? '') : undefined;
    this.hookLane = from !== undefined && to !== undefined ? { from, to } : null;
  }

  frameAt(t: number): ShowFrame {
    const time = Math.max(0, Math.min(t, this.length));
    const phase = phaseAt(time, this.length);
    const modelT = Math.min(Math.max(time, this.warp.start), this.warp.end - 1e-6);
    const raw = this.model.frameAt(modelT);
    const sky = { ...raw.sky, comets: [...raw.sky.comets], lanes: [...raw.sky.lanes], stars: [...raw.sky.stars] };
    if (phase === 'hook' && this.hookLane) {
      sky.comets.push({ ...this.hookLane, progress: clamp01(time / this.timing.hook), size: 0.4, kind: 'data' });
    }
    if (this.focusStar >= 0) {
      const touches = (a: number, b: number) => a === this.focusStar || b === this.focusStar;
      sky.lanes = sky.lanes.map((l) => (touches(l.from, l.to) ? l : { ...l, opacity: l.opacity * 0.25 }));
      sky.comets = sky.comets.filter((c, i) => touches(c.from, c.to) || i % 4 === 0);
      sky.stars = sky.stars.map((s, i) => (i === this.focusStar ? s : { ...s, brightness: s.brightness * 0.6 }));
    }
    const base: ReplayFrameState = { ...raw, sky };
    const slamHit = this.slams.find((s) => time >= s.start && time < s.start + SLAM_S);
    const cardHit = this.cards.find((c) => time >= c.start && time < c.end);
    const finaleStart = this.length - this.timing.finale;
    return {
      t: time,
      phase,
      base,
      camera: cameraAt({
        t: time,
        baseExtent: raw.extent,
        fullExtent: this.fullExtent,
        storyStart: this.warp.start,
        storyEnd: this.warp.end,
        slamStarts: this.slams.map((s) => s.start),
        focus: this.focusPoint,
      }),
      card: cardHit ? { ...cardHit, progress: (time - cardHit.start) / (cardHit.end - cardHit.start) } : null,
      slam: slamHit ? { ...slamHit, progress: (time - slamHit.start) / SLAM_S } : null,
      story: this.counter.at(time, this.warp),
      board: this.board.at(time, this.warp, this.focus),
      hook: phase === 'hook' ? { ...this.title, progress: clamp01(time / this.timing.hook) } : null,
      finale: phase === 'finale' ? clamp01((time - finaleStart) / this.timing.finale) : 0,
      loop: smoothstep((time - (this.length - LOOP_S)) / LOOP_S),
      punch: Math.max(0, ...this.slams.map((s) => punch(time - s.start))),
      focus: this.focus,
      focusStar: this.focusStar,
    };
  }

  milestoneMarks(): { time: number; label: string; day: string }[] {
    return this.slams.map((s) => ({ time: s.start, label: s.label, day: this.days[this.warp.dayAt(s.start).index] ?? '' }));
  }

  yearTicks(): { time: number; label: string }[] {
    return this.days.flatMap((day, i) => (i === 0 || day.endsWith('-01-01') ? [{ time: this.warp.dayStart(i), label: day.slice(0, 4) }] : []));
  }
}
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/director-show.test.ts`
Expected: PASS.

`yearsLabel` rounds down to the half year, so it never overstates.
- `('2023-07-06', '2026-10-06')` is 3.25 years, giving `3 years`.
- `('2023-07-06', '2027-01-10')` is 3.51 years, giving `3½ years`.
- `('2025-01-01', '2026-01-02')` is 1.0 year, giving `1 year`.
- `('2026-01-01', '2026-12-01')` is 334 days, under one year, so it counts months: round(334 / 30.44) = 11, giving `11 months`.
- `('2026-09-01', '2026-10-01')` is 30 days, giving `1 month`.

- [ ] **Step 3: Commit**

```bash
git add site/src/replay/director/show.ts site/test/director-show.test.ts
git commit -m "feat(site): the replay Show composes warp, beats, camera, leaderboard and story"
```

---
## Task 6: Story layer (layout and drawing)

**Files:**
- Create: `site/src/replay/story/layout.ts`, `site/src/replay/story/odometer.ts`, `site/src/replay/story/draw.ts`
- Test: `site/test/story-layout.test.ts`, `site/test/story-draw.test.ts`

**Interfaces:**
- Consumes: `ShowFrame` and `Show` (Task 5); `BoardRow` (Task 4); `ChainNames` and `chainName` (`site/src/lib/names.ts`); `formatCount` and `formatUtcDay`.
- Produces:
  - `type StoryAspect = 'wide' | 'square' | 'tall'`;
  - `interface Box { x: number; y: number; w: number; h: number }`;
  - `interface StoryLayout { aspect: StoryAspect; unit: number; width: number; height: number; date: Box; counter: Box; sub: Box; board: Box; watermark: Box; timeline: Box; card: Box; slam: Box; title: Box }`;
  - `aspectOf(width: number, height: number): StoryAspect`;
  - `layoutFor(width: number, height: number): StoryLayout`;
  - `intersects(a: Box, b: Box): boolean`;
  - `odometer(value: number): { text: string; frac: number }`;
  - `interface StoryAssets { names: ChainNames; coins: ReadonlyMap<string, CanvasImageSource>; ticks: readonly { at: number; label: string }[] }`;
  - `drawStory(ctx, frame: ShowFrame, layout: StoryLayout, assets: StoryAssets): void`.

- [ ] **Step 1: Write the failing tests**

`site/test/story-layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { aspectOf, intersects, layoutFor, type Box } from '../src/replay/story/layout';
import { odometer } from '../src/replay/story/odometer';

const sizes: [number, number][] = [[1920, 1080], [1080, 1080], [1080, 1920], [390, 390], [390, 693], [693, 390]];
const inside = (b: Box, w: number, h: number) => b.x >= 0 && b.y >= 0 && b.x + b.w <= w + 1e-6 && b.y + b.h <= h + 1e-6;

describe('aspectOf', () => {
  it.each([[1920, 1080, 'wide'], [1080, 1080, 'square'], [1080, 1920, 'tall'], [390, 390, 'square']])('%s×%s is %s', (w, h, a) => {
    expect(aspectOf(w, h)).toBe(a);
  });
});

describe.each(sizes)('layoutFor(%s, %s)', (w, h) => {
  const l = layoutFor(w, h);
  const reserved = [l.date, l.counter, l.sub, l.board, l.watermark, l.timeline, l.card];

  it('keeps every box inside the canvas', () => {
    for (const b of [...reserved, l.slam, l.title]) expect(inside(b, w, h)).toBe(true);
  });

  it('never overlaps two reserved boxes', () => {
    for (let i = 0; i < reserved.length; i++) for (let j = i + 1; j < reserved.length; j++) expect(intersects(reserved[i]!, reserved[j]!)).toBe(false);
  });

  it('keeps the milestone slam clear of the counter, card, board and timeline', () => {
    for (const b of [l.counter, l.card, l.board, l.timeline]) expect(intersects(l.slam, b)).toBe(false);
  });
});

describe('odometer', () => {
  it.each([
    [0, '$0', 0],
    [999.4, '$999', 0.4],
    [1500, '$1.5K', 0],
    [1_234_567, '$1.2M', 0.34567],
    [25_300_000_000, '$25.3B', 0],
  ])('%s shows %s rolling %s toward the next digit', (value, text, frac) => {
    const o = odometer(value);
    expect(o.text).toBe(text);
    expect(o.frac).toBeCloseTo(frac, 4);
  });
});
```

`site/test/story-draw.test.ts`:

```ts
import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { Show } from '../src/replay/director/show';
import { drawStory } from '../src/replay/story/draw';
import { layoutFor } from '../src/replay/story/layout';
import { chainNameMap } from '../src/lib/names';
import { buildLayout } from '../src/sky/layout';
import replayJson from './fixtures/replay.json';

const replay = replayJson as ReplayFile;
const history = replay.days.map((d) => ({ day: d.day, messages: 10, token_messages: 10, usd_value: 1000, fee_usd: null, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null })) as DayTotals[];
const show = new Show({ replay, history, stars: buildLayout(replay.chains), length: 30, focus: null, eligible: () => true });
const assets = { names: chainNameMap(replay.chains), coins: new Map<string, CanvasImageSource>(), ticks: [{ at: 0, label: '2023' }] };

function fakeCtx(texts: string[]) {
  return new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'fillText') return (s: string) => texts.push(s);
        if (key === 'measureText') return (s: string) => ({ width: s.length * 10 });
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
        return () => {};
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
}

describe('drawStory', () => {
  it('draws the hook title and the watermark during the hook', () => {
    const texts: string[] = [];
    drawStory(fakeCtx(texts), show.frameAt(1), layoutFor(1920, 1080), assets);
    expect(texts).toContain('1 month of Chainlink CCIP');
    expect(texts).toContain('in 30 seconds');
    expect(texts).toContain('ccip.dev · @ccipdev');
  });

  it('draws the date, counter, the active card and the board during the story', () => {
    const card = show.cards[0]!;
    const frame = show.frameAt(card.start + 0.1);
    const texts: string[] = [];
    drawStory(fakeCtx(texts), frame, layoutFor(1080, 1080), assets);
    expect(texts.some((t) => t.startsWith('Jul '))).toBe(true);
    expect(texts).toContain(card.label);
    expect(texts.some((t) => t.includes('messages'))).toBe(true);
  });

  it('draws a milestone slam', () => {
    const texts: string[] = [];
    const frame = { ...show.frameAt(15), slam: { start: 14.5, label: '$10B moved', progress: 0.4 } };
    drawStory(fakeCtx(texts), frame, layoutFor(1080, 1920), assets);
    expect(texts).toContain('$10B moved');
  });

  it('draws the end title in the finale', () => {
    const texts: string[] = [];
    drawStory(fakeCtx(texts), show.frameAt(29), layoutFor(1920, 1080), assets);
    expect(texts).toContain('ccip.dev');
  });
});
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/story-layout.test.ts test/story-draw.test.ts`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 2: Implement the layout and the odometer**

`site/src/replay/story/layout.ts`:

```ts
export type StoryAspect = 'wide' | 'square' | 'tall';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StoryLayout {
  aspect: StoryAspect;
  unit: number;
  width: number;
  height: number;
  date: Box;
  counter: Box;
  sub: Box;
  board: Box;
  watermark: Box;
  timeline: Box;
  card: Box;
  slam: Box;
  title: Box;
}

export function aspectOf(width: number, height: number): StoryAspect {
  const r = width / height;
  return r > 1.2 ? 'wide' : r < 0.8 ? 'tall' : 'square';
}

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const centered = (width: number, w: number, y: number, h: number): Box => ({ x: (width - w) / 2, y, w, h });

export function layoutFor(width: number, height: number): StoryLayout {
  const aspect = aspectOf(width, height);
  const u = Math.min(width, height) / 1080;
  const pad = 48 * u;
  const date: Box = { x: pad, y: pad, w: 560 * u, h: 56 * u };
  const counter: Box = { x: pad, y: pad + 64 * u, w: 640 * u, h: 110 * u };
  const sub: Box = { x: pad, y: pad + 180 * u, w: 640 * u, h: 34 * u };
  const timelineH = 40 * u;
  const slam = centered(width, Math.min(900 * u, width - 2 * pad), height / 2 - 100 * u, 200 * u);
  const title = centered(width, Math.min(1200 * u, width - 2 * pad), height / 2 - 130 * u, 260 * u);
  if (aspect === 'wide') {
    const boardW = 380 * u;
    const board: Box = { x: width - pad - boardW, y: pad, w: boardW, h: 320 * u };
    const watermark: Box = { x: width - pad - boardW, y: height - pad - 30 * u, w: boardW, h: 30 * u };
    const timeline: Box = { x: pad, y: height - pad - timelineH, w: width - 2 * pad - boardW - 40 * u, h: timelineH };
    const card = centered(width, 640 * u, timeline.y - 24 * u - 90 * u, 90 * u);
    return { aspect, unit: u, width, height, date, counter, sub, board, watermark, timeline, card, slam, title };
  }
  const watermark: Box = { x: width - pad - 300 * u, y: pad, w: 300 * u, h: 30 * u };
  const timeline: Box = { x: pad, y: height - pad - timelineH, w: width - 2 * pad, h: timelineH };
  const board: Box = { x: pad, y: timeline.y - 16 * u - 120 * u, w: width - 2 * pad, h: 120 * u };
  const card = centered(width, 640 * u, board.y - 24 * u - 90 * u, 90 * u);
  return { aspect, unit: u, width, height, date, counter, sub, board, watermark, timeline, card, slam, title };
}
```

Geometry check for the square layout at 1080: the counter occupies y 112 to 222, the slam 440 to 640, the card 742 to 832, the board 856 to 976 and the timeline 992 to 1032. The watermark (x 732 to 1032, y 48 to 78) sits beside the date (x 48 to 608), so they don't overlap. Every value scales with `u`, so 390-px canvases keep the same proportions.

`site/src/replay/story/odometer.ts`:

```ts
const UNITS: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K'], [1, '']];

export function odometer(value: number): { text: string; frac: number } {
  const v = Math.max(0, value);
  const [size, suffix] = UNITS.find(([s]) => v >= s) ?? [1, ''];
  const step = suffix === '' ? 1 : 0.1;
  const n = v / size / step;
  const whole = Math.floor(n + 1e-9);
  const shown = whole * step;
  return { text: `$${suffix === '' ? String(shown) : shown.toFixed(1)}${suffix}`, frac: Math.max(0, n - whole) };
}
```

- [ ] **Step 3: Implement the drawing**

`site/src/replay/story/draw.ts`:

```ts
import { formatCount, formatUtcDay } from '../../lib/format';
import { chainName, type ChainNames } from '../../lib/names';
import type { ShowFrame } from '../director/show';
import type { Box, StoryLayout } from './layout';
import { odometer } from './odometer';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface StoryAssets {
  names: ChainNames;
  coins: ReadonlyMap<string, CanvasImageSource>;
  ticks: readonly { at: number; label: string }[];
}

const FG = '#e8eaed';
const MUTED = '#8892a0';
const BLUE = '#4a7ff0';
const CARD = 'rgba(22, 27, 35, 0.88)';
const BORDER = 'rgba(47, 98, 223, 0.45)';
const SANS = 'Inter, sans-serif';
const MONO = '"JetBrains Mono", monospace';
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => 1 - (1 - clamp01(x)) ** 3;

function roundRect(ctx: Ctx, b: Box, r: number): void {
  ctx.beginPath();
  ctx.moveTo(b.x + r, b.y);
  ctx.lineTo(b.x + b.w - r, b.y);
  ctx.arc(b.x + b.w - r, b.y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(b.x + b.w, b.y + b.h - r);
  ctx.arc(b.x + b.w - r, b.y + b.h - r, r, 0, Math.PI / 2);
  ctx.lineTo(b.x + r, b.y + b.h);
  ctx.arc(b.x + r, b.y + b.h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(b.x, b.y + r);
  ctx.arc(b.x + r, b.y + r, r, Math.PI, (3 * Math.PI) / 2);
  ctx.closePath();
}

function coin(ctx: Ctx, assets: StoryAssets, selector: string, cx: number, cy: number, d: number): void {
  const image = assets.coins.get(selector);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  if (image) {
    ctx.clip();
    ctx.drawImage(image, cx - d / 2, cy - d / 2, d, d);
  } else {
    ctx.fillStyle = BLUE;
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = Math.max(1, d / 30);
  ctx.stroke();
}

function drawTitle(ctx: Ctx, frame: ShowFrame, l: StoryLayout): void {
  const hook = frame.hook!;
  const u = l.unit;
  const appear = ease(hook.progress / 0.35);
  const leave = 1 - ease((hook.progress - 0.8) / 0.2);
  ctx.save();
  ctx.globalAlpha = appear * leave;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = l.width / 2;
  const sweep = ctx.createLinearGradient(l.title.x, 0, l.title.x + l.title.w, 0);
  const at = clamp01(hook.progress * 1.4 - 0.2);
  sweep.addColorStop(0, FG);
  sweep.addColorStop(Math.max(0, at - 0.08), FG);
  sweep.addColorStop(at, '#ffffff');
  sweep.addColorStop(Math.min(1, at + 0.08), FG);
  sweep.addColorStop(1, FG);
  ctx.fillStyle = sweep;
  ctx.font = `800 ${86 * u}px ${SANS}`;
  ctx.fillText(hook.title, cx, l.title.y + l.title.h * 0.38);
  ctx.fillStyle = BLUE;
  ctx.font = `600 ${44 * u}px ${SANS}`;
  ctx.fillText(hook.subtitle, cx, l.title.y + l.title.h * 0.78);
  ctx.restore();
}

function drawCounter(ctx: Ctx, frame: ShowFrame, l: StoryLayout): void {
  const u = l.unit;
  const { text, frac } = odometer(frame.story.usd);
  const size = 96 * u;
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.font = `700 ${size}px ${MONO}`;
  ctx.fillStyle = FG;
  const digitIndex = text.search(/\d(?=[^\d]*$)/);
  const digit = digitIndex >= 0 ? Number(text[digitIndex]) : null;
  const tail = digitIndex >= 0 ? text.slice(digitIndex + 1) : '';
  const prefix = digitIndex >= 0 ? text.slice(0, digitIndex) : text;
  ctx.fillText(prefix, l.counter.x, l.counter.y);
  if (digit !== null) {
    const x = l.counter.x + ctx.measureText(prefix).width;
    const w = ctx.measureText('0').width;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, l.counter.y, w, size * 1.1);
    ctx.clip();
    ctx.fillText(String(digit), x, l.counter.y - frac * size);
    ctx.fillText(String((digit + 1) % 10), x, l.counter.y + (1 - frac) * size);
    ctx.restore();
    ctx.fillText(tail, x + w, l.counter.y);
  }
  ctx.font = `400 ${26 * u}px ${SANS}`;
  ctx.fillStyle = MUTED;
  ctx.fillText(`moved · ${formatCount(frame.story.messages)} messages · ${frame.story.chains} chains`, l.sub.x, l.sub.y);
  ctx.restore();
}

function drawDate(ctx: Ctx, frame: ShowFrame, l: StoryLayout): void {
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.font = `600 ${48 * l.unit}px ${MONO}`;
  ctx.fillStyle = FG;
  ctx.fillText(formatUtcDay(frame.story.day), l.date.x, l.date.y);
  ctx.restore();
}

function drawTimeline(ctx: Ctx, frame: ShowFrame, l: StoryLayout, assets: StoryAssets): void {
  const u = l.unit;
  const b = l.timeline;
  const y = b.y + 8 * u;
  ctx.save();
  ctx.fillStyle = 'rgba(232, 234, 237, 0.14)';
  ctx.fillRect(b.x, y, b.w, 4 * u);
  const fill = ctx.createLinearGradient(b.x, 0, b.x + b.w, 0);
  fill.addColorStop(0, '#2f62df');
  fill.addColorStop(1, '#6c9bff');
  ctx.fillStyle = fill;
  ctx.fillRect(b.x, y, b.w * frame.story.timeline, 4 * u);
  ctx.fillStyle = MUTED;
  ctx.font = `600 ${18 * u}px ${MONO}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  for (const tick of assets.ticks) ctx.fillText(tick.label, b.x + b.w * tick.at, y + 12 * u);
  ctx.restore();
}

function drawCard(ctx: Ctx, frame: ShowFrame, l: StoryLayout, assets: StoryAssets): void {
  const card = frame.card!;
  const u = l.unit;
  const enter = ease(card.progress / 0.15);
  const exit = 1 - ease((card.progress - 0.85) / 0.15);
  const dim = frame.slam ? 0.4 : 1;
  const b = { ...l.card, y: l.card.y + (1 - enter) * 24 * u };
  ctx.save();
  ctx.globalAlpha = Math.min(enter, exit) * dim;
  roundRect(ctx, b, 18 * u);
  ctx.fillStyle = CARD;
  ctx.fill();
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 2 * u;
  ctx.stroke();
  const d = 56 * u;
  card.selectors.forEach((s, i) => coin(ctx, assets, s, b.x + 24 * u + d / 2 + i * d * 0.7, b.y + b.h / 2, d));
  ctx.font = `600 ${32 * u}px ${SANS}`;
  ctx.fillStyle = FG;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(card.label, b.x + 24 * u + d + Math.max(0, card.selectors.length - 1) * d * 0.7 + 18 * u, b.y + b.h / 2);
  ctx.restore();
}

function drawSlam(ctx: Ctx, frame: ShowFrame, l: StoryLayout): void {
  const slam = frame.slam!;
  const u = l.unit;
  const scale = 1.4 - 0.4 * ease(slam.progress / 0.25);
  const alpha = ease(slam.progress / 0.15) * (1 - ease((slam.progress - 0.8) / 0.2));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(l.width / 2, l.slam.y + l.slam.h / 2);
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${110 * u}px ${SANS}`;
  ctx.fillStyle = FG;
  ctx.fillText(slam.label, 0, 0);
  ctx.restore();
}

function drawBoard(ctx: Ctx, frame: ShowFrame, l: StoryLayout, assets: StoryAssets): void {
  const u = l.unit;
  const rows = frame.board;
  if (rows.length === 0) return;
  const max = Math.max(...rows.map((r) => r.value), 1);
  ctx.save();
  ctx.textBaseline = 'middle';
  if (l.aspect === 'wide') {
    const rowH = 60 * u;
    for (const r of rows) {
      const y = l.board.y + r.rank * rowH;
      ctx.globalAlpha = r.alpha;
      if (r.focus) {
        roundRect(ctx, { x: l.board.x - 8 * u, y: y + 4 * u, w: l.board.w + 16 * u, h: rowH - 8 * u }, 10 * u);
        ctx.fillStyle = 'rgba(19, 36, 77, 0.9)';
        ctx.fill();
      }
      coin(ctx, assets, r.selector, l.board.x + 20 * u, y + rowH / 2, 36 * u);
      ctx.fillStyle = FG;
      ctx.font = `600 ${24 * u}px ${SANS}`;
      ctx.textAlign = 'left';
      ctx.fillText(chainName(assets.names, r.selector), l.board.x + 48 * u, y + rowH / 2 - 8 * u);
      ctx.fillStyle = 'rgba(74, 127, 240, 0.55)';
      ctx.fillRect(l.board.x + 48 * u, y + rowH / 2 + 10 * u, (l.board.w - 160 * u) * (r.value / max), 6 * u);
      ctx.fillStyle = MUTED;
      ctx.font = `600 ${20 * u}px ${MONO}`;
      ctx.textAlign = 'right';
      ctx.fillText(odometer(r.value).text, l.board.x + l.board.w, y + rowH / 2);
    }
  } else {
    const shown = rows.filter((r) => r.rank < 3 || r.focus);
    const colW = l.board.w / Math.max(3, shown.length);
    for (const r of shown) {
      const x = l.board.x + Math.min(r.rank, 3) * colW;
      ctx.globalAlpha = r.alpha;
      coin(ctx, assets, r.selector, x + 28 * u, l.board.y + 40 * u, 44 * u);
      ctx.fillStyle = r.focus ? BLUE : FG;
      ctx.font = `600 ${22 * u}px ${SANS}`;
      ctx.textAlign = 'left';
      ctx.fillText(chainName(assets.names, r.selector), x + 60 * u, l.board.y + 30 * u);
      ctx.fillStyle = MUTED;
      ctx.font = `600 ${18 * u}px ${MONO}`;
      ctx.fillText(odometer(r.value).text, x + 60 * u, l.board.y + 58 * u);
    }
  }
  ctx.restore();
}

function drawWatermark(ctx: Ctx, l: StoryLayout): void {
  ctx.save();
  ctx.font = `600 ${22 * l.unit}px ${SANS}`;
  ctx.fillStyle = BLUE;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('ccip.dev · @ccipdev', l.watermark.x + l.watermark.w, l.watermark.y);
  ctx.restore();
}

function drawEndTitle(ctx: Ctx, frame: ShowFrame, l: StoryLayout): void {
  const alpha = ease((frame.finale - 0.3) / 0.4);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${130 * l.unit}px ${SANS}`;
  ctx.fillStyle = BLUE;
  ctx.fillText('ccip.dev', l.width / 2, l.height / 2);
  ctx.restore();
}

export function drawStory(ctx: Ctx, frame: ShowFrame, layout: StoryLayout, assets: StoryAssets): void {
  if (frame.hook) {
    drawTitle(ctx, frame, layout);
    drawWatermark(ctx, layout);
    return;
  }
  drawDate(ctx, frame, layout);
  drawCounter(ctx, frame, layout);
  drawTimeline(ctx, frame, layout, assets);
  drawBoard(ctx, frame, layout, assets);
  if (frame.card) drawCard(ctx, frame, layout, assets);
  if (frame.slam) drawSlam(ctx, frame, layout);
  drawWatermark(ctx, layout);
  if (frame.phase === 'finale') drawEndTitle(ctx, frame, layout);
}
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/story-layout.test.ts test/story-draw.test.ts`
Expected: PASS.

The fixture's first card is the first join on day 0. Its label comes from `scheduleCards`, so read it from `show.cards[0]` as the test does.

- [ ] **Step 4: Commit**

```bash
git add site/src/replay/story site/test/story-layout.test.ts site/test/story-draw.test.ts
git commit -m "feat(site): replay story layer: layouts per aspect, odometer counter, cards, slams, leaderboard, titles"
```

---

## Task 7: Compositor draws the `Show`; recorder length; all icons load

**Files:**
- Modify: `site/src/sky/layout.ts` (add `cameraProjector`), `site/src/replay/compose.ts`, `site/src/replay/recorder.ts`, `site/src/replay/timeline.ts`, `site/src/replay/player.tsx` (minimal wiring), `docs/superpowers/specs/2026-10-07-chain-icons-design.md` (§7.2 preload line)
- Test: `site/test/layout.test.ts`, `site/test/compose.test.ts`, `site/test/recorder.test.ts`

**Interfaces:**
- Consumes: `Show` and `ShowFrame` (Task 5); `drawStory` and `layoutFor` (Task 6); `Camera` (Task 4).
- Produces:
  - `cameraProjector(width: number, height: number, camera: Camera, margin?: number): Projector`;
  - `ReplayCompositor`, constructed as `new ReplayCompositor(show: Pick<Show, 'frameAt' | 'timing' | 'length' | 'warp'>, stars: readonly StarPoint[], assets: { names: ChainNames; ticks: readonly { at: number; label: string }[] }, createCanvas: () => SkyCanvas)`, keeping `draw(t, target, width, height)`, `setCoinImages` and `destroy`;
  - `REPLAY_LENGTHS = [15, 30, 60] as const`, with the default length 30;
  - `totalFrames(lengthS) = REPLAY_FPS * lengthS`.

- [ ] **Step 1: Write the failing tests**

Append to `site/test/layout.test.ts`, importing `cameraProjector` from `'../src/sky/layout'`:

```ts
describe('cameraProjector', () => {
  it('matches the plain projector when centered with no rotation', () => {
    const plain = projector(800, 800, [], 0.08, 2);
    const cam = cameraProjector(800, 800, { cx: 0, cy: 0, extent: 2, rotation: 0 });
    expect(cam(0.5, -0.25)).toEqual(plain(0.5, -0.25));
  });

  it('moves the center to the middle of the canvas and rotates around it', () => {
    const cam = cameraProjector(800, 800, { cx: 1, cy: 0, extent: 2, rotation: Math.PI / 2 });
    expect(cam(1, 0)).toEqual([400, 400]);
    const [x, y] = cam(2, 0);
    expect(x).toBeCloseTo(400, 6);
    expect(y).toBeGreaterThan(400);
  });
});
```

In `site/test/compose.test.ts`:
- **Delete** the `overlayText` and `drawOverlay` describe blocks, along with their imports. The story layer replaces them and is tested in Task 6.
- Change the `state` helper users so the `model` stubs become `show` stubs: `{ frameAt: () => frame, timing: { hook: 2, finale: 3 }, length: 30, warp: { start: 2, end: 27 } }`, where `frame` is a `ShowFrame`-shaped object.
- Use a helper that builds a minimal `ShowFrame` around the existing `state(false)`:

```ts
const showFrame = (base = state(false)) => ({
  t: 10, phase: 'story' as const, base, camera: { cx: 0, cy: 0, extent: 1, rotation: 0 },
  card: null, slam: null, story: { usd: 0, messages: 0, chains: 0, day: '2023-07-07', timeline: 0.3 },
  board: [], hook: null, finale: 0, loop: 0, punch: 0, focus: null, focusStar: -1,
});
const showStub = (frame: ReturnType<typeof showFrame>) =>
  ({ frameAt: () => frame, timing: { hook: 2, finale: 3 }, length: 30, warp: { start: 2, end: 27 } }) as never;
const assets = { names: new Map<string, string>(), ticks: [] };
```

- Update each `new ReplayCompositor(model, stars, '2023-07-06', '2026-10-06', createCanvas)` call to `new ReplayCompositor(showStub(frame), stars, assets, createCanvas)`.
- The fake 2D `target` needs the extra no-op methods that `drawStory` calls: `translate`, `scale`, `rect`, `clip`, `moveTo`, `lineTo`, `closePath`, `fill`, `measureText` (returning `{ width: 0 }`) and `createLinearGradient` (returning `{ addColorStop() {} }`). Add them to `coinTarget` and to the destroyed-compositor target.
- Keep these assertions as they are: the destroyed compositor stops drawing; the 2D retry on a fresh canvas; the coin drawn at `[image, 388, 388, 24, 24]`, since the camera at extent 1 with no rotation matches the old projector.

In `site/test/recorder.test.ts`, change `expect(totalFrames(60)).toBe(1860)` to `expect(totalFrames(60)).toBe(1800)`.

Run: `pnpm --filter @ccip-dev/site exec vitest run test/layout.test.ts test/compose.test.ts test/recorder.test.ts`
Expected: FAIL. `cameraProjector` is missing, the compositor constructor shape is wrong, and the frame count is wrong.

- [ ] **Step 2: Implement `cameraProjector`**

Append to `site/src/sky/layout.ts`:

```ts
export function cameraProjector(
  width: number,
  height: number,
  camera: { cx: number; cy: number; extent: number; rotation: number },
  margin = 0.08,
): Projector {
  const base = projector(width, height, [], margin, camera.extent);
  const cos = Math.cos(camera.rotation);
  const sin = Math.sin(camera.rotation);
  return (x, y) => {
    const dx = x - camera.cx;
    const dy = y - camera.cy;
    return base(dx * cos - dy * sin, dx * sin + dy * cos);
  };
}
```

`projector` applies its 1.08 breathing factor to the override, exactly as the old compositor did with `state.extent`. Replay framing therefore stays the same: `Camera.extent` starts from `ReplayModel`'s extent.

- [ ] **Step 3: Rewrite the compositor around the `Show`**

In `site/src/replay/compose.ts`:
- Remove `OverlayText`, `overlayText` and `drawOverlay`, along with their imports (`formatCount`, `formatUsd`, `formatUtcDay`).
- Keep `REPLAY_COIN_UNIT`, `DrawnCoin` and `drawCoins`.
- Replace the class with:

```ts
import type { ChainNames } from '../lib/names';
import { cameraProjector, type Projector, type StarPoint } from '../sky/layout';
import { coinDiameter } from '../sky/coins';
import { createRenderer, type SkyCanvas, type SkyRenderer } from '../sky/renderer';
import type { Show, ShowFrame } from './director/show';
import { drawStory } from './story/draw';
import { layoutFor } from './story/layout';

type ShowSource = Pick<Show, 'frameAt' | 'timing' | 'length' | 'warp'>;

export interface CompositorAssets {
  names: ChainNames;
  ticks: readonly { at: number; label: string }[];
}

export class ReplayCompositor {
  private readonly skyCanvas: SkyCanvas;
  private readonly renderer: SkyRenderer;
  private coinImages: ReadonlyMap<string, CanvasImageSource> = new Map();
  private loopCache: { width: number; height: number; canvas: SkyCanvas } | null = null;
  private destroyed = false;

  constructor(
    private readonly show: ShowSource,
    private readonly stars: readonly StarPoint[],
    private readonly assets: CompositorAssets,
    private readonly createCanvas: () => SkyCanvas,
  ) {
    let canvas = createCanvas();
    let renderer: SkyRenderer;
    try {
      renderer = createRenderer(canvas);
    } catch {
      canvas = createCanvas();
      renderer = createRenderer(canvas, { preferGl: false });
    }
    this.skyCanvas = canvas;
    this.renderer = renderer;
  }

  setCoinImages(images: ReadonlyMap<string, CanvasImageSource>): void {
    this.coinImages = images;
  }

  draw(t: number, target: Ctx2d, width: number, height: number): ShowFrame {
    const frame = this.show.frameAt(t);
    if (this.destroyed) return frame;
    if (frame.loop > 0) this.ensureLoopCache(width, height);
    this.compose(frame, target, width, height);
    if (frame.loop > 0 && this.loopCache) {
      target.save();
      target.globalAlpha = frame.loop;
      target.drawImage(this.loopCache.canvas, 0, 0);
      target.restore();
    }
    return frame;
  }

  private ensureLoopCache(width: number, height: number): void {
    if (this.loopCache && this.loopCache.width === width && this.loopCache.height === height) return;
    const canvas = this.createCanvas();
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d') as Ctx2d | null;
    if (!ctx) return;
    this.compose(this.show.frameAt(0), ctx, width, height);
    this.loopCache = { width, height, canvas };
  }

  private compose(frame: ShowFrame, target: Ctx2d, width: number, height: number): void {
    if (this.skyCanvas.width !== width || this.skyCanvas.height !== height) this.renderer.resize(width, height);
    const project = cameraProjector(width, height, frame.camera);
    this.renderer.draw(frame.base.sky, project, Math.min(width, height) / 1000);
    target.fillStyle = '#0c0f14';
    target.fillRect(0, 0, width, height);
    const glow = target.createRadialGradient(width / 2, 0, 0, width / 2, 0, Math.max(width, height) * 0.7);
    glow.addColorStop(0, 'rgba(47, 98, 223, 0.10)');
    glow.addColorStop(1, 'rgba(47, 98, 223, 0)');
    target.fillStyle = glow;
    target.fillRect(0, 0, width, height);
    target.drawImage(this.skyCanvas, 0, 0);
    const coins = this.placeCoins(frame, project, width, height);
    drawCoins(target, coins);
    if (frame.phase === 'finale') this.drawCoinWave(target, frame, coins, project, width, height);
    drawStory(target, frame, layoutFor(width, height), { names: this.assets.names, coins: this.coinImages, ticks: this.assets.ticks });
  }

  private drawCoinWave(target: Ctx2d, frame: ShowFrame, coins: readonly DrawnCoin[], project: Projector, width: number, height: number): void {
    const [ox, oy] = project(this.stars[0]?.x ?? 0, this.stars[0]?.y ?? 0);
    const reach = Math.hypot(width, height) / 2;
    const seconds = frame.finale * this.show.timing.finale;
    target.save();
    for (const c of coins) {
      const p = (seconds - 0.6 * (Math.hypot(c.x - ox, c.y - oy) / reach)) / 0.5;
      if (p <= 0 || p >= 1) continue;
      target.globalAlpha = 1 - p;
      target.beginPath();
      target.arc(c.x, c.y, (c.d / 2) * (1 + 0.8 * p), 0, Math.PI * 2);
      target.strokeStyle = '#6c9bff';
      target.lineWidth = Math.max(1.5, c.d / 18);
      target.stroke();
    }
    target.restore();
  }

  private placeCoins(frame: ShowFrame, project: Projector, width: number, height: number): DrawnCoin[] {
    const unit = Math.min(width, height) / REPLAY_COIN_UNIT;
    return frame.base.coins.flatMap((c) => {
      const image = this.coinImages.get(c.selector);
      const star = frame.base.sky.stars[c.star];
      if (!image || !star || star.radius <= 0) return [];
      const [x, y] = project(star.x, star.y);
      return [{ x, y, d: coinDiameter(star.radius) * unit, alpha: c.alpha, image }];
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.renderer.destroy();
  }
}
```

`SkyCanvas` is `HTMLCanvasElement | OffscreenCanvas`, and both have `getContext('2d')`. If the TypeScript types disagree, narrow with a cast, as the snippet does.

- [ ] **Step 4: Lengths, frame count, minimal player wiring and icon preload**

1. In `site/src/replay/timeline.ts`, change `REPLAY_LENGTHS` to `[15, 30, 60] as const`. Keep `END_CARD_S` only if something still imports it; otherwise remove it and the `duration` field's use of it, so that `duration = length`.

2. In `site/src/replay/recorder.ts`, change `totalFrames` to `return REPLAY_FPS * lengthS;` and drop the `END_CARD_S` import.

3. In `site/src/replay/player.tsx`, keep the current markup; Task 9 replaces it. Only:
   - build a `Show` instead of a `ReplayModel`: `new Show({ replay, history, stars, length, focus: null, eligible: hasIcon })`, memoized on `[data, stars, length]`;
   - pass `assets = { names: chainNameMap(data.replay.chains), ticks: show.yearTicks().map((y) => ({ at: (y.time - show.warp.start) / (show.warp.end - show.warp.start), label: y.label })) }` to both `ReplayCompositor` constructions;
   - use `show.length` as the scrubber `max`, the playback clock end and the reduced-motion starting point (`show.length - 0.01`);
   - set the default length to 30;
   - preload icons for **every replay chain**, not only `coinSelectorsEver()`: `new Map(data.replay.chains.flatMap(c => { const href = iconHref(c.selector); return href ? [[c.selector, href]] : []; }))`. Join cards and the leaderboard show any chain's logo.

4. In `docs/superpowers/specs/2026-10-07-chain-icons-design.md` §7.2, replace the preload sentence with "As soon as `replay.json` has loaded, the player preloads the icons of every replay chain, because the replay's join cards and leaderboard (viral replay spec) show any chain's logo." Note the change in your report.

Run: `pnpm --filter @ccip-dev/site exec vitest run test/layout.test.ts test/compose.test.ts test/recorder.test.ts test/timeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Build and look**

1. Run the site suite, the typecheck and `pnpm --filter @ccip-dev/site build`. The replay budget must stay ≤ 200 KB.
2. An `astro preview` server is running on port 4321 and serves `site/dist`. Load the chrome-devtools tools (ToolSearch `chrome-devtools`).
3. Open `http://localhost:4321/replay/`, press Play, and take screenshots at about 1 s, 10 s, 20 s and 29 s. Save them as `replay-a-t7-*.png` in the SDD workspace.
4. Expected:
   - 1 s: the hook title;
   - 10 s and 20 s: date, counter, a card or slam, the leaderboard and the timeline;
   - 29 s: "ccip.dev", with the coin wave visible.
5. Describe the shots in your report.

- [ ] **Step 6: Commit**

```bash
git add site/src/sky/layout.ts site/src/replay/compose.ts site/src/replay/recorder.ts site/src/replay/timeline.ts site/src/replay/player.tsx site/test/layout.test.ts site/test/compose.test.ts site/test/recorder.test.ts docs/superpowers/specs/2026-10-07-chain-icons-design.md
git commit -m "feat(site): replay draws the director's Show: camera, story layer, coin wave and loop; lengths 15/30/60"
```

---
## Task 8: Controls kit, applied site-wide

**Files:**
- Create: `site/src/styles/controls.css`, `site/src/lib/controls.ts`, `site/src/components/controls/Segmented.tsx`, `site/src/components/controls/ShapePicker.tsx`, `site/src/components/controls/ChainPicker.tsx`, `site/src/components/controls/Scrubber.tsx`
- Modify: `site/src/layouts/Base.astro` (import `controls.css`), `site/src/styles/base.css` (`.share-btn` and `.tabs` restyle), `site/src/styles/home.css` (`.sound-btn`)
- Test: `site/test/controls.test.ts`

**Interfaces:**
- Produces:
  - from `lib/controls.ts`:
    - `interface PickerChain { selector: string; name: string; value: number; icon: string | null }`;
    - `filterChains(query: string, chains: readonly PickerChain[]): PickerChain[]`;
    - `moveIndex(current: number, delta: number, count: number): number`;
    - `nearestMark(marks: readonly { time: number }[], time: number, length: number, tolerance?: number): number`, which returns an index or -1;
    - `formatClock(seconds: number): string`;
  - components:
    - `<Segmented label options value onChange disabled? />`;
    - `<ShapePicker value onChange disabled? />` for `'16:9' | '1:1' | '9:16'`;
    - `<ChainPicker chains value onChange disabled? />`, where `value: string | null` and null means All chains;
    - `<Scrubber length time onScrub marks ticks valueText disabled? />`;
  - CSS classes: `.btn`, `.btn-primary`, `.btn-ghost`, `.icon-btn`, `.seg`, `.shape-picker`, `.chain-picker`, `.chain-pop`, `.scrubber`, `.bigplay`, `.player-bar`, `.studio`, `.rec-pill`, `.rec-badge`, `.rec-dot`, `.tri`, `.pause-i`.

- [ ] **Step 1: Write the failing tests**

`site/test/controls.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { filterChains, formatClock, moveIndex, nearestMark } from '../src/lib/controls';

const chains = [
  { selector: 'e', name: 'Ethereum', value: 3, icon: null },
  { selector: 'b', name: 'Base', value: 2, icon: null },
  { selector: 'n', name: 'BNB Chain', value: 1, icon: null },
];

describe('filterChains', () => {
  it('matches case-insensitively anywhere in the name, keeping order', () => {
    expect(filterChains('b', chains).map((c) => c.selector)).toEqual(['b', 'n']);
    expect(filterChains('CHAIN', chains).map((c) => c.selector)).toEqual(['n']);
  });

  it('ignores spaces and returns everything for an empty query', () => {
    expect(filterChains('bnbch', chains).map((c) => c.selector)).toEqual(['n']);
    expect(filterChains('  ', chains)).toHaveLength(3);
  });
});

describe('moveIndex', () => {
  it('wraps around both ends', () => {
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(2, 1, 3)).toBe(0);
    expect(moveIndex(-1, 1, 3)).toBe(0);
  });
});

describe('nearestMark', () => {
  const marks = [{ time: 5 }, { time: 10 }];
  it('finds the mark under the pointer within the tolerance', () => {
    expect(nearestMark(marks, 10.2, 30)).toBe(1);
    expect(nearestMark(marks, 7.5, 30)).toBe(-1);
  });
});

describe('formatClock', () => {
  it.each([[0, '0:00'], [9.6, '0:09'], [30, '0:30'], [75, '1:15']])('%s s is %s', (s, text) => {
    expect(formatClock(s)).toBe(text);
  });
});
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/controls.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 2: Implement the helpers**

`site/src/lib/controls.ts`:

```ts
export interface PickerChain {
  selector: string;
  name: string;
  value: number;
  icon: string | null;
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');

export function filterChains(query: string, chains: readonly PickerChain[]): PickerChain[] {
  const q = squash(query);
  return q === '' ? [...chains] : chains.filter((c) => squash(c.name).includes(q));
}

export function moveIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (((current + delta) % count) + count) % count;
}

export function nearestMark(marks: readonly { time: number }[], time: number, length: number, tolerance = 0.015): number {
  let best = -1;
  let bestGap = tolerance * length;
  marks.forEach((m, i) => {
    const gap = Math.abs(m.time - time);
    if (gap <= bestGap) {
      best = i;
      bestGap = gap;
    }
  });
  return best;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/controls.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the components**

`site/src/components/controls/Segmented.tsx`:

```tsx
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { moveIndex } from '../../lib/controls';

export interface SegOption<T extends string | number> {
  value: T;
  label: ReactNode;
  title?: string;
}

export default function Segmented<T extends string | number>(props: {
  label: string;
  options: readonly SegOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = props.options.findIndex((o) => o.value === props.value);
  const onKey = (e: KeyboardEvent) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (delta === 0 || props.disabled) return;
    e.preventDefault();
    const next = moveIndex(index, delta, props.options.length);
    props.onChange(props.options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={props.label} className={`seg ${props.className ?? ''}`} onKeyDown={onKey}>
      {props.options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          tabIndex={o.value === props.value ? 0 : -1}
          title={o.title}
          disabled={props.disabled}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

`site/src/components/controls/ShapePicker.tsx`:

```tsx
import Segmented from './Segmented';

type Shape = '16:9' | '1:1' | '9:16';
const ICON: Record<Shape, { w: number; h: number }> = { '16:9': { w: 18, h: 10 }, '1:1': { w: 12, h: 12 }, '9:16': { w: 9, h: 15 } };

export default function ShapePicker(props: { value: Shape; onChange: (value: Shape) => void; disabled?: boolean }) {
  return (
    <Segmented
      label="Shape"
      className="shape-picker"
      value={props.value}
      onChange={props.onChange}
      disabled={props.disabled}
      options={(Object.keys(ICON) as Shape[]).map((shape) => ({
        value: shape,
        title: shape,
        label: (
          <>
            <i className="shape-i" style={{ width: ICON[shape].w, height: ICON[shape].h }} aria-hidden="true" />
            <span className="visually-hidden">{shape}</span>
          </>
        ),
      }))}
    />
  );
}
```

`site/src/components/controls/ChainPicker.tsx`:

```tsx
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { filterChains, moveIndex, type PickerChain } from '../../lib/controls';
import { formatUsd } from '../../lib/format';

const ALL = '__all__';

export default function ChainPicker(props: { chains: readonly PickerChain[]; value: string | null; onChange: (selector: string | null) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const results = useMemo(() => filterChains(query, props.chains), [query, props.chains]);
  const items = useMemo(() => [ALL, ...results.map((c) => c.selector)], [results]);
  const current = props.chains.find((c) => c.selector === props.value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const choose = (key: string) => {
    props.onChange(key === ALL ? null : key);
    setOpen(false);
    setQuery('');
    buttonRef.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => moveIndex(a, e.key === 'ArrowDown' ? 1 : -1, items.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const key = items[active];
      if (key) choose(key);
    } else if (e.key === 'Escape') {
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <div className="chain-picker-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`chain-picker${open ? ' open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={props.disabled}
        onClick={() => {
          setOpen((o) => !o);
          setActive(0);
        }}
      >
        {current?.icon ? <img src={current.icon} alt="" width={26} height={26} /> : <span className="all-coin" aria-hidden="true">✦</span>}
        <span>{current ? current.name : 'All chains'}</span>
        <span className="caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="chain-pop">
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={`${listId}-${active}`}
            aria-label="Search chains"
            placeholder={`Search ${props.chains.length} chains`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
          />
          <ul role="listbox" id={listId} aria-label="Chains">
            {items.map((key, i) => {
              const chain = key === ALL ? null : results.find((c) => c.selector === key)!;
              const selected = key === ALL ? props.value === null : props.value === key;
              return (
                <li
                  key={key}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={selected}
                  className={`${i === active ? 'active' : ''} ${selected ? 'on' : ''}`}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => choose(key)}
                >
                  {chain ? (
                    chain.icon ? <img src={chain.icon} alt="" width={26} height={26} loading="lazy" /> : <span className="all-coin" aria-hidden="true" />
                  ) : (
                    <span className="all-coin" aria-hidden="true">✦</span>
                  )}
                  <span>{chain ? chain.name : 'All chains'}</span>
                  <span className="m">{chain ? formatUsd(chain.value) : 'network'}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
```

`site/src/components/controls/Scrubber.tsx`:

```tsx
import { useState } from 'react';
import { nearestMark } from '../../lib/controls';

export default function Scrubber(props: {
  length: number;
  time: number;
  onScrub: (t: number) => void;
  marks: readonly { time: number; label: string; day: string }[];
  ticks: readonly { time: number; label: string }[];
  valueText: string;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(-1);
  const pct = (t: number) => `${(100 * Math.min(Math.max(t, 0), props.length)) / props.length}%`;
  return (
    <div
      className="scrubber"
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return;
        const rect = e.currentTarget.getBoundingClientRect();
        setHover(nearestMark(props.marks, ((e.clientX - rect.left) / rect.width) * props.length, props.length));
      }}
      onPointerLeave={() => setHover(-1)}
    >
      <div className="scrub-rail" aria-hidden="true">
        <div className="scrub-fill" style={{ width: pct(props.time) }} />
        {props.marks.map((m) => <span key={`${m.time}-${m.label}`} className="scrub-mark" style={{ left: pct(m.time) }} />)}
        {props.ticks.map((t) => <span key={t.label} className="scrub-tick" style={{ left: pct(t.time) }}>{t.label}</span>)}
        {hover >= 0 && (
          <span className="scrub-tip" style={{ left: pct(props.marks[hover]!.time) }}>
            {props.marks[hover]!.label} <span className="m">· {props.marks[hover]!.day}</span>
          </span>
        )}
      </div>
      <input
        type="range"
        min={0}
        max={props.length}
        step={0.01}
        value={Math.min(props.time, props.length)}
        aria-label="Position"
        aria-valuetext={props.valueText}
        disabled={props.disabled}
        onChange={(e) => props.onScrub(Number(e.target.value))}
      />
    </div>
  );
}
```

- [ ] **Step 4: Style the kit and apply it site-wide**

`site/src/styles/controls.css` holds the Direction A styles. These follow the approved mockup (`replay-a-detail-v2` in the brainstorm session):

```css
.btn, .share-btn, .sound-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 40px; padding: 0 16px; border-radius: 999px; font: 600 14px var(--font-sans); color: var(--fg); background: var(--card); border: 1px solid var(--border); cursor: pointer; white-space: nowrap; }
.btn:hover, .share-btn:hover, .sound-btn:hover { border-color: var(--blue-2); }
.btn:focus-visible, .share-btn:focus-visible, .sound-btn:focus-visible, .seg button:focus-visible, .chain-picker:focus-visible, .icon-btn:focus-visible { outline: 2px solid var(--blue-2); outline-offset: 2px; }
.btn-primary { background: linear-gradient(180deg, #3b6ff0, #2f62df); border-color: transparent; box-shadow: 0 6px 20px rgba(47, 98, 223, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.25); }
.btn-ghost { background: transparent; }
.btn:disabled, .seg button:disabled, .chain-picker:disabled { opacity: 0.5; cursor: default; }
.sound-btn[aria-pressed='true'] { background: #13244d; border-color: var(--blue-2); }
.icon-btn { width: 36px; height: 36px; flex: none; display: grid; place-items: center; border-radius: 50%; background: rgba(22, 27, 35, 0.7); border: 1px solid var(--border); cursor: pointer; }
.tri { width: 0; height: 0; border-left: 11px solid var(--fg); border-top: 7px solid transparent; border-bottom: 7px solid transparent; margin-left: 3px; }
.pause-i { width: 11px; height: 13px; border-left: 4px solid var(--fg); border-right: 4px solid var(--fg); box-sizing: border-box; }
.seg { display: inline-flex; padding: 3px; border-radius: 999px; background: var(--card); border: 1px solid var(--border); }
.seg button { padding: 6px 12px; border: 0; border-radius: 999px; background: none; font: 600 13px var(--font-sans); color: var(--muted); cursor: pointer; }
.seg button[aria-checked='true'] { background: #13244d; color: var(--fg); box-shadow: inset 0 0 0 1px var(--blue-2); }
.shape-picker button { width: 40px; display: grid; place-items: center; padding: 6px 0; }
.shape-i { display: block; border: 1.5px solid currentColor; border-radius: 2px; }
.chain-picker-wrap { position: relative; }
.chain-picker { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px 0 6px; border-radius: 999px; background: var(--card); border: 1px solid var(--border); font: 600 14px var(--font-sans); color: var(--fg); cursor: pointer; }
.chain-picker.open { border-color: var(--blue-2); box-shadow: 0 0 0 3px rgba(74, 127, 240, 0.2); }
.chain-picker img, .chain-pop img, .all-coin { width: 26px; height: 26px; flex: none; border-radius: 50%; }
.all-coin { display: grid; place-items: center; font-size: 12px; color: #fff; background: linear-gradient(135deg, #2f62df, #6c9bff); }
.caret { width: 0; height: 0; border-top: 5px solid var(--muted); border-left: 4px solid transparent; border-right: 4px solid transparent; }
.chain-pop { position: absolute; left: 0; top: 48px; z-index: 40; width: min(300px, calc(100vw - 32px)); padding: 8px; border-radius: 12px; background: var(--card); border: 1px solid var(--border); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55); }
.chain-pop input { width: 100%; height: 36px; padding: 0 10px; border-radius: 8px; background: #0f131a; border: 1px solid var(--border-soft); color: var(--fg); font: 400 13px var(--font-sans); box-sizing: border-box; }
.chain-pop ul { list-style: none; margin: 6px 0 0; padding: 0; max-height: 320px; overflow-y: auto; }
.chain-pop li { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 8px; font: 500 14px var(--font-sans); cursor: pointer; }
.chain-pop li.active { background: rgba(47, 98, 223, 0.12); }
.chain-pop li.on { background: #13244d; }
.chain-pop .m, .scrub-tip .m { margin-left: auto; font: 500 11px var(--font-mono); color: var(--muted); }
.player-stage { position: relative; }
.player-bar { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 10px; padding: 26px 12px 10px; background: linear-gradient(transparent, rgba(8, 10, 14, 0.92)); }
.player-time { font: 600 11px var(--font-mono); color: var(--muted); white-space: nowrap; }
.scrubber { position: relative; flex: 1; height: 28px; }
.scrubber input[type='range'] { position: absolute; inset: 0; width: 100%; margin: 0; opacity: 0; cursor: pointer; }
.scrubber input[type='range']:focus-visible + * , .scrubber:focus-within .scrub-rail { outline: 2px solid var(--blue-2); outline-offset: 4px; border-radius: 4px; }
.scrub-rail { position: absolute; left: 0; right: 0; top: 9px; height: 4px; border-radius: 4px; background: rgba(232, 234, 237, 0.14); pointer-events: none; }
.scrub-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px; background: linear-gradient(90deg, #2f62df, #6c9bff); box-shadow: 0 0 10px rgba(74, 127, 240, 0.7); }
.scrub-fill::after { content: ''; position: absolute; right: -7px; top: -5px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 4px rgba(74, 127, 240, 0.35), 0 0 12px rgba(74, 127, 240, 0.9); }
.scrub-mark { position: absolute; top: -2px; width: 8px; height: 8px; margin-left: -4px; border-radius: 50%; background: #e8eaed; box-shadow: 0 0 6px rgba(232, 234, 237, 0.8); }
.scrub-tick { position: absolute; top: 10px; transform: translateX(-50%); font: 600 9px var(--font-mono); color: var(--muted); }
.scrub-tip { position: absolute; bottom: 16px; transform: translateX(-50%); display: inline-flex; gap: 4px; padding: 6px 10px; border-radius: 8px; background: rgba(22, 27, 35, 0.95); border: 1px solid var(--border); font: 600 11px var(--font-sans); white-space: nowrap; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5); }
.bigplay { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 72px; height: 72px; border: 0; border-radius: 50%; display: grid; place-items: center; background: rgba(47, 98, 223, 0.85); box-shadow: 0 0 0 8px rgba(47, 98, 223, 0.18), 0 0 40px rgba(74, 127, 240, 0.6); cursor: pointer; }
.bigplay .tri { border-left-width: 20px; border-top-width: 12px; border-bottom-width: 12px; margin-left: 6px; }
.studio { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 12px; }
.studio .spacer { flex: 1; }
.rec-dot { width: 10px; height: 10px; border-radius: 50%; background: #ff4d5e; box-shadow: 0 0 10px rgba(255, 77, 94, 0.8); }
.rec-pill { position: relative; overflow: hidden; display: inline-flex; align-items: center; gap: 10px; height: 40px; padding: 0 6px 0 16px; border-radius: 999px; background: #1a1f2a; border: 1px solid rgba(255, 77, 94, 0.5); font: 600 14px var(--font-sans); }
.rec-pill > * { position: relative; }
.rec-prog { position: absolute !important; left: 0; top: 0; bottom: 0; background: linear-gradient(90deg, rgba(255, 77, 94, 0.25), rgba(255, 77, 94, 0.12)); }
.rec-cancel { height: 30px; padding: 0 12px; border: 0; border-radius: 999px; background: rgba(232, 234, 237, 0.08); color: var(--fg); font: 600 13px var(--font-sans); cursor: pointer; }
.rec-badge { position: absolute; right: 12px; top: 10px; display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 6px; background: rgba(255, 77, 94, 0.15); border: 1px solid rgba(255, 77, 94, 0.5); font: 700 10px var(--font-sans); letter-spacing: 0.1em; }
.rec-badge .rec-dot { width: 8px; height: 8px; }
@media (max-width: 639px) {
  .studio .chain-picker-wrap, .studio .chain-picker { width: 100%; }
  .studio .chain-picker .caret { margin-left: auto; }
  .studio .btn-primary, .studio .share, .studio .share-btn, .studio .rec-pill { width: 100%; }
  .studio .spacer { display: none; }
}
```

In `site/src/layouts/Base.astro`, add `import '../styles/controls.css';` after the `base.css` import.

In `site/src/styles/base.css`:
- delete the `.share-btn` and `.share-btn:hover` rules, which `controls.css` now owns;
- change the `.tabs` rules to the segmented look:

```css
.tabs { display: inline-flex; flex-wrap: wrap; gap: 4px; margin: 12px 0; padding: 3px; border-radius: 999px; background: var(--card); border: 1px solid var(--border); }
.tabs a { padding: 6px 12px; border-radius: 999px; color: var(--muted); font: 600 13px var(--font-sans); border: 0; }
.tabs a:hover { text-decoration: none; color: var(--fg); }
.tabs a[aria-current='page'] { background: #13244d; color: var(--fg); box-shadow: inset 0 0 0 1px var(--blue-2); }
```

Keep the flow page's `.tabs button` rule working. If `flow/[window].astro` styles `.tabs button`, give it the same segmented look, with the active state on `button.active`.

In `site/src/styles/home.css`, delete the `.sound-btn` and `.sound-btn[aria-pressed='true']` rules, which `controls.css` now owns.

- [ ] **Step 5: Build and check contrast**

1. Run the site suite, the typecheck and the build.
2. On the preview at port 4321, run Lighthouse mobile accessibility on `/top/lane/7d/`, which has tabs, and on `/`, which has Sound and Share. Each must be ≥ 95.
3. Take screenshots of the tabs and the Share button at 1440 and 390, saved as `controls-*.png` in the SDD workspace, and describe them in the report.

- [ ] **Step 6: Commit**

```bash
git add site/src/styles/controls.css site/src/lib/controls.ts site/src/components/controls site/src/layouts/Base.astro site/src/styles/base.css site/src/styles/home.css site/test/controls.test.ts
git commit -m "feat(site): controls kit (buttons, segmented, shape and chain pickers, scrubber) used site-wide"
```

---

## Task 9: The Direction A player

**Files:**
- Create: `site/src/components/ReplayPage.astro`, `site/src/lib/chain-slug.ts`
- Modify: `site/src/replay/player.tsx` (rewrite), `site/src/replay/recorder.ts` (`recordingFilename`), `site/src/pages/replay.astro`
- Test: `site/test/recorder.test.ts`, `site/test/chain-slug.test.ts`

**Interfaces:**
- Consumes:
  - the controls kit (Task 8);
  - `Show` (Task 5) and `ReplayCompositor` (Task 7);
  - `ShareButton`;
  - `trailingWeights` and `chainNameMap`, `chainName`, `iconHref`, `hasIcon`.
- Produces:
  - `chainSlug(chain: { selector: string; name: string | null; display_name: string | null }): string`;
  - `slugMap(chains): Map<string, string>`, mapping selector to slug;
  - `ReplayPlayer` props: `{ focus: string | null; slugs: Record<string, string> }`;
  - `recordingFilename(lastDay: string, aspect: Aspect, slug?: string | null): string`;
  - `ReplayPage.astro` props: `{ focus: string | null; slugs: Record<string, string> }`.

- [ ] **Step 1: Write the failing test**

In `site/test/recorder.test.ts`, add:

```ts
  it('names a focus recording after its chain', () => {
    expect(recordingFilename('2026-10-06', '1:1', 'base')).toBe('ccip-replay-base-2026-10-06-1x1.mp4');
    expect(recordingFilename('2026-10-06', '16:9', null)).toBe('ccip-replay-2026-10-06-16x9.mp4');
  });
```

Run it and expect a FAIL; then change `recordingFilename` to:

```ts
export function recordingFilename(lastDay: string, aspect: Aspect, slug: string | null = null): string {
  return `ccip-replay-${slug ? `${slug}-` : ''}${lastDay}-${aspect.replace(':', 'x')}.mp4`;
}
```

Run it again and expect a PASS.

Then add the slug helper, test first:

`site/test/chain-slug.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { chainSlug, slugMap } from '../src/lib/chain-slug';

const c = (selector: string, display_name: string | null, name: string | null = null) => ({ selector, display_name, name });

describe('chainSlug', () => {
  it.each([
    ['Base Mainnet', 'base'],
    ['BNB Chain Mainnet', 'bnb-chain'],
    ['B^2 Mainnet', 'b-2'],
    ['Polygon zkEVM', 'polygon-zkevm'],
    ['sui-mainnet', 'sui'],
    ['Ünïcode Chain', 'unicode-chain'],
  ])('%s → %s', (display, slug) => {
    expect(chainSlug(c('1', display))).toBe(slug);
  });

  it('falls back to the name, then the selector', () => {
    expect(chainSlug(c('42', null, 'ethereum-mainnet'))).toBe('ethereum');
    expect(chainSlug(c('42', '日本'))).toBe('42');
  });
});

describe('slugMap', () => {
  it('suffixes collisions in selector order and keeps every slug URL-safe', () => {
    const map = slugMap([c('9', 'Mind Mainnet'), c('1', 'Mind Network'), c('5', 'Mind Mainnet')]);
    expect(map.get('5')).toBe('mind');
    expect(map.get('9')).toBe('mind-2');
    expect(map.get('1')).toBe('mind-network');
    for (const s of map.values()) expect(s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});
```

Run it and expect a FAIL. Then implement:

`site/src/lib/chain-slug.ts`:

```ts
interface SlugChain {
  selector: string;
  name: string | null;
  display_name: string | null;
}

export function chainSlug(chain: SlugChain): string {
  const source = chain.display_name ?? chain.name ?? chain.selector;
  const slug = source
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s-]+mainnet$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || chain.selector;
}

export function slugMap(chains: readonly SlugChain[]): Map<string, string> {
  const used = new Map<string, number>();
  const out = new Map<string, string>();
  for (const c of [...chains].sort((a, b) => (a.selector < b.selector ? -1 : a.selector > b.selector ? 1 : 0))) {
    const base = chainSlug(c);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    out.set(c.selector, n === 1 ? base : `${base}-${n}`);
  }
  return out;
}
```

Run it again and expect a PASS.

- [ ] **Step 2: Rewrite the player**

Rewrite `site/src/replay/player.tsx`. Keep these existing behaviors exactly:
- data loading with retry and `trackDataError`;
- the reduced-motion start;
- the `drawFrame` sizing (`MAX_DPR`, `MAX_SIDE_PX`), the `.replay-shell.ready` class and the resize redraw;
- the playback loop with `UI_UPDATE_MS`;
- the coin-image preload for every replay chain, and `setCoinImages` on compositor changes;
- the recording flow: `settleWithin`, the abort check, `document.fonts.ready`, `recordReplay`, the download link and `track`.

Change these:

```tsx
export default function ReplayPlayer({ focus: initialFocus, slugs }: { focus: string | null; slugs: Record<string, string> }) {
  // …existing state…
  const [length, setLength] = useState<ReplayLength>(30);
  const [aspect, setAspect] = useState<Aspect>(() => (typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches ? '1:1' : '16:9'));
  const [focus, setFocus] = useState<string | null>(initialFocus);
  const [hasPlayed, setHasPlayed] = useState(false);

  const names = useMemo(() => (data ? chainNameMap(data.replay.chains) : new Map<string, string>()), [data]);
  const show = useMemo(
    () => (data ? new Show({ replay: data.replay, history: data.history, stars, length, focus, eligible: hasIcon }) : null),
    [data, stars, length, focus],
  );
  const assets = useMemo(
    () => (show ? { names, ticks: show.yearTicks().map((y) => ({ at: (y.time - show.warp.start) / (show.warp.end - show.warp.start), label: y.label })) } : null),
    [show, names],
  );
  const pickerChains = useMemo(() => {
    if (!data) return [];
    const values = trailingWeights(data.replay, 30).chains;
    return data.replay.chains
      .map((c) => ({ selector: c.selector, name: chainName(names, c.selector), value: values.get(c.selector) ?? 0, icon: iconHref(c.selector) }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  }, [data, names]);
  const slug = focus ? slugs[focus] ?? null : null;
  const focusName = focus ? chainName(names, focus) : null;
  const pageUrl = `https://ccip.dev/replay/${slug ? `${slug}/` : ''}`;

  const chooseChain = (selector: string | null) => {
    setFocus(selector);
    const nextSlug = selector ? slugs[selector] : null;
    history.pushState({ focus: selector }, '', `/replay/${nextSlug ? `${nextSlug}/` : ''}`);
    document.title = selector ? `${chainName(names, selector)} on Chainlink CCIP · Replay · ccip.dev` : 'Replay · ccip.dev';
  };
  useEffect(() => {
    const onPop = () => {
      const match = /^\/replay\/([a-z0-9-]+)\/?$/.exec(location.pathname);
      const selector = match ? Object.keys(slugs).find((s) => slugs[s] === match[1]) ?? null : null;
      setFocus(selector);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [slugs]);
```

- Use `show` and `assets` in both `new ReplayCompositor(show, stars, assets, …)` calls, and `show.length` wherever the old code used `model.duration`.
- `play()` also calls `setHasPlayed(true)`.
- The recording download name is `recordingFilename(lastDay, aspect, slug)`.

The returned markup is Direction A:

```tsx
  return (
    <div className="player">
      <div className="player-stage" style={{ aspectRatio: String(RATIO[aspect]), width: `min(100%, ${80 * RATIO[aspect]}vh)` }}>
        <canvas ref={canvasRef} aria-label={`Time-lapse of CCIP ${focusName ? `for ${focusName} ` : ''}from ${since} to ${lastDay}`} />
        {!hasPlayed && !playing && (
          <button type="button" className="bigplay" aria-label="Play the replay" onClick={play}>
            <span className="tri" aria-hidden="true" />
          </button>
        )}
        {recording && (
          <span className="rec-badge" aria-hidden="true">
            <span className="rec-dot" />
            REC 1080p · {aspect}
          </span>
        )}
        <div className="player-bar">
          <button type="button" className="icon-btn" aria-label={playing ? 'Pause' : 'Play'} onClick={() => (playing ? setPlaying(false) : play())}>
            {playing ? <span className="pause-i" aria-hidden="true" /> : <span className="tri" aria-hidden="true" />}
          </button>
          <Scrubber
            length={show.length}
            time={shown}
            onScrub={scrub}
            marks={show.milestoneMarks().map((m) => ({ ...m, day: formatUtcDay(m.day) }))}
            ticks={show.yearTicks()}
            valueText={formatUtcDay(show.frameAt(shown).story.day)}
            disabled={recording !== null}
          />
          <span className="player-time">
            {formatClock(shown)} / {formatClock(show.length)}
          </span>
        </div>
      </div>
      <div className="studio">
        <ChainPicker chains={pickerChains} value={focus} onChange={chooseChain} disabled={recording !== null} />
        <Segmented
          label="Length"
          value={length}
          onChange={(l) => setLength(l)}
          disabled={recording !== null}
          options={REPLAY_LENGTHS.map((l) => ({ value: l, label: `${l}s` }))}
        />
        <ShapePicker value={aspect} onChange={setAspect} disabled={recording !== null} />
        <span className="spacer" />
        <ShareButton
          view={slug ? `replay/${slug}` : 'replay'}
          headline={focusName ? `Watch ${focusName} on Chainlink CCIP` : 'Watch CCIP grow from the first message to today'}
          url={pageUrl}
          cardUrl={`/og/replay${slug ? `/${slug}` : ''}.png`}
        />
        {recordable && !recording && (
          <button type="button" className="btn btn-primary" onClick={() => void record()}>
            <span className="rec-dot" aria-hidden="true" />
            Record video
          </button>
        )}
        {recording && (
          <span className="rec-pill" role="status">
            <span className="rec-prog" style={{ width: `${Math.round(recording.progress * 100)}%` }} />
            <span className="rec-dot" aria-hidden="true" />
            Recording · {Math.round(recording.progress * 100)}%
            <button type="button" className="rec-cancel" onClick={() => recording.controller.abort()}>
              Cancel
            </button>
          </span>
        )}
        {recordable === false && <span className="muted">Recording works in Chrome, Edge and Safari</span>}
        {recordError && <span className="down">{recordError}</span>}
      </div>
    </div>
  );
```

- `valueText` calls `show.frameAt(shown)` once per render. That's acceptable: renders happen at `UI_UPDATE_MS` while playing.
- Import `formatUtcDay`, `formatClock`, the four controls components, `ShareButton` (`../components/ShareButton`), `chainName` and `chainNameMap`, `trailingWeights` and `Show`.
- Remove the old `select` markup and the `.player-controls` usage.

- [ ] **Step 3: One page component for the replay and the chain pages**

Create `site/src/components/ReplayPage.astro`, moving everything from `site/src/pages/replay.astro`'s frontmatter and markup into it, with these changes:
- **Props:** `focus: string | null` and `slugs: Record<string, string>`.
- **Head:** with a focus, `h1` is `${name} on Chainlink CCIP` and the lead is `${formatCount(focusMessages)} messages with ${partners} chains since ${formatUtcDay(first_day)}`. Compute `focusMessages` and `partners` with `StoryCounter` from `site/src/replay/director/story.ts`: sum `dailyTotals()` messages, and take the `at(Infinity, linearWarp(days.length, 0, 1)).chains` partners. Without a focus, keep "Watch CCIP grow" and change the lead to "…replayed in 30 seconds."
- Remove the page-head `ShareButton`; Share now lives in the studio row.
- **Base:** pass `title={focus ? `${name} on Chainlink CCIP · Replay` : 'Replay'}`, the matching `description`, and `cardPath={focus ? `replay/${slugs[focus]}` : 'replay'}`.
- Render `<ReplayPlayer client:only="react" focus={focus} slugs={slugs} />`.
- Delete the old `.player-controls` global styles from the moved `<style>`.

`site/src/pages/replay.astro` becomes:

```astro
---
import ReplayPage from '../components/ReplayPage.astro';
import { buildData } from '../lib/build-data';
import { slugMap } from '../lib/chain-slug';

const replay = await buildData('replay.json');
const slugs = Object.fromEntries(slugMap(replay.chains));
---
<ReplayPage focus={null} slugs={slugs} />
```

- [ ] **Step 4: Build and check in the browser**

1. Run the site suite, the typecheck and the build. The replay budget must stay ≤ 200 KB.
2. On the preview at port 4321, at 1440 and at 390 (via `emulate`):
   - **Before play:** the big Play button is over the poster frame.
   - **After play:** the bar shows Pause, the scrubber with year ticks and milestone dots, and the time.
   - **Studio row:** the chain picker, 15s/30s/60s, the shape icons, Share and Record video.
   - **Chain picker:** search "base", press Enter. The URL becomes `/replay/base/`, the title changes, and the hook reads "Base × Chainlink CCIP". Browser back returns to All chains.
   - **Phone:** at 390 the default shape is 1:1, and there is no horizontal scroll.
   - **Accessibility:** Lighthouse mobile accessibility on `/replay/` is ≥ 95.
3. Save the screenshots as `player-*.png` in the SDD workspace.

- [ ] **Step 5: Commit**

```bash
git add site/src/replay/player.tsx site/src/replay/recorder.ts site/src/components/ReplayPage.astro site/src/pages/replay.astro site/src/lib/chain-slug.ts site/test/recorder.test.ts site/test/chain-slug.test.ts
git commit -m "feat(site): Direction A replay player with chain picker, length and shape controls, and recording pill"
```

---

## Task 10: Chain pages and chain cards

**Files:**
- Create: `site/src/pages/replay/[slug].astro`, `site/src/pages/replay-cards.json.ts`
- Modify: `site/src/lib/card-paths.ts`, `site/worker/og.ts`, `site/worker/cards/content.ts`, `site/worker/cards/frame.ts`
- Test: `site/test/card-paths.test.ts`, `site/test/card-content.test.ts`, `site/test/og.test.ts`, `site/worker/test/render.test.ts`

**Interfaces:**
- Consumes: `slugMap` (Task 9); `StoryCounter` and `linearWarp` (Tasks 1 and 4); `iconDataUri`.
- Produces:
  - `CardRoute` gains `{ kind: 'replay-chain'; slug: string }`;
  - `/replay-cards.json`, a map of `{ [slug]: ReplayCardEntry }` where `interface ReplayCardEntry { name: string; since: string; usd: number; messages: number; partners: number; coin: string | null }`;
  - `replayChainCard(entry: ReplayCardEntry, slug: string): CardSpec`;
  - `CardSpec.badge?: string | null`.

- [ ] **Step 1: Write the failing tests**

In `site/test/card-paths.test.ts`, add:

```ts
  it('parses and formats per-chain replay cards, rejecting unsafe slugs', () => {
    expect(parseCardPath('replay/base')).toEqual({ kind: 'replay-chain', slug: 'base' });
    expect(cardPathOf({ kind: 'replay-chain', slug: 'bnb-chain' })).toBe('replay/bnb-chain');
    expect(parseCardPath('replay/Base')).toBeNull();
    expect(parseCardPath('replay/../x')).toBeNull();
    expect(isOgImageUrl('https://ccip.dev/og/replay/base.png?v=2026-10-06')).toBe(true);
  });
```

In `site/test/card-content.test.ts`, add:

```ts
  it('describes a chain replay card', () => {
    const spec = replayChainCard({ name: 'Base', since: '2023-11-03', usd: 611_000_000, messages: 123_456, partners: 31, coin: 'data:image/svg+xml;base64,AA' }, 'base');
    expect(spec).toEqual({
      eyebrow: 'BASE ON CHAINLINK CCIP',
      big: '$611.0M',
      label: 'moved · 123,456 messages · 31 chains',
      date: 'since Nov 3, 2023',
      extra: ['ccip.dev/replay/base'],
      spark: null,
      badge: 'data:image/svg+xml;base64,AA',
    });
  });
```

In `site/test/og.test.ts`, give `setup`'s `assets` a `/replay-cards.json` body with one entry `base`, then add:

```ts
  it('renders a chain replay card from the build-time card data, 404s an unknown chain, and falls back without the data', async () => {
    const cards = { base: { name: 'Base', since: '2023-11-03', usd: 1, messages: 2, partners: 3, coin: null } };
    const { get } = setup({}, [], DATA, { '/replay-cards.json': JSON.stringify(cards) });
    expect((await get('/og/replay/base.png')).status).toBe(200);
    expect((await get('/og/replay/nope.png')).status).toBe(404);
    const bare = setup();
    expect((await bare.get('/og/replay/base.png')).headers.get('cache-control')).toBe('public, max-age=60');
  });
```

In `site/worker/test/render.test.ts`, add a red-badge pixel test, modeled on the existing coin test:
- `assets['/replay-cards.json'] = JSON.stringify({ base: { name: 'Base', since: '2023-11-03', usd: 1, messages: 2, partners: 3, coin: 'data:image/svg+xml;base64,<red square>' } })`;
- render `/og/replay/base.png`;
- assert that pixel `(1200 - 640 + 320, 315)` is red;
- delete the asset in `afterEach`, and also delete `/og/replay/base.png` from `caches.default`.

Run: `pnpm --filter @ccip-dev/site test`
Expected: the new tests FAIL.

- [ ] **Step 2: Implement the route and the card**

In `site/src/lib/card-paths.ts`:
- add `| { kind: 'replay-chain'; slug: string }` to `CardRoute`;
- add `const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;`;
- in `parseCardPath`, add a line before the `SIMPLE` check: `if (head === 'replay' && parts.length === 2) return a !== undefined && SLUG.test(a) ? { kind: 'replay-chain', slug: a } : null;`;
- in `cardPathOf`, add `case 'replay-chain': return `replay/${route.slug}`;`.

In `site/worker/cards/content.ts`:
- add `badge?: string | null;` to `CardSpec`;
- add:

```ts
export interface ReplayCardEntry {
  name: string;
  since: string;
  usd: number;
  messages: number;
  partners: number;
  coin: string | null;
}

export function replayChainCard(entry: ReplayCardEntry, slug: string): CardSpec {
  return {
    eyebrow: `${entry.name.toUpperCase()} ON CHAINLINK CCIP`,
    big: formatUsd(entry.usd),
    label: `moved · ${formatCount(entry.messages)} messages · ${entry.partners} chains`,
    date: `since ${formatUtcDay(entry.since)}`,
    extra: [`ccip.dev/replay/${slug}`],
    spark: null,
    badge: entry.coin,
  };
}
```

  Import `formatUtcDay` if it's missing. `formatUsd(611_000_000)` is `$611.0M`, given `compact`'s one decimal for suffixed units; if the test expectation differs, re-derive it from `formatUsd` rather than changing the format.

In `site/worker/cards/frame.ts`, after the coin `img` elements, add the badge:

```ts
    spec.badge
      ? h('img', {
          src: spec.badge,
          width: 132,
          height: 132,
          style: { position: 'absolute', left: CARD_W - SKY_W + 320 - 66, top: CARD_H / 2 - 66, width: 132, height: 132, borderRadius: 66, boxShadow: '0 0 0 2px rgba(255,255,255,0.25), 0 0 40px rgba(74,127,240,0.6)' },
        })
      : null,
```

In `site/worker/og.ts`, add the case to `build`, plus a loader:

```ts
async function replayCardEntries(env: OgEnv, origin: string): Promise<Record<string, ReplayCardEntry>> {
  const res = await env.ASSETS.fetch(new Request(`${origin}/replay-cards.json`));
  if (!res.ok) throw new Error(`replay-cards.json: HTTP ${res.status}`);
  return (await res.json()) as Record<string, ReplayCardEntry>;
}
```

```ts
    case 'replay-chain': {
      const entry = (await replayCardEntries(env, origin))[route.slug];
      return entry ? { spec: replayChainCard(entry, route.slug), maxAge: cardMaxAge(route, null) } : null;
    }
```

`build` needs `env` and `origin`, so change its signature to `build(route, deps, env, origin)` and update its one caller. A thrown error, such as a missing asset, already falls through to the existing `fallback` (max-age 60). An unknown slug returns `null`, which gives a 404, because the route isn't `daily`.

- [ ] **Step 3: Pages and the card data**

`site/src/pages/replay/[slug].astro`:

```astro
---
import ReplayPage from '../../components/ReplayPage.astro';
import { buildData } from '../../lib/build-data';
import { slugMap } from '../../lib/chain-slug';

export async function getStaticPaths() {
  const replay = await buildData('replay.json');
  const slugs = slugMap(replay.chains);
  return replay.chains.map((c) => ({ params: { slug: slugs.get(c.selector)! }, props: { selector: c.selector, slugs: Object.fromEntries(slugs) } }));
}

const { selector, slugs } = Astro.props;
---
<ReplayPage focus={selector} slugs={slugs} />
```

`site/src/pages/replay-cards.json.ts`:

```ts
import type { APIRoute } from 'astro';
import { buildData } from '../lib/build-data';
import { iconDataUri } from '../lib/chain-icons-server';
import { slugMap } from '../lib/chain-slug';
import { daysBetween } from '../lib/days';
import { shortChainName } from '../lib/names';
import { StoryCounter } from '../replay/director/story';
import { linearWarp } from '../replay/director/warp';

export const GET: APIRoute = async () => {
  const [replay, history] = await Promise.all([buildData('replay.json'), buildData('history.json')]);
  const first = replay.since ?? replay.days[0]?.day ?? '';
  const last = replay.days.at(-1)?.day ?? first;
  const days = first ? daysBetween(first, last) : [];
  const slugs = slugMap(replay.chains);
  const out: Record<string, unknown> = {};
  for (const chain of replay.chains) {
    const counter = new StoryCounter(days, history.days, replay, chain.selector);
    const totals = counter.dailyTotals();
    out[slugs.get(chain.selector)!] = {
      name: shortChainName(chain),
      since: chain.first_day,
      usd: totals.reduce((s, d) => s + d.usd_value, 0),
      messages: totals.reduce((s, d) => s + d.messages, 0),
      partners: counter.at(Number.POSITIVE_INFINITY, linearWarp(days.length, 0, 1)).chains,
      coin: iconDataUri(chain.selector),
    };
  }
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
};
```

- [ ] **Step 4: Run everything**

1. Run the site suite, the typecheck and the build. check-build must report every `/replay/<slug>/` page with a unique title, an allowed `og:image` and a canonical URL. The page count rises by about 92.
2. Check that `site/dist/replay-cards.json` has one key per chain: `node -e "console.log(Object.keys(require('./site/dist/replay-cards.json')).length)"`, run from the repo root.
3. Run `wrangler dev` on port 8790 against `site/dist`. Fetch `/og/replay/base.png` and look at it with Read: you should see the "BASE ON CHAINLINK CCIP" eyebrow, the value, and the Base coin badge over the sky. Stop `wrangler dev`.
4. On the preview, open `/replay/base/`. The page title and h1 name Base, and the player opens in the Base cut.

- [ ] **Step 5: Commit**

```bash
git add site/src/pages/replay site/src/pages/replay-cards.json.ts site/src/lib/card-paths.ts site/worker site/test/card-paths.test.ts site/test/card-content.test.ts site/test/og.test.ts
git commit -m "feat(site): a replay page and share card for every chain"
```

---

## After the last task (controller)

1. **Full checks.** Run `pnpm test && pnpm typecheck` at the root, and `pnpm --filter @ccip-dev/site build` against production data. Both budgets must hold.
2. **Recordings.** Record 30 s MP4s in 16:9, 1:1 and 9:16, plus one Base focus cut in 1:1.
   - Extract frames at 0.5, 2.5, 10, 20, 28 and 29.9 s with `ffmpeg -ss <t> -i <file> -frames:v 1 <png>`, and look at each one.
   - Compare frame 0 with frame 29.9 for the loop seam.
   - Check that cards and slams never overlap the counter, leaderboard or timeline.
3. **Browser QA:**
   - `/replay/` and `/replay/base/` at 1440 and 390;
   - the picker, the back button, Share and the scrubber tooltips;
   - Lighthouse mobile accessibility ≥ 95 on both pages;
   - no horizontal scroll at 390 on `/replay/`, `/replay/base/`, `/top/lane/7d/` and `/`.
4. **Status and specs.**
   - In `IMPLEMENTATION_PLAN.md`, add `Stage 10: Viral replay (Plan A)` and set its status.
   - Add the website spec §8 pointer to `2026-10-07-viral-replay-design.md`.
5. **Release.** After the final whole-branch review is clean, push. The site workflow deploys; check the live `/replay/` and one live chain card.
6. **Hand-off.** Plan B (cinema renderer) and Plan C (soundtrack) build on `Show` and `ShowFrame` from this plan.
