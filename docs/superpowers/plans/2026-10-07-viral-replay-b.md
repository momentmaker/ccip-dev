# Viral Replay, Plan B (cinema renderer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the replay its cinematic look, rendered from Plan A's `ShowFrame`:
- HDR glow, a drifting nebula and parallax dust;
- motion-blurred comet streaks with arrival sparks;
- chain-join supernovas and coins that pop in with a bounce;
- milestone shockwaves and record-day ripples;
- a finale network pulse and "ccip.dev" assembling from particles.

The live player adapts its quality tier, recordings always render at full quality, and anything without WebGL2 falls back to Plan A's compositor.

**Architecture:**
- **Pure layer** (`site/src/replay/cinema/`, unit-tested): effect math, quality tiers, atlas layout, and a scene builder that turns a `ShowFrame` into flat instance arrays.
- **WebGL2 layer:** `CinemaRenderer` draws those arrays into an HDR target, runs bloom, then composites with tone mapping, vignette, grain and shock distortion.
- **`CinemaCompositor`:** puts the GL frame on the 2D target, draws Plan A's story layer on top, and handles the loop fade.

**Tech Stack:** TypeScript 7, Vitest 4, WebGL2 (GLSL ES 3.00). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-07-viral-replay-design.md` §8, plus the cinematic parts of §7.1, §7.4 and §14. **Depends on:** Plan A complete (`Show`, `ShowFrame`, `ReplayCompositor`, `drawStory`, `cameraProjector`, the coin images).

## Global Constraints

**Repo and workflow** (same as Plan A)
- Repo `/Users/rubberduck/GitHub/momentmaker/ccip-dev`, branch `main`. Never push or deploy.
- End every commit with a blank line and a `Co-Authored-By:` trailer naming your model.
- Before each commit, run `pnpm --filter @ccip-dev/site test` and `typecheck`. Run `build` before the last commit of any task that touches the player, styles or pages.

**Code**
- No new dependencies.
- Test first for all pure modules. The GL code is checked with browser screenshots and recorded MP4 frames.
- Follow the surrounding code, and add no comments that restate code.

**Determinism**
- All randomness uses `mulberry32` from `site/src/replay/timeline.ts`, seeded from stable data: star index, day index and spawn time.
- The same `t` and tier must give the same scene arrays.

**Colors** (from `site/src/sky/frame.ts` `COLORS`)
- Blue `[74, 127, 240] / 255` for glow, lanes and supernovas.
- Pale `[201, 214, 245] / 255` for data comets.
- Gold `[245, 196, 81] / 255` only for $1M+ comets and record-day ripples.
- Star white `[232, 234, 237] / 255`.
- Background `#0c0f14`, with the nebula in brand blue at 6–10%.

**Budgets**
- `/replay/` JS ≤ 200 KB gzipped, including this plan's code.
- The live player holds ≥ 50 fps at the High tier on an M-series Mac and ≥ 30 fps at Low on a mid-range phone.
- A 30 s 1080p recording takes about 60 s or less on an M3.

**Quality tiers** (spec §8.3, verbatim)

| Tier | Bloom | Particles | Nebula | Dust layers |
|---|---|---|---|---|
| High | full resolution | 1.0 | yes | 3 |
| Medium | half resolution | 0.5 | yes | 2 |
| Low | none | 0.25 | no | 1 |

- Step down when the median frame time over the first 2 s of play exceeds 22 ms (High) or 30 ms (Medium).
- Never step up within a session.

**Effect timings**

| Effect | Constant | Value |
|---|---|---|
| Spark life | `SPARK_LIFE` | 0.4 s |
| Supernova flash | `NOVA_FLASH_S` | 0.3 s |
| Supernova ring | `NOVA_RING_S` | 0.8 s |
| Supernova particles | `NOVA_PARTICLE_S`, `NOVA_PARTICLES` | 1.2 s, 40 particles |
| Coin pop | `POP_S` | 0.5 s (0 → 1.25 → 1) |
| Shockwave | `SHOCK_S` | 0.5 s |
| Arrival window | `ARRIVAL_S` | 0.4 s |

## Review Focus

1. **A browser with WebGL2 but no `EXT_color_buffer_float`,** such as some phones. It renders through RGBA8 targets: still bloomed, just not HDR, never a black screen.
   - Task 5: target selection, tested with a fake GL context.
2. **A WebGL context lost mid-play,** which happens on mobile backgrounding. The first loss recreates the renderer; the second falls back to Plan A's compositor, and the replay keeps playing.
   - Task 5: compositor fallback, tested with a fake renderer that reports `lost`.
3. **Thousands of comets and arrivals at once in 2025–26.** Instance arrays stay bounded (by `MAX_REPLAY_COMETS`, `MAX_ARRIVALS` and the tier particle scale), and frame times stay within budget.
   - Task 4: an upper bound on the length of the scene arrays.
4. **A recording that starts while the live player has stepped down to Low.** It still renders at High.
   - Task 6: the recorder builds its own compositor with `quality: 'high'`, and a test asserts the controller is locked.
5. **Reduced motion.** There is no camera punch-in and no shockwave distortion; the other effects stay.
   - Task 6: `ShowInput.reducedMotion` drops slam punches, and the scene has `shock === null`.

---

## Task 1: Arrivals in the replay model

**Files:**
- Modify: `site/src/replay/timeline.ts`, `site/src/replay/director/show.ts`
- Test: `site/test/timeline.test.ts`, `site/test/director-show.test.ts`

**Interfaces:**
- Produces:
  - `ARRIVAL_S = 0.4` and `MAX_ARRIVALS = 120`;
  - `interface FrameArrival { from: number; to: number; age: number; size: number; kind: CometKind }`;
  - `ReplayFrameState.arrivals: FrameArrival[]`;
  - in focus mode, the `Show` filters `arrivals` the same way it filters comets.

- [ ] **Step 1: Write the failing tests**

Append to `site/test/timeline.test.ts`:

```ts
describe('arrivals', () => {
  it('reports comets that finished within the last 0.4 s, with their age', () => {
    const m = new ReplayModel(replay, history, [], stars, 60);
    let found = false;
    for (let t = 15; t < 30 && !found; t += 0.05) {
      const f = m.frameAt(t);
      if (f.arrivals.length > 0) {
        found = true;
        for (const a of f.arrivals) {
          expect(a.age).toBeGreaterThanOrEqual(0);
          expect(a.age).toBeLessThan(0.4);
        }
        expect(m.frameAt(t)).toEqual(f);
      }
    }
    expect(found).toBe(true);
  });

  it('has no arrivals before any comet flies', () => {
    expect(new ReplayModel(replay, history, [], stars, 60).frameAt(0).arrivals).toEqual([]);
  });
});
```

In `site/test/director-show.test.ts`, add:

```ts
  it('thins arrivals in a focus cut the same way it thins comets', () => {
    const all = new Show({ replay, history, stars, length: 30, focus: null, eligible: () => true });
    const focused = new Show({ replay, history, stars, length: 30, focus: '5009297550715157269', eligible: () => true });
    for (const t of [10, 15, 20, 25]) expect(focused.frameAt(t).base.arrivals.length).toBeLessThanOrEqual(all.frameAt(t).base.arrivals.length);
  });
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/timeline.test.ts test/director-show.test.ts`
Expected: FAIL, because `arrivals` is undefined.

- [ ] **Step 2: Implement**

In `site/src/replay/timeline.ts`:
- add `export const ARRIVAL_S = 0.4;` and `export const MAX_ARRIVALS = 120;`;
- add the `FrameArrival` interface, importing `CometKind` from `'../sky/frame'`;
- add `arrivals: FrameArrival[];` to `ReplayFrameState`;
- in `frameAt`, widen the spawn lookback and collect arrivals:

```ts
    const comets: FrameComet[] = [];
    const arrivals: FrameArrival[] = [];
    const firstSpawnDay = this.warp.dayAt(Math.max(this.warp.start, time - REPLAY_COMET_S - ARRIVAL_S)).index;
    for (let d = firstSpawnDay; d <= dayIndex; d++) {
      const dayLanes = this.lanesByDay.get(this.days[d]!);
      if (!dayLanes) continue;
      for (const spawn of this.spawns(d, dayLanes)) {
        const progress = (time - (this.dayStart(d) + spawn.offset * this.warp.dayLength(d))) / REPLAY_COMET_S;
        if (progress < 0) continue;
        const ends = this.replay.lanes[spawn.lane];
        const from = ends ? this.starOfChain[ends[0]] ?? -1 : -1;
        const to = ends ? this.starOfChain[ends[1]] ?? -1 : -1;
        if (from < 0 || to < 0) continue;
        const kind = cometKind(spawn.usd, spawn.usd > 0 ? 'token' : null);
        const size = cometSize(spawn.usd);
        if (progress < 1) comets.push({ from, to, progress, size, kind });
        else if ((progress - 1) * REPLAY_COMET_S < ARRIVAL_S) arrivals.push({ from, to, age: (progress - 1) * REPLAY_COMET_S, size, kind });
      }
    }
```

  This replaces the old comet loop; keep the `MAX_REPLAY_COMETS` slice for comets.
- add `arrivals: arrivals.slice(-MAX_ARRIVALS)` to the returned state;
- add `arrivals: []` to the empty-replay return.

In `site/src/replay/director/show.ts`, inside the focus branch of `frameAt`, next to the comet filter, add:

```ts
      base.arrivals = raw.arrivals.filter((a, i) => touches(a.from, a.to) || i % 4 === 0);
```

Since `base` is built after the sky edits, restructure slightly: build `arrivals` alongside `sky` and set `const base: ReplayFrameState = { ...raw, sky, arrivals };`, where `arrivals` is the filtered list in focus mode and `raw.arrivals` otherwise.

Also update the compose-test `state()` helper and any `ReplayFrameState` literal in tests to include `arrivals: []`.

Run: `pnpm --filter @ccip-dev/site exec vitest run test/timeline.test.ts test/director-show.test.ts test/compose.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add site/src/replay/timeline.ts site/src/replay/director/show.ts site/test/timeline.test.ts site/test/director-show.test.ts site/test/compose.test.ts
git commit -m "feat(site): replay frames report recent comet arrivals"
```

---

## Task 2: Effect math

**Files:**
- Create: `site/src/replay/cinema/fx.ts`
- Test: `site/test/cinema-fx.test.ts`

**Interfaces:**
- Consumes: `mulberry32` (`timeline.ts`).
- Produces:
  - the constants in the Effect timings table;
  - `interface Particle { x: number; y: number; alpha: number; size: number }`;
  - `burst(seed: number, count: number, age: number, life: number, ox: number, oy: number, reach: number): Particle[]`;
  - `novaFlash(age: number): number`;
  - `novaRing(age: number): { radius: number; alpha: number }`, where `radius` runs from 0 to 1;
  - `elasticPop(age: number): number`;
  - `heartbeat(activity: number): number`;
  - `shockAt(age: number): { progress: number; strength: number } | null`;
  - `textTargets(image: { width: number; height: number; data: ArrayLike<number> }, step: number): { x: number; y: number }[]`, with coordinates normalized to 0..1;
  - `assemble(seed: number, sources: readonly { x: number; y: number }[], targets: readonly { x: number; y: number }[], p: number): Particle[]`;
  - `arrivalSeed(to: number, arrivalTime: number): number`.

- [ ] **Step 1: Write the failing tests**

`site/test/cinema-fx.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { arrivalSeed, assemble, burst, elasticPop, heartbeat, novaFlash, novaRing, shockAt, textTargets } from '../src/replay/cinema/fx';

describe('burst', () => {
  it('starts every particle at the origin, fully opaque', () => {
    for (const p of burst(7, 12, 0, 1, 50, 60, 100)) expect(p).toMatchObject({ x: 50, y: 60, alpha: 1 });
  });

  it('spreads within its reach and fades out by the end of its life', () => {
    const late = burst(7, 12, 0.99, 1, 0, 0, 100);
    for (const p of late) {
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(100 + 1e-9);
      expect(p.alpha).toBeLessThan(0.001);
    }
    expect(burst(7, 12, 0.5, 1, 0, 0, 100)).toEqual(burst(7, 12, 0.5, 1, 0, 0, 100));
    expect(burst(7, 12, 1.2, 1, 0, 0, 100)).toEqual([]);
  });
});

describe('supernova and pop', () => {
  it('flashes for 0.3 s and rings out over 0.8 s', () => {
    expect(novaFlash(0)).toBe(1);
    expect(novaFlash(0.3)).toBe(0);
    expect(novaRing(0)).toEqual({ radius: 0, alpha: 1 });
    expect(novaRing(0.8)).toEqual({ radius: 1, alpha: 0 });
  });

  it('pops a coin from 0 past 1.25 and settles at 1 by 0.5 s', () => {
    expect(elasticPop(0)).toBe(0);
    const samples = Array.from({ length: 50 }, (_, i) => elasticPop(i / 100));
    expect(Math.max(...samples)).toBeCloseTo(1.25, 2);
    expect(elasticPop(0.5)).toBe(1);
    expect(elasticPop(3)).toBe(1);
  });
});

describe('heartbeat and shock', () => {
  it('maps activity to 0.8–1.2 brightness', () => {
    expect(heartbeat(0)).toBe(0.8);
    expect(heartbeat(1)).toBeCloseTo(1.2, 9);
    expect(heartbeat(5)).toBeCloseTo(1.2, 9);
  });

  it('runs a shockwave for half a second', () => {
    expect(shockAt(-0.1)).toBeNull();
    expect(shockAt(0)).toEqual({ progress: 0, strength: 1 });
    expect(shockAt(0.25)!.strength).toBeCloseTo(0.25, 9);
    expect(shockAt(0.5)).toBeNull();
  });
});

describe('textTargets', () => {
  it('samples opaque pixels on the step grid as normalized points', () => {
    const width = 4;
    const height = 2;
    const data = new Uint8ClampedArray(width * height * 4);
    data[(0 * width + 2) * 4 + 3] = 255;
    data[(1 * width + 0) * 4 + 3] = 200;
    data[(1 * width + 3) * 4 + 3] = 10;
    expect(textTargets({ width, height, data }, 1)).toEqual([
      { x: 2 / 4, y: 0 },
      { x: 0, y: 1 / 2 },
    ]);
  });
});

describe('assemble', () => {
  const sources = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  const targets = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 100 }];
  it('starts on the sources and lands on the targets', () => {
    const start = assemble(3, sources, targets, 0);
    expect(start.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 0], [0, 0]]);
    const end = assemble(3, sources, targets, 1);
    expect(end.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[100, 100], [200, 100], [300, 100]]);
  });
});

describe('arrivalSeed', () => {
  it('is stable for the same arrival and differs between arrivals', () => {
    expect(arrivalSeed(4, 10.0001)).toBe(arrivalSeed(4, 10.0));
    expect(arrivalSeed(4, 10)).not.toBe(arrivalSeed(5, 10));
  });
});
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/cinema-fx.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 2: Implement**

`site/src/replay/cinema/fx.ts`:

```ts
import { mulberry32 } from '../timeline';

export const SPARK_LIFE = 0.4;
export const NOVA_FLASH_S = 0.3;
export const NOVA_RING_S = 0.8;
export const NOVA_PARTICLE_S = 1.2;
export const NOVA_PARTICLES = 40;
export const POP_S = 0.5;
export const SHOCK_S = 0.5;

export interface Particle {
  x: number;
  y: number;
  alpha: number;
  size: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
const easeInOut = (x: number) => {
  const c = clamp01(x);
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
};

export function burst(seed: number, count: number, age: number, life: number, ox: number, oy: number, reach: number): Particle[] {
  if (age < 0 || age >= life) return [];
  const rng = mulberry32(seed);
  const p = age / life;
  const travel = easeOut(p);
  const alpha = (1 - p) ** 2;
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const speed = 0.4 + 0.6 * rng();
    const size = 0.5 + 0.5 * rng();
    out.push({ x: ox + Math.cos(angle) * speed * reach * travel, y: oy + Math.sin(angle) * speed * reach * travel, alpha, size });
  }
  return out;
}

export function novaFlash(age: number): number {
  return age < 0 ? 0 : clamp01(1 - age / NOVA_FLASH_S);
}

export function novaRing(age: number): { radius: number; alpha: number } {
  const p = clamp01(age / NOVA_RING_S);
  return { radius: easeOut(p), alpha: 1 - p };
}

export function elasticPop(age: number): number {
  const p = age / POP_S;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  if (p < 0.6) return 1.25 * easeOut(p / 0.6);
  return 1.25 - 0.25 * easeInOut((p - 0.6) / 0.4);
}

export function heartbeat(activity: number): number {
  return 0.8 + 0.4 * clamp01(activity);
}

export function shockAt(age: number): { progress: number; strength: number } | null {
  if (age < 0 || age >= SHOCK_S) return null;
  const progress = age / SHOCK_S;
  return { progress, strength: (1 - progress) ** 2 };
}

export function textTargets(image: { width: number; height: number; data: ArrayLike<number> }, step: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < image.height; y += step) {
    for (let x = 0; x < image.width; x += step) {
      if ((image.data[(y * image.width + x) * 4 + 3] ?? 0) > 127) out.push({ x: x / image.width, y: y / image.height });
    }
  }
  return out;
}

export function assemble(seed: number, sources: readonly { x: number; y: number }[], targets: readonly { x: number; y: number }[], p: number): Particle[] {
  if (sources.length === 0) return [];
  const rng = mulberry32(seed);
  return targets.map((target, i) => {
    const source = sources[i % sources.length]!;
    const delay = rng() * 0.4;
    const swirl = (rng() - 0.5) * 0.6;
    const k = p <= 0 ? 0 : p >= 1 ? 1 : easeInOut((p - delay) / 0.6);
    const mx = (source.x + target.x) / 2 - (target.y - source.y) * swirl;
    const my = (source.y + target.y) / 2 + (target.x - source.x) * swirl;
    const u = 1 - k;
    return {
      x: u * u * source.x + 2 * u * k * mx + k * k * target.x,
      y: u * u * source.y + 2 * u * k * my + k * k * target.y,
      alpha: clamp01(p * 4),
      size: 0.6 + 0.4 * rng(),
    };
  });
}

export function arrivalSeed(to: number, arrivalTime: number): number {
  return (to * 100_003 + Math.round(arrivalTime * 30)) >>> 0;
}
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/cinema-fx.test.ts`
Expected: PASS.

Check that `assemble` hits its endpoints exactly. At `p = 0`, `k = 0`, so each particle sits on `source`. The third target uses `sources[2 % 2]`, which is `sources[0]`, at (0, 0). At `p = 1`, `k = 1`, so each particle sits on `target`.

- [ ] **Step 3: Commit**

```bash
git add site/src/replay/cinema/fx.ts site/test/cinema-fx.test.ts
git commit -m "feat(site): cinema effect math: bursts, supernova, coin pop, heartbeat, shockwave, text particles"
```

---

## Task 3: Quality tiers and the icon atlas layout

**Files:**
- Create: `site/src/replay/cinema/quality.ts`, `site/src/replay/cinema/atlas.ts`
- Test: `site/test/cinema-quality.test.ts`

**Interfaces:**
- Produces:
  - `type Tier = 'high' | 'medium' | 'low'`;
  - `interface TierConfig { bloom: 'full' | 'half' | 'off'; particles: number; nebula: boolean; dust: number }`;
  - `TIERS: Record<Tier, TierConfig>`;
  - `class QualityController`, with `constructor(opts: { start?: Tier; locked?: boolean; windowS?: number })`, `sample(frameMs: number, nowS: number): Tier` and a `tier` getter;
  - `atlasLayout(count: number, cell: number, maxSize?: number): { cols: number; rows: number; width: number; height: number; cell: number; uv(i: number): [number, number, number, number] }`.

- [ ] **Step 1: Write the failing tests**

`site/test/cinema-quality.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { atlasLayout } from '../src/replay/cinema/atlas';
import { QualityController, TIERS } from '../src/replay/cinema/quality';

describe('TIERS', () => {
  it('matches the spec table', () => {
    expect(TIERS.high).toEqual({ bloom: 'full', particles: 1, nebula: true, dust: 3 });
    expect(TIERS.medium).toEqual({ bloom: 'half', particles: 0.5, nebula: true, dust: 2 });
    expect(TIERS.low).toEqual({ bloom: 'off', particles: 0.25, nebula: false, dust: 1 });
  });
});

describe('QualityController', () => {
  const feed = (c: QualityController, ms: number, from: number, to: number) => {
    let tier = c.tier;
    for (let t = from; t < to; t += 1 / 60) tier = c.sample(ms, t);
    return tier;
  };

  it('stays on High when frames are fast', () => {
    expect(feed(new QualityController({}), 12, 0, 3)).toBe('high');
  });

  it('steps down one tier per slow window, never back up', () => {
    const c = new QualityController({});
    expect(feed(c, 26, 0, 2.05)).toBe('medium');
    expect(feed(c, 34, 2.05, 4.1)).toBe('low');
    expect(feed(c, 5, 4.1, 8)).toBe('low');
  });

  it('only steps from Medium to Low past 30 ms', () => {
    const c = new QualityController({ start: 'medium' });
    expect(feed(c, 26, 0, 4)).toBe('medium');
  });

  it('never changes when locked, as for recordings', () => {
    expect(feed(new QualityController({ locked: true }), 80, 0, 6)).toBe('high');
  });
});

describe('atlasLayout', () => {
  it('packs cells in rows and gives each icon its UV box', () => {
    const l = atlasLayout(20, 128, 1024);
    expect(l.cols).toBe(8);
    expect(l.rows).toBe(3);
    expect(l.width).toBe(1024);
    expect(l.height).toBe(384);
    expect(l.uv(0)).toEqual([0, 0, 0.125, 1 / 3]);
    expect(l.uv(9)).toEqual([0.125, 1 / 3, 0.25, 2 / 3]);
  });
});
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/cinema-quality.test.ts`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 2: Implement**

`site/src/replay/cinema/quality.ts`:

```ts
export type Tier = 'high' | 'medium' | 'low';

export interface TierConfig {
  bloom: 'full' | 'half' | 'off';
  particles: number;
  nebula: boolean;
  dust: number;
}

export const TIERS: Record<Tier, TierConfig> = {
  high: { bloom: 'full', particles: 1, nebula: true, dust: 3 },
  medium: { bloom: 'half', particles: 0.5, nebula: true, dust: 2 },
  low: { bloom: 'off', particles: 0.25, nebula: false, dust: 1 },
};

const LIMIT_MS: Record<Tier, number> = { high: 22, medium: 30, low: Infinity };
const NEXT: Record<Tier, Tier> = { high: 'medium', medium: 'low', low: 'low' };

export class QualityController {
  private current: Tier;
  private readonly locked: boolean;
  private readonly windowS: number;
  private windowStart: number | null = null;
  private samples: number[] = [];

  constructor(opts: { start?: Tier; locked?: boolean; windowS?: number }) {
    this.current = opts.start ?? 'high';
    this.locked = opts.locked ?? false;
    this.windowS = opts.windowS ?? 2;
  }

  get tier(): Tier {
    return this.current;
  }

  sample(frameMs: number, nowS: number): Tier {
    if (this.locked || this.current === 'low') return this.current;
    if (this.windowStart === null) this.windowStart = nowS;
    this.samples.push(frameMs);
    if (nowS - this.windowStart >= this.windowS) {
      const sorted = [...this.samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)]!;
      if (median > LIMIT_MS[this.current]) this.current = NEXT[this.current];
      this.samples = [];
      this.windowStart = nowS;
    }
    return this.current;
  }
}
```

`site/src/replay/cinema/atlas.ts`:

```ts
export function atlasLayout(count: number, cell: number, maxSize = 2048) {
  const cols = Math.max(1, Math.min(count, Math.floor(maxSize / cell)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const width = cols * cell;
  const height = rows * cell;
  return {
    cols,
    rows,
    width,
    height,
    cell,
    uv(i: number): [number, number, number, number] {
      const c = i % cols;
      const r = Math.floor(i / cols);
      return [(c * cell) / width, (r * cell) / height, ((c + 1) * cell) / width, ((r + 1) * cell) / height];
    },
  };
}
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/cinema-quality.test.ts`
Expected: PASS.

Check the layout: 20 cells of 128 px with a maximum of 1024 give 8 columns and 3 rows (1024 × 384). Cell 9 is at column 1, row 1, so its UV box is [0.125, 1/3, 0.25, 2/3].

- [ ] **Step 3: Commit**

```bash
git add site/src/replay/cinema/quality.ts site/src/replay/cinema/atlas.ts site/test/cinema-quality.test.ts
git commit -m "feat(site): cinema quality tiers with an adaptive controller, and the icon atlas layout"
```

---
## Task 4: The scene builder

**Files:**
- Create: `site/src/replay/cinema/scene.ts`
- Test: `site/test/cinema-scene.test.ts`

**Interfaces:**
- Consumes:
  - `ShowFrame` (Plan A Task 5), with `base.arrivals` (this plan's Task 1);
  - `fx` (Task 2) and `TierConfig` (Task 3);
  - `cameraProjector` (`sky/layout.ts`), `laneControl` and `quadPoint` (`sky/geometry.ts`), `coinDiameter` (`sky/coins.ts`), `COLORS` (`sky/frame.ts`);
  - `REPLAY_COIN_UNIT` (`replay/compose.ts`), and `IGNITE_S` and `mulberry32` (`replay/timeline.ts`).
- Produces:
  - `QUAD_FLOATS = 10`, laid out as `x, y, sx, sy, angle, r, g, b, a, shape`;
  - `COIN_FLOATS = 8`, laid out as `x, y, size, alpha, u0, v0, u1, v1`;
  - `LINE_FLOATS = 3`, laid out as `x, y, alpha`;
  - `SHAPE = { glow: 0, ring: 1, disc: 2, streak: 3, spark: 4 }`;
  - `DUST_COUNTS = [300, 180, 90]`, `DUST_PARALLAX = [0.2, 0.4, 0.7]` and `MAX_SCENE_QUADS = 8000`;
  - `interface DustField { layers: Float32Array[] }`, five floats per point: `x, y, size, alpha, phase`;
  - `dustField(seed: number, spread: number): DustField`;
  - `interface SceneContext { width: number; height: number; tier: TierConfig; dust: DustField; fullExtent: number; atlas: ReadonlyMap<string, readonly [number, number, number, number]>; titleTargets: readonly { x: number; y: number }[]; reducedMotion: boolean; seed: number; finaleSeconds: number }`;
  - `interface CinemaScene { width: number; height: number; nebula: { offset: [number, number]; intensity: number; seed: number } | null; lines: Float32Array; quads: Float32Array; coins: Float32Array; shock: { x: number; y: number; progress: number; strength: number } | null; exposure: number; bloom: TierConfig['bloom']; frame: number }`;
  - `buildScene(frame: ShowFrame, ctx: SceneContext): CinemaScene`.

- [ ] **Step 1: Write the failing tests**

`site/test/cinema-scene.test.ts`:

```ts
import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { TIERS } from '../src/replay/cinema/quality';
import { buildScene, COIN_FLOATS, dustField, LINE_FLOATS, MAX_SCENE_QUADS, QUAD_FLOATS, type SceneContext } from '../src/replay/cinema/scene';
import { Show } from '../src/replay/director/show';
import { buildLayout } from '../src/sky/layout';
import replayJson from './fixtures/replay.json';

const replay = replayJson as ReplayFile;
const history = replay.days.map((d) => ({ day: d.day, messages: 10, token_messages: 10, usd_value: 1000, fee_usd: null, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null })) as DayTotals[];
const stars = buildLayout(replay.chains);
const show = new Show({ replay, history, stars, length: 30, focus: null, eligible: () => true });
const atlas = new Map(replay.chains.map((c, i) => [c.selector, [i * 0.1, 0, i * 0.1 + 0.1, 1] as const]));
const ctx = (over: Partial<SceneContext> = {}): SceneContext => ({
  width: 1280,
  height: 720,
  tier: TIERS.high,
  dust: dustField(11, 1),
  fullExtent: 1,
  atlas,
  titleTargets: [{ x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 }],
  reducedMotion: false,
  seed: 5,
  finaleSeconds: 3,
  ...over,
});

describe('buildScene', () => {
  it('is deterministic for the same frame and context', () => {
    expect(buildScene(show.frameAt(15), ctx())).toEqual(buildScene(show.frameAt(15), ctx()));
  });

  it('packs whole instances and stays bounded', () => {
    const s = buildScene(show.frameAt(15), ctx());
    expect(s.quads.length % QUAD_FLOATS).toBe(0);
    expect(s.coins.length % COIN_FLOATS).toBe(0);
    expect(s.lines.length % LINE_FLOATS).toBe(0);
    expect(s.quads.length / QUAD_FLOATS).toBeLessThanOrEqual(MAX_SCENE_QUADS);
  });

  it('draws fewer dust points and no nebula on the Low tier', () => {
    const high = buildScene(show.frameAt(15), ctx());
    const low = buildScene(show.frameAt(15), ctx({ tier: TIERS.low }));
    expect(low.quads.length).toBeLessThan(high.quads.length);
    expect(low.nebula).toBeNull();
    expect(high.nebula).not.toBeNull();
    expect(low.bloom).toBe('off');
  });

  it('draws one coin per visible coin that has an atlas cell', () => {
    const frame = show.frameAt(26);
    const s = buildScene(frame, ctx());
    const visible = frame.base.coins.filter((c) => atlas.has(c.selector) && (frame.base.sky.stars[c.star]?.radius ?? 0) > 0);
    expect(s.coins.length / COIN_FLOATS).toBe(visible.length);
  });

  it('shakes only during a milestone slam, and never under reduced motion', () => {
    const frame = { ...show.frameAt(15), slam: { start: 14.9, label: '$1B moved', progress: 0.1 } };
    expect(buildScene(frame, ctx()).shock).not.toBeNull();
    expect(buildScene(frame, ctx({ reducedMotion: true })).shock).toBeNull();
    expect(buildScene(show.frameAt(15), ctx()).shock).toBeNull();
  });

  it('assembles the title from particles and pulses the exposure in the finale', () => {
    const story = buildScene(show.frameAt(20), ctx());
    const finale = buildScene(show.frameAt(28.2), ctx());
    expect(finale.quads.length).toBeGreaterThan(story.quads.length);
    expect(story.exposure).toBe(1);
    expect(buildScene(show.frameAt(27.6), ctx()).exposure).toBeGreaterThan(1);
  });
});

describe('dustField', () => {
  it('seeds three layers with the spec counts', () => {
    const d = dustField(3, 1);
    expect(d.layers.map((l) => l.length / 5)).toEqual([300, 180, 90]);
    expect(dustField(3, 1)).toEqual(d);
  });
});
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/cinema-scene.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 2: Implement**

`site/src/replay/cinema/scene.ts`:

```ts
import { coinDiameter } from '../../sky/coins';
import { COLORS } from '../../sky/frame';
import { laneControl, quadPoint } from '../../sky/geometry';
import { cameraProjector } from '../../sky/layout';
import { REPLAY_COIN_UNIT } from '../compose';
import type { ShowFrame } from '../director/show';
import { IGNITE_S, mulberry32 } from '../timeline';
import { arrivalSeed, assemble, burst, elasticPop, heartbeat, NOVA_PARTICLE_S, NOVA_PARTICLES, novaFlash, novaRing, shockAt, SPARK_LIFE } from './fx';
import type { TierConfig } from './quality';

export const QUAD_FLOATS = 10;
export const COIN_FLOATS = 8;
export const LINE_FLOATS = 3;
export const SHAPE = { glow: 0, ring: 1, disc: 2, streak: 3, spark: 4 } as const;
export const DUST_COUNTS = [300, 180, 90] as const;
export const DUST_PARALLAX = [0.2, 0.4, 0.7] as const;
export const MAX_SCENE_QUADS = 8000;
const DUST_SPREAD = 3;
const LANE_SEGMENTS = 16;
const TITLE_PARTICLES_FROM_S = 0.3;
const TITLE_PARTICLES_S = 1.2;
const PULSE_AT_S = 0.6;
const PULSE_WIDTH_S = 0.3;
const RECORD_RIPPLE_S = 1.2;

export interface DustField {
  layers: Float32Array[];
}

export interface SceneContext {
  width: number;
  height: number;
  tier: TierConfig;
  dust: DustField;
  fullExtent: number;
  atlas: ReadonlyMap<string, readonly [number, number, number, number]>;
  titleTargets: readonly { x: number; y: number }[];
  reducedMotion: boolean;
  seed: number;
  finaleSeconds: number;
}

export interface CinemaScene {
  width: number;
  height: number;
  nebula: { offset: [number, number]; intensity: number; seed: number } | null;
  lines: Float32Array;
  quads: Float32Array;
  coins: Float32Array;
  shock: { x: number; y: number; progress: number; strength: number } | null;
  exposure: number;
  bloom: TierConfig['bloom'];
  frame: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
type Rgb = readonly number[];
const colorOf = (kind: string): Rgb => (kind === 'gold' ? COLORS.gold : kind === 'token' ? COLORS.blue : COLORS.pale);
const mixRgb = (a: Rgb, b: Rgb, k: number): Rgb => a.map((v, i) => v + (b[i]! - v) * k);

export function dustField(seed: number, spread: number): DustField {
  const rng = mulberry32(seed);
  return {
    layers: DUST_COUNTS.map((count) => {
      const out = new Float32Array(count * 5);
      for (let i = 0; i < count; i++) {
        out.set([(rng() * 2 - 1) * spread * DUST_SPREAD, (rng() * 2 - 1) * spread * DUST_SPREAD, 0.6 + rng() * 1.4, 0.15 + rng() * 0.35, rng() * Math.PI * 2], i * 5);
      }
      return out;
    }),
  };
}

export function buildScene(frame: ShowFrame, ctx: SceneContext): CinemaScene {
  const { width: w, height: h, tier } = ctx;
  const unit = Math.min(w, h) / 1000;
  const cam = frame.camera;
  const project = cameraProjector(w, h, cam);
  const sky = frame.base.sky;
  const quads: number[] = [];
  const put = (x: number, y: number, sx: number, sy: number, angle: number, c: Rgb, a: number, shape: number, gain = 1) => {
    if (a <= 0.002 || quads.length / QUAD_FLOATS >= MAX_SCENE_QUADS) return;
    quads.push(x, y, sx, sy, angle, c[0]! * gain, c[1]! * gain, c[2]! * gain, Math.min(1, a), shape);
  };
  const onScreen = (x: number, y: number, pad: number) => x > -pad && y > -pad && x < w + pad && y < h + pad;

  for (let layer = 0; layer < Math.min(tier.dust, ctx.dust.layers.length); layer++) {
    const par = DUST_PARALLAX[layer]!;
    const proj = cameraProjector(w, h, { cx: cam.cx * par, cy: cam.cy * par, extent: ctx.fullExtent + (cam.extent - ctx.fullExtent) * par, rotation: cam.rotation * par });
    const pts = ctx.dust.layers[layer]!;
    for (let i = 0; i < pts.length; i += 5) {
      const [x, y] = proj(pts[i]!, pts[i + 1]!);
      if (!onScreen(x, y, 4)) continue;
      const twinkle = 0.85 + 0.15 * Math.sin(frame.t * 1.7 + pts[i + 4]!);
      const size = pts[i + 2]! * unit * 2;
      put(x, y, size, size, 0, COLORS.pale, pts[i + 3]! * twinkle, SHAPE.spark);
    }
  }

  const points = sky.stars.map((s) => {
    const [x, y] = project(s.x, s.y);
    return { x, y };
  });

  const lines: number[] = [];
  for (const lane of sky.lanes) {
    const a = points[lane.from];
    const b = points[lane.to];
    if (!a || !b) continue;
    const c = laneControl(a, b);
    let prev = a;
    for (let s = 1; s <= LANE_SEGMENTS; s++) {
      const p = quadPoint(a, c, b, s / LANE_SEGMENTS);
      lines.push(prev.x, prev.y, lane.opacity * 0.9, p.x, p.y, lane.opacity * 0.9);
      prev = p;
    }
  }

  const activity = new Array<number>(sky.stars.length).fill(0);
  for (const lane of sky.lanes) {
    activity[lane.from] = (activity[lane.from] ?? 0) + lane.opacity;
    activity[lane.to] = (activity[lane.to] ?? 0) + lane.opacity;
  }
  const maxActivity = Math.max(1e-9, ...activity);
  sky.stars.forEach((s, i) => {
    if (s.radius <= 0) return;
    const p = points[i]!;
    const r = s.radius * unit;
    const beat = heartbeat(activity[i]! / maxActivity);
    put(p.x, p.y, r * 4 * beat, r * 4 * beat, 0, COLORS.blue, (0.22 * s.brightness + 0.5 * s.flash) * beat, SHAPE.glow, 1.4);
  });

  for (const c of sky.comets) {
    const a = points[c.from];
    const b = points[c.to];
    if (!a || !b) continue;
    const ctrl = laneControl(a, b);
    const head = quadPoint(a, ctrl, b, c.progress);
    const ahead = quadPoint(a, ctrl, b, Math.min(1, c.progress + 0.01));
    const angle = Math.atan2(ahead.y - head.y, ahead.x - head.x);
    const color = colorOf(c.kind);
    const size = (10 + 16 * c.size) * unit;
    const half = (size * (6 + 8 * c.size)) / 4;
    put(head.x - Math.cos(angle) * half, head.y - Math.sin(angle) * half, half, size * 0.35, angle, color, 0.9, SHAPE.streak, c.kind === 'gold' ? 2.2 : 1.6);
    put(head.x, head.y, size, size, 0, color, 1, SHAPE.glow, 1.6);
    put(head.x, head.y, (2.2 + 3 * c.size) * unit, (2.2 + 3 * c.size) * unit, 0, mixRgb(color, COLORS.star, 0.5), 1, SHAPE.disc, 1.2);
  }

  for (const arrival of frame.base.arrivals) {
    const dest = points[arrival.to];
    if (!dest) continue;
    const color = colorOf(arrival.kind);
    const count = Math.round((8 + 8 * arrival.size) * tier.particles);
    for (const p of burst(arrivalSeed(arrival.to, frame.t - arrival.age), count, arrival.age, SPARK_LIFE, dest.x, dest.y, (30 + 40 * arrival.size) * unit)) {
      put(p.x, p.y, 3 * unit * p.size, 3 * unit * p.size, 0, color, p.alpha, SHAPE.spark, 2);
    }
    const ripple = (10 + 40 * (arrival.age / SPARK_LIFE)) * unit;
    put(dest.x, dest.y, ripple, ripple, 0, color, 1 - arrival.age / SPARK_LIFE, SHAPE.ring, 1.2);
  }

  for (const ring of sky.rings) {
    const p = points[ring.star];
    if (!p) continue;
    const age = ring.progress * IGNITE_S;
    put(p.x, p.y, 60 * unit, 60 * unit, 0, COLORS.blue, novaFlash(age), SHAPE.glow, 3);
    const nr = novaRing(age);
    const radius = (12 + 90 * nr.radius) * unit;
    put(p.x, p.y, radius, radius, 0, COLORS.blue, nr.alpha, SHAPE.ring, 2);
    for (const q of burst(ring.star * 7919 + 1, Math.round(NOVA_PARTICLES * tier.particles), age, NOVA_PARTICLE_S, p.x, p.y, 80 * unit)) {
      put(q.x, q.y, 2.5 * unit * q.size, 2.5 * unit * q.size, 0, COLORS.pale, q.alpha, SHAPE.spark, 2);
    }
  }

  if (frame.card?.kind === 'record') {
    const age = frame.t - frame.card.start;
    if (age >= 0 && age < RECORD_RIPPLE_S) {
      const radius = (40 + 600 * easeOut(age / RECORD_RIPPLE_S)) * unit;
      put(w / 2, h / 2, radius, radius, 0, COLORS.gold, 1 - age / RECORD_RIPPLE_S, SHAPE.ring, 1.5);
    }
  }

  sky.stars.forEach((s, i) => {
    if (s.radius <= 0) return;
    const p = points[i]!;
    const core = Math.max(1, s.radius * unit);
    put(p.x, p.y, core, core, 0, COLORS.star, 0.55 + 0.45 * s.brightness + s.flash, SHAPE.disc, 1.1);
  });

  const coins: number[] = [];
  for (const c of frame.base.coins) {
    const uv = ctx.atlas.get(c.selector);
    const star = sky.stars[c.star];
    const p = points[c.star];
    if (!uv || !star || !p || star.radius <= 0) continue;
    const ring = sky.rings.find((r) => r.star === c.star);
    const pop = ring ? elasticPop(ring.progress * IGNITE_S) : 1;
    coins.push(p.x, p.y, coinDiameter(star.radius) * (Math.min(w, h) / REPLAY_COIN_UNIT) * pop, c.alpha, uv[0], uv[1], uv[2], uv[3]);
  }

  let exposure = 1;
  if (frame.phase === 'finale') {
    const seconds = frame.finale * ctx.finaleSeconds;
    exposure = 1 + 0.35 * Math.max(0, 1 - Math.abs(seconds - PULSE_AT_S) / PULSE_WIDTH_S);
    const origin = points.find((_, i) => (sky.stars[i]?.radius ?? 0) > 0) ?? { x: w / 2, y: h / 2 };
    const reach = Math.hypot(w, h) / 2;
    for (let i = 0; i < coins.length; i += COIN_FLOATS) {
      const x = coins[i]!;
      const y = coins[i + 1]!;
      const d = coins[i + 2]!;
      const p = (seconds - 0.6 * (Math.hypot(x - origin.x, y - origin.y) / reach)) / 0.5;
      if (p > 0 && p < 1) put(x, y, (d / 2) * (1 + 0.8 * p), (d / 2) * (1 + 0.8 * p), 0, COLORS.blue, 1 - p, SHAPE.ring, 1.6);
    }
    const p = clamp01((seconds - TITLE_PARTICLES_FROM_S) / TITLE_PARTICLES_S);
    const fade = 1 - clamp01((frame.finale - 0.75) / 0.15);
    if (p > 0 && fade > 0 && ctx.titleTargets.length > 0) {
      const sources = points.filter((_, i) => (sky.stars[i]?.radius ?? 0) > 0).slice(0, 60);
      const boxW = Math.min(w * 0.62, h * 1.6);
      const targets = ctx.titleTargets.map((t) => ({ x: w / 2 + (t.x - 0.5) * boxW, y: h / 2 + (t.y - 0.5) * boxW * 0.25 }));
      const step = Math.max(1, Math.round(1 / tier.particles));
      assemble(ctx.seed, sources, targets, p).forEach((q, i) => {
        if (i % step === 0) put(q.x, q.y, 3.5 * unit * q.size, 3.5 * unit * q.size, 0, mixRgb(COLORS.blue, COLORS.star, 0.6), q.alpha * fade, SHAPE.spark, 2.2);
      });
    }
  }

  const shock = ctx.reducedMotion || !frame.slam ? null : shockAt(frame.t - frame.slam.start);
  return {
    width: w,
    height: h,
    nebula: tier.nebula ? { offset: [frame.t * 0.02 + cam.cx * 0.05, cam.cy * 0.05], intensity: 0.08, seed: (ctx.seed % 997) / 997 } : null,
    lines: new Float32Array(lines),
    quads: new Float32Array(quads),
    coins: new Float32Array(coins),
    shock: shock ? { x: 0.5, y: 0.5, progress: shock.progress, strength: shock.strength } : null,
    exposure,
    bloom: tier.bloom,
    frame: Math.round(frame.t * 30),
  };
}
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/cinema-scene.test.ts`
Expected: PASS.

On the finale test values: with a 30 s show, the finale starts at 27 s and `finaleSeconds` is 3. At 28.2 s, `seconds` is 1.2, so `p = (1.2 − 0.3) / 1.2 = 0.75` and the title particles are drawn, with `fade = 1` because `finale = 0.4`. At 27.6 s, `seconds` is 0.6, which is exactly the pulse center, so the exposure is 1.35.

- [ ] **Step 3: Commit**

```bash
git add site/src/replay/cinema/scene.ts site/test/cinema-scene.test.ts
git commit -m "feat(site): cinema scene builder turns a ShowFrame into dust, lanes, streaks, sparks, supernovas, coins and finale particles"
```

---

## Task 5: The WebGL2 cinema renderer

**Files:**
- Create: `site/src/replay/cinema/shaders.ts`, `site/src/replay/cinema/gl.ts`, `site/src/replay/cinema/renderer.ts`
- Modify: `site/src/sky/renderer-gl.ts` (export `compile` and `link`)
- Test: `site/test/cinema-gl.test.ts`

**Interfaces:**
- Consumes: `CinemaScene`, `QUAD_FLOATS`, `COIN_FLOATS` and `LINE_FLOATS` (Task 4); `SkyCanvas` (`sky/renderer.ts`).
- Produces:
  - from `gl.ts`:
    - `interface Target { fbo: WebGLFramebuffer; tex: WebGLTexture; width: number; height: number }`;
    - `targetFormat(gl): { internal: number; type: number; hdr: boolean }`;
    - `createTarget(gl, width, height, format): Target`;
    - `deleteTarget(gl, t)`;
  - `class CinemaRenderer`:
    - `static create(canvas: SkyCanvas): CinemaRenderer | null`;
    - `resize(width: number, height: number): void`;
    - `render(scene: CinemaScene): void`;
    - `setAtlas(source: TexImageSource | null): void`;
    - `get lost(): boolean`;
    - `destroy(): void`.

- [ ] **Step 1: Write the failing test for target selection**

`site/test/cinema-gl.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { targetFormat } from '../src/replay/cinema/gl';

const fakeGl = (float: boolean) =>
  ({
    RGBA16F: 0x881a,
    HALF_FLOAT: 0x140b,
    RGBA8: 0x8058,
    UNSIGNED_BYTE: 0x1401,
    getExtension: (name: string) => (float && name === 'EXT_color_buffer_float' ? {} : null),
  }) as unknown as WebGL2RenderingContext;

describe('targetFormat', () => {
  it('uses half-float HDR targets when color-buffer float is available', () => {
    expect(targetFormat(fakeGl(true))).toEqual({ internal: 0x881a, type: 0x140b, hdr: true });
  });

  it('falls back to RGBA8 targets without it', () => {
    expect(targetFormat(fakeGl(false))).toEqual({ internal: 0x8058, type: 0x1401, hdr: false });
  });
});
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/cinema-gl.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 2: Shaders**

`site/src/replay/cinema/shaders.ts`:

```ts
export const FULLSCREEN_VERT = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const BACKGROUND_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec2 u_offset;
uniform float u_intensity;
uniform float u_seed;
uniform vec2 u_aspect;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21) + u_seed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec3 col = mix(vec3(0.035, 0.043, 0.063), vec3(0.047, 0.067, 0.11), v_uv.y);
  if (u_intensity > 0.0) {
    vec2 p = v_uv * u_aspect * 2.2 + u_offset;
    float n = fbm(p) * 0.7 + fbm(p * 1.7 + 4.0) * 0.5;
    col += vec3(0.18, 0.38, 0.87) * smoothstep(0.45, 0.85, n) * u_intensity;
  }
  outColor = vec4(col, 1.0);
}`;

export const QUAD_VERT = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_center;
layout(location = 2) in vec2 a_size;
layout(location = 3) in float a_angle;
layout(location = 4) in vec4 a_color;
layout(location = 5) in float a_shape;
uniform vec2 u_resolution;
out vec2 v_local;
out vec4 v_color;
flat out float v_shape;
void main() {
  v_local = a_corner;
  v_color = a_color;
  v_shape = a_shape;
  float c = cos(a_angle);
  float s = sin(a_angle);
  vec2 p = a_corner * a_size;
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  vec2 clip = (a_center + p) / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

export const QUAD_FRAG = `#version 300 es
precision highp float;
in vec2 v_local;
in vec4 v_color;
flat in float v_shape;
out vec4 outColor;
void main() {
  float d = length(v_local);
  float a;
  if (v_shape < 3.5 && v_shape > 2.5) {
    float across = abs(v_local.y);
    if (across > 1.0) discard;
    float along = (v_local.x + 1.0) * 0.5;
    a = pow(along, 2.5) * (1.0 - smoothstep(0.0, 1.0, across));
  } else {
    if (d > 1.0) discard;
    if (v_shape < 0.5) a = pow(1.0 - d, 2.2);
    else if (v_shape < 1.5) a = smoothstep(0.8, 0.9, d) * (1.0 - smoothstep(0.92, 1.0, d));
    else if (v_shape < 2.5) a = 1.0 - smoothstep(0.7, 1.0, d);
    else a = pow(1.0 - d, 4.0);
  }
  float alpha = v_color.a * a;
  outColor = vec4(v_color.rgb * alpha, alpha);
}`;

export const LINE_VERT = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in float a_alpha;
uniform vec2 u_resolution;
out float v_alpha;
void main() {
  v_alpha = a_alpha;
  vec2 clip = a_pos / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

export const LINE_FRAG = `#version 300 es
precision highp float;
in float v_alpha;
out vec4 outColor;
void main() { outColor = vec4(vec3(0.290, 0.498, 0.941) * v_alpha * 1.3, v_alpha); }`;

export const COIN_VERT = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_center;
layout(location = 2) in float a_size;
layout(location = 3) in float a_alpha;
layout(location = 4) in vec4 a_uv;
uniform vec2 u_resolution;
out vec2 v_local;
out vec2 v_uv;
out float v_alpha;
void main() {
  v_local = a_corner;
  v_alpha = a_alpha;
  v_uv = mix(a_uv.xy, a_uv.zw, a_corner * 0.5 + 0.5);
  vec2 clip = (a_center + a_corner * a_size * 0.5) / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

export const COIN_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
in vec2 v_local;
in vec2 v_uv;
in float v_alpha;
out vec4 outColor;
void main() {
  float d = length(v_local);
  if (d > 1.0) discard;
  vec4 c = texture(u_atlas, v_uv);
  float edge = 1.0 - smoothstep(0.92, 1.0, d);
  float ring = smoothstep(0.86, 0.92, d) * (1.0 - smoothstep(0.96, 1.0, d));
  vec3 rgb = c.rgb * edge + vec3(0.25) * ring;
  float a = max(c.a * edge, ring * 0.6);
  outColor = vec4(rgb * v_alpha, a * v_alpha);
}`;

export const BRIGHT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform float u_threshold;
void main() {
  vec3 c = texture(u_src, v_uv).rgb;
  float l = max(c.r, max(c.g, c.b));
  outColor = vec4(c * smoothstep(u_threshold, u_threshold + 0.5, l), 1.0);
}`;

export const DOWN_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform vec2 u_texel;
void main() {
  vec3 c = texture(u_src, v_uv + u_texel * vec2(-1.0, -1.0)).rgb
         + texture(u_src, v_uv + u_texel * vec2(1.0, -1.0)).rgb
         + texture(u_src, v_uv + u_texel * vec2(-1.0, 1.0)).rgb
         + texture(u_src, v_uv + u_texel * vec2(1.0, 1.0)).rgb;
  outColor = vec4(c * 0.25, 1.0);
}`;

export const UP_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform vec2 u_texel;
void main() {
  vec3 c = texture(u_src, v_uv).rgb * 4.0
         + texture(u_src, v_uv + u_texel * vec2(-1.0, 0.0)).rgb * 2.0
         + texture(u_src, v_uv + u_texel * vec2(1.0, 0.0)).rgb * 2.0
         + texture(u_src, v_uv + u_texel * vec2(0.0, -1.0)).rgb * 2.0
         + texture(u_src, v_uv + u_texel * vec2(0.0, 1.0)).rgb * 2.0
         + texture(u_src, v_uv + u_texel).rgb
         + texture(u_src, v_uv - u_texel).rgb
         + texture(u_src, v_uv + u_texel * vec2(1.0, -1.0)).rgb
         + texture(u_src, v_uv + u_texel * vec2(-1.0, 1.0)).rgb;
  outColor = vec4(c / 16.0, 1.0);
}`;

export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_bloomStrength;
uniform float u_exposure;
uniform float u_frame;
uniform vec2 u_resolution;
uniform vec4 u_shock;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec2 uv = v_uv;
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 dir = uv - u_shock.xy;
  float dist = length(dir * aspect);
  float band = u_shock.w * exp(-pow((dist - u_shock.z * 0.9) * 12.0, 2.0));
  uv -= normalize(dir + 1e-6) * band * 0.02;
  float ca = 0.004 * u_shock.w;
  vec3 col = vec3(texture(u_scene, uv + dir * ca).r, texture(u_scene, uv).g, texture(u_scene, uv - dir * ca).b);
  col += texture(u_bloom, uv).rgb * u_bloomStrength;
  col = aces(col * u_exposure * 1.35);
  float vig = smoothstep(1.15, 0.35, length((v_uv - 0.5) * aspect));
  col *= mix(0.72, 1.0, vig);
  float g = fract(sin(dot(v_uv * u_resolution + u_frame, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  col += g * 0.025;
  outColor = vec4(col, 1.0);
}`;
```

- [ ] **Step 3: GL helpers**

In `site/src/sky/renderer-gl.ts`, change `function compile` and `function link` to `export function compile` and `export function link`. Their bodies stay the same.

`site/src/replay/cinema/gl.ts`:

```ts
export interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
}

export function targetFormat(gl: WebGL2RenderingContext): { internal: number; type: number; hdr: boolean } {
  return gl.getExtension('EXT_color_buffer_float')
    ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT, hdr: true }
    : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE, hdr: false };
}

export function createTarget(gl: WebGL2RenderingContext, width: number, height: number, format: { internal: number; type: number }): Target {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) throw new Error('WebGL: could not create a render target');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, format.internal, width, height, 0, gl.RGBA, format.type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('WebGL: render target incomplete');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, width, height };
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target): void {
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/cinema-gl.test.ts`
Expected: PASS.

- [ ] **Step 4: The renderer**

`site/src/replay/cinema/renderer.ts`:

```ts
import type { SkyCanvas } from '../../sky/renderer';
import { link } from '../../sky/renderer-gl';
import { createTarget, deleteTarget, targetFormat, type Target } from './gl';
import { COIN_FLOATS, LINE_FLOATS, QUAD_FLOATS, type CinemaScene } from './scene';
import {
  BACKGROUND_FRAG,
  BRIGHT_FRAG,
  COIN_FRAG,
  COIN_VERT,
  COMPOSITE_FRAG,
  DOWN_FRAG,
  FULLSCREEN_VERT,
  LINE_FRAG,
  LINE_VERT,
  QUAD_FRAG,
  QUAD_VERT,
  UP_FRAG,
} from './shaders';

const BLOOM_LEVELS = 5;
const BLOOM_THRESHOLD = 0.8;
const BLOOM_STRENGTH = 0.9;

interface Programs {
  background: WebGLProgram;
  quad: WebGLProgram;
  line: WebGLProgram;
  coin: WebGLProgram;
  bright: WebGLProgram;
  down: WebGLProgram;
  up: WebGLProgram;
  composite: WebGLProgram;
}

export class CinemaRenderer {
  private programs: Programs | null = null;
  private quadVao: WebGLVertexArrayObject | null = null;
  private coinVao: WebGLVertexArrayObject | null = null;
  private lineVao: WebGLVertexArrayObject | null = null;
  private emptyVao: WebGLVertexArrayObject | null = null;
  private buffers: WebGLBuffer[] = [];
  private scene: Target | null = null;
  private bloom: Target[] = [];
  private bloomMode: CinemaScene['bloom'] | null = null;
  private black: WebGLTexture | null = null;
  private atlas: WebGLTexture | null = null;
  private readonly format: { internal: number; type: number; hdr: boolean };

  static create(canvas: SkyCanvas): CinemaRenderer | null {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    if (!gl) return null;
    const r = new CinemaRenderer(canvas, gl);
    r.init();
    return r;
  }

  private constructor(
    private readonly canvas: SkyCanvas,
    private readonly gl: WebGL2RenderingContext,
  ) {
    this.format = targetFormat(gl);
  }

  get lost(): boolean {
    return this.gl.isContextLost();
  }

  private init(): void {
    const gl = this.gl;
    this.programs = {
      background: link(gl, FULLSCREEN_VERT, BACKGROUND_FRAG),
      quad: link(gl, QUAD_VERT, QUAD_FRAG),
      line: link(gl, LINE_VERT, LINE_FRAG),
      coin: link(gl, COIN_VERT, COIN_FRAG),
      bright: link(gl, FULLSCREEN_VERT, BRIGHT_FRAG),
      down: link(gl, FULLSCREEN_VERT, DOWN_FRAG),
      up: link(gl, FULLSCREEN_VERT, UP_FRAG),
      composite: link(gl, FULLSCREEN_VERT, COMPOSITE_FRAG),
    };
    const corners = gl.createBuffer()!;
    const quads = gl.createBuffer()!;
    const coins = gl.createBuffer()!;
    const lines = gl.createBuffer()!;
    this.buffers = [corners, quads, coins, lines];
    const cornerData = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, cornerData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, quads);
    for (const [loc, size, offset] of [[1, 2, 0], [2, 2, 2], [3, 1, 4], [4, 4, 5], [5, 1, 9]] as const) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, QUAD_FLOATS * 4, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
    }

    this.coinVao = gl.createVertexArray();
    gl.bindVertexArray(this.coinVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, coins);
    for (const [loc, size, offset] of [[1, 2, 0], [2, 1, 2], [3, 1, 3], [4, 4, 4]] as const) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, COIN_FLOATS * 4, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
    }

    this.lineVao = gl.createVertexArray();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, lines);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, LINE_FLOATS * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, LINE_FLOATS * 4, 8);

    this.emptyVao = gl.createVertexArray();
    gl.bindVertexArray(null);

    this.black = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.black);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.disable(gl.DEPTH_TEST);
  }

  setAtlas(source: TexImageSource | null): void {
    const gl = this.gl;
    if (this.atlas) gl.deleteTexture(this.atlas);
    this.atlas = null;
    if (!source) return;
    this.atlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  resize(width: number, height: number): void {
    if (this.canvas.width === width && this.canvas.height === height && this.scene) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.releaseTargets();
    this.scene = createTarget(this.gl, width, height, this.format);
  }

  private releaseTargets(): void {
    if (this.scene) deleteTarget(this.gl, this.scene);
    for (const t of this.bloom) deleteTarget(this.gl, t);
    this.scene = null;
    this.bloom = [];
    this.bloomMode = null;
  }

  private ensureBloom(mode: CinemaScene['bloom']): void {
    if (this.bloomMode === mode || mode === 'off') return;
    for (const t of this.bloom) deleteTarget(this.gl, t);
    this.bloom = [];
    let w = Math.max(1, Math.floor(this.canvas.width / (mode === 'full' ? 2 : 4)));
    let h = Math.max(1, Math.floor(this.canvas.height / (mode === 'full' ? 2 : 4)));
    for (let i = 0; i < BLOOM_LEVELS && w >= 2 && h >= 2; i++) {
      this.bloom.push(createTarget(this.gl, w, h, this.format));
      w = Math.floor(w / 2);
      h = Math.floor(h / 2);
    }
    this.bloomMode = mode;
  }

  private fullscreen(program: WebGLProgram, target: Target | null, setup: (u: (name: string) => WebGLUniformLocation | null) => void): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.width : this.canvas.width, target ? target.height : this.canvas.height);
    gl.useProgram(program);
    setup((name) => gl.getUniformLocation(program, name));
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private bindTexture(unit: number, tex: WebGLTexture | null): void {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
  }

  render(scene: CinemaScene): void {
    const gl = this.gl;
    const p = this.programs;
    if (!p || gl.isContextLost()) return;
    this.resize(scene.width, scene.height);
    const target = this.scene!;
    const { width, height } = scene;

    gl.disable(gl.BLEND);
    this.fullscreen(p.background, target, (u) => {
      gl.uniform2f(u('u_offset'), scene.nebula?.offset[0] ?? 0, scene.nebula?.offset[1] ?? 0);
      gl.uniform1f(u('u_intensity'), scene.nebula?.intensity ?? 0);
      gl.uniform1f(u('u_seed'), scene.nebula?.seed ?? 0);
      gl.uniform2f(u('u_aspect'), width / height, 1);
    });

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(p.line);
    gl.uniform2f(gl.getUniformLocation(p.line, 'u_resolution'), width, height);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[3]!);
    gl.bufferData(gl.ARRAY_BUFFER, scene.lines, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, scene.lines.length / LINE_FLOATS);

    gl.useProgram(p.quad);
    gl.uniform2f(gl.getUniformLocation(p.quad, 'u_resolution'), width, height);
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[1]!);
    gl.bufferData(gl.ARRAY_BUFFER, scene.quads, gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, scene.quads.length / QUAD_FLOATS);

    if (this.atlas && scene.coins.length > 0) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(p.coin);
      gl.uniform2f(gl.getUniformLocation(p.coin, 'u_resolution'), width, height);
      this.bindTexture(0, this.atlas);
      gl.uniform1i(gl.getUniformLocation(p.coin, 'u_atlas'), 0);
      gl.bindVertexArray(this.coinVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[2]!);
      gl.bufferData(gl.ARRAY_BUFFER, scene.coins, gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, scene.coins.length / COIN_FLOATS);
    }

    let bloomTex: WebGLTexture | null = this.black;
    if (scene.bloom !== 'off') {
      this.ensureBloom(scene.bloom);
      if (this.bloom.length > 0) {
        gl.disable(gl.BLEND);
        this.bindTexture(0, target.tex);
        this.fullscreen(p.bright, this.bloom[0]!, (u) => {
          gl.uniform1i(u('u_src'), 0);
          gl.uniform1f(u('u_threshold'), this.format.hdr ? BLOOM_THRESHOLD : 0.55);
        });
        for (let i = 1; i < this.bloom.length; i++) {
          const src = this.bloom[i - 1]!;
          this.bindTexture(0, src.tex);
          this.fullscreen(p.down, this.bloom[i]!, (u) => {
            gl.uniform1i(u('u_src'), 0);
            gl.uniform2f(u('u_texel'), 1 / src.width, 1 / src.height);
          });
        }
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        for (let i = this.bloom.length - 1; i > 0; i--) {
          const src = this.bloom[i]!;
          this.bindTexture(0, src.tex);
          this.fullscreen(p.up, this.bloom[i - 1]!, (u) => {
            gl.uniform1i(u('u_src'), 0);
            gl.uniform2f(u('u_texel'), 1 / src.width, 1 / src.height);
          });
        }
        bloomTex = this.bloom[0]!.tex;
      }
    }

    gl.disable(gl.BLEND);
    this.bindTexture(0, target.tex);
    this.bindTexture(1, bloomTex);
    this.fullscreen(p.composite, null, (u) => {
      gl.uniform1i(u('u_scene'), 0);
      gl.uniform1i(u('u_bloom'), 1);
      gl.uniform1f(u('u_bloomStrength'), scene.bloom === 'off' ? 0 : BLOOM_STRENGTH);
      gl.uniform1f(u('u_exposure'), scene.exposure);
      gl.uniform1f(u('u_frame'), scene.frame);
      gl.uniform2f(u('u_resolution'), width, height);
      gl.uniform4f(u('u_shock'), scene.shock?.x ?? 0.5, scene.shock?.y ?? 0.5, scene.shock?.progress ?? 0, scene.shock?.strength ?? 0);
    });
    gl.bindVertexArray(null);
  }

  destroy(): void {
    const gl = this.gl;
    this.releaseTargets();
    for (const b of this.buffers) gl.deleteBuffer(b);
    for (const vao of [this.quadVao, this.coinVao, this.lineVao, this.emptyVao]) if (vao) gl.deleteVertexArray(vao);
    if (this.programs) for (const program of Object.values(this.programs)) gl.deleteProgram(program);
    if (this.black) gl.deleteTexture(this.black);
    if (this.atlas) gl.deleteTexture(this.atlas);
  }
}
```

Run the site suite and the typecheck. The GL code has no unit test beyond `targetFormat`; Task 6's browser checks verify it.

- [ ] **Step 5: Commit**

```bash
git add site/src/replay/cinema/shaders.ts site/src/replay/cinema/gl.ts site/src/replay/cinema/renderer.ts site/src/sky/renderer-gl.ts site/test/cinema-gl.test.ts
git commit -m "feat(site): WebGL2 cinema renderer: nebula, instanced effects, coins, HDR bloom and tone-mapped composite"
```

---
## Task 6: Cinema compositor, player and recorder wiring, adaptive quality, reduced motion

**Files:**
- Create: `site/src/replay/cinema/compositor.ts`
- Modify:
  - `site/src/replay/director/show.ts` (`reducedMotion` input);
  - `site/src/replay/story/draw.ts` (end-title timing);
  - `site/src/replay/player.tsx` (choose the compositor, track frame times, handle context loss, record at High).
- Test: `site/test/cinema-compositor.test.ts`, `site/test/director-show.test.ts`, `site/test/story-draw.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 5; Plan A's `Show`, `ReplayCompositor`, `drawStory`, `layoutFor` and `CompositorAssets`.
- Produces:
  - `ShowInput.reducedMotion?: boolean`. When true, `frame.punch` is 0 and the camera ignores slams.
  - `interface CinemaOptions { quality: 'auto' | 'high'; reducedMotion: boolean; createRenderer?: (canvas: SkyCanvas) => RendererLike | null }`, where `RendererLike = Pick<CinemaRenderer, 'render' | 'resize' | 'setAtlas' | 'destroy' | 'lost'>`.
  - `class CinemaCompositor`:
    - `constructor(show, stars, assets, createCanvas, opts: CinemaOptions)`, which throws if no renderer can be created;
    - `static isSupported(createCanvas: () => SkyCanvas): boolean`;
    - `setCoinImages(images)`;
    - `draw(t, target, width, height): ShowFrame`;
    - `noteFrame(ms: number, nowS: number): void`;
    - the getters `lost` and `tier`;
    - `destroy()`.
  - In `drawStory`, the end title fades in over finale progress 0.6 to 0.8. It was 0.3 to 0.7; this leaves room for the particles.

- [ ] **Step 1: Write the failing tests**

In `site/test/director-show.test.ts`, add:

```ts
  it('skips the milestone punch-in under reduced motion', () => {
    const s = new Show({ replay, history, stars, length: 30, focus: null, eligible: () => true, reducedMotion: true });
    for (const t of [3, 10, 20, 26]) expect(s.frameAt(t).punch).toBe(0);
  });
```

In `site/test/story-draw.test.ts`, add:

```ts
  it('fades the end title in late in the finale, after the particles', () => {
    const early: string[] = [];
    drawStory(fakeCtx(early), show.frameAt(27 + 3 * 0.55), layoutFor(1920, 1080), assets);
    expect(early).not.toContain('ccip.dev');
    const late: string[] = [];
    drawStory(fakeCtx(late), show.frameAt(27 + 3 * 0.9), layoutFor(1920, 1080), assets);
    expect(late).toContain('ccip.dev');
  });
```

`site/test/cinema-compositor.test.ts`:

```ts
import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it, vi } from 'vitest';
import { CinemaCompositor } from '../src/replay/cinema/compositor';
import { Show } from '../src/replay/director/show';
import { buildLayout } from '../src/sky/layout';
import replayJson from './fixtures/replay.json';

const replay = replayJson as ReplayFile;
const history = replay.days.map((d) => ({ day: d.day, messages: 10, token_messages: 10, usd_value: 1000, fee_usd: null, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null })) as DayTotals[];
const stars = buildLayout(replay.chains);
const show = new Show({ replay, history, stars, length: 30, focus: null, eligible: () => true });
const assets = { names: new Map<string, string>(), ticks: [] };

function fake2d(calls: unknown[][]) {
  return new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'drawImage') return (...args: unknown[]) => calls.push(args);
        if (key === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
        if (key === 'measureText') return () => ({ width: 10 });
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
        return () => {};
      },
      set: () => true,
    },
  );
}
const createCanvas = (calls: unknown[][] = []) => () => ({ width: 1, height: 1, getContext: (kind: string) => (kind === '2d' ? fake2d(calls) : null) }) as never;
const fakeRenderer = (lost = false) => ({ render: vi.fn(), resize: vi.fn(), setAtlas: vi.fn(), destroy: vi.fn(), lost });

describe('CinemaCompositor', () => {
  it('renders the GL scene, then draws it and the story layer onto the target', () => {
    const renderer = fakeRenderer();
    const calls: unknown[][] = [];
    const c = new CinemaCompositor(show, stars, assets, createCanvas(), { quality: 'auto', reducedMotion: false, createRenderer: () => renderer as never });
    const frame = c.draw(15, fake2d(calls) as never, 640, 360);
    expect(frame.t).toBe(15);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('steps quality down on slow frames when auto, and stays High when recording', () => {
    const auto = new CinemaCompositor(show, stars, assets, createCanvas(), { quality: 'auto', reducedMotion: false, createRenderer: () => fakeRenderer() as never });
    for (let t = 0; t < 2.1; t += 1 / 60) auto.noteFrame(40, t);
    expect(auto.tier).toBe('medium');
    const rec = new CinemaCompositor(show, stars, assets, createCanvas(), { quality: 'high', reducedMotion: false, createRenderer: () => fakeRenderer() as never });
    for (let t = 0; t < 6; t += 1 / 60) rec.noteFrame(80, t);
    expect(rec.tier).toBe('high');
  });

  it('packs coin images into one atlas and uploads it', () => {
    const renderer = fakeRenderer();
    const calls: unknown[][] = [];
    const c = new CinemaCompositor(show, stars, assets, createCanvas(calls), { quality: 'auto', reducedMotion: false, createRenderer: () => renderer as never });
    c.setCoinImages(new Map([['a', {} as CanvasImageSource], ['b', {} as CanvasImageSource]]));
    expect(renderer.setAtlas).toHaveBeenCalledTimes(1);
    expect(calls.filter((args) => args.length === 5)).toHaveLength(2);
  });

  it('reports a lost context and throws when no renderer can be made', () => {
    const c = new CinemaCompositor(show, stars, assets, createCanvas(), { quality: 'auto', reducedMotion: false, createRenderer: () => fakeRenderer(true) as never });
    expect(c.lost).toBe(true);
    expect(() => new CinemaCompositor(show, stars, assets, createCanvas(), { quality: 'auto', reducedMotion: false, createRenderer: () => null })).toThrow();
  });
});
```

Run: `pnpm --filter @ccip-dev/site exec vitest run test/cinema-compositor.test.ts test/director-show.test.ts test/story-draw.test.ts`
Expected: FAIL. The module is missing, `reducedMotion` is unknown, and the end title appears too early.

- [ ] **Step 2: Implement**

In `site/src/replay/director/show.ts`:
- add `reducedMotion?: boolean` to `ShowInput`;
- store it as `private readonly reducedMotion: boolean`;
- in `frameAt`, use `const slamStarts = this.reducedMotion ? [] : this.slams.map((s) => s.start);` for both `cameraAt({ … slamStarts })` and `punch: Math.max(0, ...slamStarts.map((s) => punch(time - s)))`.

In `site/src/replay/story/draw.ts`, in `drawEndTitle`, change `ease((frame.finale - 0.3) / 0.4)` to `ease((frame.finale - 0.6) / 0.2)`.

`site/src/replay/cinema/compositor.ts`:

```ts
import type { SkyCanvas } from '../../sky/renderer';
import type { StarPoint } from '../../sky/layout';
import type { CompositorAssets } from '../compose';
import type { Show, ShowFrame } from '../director/show';
import { drawStory } from '../story/draw';
import { layoutFor } from '../story/layout';
import { atlasLayout } from './atlas';
import { textTargets } from './fx';
import { QualityController, TIERS, type Tier } from './quality';
import { CinemaRenderer } from './renderer';
import { buildScene, dustField, type DustField } from './scene';

type Ctx2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type ShowSource = Pick<Show, 'frameAt' | 'timing' | 'length' | 'warp'>;
export type RendererLike = Pick<CinemaRenderer, 'render' | 'resize' | 'setAtlas' | 'destroy' | 'lost'>;

export interface CinemaOptions {
  quality: 'auto' | 'high';
  reducedMotion: boolean;
  createRenderer?: (canvas: SkyCanvas) => RendererLike | null;
}

const ATLAS_CELL = 128;
const TITLE_W = 800;
const TITLE_H = 200;
const MAX_TITLE_PARTICLES = 700;
const SEED = 5;

function rasterTitle(createCanvas: () => SkyCanvas): { x: number; y: number }[] {
  const canvas = createCanvas();
  canvas.width = TITLE_W;
  canvas.height = TITLE_H;
  const ctx = canvas.getContext('2d') as Ctx2d | null;
  if (!ctx) return [];
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 150px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ccip.dev', TITLE_W / 2, TITLE_H / 2);
  const points = textTargets(ctx.getImageData(0, 0, TITLE_W, TITLE_H), 6);
  const step = Math.max(1, Math.ceil(points.length / MAX_TITLE_PARTICLES));
  return points.filter((_, i) => i % step === 0);
}

export class CinemaCompositor {
  private readonly glCanvas: SkyCanvas;
  private readonly renderer: RendererLike;
  private readonly quality: QualityController;
  private readonly dust: DustField;
  private readonly fullExtent: number;
  private readonly titleTargets: { x: number; y: number }[];
  private atlas = new Map<string, readonly [number, number, number, number]>();
  private coinImages: ReadonlyMap<string, CanvasImageSource> = new Map();
  private loopCache: { width: number; height: number; canvas: SkyCanvas } | null = null;
  private destroyed = false;

  static isSupported(createCanvas: () => SkyCanvas): boolean {
    try {
      return createCanvas().getContext('webgl2') !== null;
    } catch {
      return false;
    }
  }

  constructor(
    private readonly show: ShowSource,
    stars: readonly StarPoint[],
    private readonly assets: CompositorAssets,
    private readonly createCanvas: () => SkyCanvas,
    private readonly opts: CinemaOptions,
  ) {
    this.glCanvas = createCanvas();
    const renderer = (opts.createRenderer ?? ((c: SkyCanvas) => CinemaRenderer.create(c)))(this.glCanvas);
    if (!renderer) throw new Error('cinema: WebGL2 is unavailable');
    this.renderer = renderer;
    this.quality = new QualityController({ locked: opts.quality === 'high' });
    this.fullExtent = Math.max(1e-6, ...stars.map((s) => Math.hypot(s.x, s.y)));
    this.dust = dustField(17, this.fullExtent);
    this.titleTargets = rasterTitle(createCanvas);
  }

  get lost(): boolean {
    return this.renderer.lost;
  }

  get tier(): Tier {
    return this.quality.tier;
  }

  noteFrame(ms: number, nowS: number): void {
    this.quality.sample(ms, nowS);
  }

  setCoinImages(images: ReadonlyMap<string, CanvasImageSource>): void {
    this.coinImages = images;
    const entries = [...images];
    this.atlas = new Map();
    if (entries.length === 0) {
      this.renderer.setAtlas(null);
      return;
    }
    const layout = atlasLayout(entries.length, ATLAS_CELL);
    const canvas = this.createCanvas();
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d') as Ctx2d | null;
    if (!ctx) return;
    entries.forEach(([selector, image], i) => {
      const uv = layout.uv(i);
      ctx.drawImage(image, uv[0] * layout.width, uv[1] * layout.height, ATLAS_CELL, ATLAS_CELL);
      this.atlas.set(selector, uv);
    });
    this.renderer.setAtlas(canvas as unknown as TexImageSource);
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
    const scene = buildScene(frame, {
      width,
      height,
      tier: TIERS[this.quality.tier],
      dust: this.dust,
      fullExtent: this.fullExtent,
      atlas: this.atlas,
      titleTargets: this.titleTargets,
      reducedMotion: this.opts.reducedMotion,
      seed: SEED,
      finaleSeconds: this.show.timing.finale,
    });
    this.renderer.render(scene);
    target.drawImage(this.glCanvas, 0, 0);
    drawStory(target, frame, layoutFor(width, height), { names: this.assets.names, coins: this.coinImages, ticks: this.assets.ticks });
  }

  destroy(): void {
    this.destroyed = true;
    this.renderer.destroy();
  }
}
```

If `CompositorAssets` isn't exported from `compose.ts`, export it there; Plan A Task 7 defines it.

Run: `pnpm --filter @ccip-dev/site exec vitest run test/cinema-compositor.test.ts test/director-show.test.ts test/story-draw.test.ts`
Expected: PASS.

- [ ] **Step 3: Wire the player and recorder**

In `site/src/replay/player.tsx`, as Plan A Task 9 left it:

1. Pass `reducedMotion` into the `Show` input: `new Show({ …, reducedMotion })`, and add it to the memo deps.

2. Track the compositor kind and losses:

```tsx
  const [classic, setClassic] = useState(false);
  const [compositorKey, setCompositorKey] = useState(0);
  const lossesRef = useRef(0);
```

3. In the compositor effect, build a cinema compositor when possible:

```tsx
    const makeCanvas = () => document.createElement('canvas');
    let created: ReplayCompositor | CinemaCompositor;
    try {
      created =
        !classic && CinemaCompositor.isSupported(makeCanvas)
          ? new CinemaCompositor(show, stars, assets, makeCanvas, { quality: 'auto', reducedMotion })
          : new ReplayCompositor(show, stars, assets, makeCanvas);
    } catch (err) {
      console.warn('cinema compositor failed; using the classic renderer', err);
      try {
        created = new ReplayCompositor(show, stars, assets, makeCanvas);
      } catch (inner) {
        console.warn('Replay compositor failed to start', inner);
        setError('Your browser could not start the animation.');
        return;
      }
    }
```

   Add `classic` and `compositorKey` to the effect deps, and widen the compositor state type to `ReplayCompositor | CinemaCompositor | null`. Both share `draw`, `setCoinImages` and `destroy`.

4. In `drawFrame`, before drawing:

```tsx
    if (compositor instanceof CinemaCompositor && compositor.lost) {
      lossesRef.current += 1;
      if (lossesRef.current >= 2) setClassic(true);
      else setCompositorKey((k) => k + 1);
      return;
    }
```

5. In the playback `tick`, report frame intervals:

```tsx
      if (lastFrameRef.current !== null && compositor instanceof CinemaCompositor) compositor.noteFrame(frameTime - lastFrameRef.current, frameTime / 1000);
      lastFrameRef.current = frameTime;
```

   Add `const lastFrameRef = useRef<number | null>(null);` and reset it to `null` whenever playback starts.

6. In `record()`, build the recording compositor at High quality:

```tsx
      const offscreen = () => new OffscreenCanvas(1, 1);
      recorder =
        CinemaCompositor.isSupported(offscreen)
          ? new CinemaCompositor(show, stars, assets, offscreen, { quality: 'high', reducedMotion: false })
          : new ReplayCompositor(show, stars, assets, offscreen);
```

   Recordings always include full motion. Reduced motion is a viewing preference, and the exported video is for others. Widen `recorder`'s type the same way.

- [ ] **Step 4: Build, look, measure**

1. Run the site suite, the typecheck and the build. Quote the replay budget line; it must stay ≤ 200 KB gzipped.
2. On the preview at port 4321 (chrome-devtools; reuse the server), open `/replay/`, play, and screenshot at about 1, 5, 12, 20, 27.7 and 29 s. Save the shots as `cinema-*.png` in the SDD workspace and look at each one.
   - **Background:** the nebula glow and dust stars.
   - **Comets:** streaks, not blobs, with sparks where they land.
   - **Joins:** supernova rings.
   - **Coins:** they bounce in.
   - **Dense years:** they glow without blowing out to white.
   - **27.7 s:** "ccip.dev" particles assembling.
   - **29 s:** the end title.
3. **Frame rate:** during 5 s of play, measure the rAF frame intervals with `evaluate_script`, collecting `performance.now()` deltas in a rAF loop. Report the median. At High on this M-series machine, the expectation is ≥ 50 fps.
4. **Recording:** record a 30 s 1:1 MP4. Extract frames at 2.5, 12, 20 and 28 s with ffmpeg and look at them.
5. **Fallback:** confirm the classic renderer still works by forcing it. In the browser, set `HTMLCanvasElement.prototype.getContext` to return `null` for `'webgl2'` via an init script on `navigate_page`, reload, and play. The classic sky plus story layer should render with no errors.

- [ ] **Step 5: Commit**

```bash
git add site/src/replay/cinema/compositor.ts site/src/replay/director/show.ts site/src/replay/story/draw.ts site/src/replay/player.tsx site/test/cinema-compositor.test.ts site/test/director-show.test.ts site/test/story-draw.test.ts
git commit -m "feat(site): replay renders through the cinema compositor with adaptive quality, context-loss fallback and High-quality recordings"
```

---

## After the last task (controller)

1. **Full checks.** Run `pnpm test && pnpm typecheck` and the site build. The budgets must hold.
2. **Recordings.** Record 16:9, 1:1 and 9:16 MP4s plus a Base focus cut. Extract frames at 0.5, 2.5, 10, 20, 27.7 and 29.9 s and look at every one. Check:
   - no blown-out white in 2025–26;
   - comets read as streaks;
   - the supernovas and coin pops are visible;
   - the title particles assemble cleanly;
   - frame 0 and frame 29.9 match for the loop.
3. **Performance.** Take a chrome-devtools performance trace during play. Note the median frame time and confirm the tier stays High on this Mac.
4. **Status.** Update `IMPLEMENTATION_PLAN.md` Stage 10 with "Plan B complete".
5. **Release.** After the final whole-branch review is clean, push.
