import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { cometCount, daySpawns, mulberry32, REPLAY_COMET_S, ReplayModel } from '../src/replay/timeline';
import { durationWarp } from '../src/replay/director/warp';
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
const model = () => new ReplayModel(replay, history, stars, 60);

describe('replay helpers', () => {
  it.each([[0, 0], [1, 1], [2, 2], [31, 20], [5000, 49]])('%s messages spawn %s comets', (messages, comets) => {
    expect(cometCount(messages)).toBe(comets);
  });

  it('draws the same seeded sequence every time', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(first.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('spawns comets on the day’s lanes in proportion, sorted by time, deterministically', () => {
    const lanes = [[0, 31, 1000], [1, 4, 500]] as [number, number, number][];
    const spawns = daySpawns(lanes, 1);
    expect(spawns).toHaveLength(cometCount(35));
    expect(spawns).toEqual(daySpawns(lanes, 1));
    expect(spawns.every((s) => s.lane === 0 || s.lane === 1)).toBe(true);
    expect(spawns.map((s) => s.offset)).toEqual([...spawns.map((s) => s.offset)].sort((x, y) => x - y));
    expect(spawns.find((s) => s.lane === 0)?.usd).toBeCloseTo(1000 / 31);
  });
});

describe('ReplayModel', () => {
  it('spreads the calendar days evenly over the run', () => {
    const m = model();
    expect(m.days).toEqual(['2023-07-06', '2023-07-07', '2023-07-08', '2023-07-09']);
    expect(m.warp.dayLength(0)).toBe(15);
    expect(m.duration).toBe(60);
  });

  it('ignites chains on their first day and counts the running totals', () => {
    const m = model();
    const start = m.frameAt(0);
    expect(start.day).toBe('2023-07-06');
    expect(start.sky.stars.map((s) => s.radius > 0)).toEqual([true, true, false, false]);
    expect(start.sky.stars[0]!.flash).toBe(1);
    expect(start.sky.rings.map((r) => r.star)).toEqual([0, 1]);
    expect(start.activeChains).toBe(2);

    const base = m.frameAt(30);
    expect(base.day).toBe('2023-07-08');
    expect(base.activeChains).toBe(3);
    expect(base.cumulativeMessages).toBe(52);
  });

  it('shows the end card after the last day', () => {
    const end = model().frameAt(60.5);
    expect(end).toMatchObject({ endCard: true, day: '2023-07-09', activeChains: 4, cumulativeMessages: 60 });
  });

  it('renders the same frame for the same time', () => {
    expect(model().frameAt(20)).toEqual(model().frameAt(20));
  });

  it('renders the same frames whatever order they are asked for in', () => {
    const used = model();
    used.frameAt(50);
    used.frameAt(5);
    expect(used.frameAt(20)).toEqual(model().frameAt(20));
    expect(used.frameAt(40)).toEqual(model().frameAt(40));
  });

  it('grows the camera extent smoothly as a chain ignites', () => {
    const m = model();
    const [before, mid, after] = [30, 30.5, 31].map((t) => m.frameAt(t).extent);
    const baseStar = stars.find((s) => s.selector === replay.chains.find((c) => c.first_day === '2023-07-08')!.selector)!;
    expect(mid!).toBeGreaterThan(before!);
    expect(after!).toBeGreaterThanOrEqual(mid!);
    expect(after!).toBeCloseTo(Math.max(before!, Math.hypot(baseStar.x, baseStar.y)));
    expect(m.frameAt(29.999).extent).toBeCloseTo(before!, 3);
  });

  it('keeps every comet on a known lane and inside its flight', () => {
    const m = model();
    const first = daySpawns(replay.days[1]!.lanes, 1)[0]!;
    const frame = m.frameAt(m.dayStart(1) + first.offset * m.warp.dayLength(0) + 0.1);
    expect(frame.sky.comets.length).toBeGreaterThan(0);
    for (const c of frame.sky.comets) {
      expect(c.progress).toBeGreaterThanOrEqual(0);
      expect(c.progress).toBeLessThan(1);
      expect(frame.sky.stars[c.from]!.radius).toBeGreaterThan(0);
    }
    expect(REPLAY_COMET_S).toBe(0.8);
  });
});

const POLYGON = '4051577828743386545';
const ETHEREUM = '5009297550715157269';
const coinModel = (eligible: (selector: string) => boolean = () => true) => new ReplayModel(replay, history, stars, 60, { count: 1, eligible });
const coinsAt = (m: ReplayModel, t: number) => m.frameAt(t).coins.map((c) => [c.selector, Number(c.alpha.toFixed(3))]).sort();

describe('replay coins', () => {
  it('shows no coin while no chain has value', () => {
    expect(coinModel().frameAt(0).coins).toEqual([]);
    expect(coinModel().frameAt(14).coins).toEqual([]);
  });

  it('fades the day’s top chain in over half a second', () => {
    const m = coinModel();
    expect(coinsAt(m, m.dayStart(1) + 0.25)).toEqual([[POLYGON, 0.5]]);
    expect(coinsAt(m, m.dayStart(1) + 0.6)).toEqual([[POLYGON, 1]]);
  });

  it('cross-fades when the top chain changes', () => {
    const m = coinModel();
    expect(coinsAt(m, m.dayStart(2) + 0.25)).toEqual([[POLYGON, 0.5], [ETHEREUM, 0.5]].sort());
    expect(coinsAt(m, m.dayStart(2) + 0.6)).toEqual([[ETHEREUM, 1]]);
  });

  it('only gives coins to eligible chains', () => {
    const m = coinModel((s) => s !== POLYGON);
    expect(coinsAt(m, m.dayStart(1) + 0.6)).toEqual([[ETHEREUM, 1]]);
  });

  it('is a pure function of t and holds through the end card', () => {
    const m = coinModel();
    expect(m.frameAt(31.3).coins).toEqual(m.frameAt(31.3).coins);
    expect(coinsAt(m, m.duration)).toEqual([[ETHEREUM, 1]]);
  });

  it('fades a chain that flickers at the cutoff instead of strobing it', () => {
    const flicker: ReplayFile = {
      ...replay,
      since: '2024-01-01',
      chains: [
        { selector: 'A', name: 'a-mainnet', display_name: 'A', first_day: '2024-01-01' },
        { selector: 'B', name: 'b-mainnet', display_name: 'B', first_day: '2024-01-01' },
      ],
      lanes: [[0, 0], [1, 1]],
      days: [
        { day: '2024-01-01', lanes: [[0, 1, 50]] },
        { day: '2024-01-02', lanes: [[1, 1, 75]] },
        { day: '2024-01-03', lanes: [[0, 1, 50]] },
        { day: '2024-01-04', lanes: [[1, 1, 50]] },
      ],
    };
    const m = new ReplayModel(flicker, [], buildLayout(flicker.chains), 1, { count: 1, eligible: () => true });
    expect(coinsAt(m, 0.75)).toEqual([['A', 0.5], ['B', 0.5]]);
  });
});

describe('replay coins on the last day', () => {
  const surge: ReplayFile = {
    ...replay,
    since: '2024-01-01',
    chains: [
      { selector: 'A', name: 'a-mainnet', display_name: 'A', first_day: '2024-01-01' },
      { selector: 'B', name: 'b-mainnet', display_name: 'B', first_day: '2024-01-01' },
    ],
    lanes: [[0, 0], [1, 1]],
    days: [
      { day: '2024-01-01', lanes: [[0, 1, 50]] },
      { day: '2024-01-02', lanes: [[0, 1, 50]] },
      { day: '2024-01-03', lanes: [[0, 1, 50]] },
      { day: '2024-01-04', lanes: [[1, 1, 500]] },
    ],
  };
  const surgeModel = () => new ReplayModel(surge, [], buildLayout(surge.chains), 1, { count: 1, eligible: () => true });

  it('settles a chain that enters the set on the final day during the end card', () => {
    const m = surgeModel();
    expect(coinsAt(m, m.length + 0.5)).toEqual([['B', 1]]);
  });

  it('lists every chain that wears a coin on any day, in star order', () => {
    expect(surgeModel().coinSelectorsEver()).toEqual(['A', 'B']);
    expect(coinModel().coinSelectorsEver().sort()).toEqual([ETHEREUM, POLYGON].sort());
  });
});

describe('replay coin window', () => {
  const longReplay: ReplayFile = {
    ...replay,
    since: '2024-01-01',
    chains: [
      { selector: 'A', name: 'a-mainnet', display_name: 'A', first_day: '2024-01-01' },
      { selector: 'B', name: 'b-mainnet', display_name: 'B', first_day: '2024-01-01' },
    ],
    lanes: [[0, 0], [1, 1]],
    days: Array.from({ length: 40 }, (_, i) => ({
      day: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
      lanes: i === 0 ? [[0, 1, 1000]] : [[1, 1, 1]],
    })),
  };
  const longModel = () => new ReplayModel(longReplay, [], buildLayout(longReplay.chains), 40, { count: 1, eligible: () => true });

  it('keeps a chain for 30 days then evicts it', () => {
    const m = longModel();
    expect(coinsAt(m, m.dayStart(29) + 0.9)).toEqual([['A', 1]]);
    expect(coinsAt(m, m.dayStart(30) + 0.9)).toEqual([['B', 1]]);
  });

  it('puts full-alpha coins on the largest star', () => {
    const m = longModel();
    for (const t of [1.2, 5.7, 12.3, 20.5, 29.9, 30.9, 33.4, 39.9]) {
      const frame = m.frameAt(t);
      const max = Math.max(...frame.sky.stars.map((s) => s.radius));
      for (const coin of frame.coins.filter((c) => c.alpha === 1)) expect(frame.sky.stars[coin.star]!.radius).toBe(max);
    }
  });
});

describe('ReplayModel with a warp', () => {
  const warp = durationWarp([1, 10, 1, 1], 2);
  const warped = () => new ReplayModel(replay, history, stars, 60, { count: 1, eligible: () => true }, warp);

  it('maps time to days through the warp', () => {
    expect(warped().frameAt(2.5).dayIndex).toBe(0);
    expect(warped().frameAt(3.5).dayIndex).toBe(1);
    expect(warped().frameAt(12.9).dayIndex).toBe(1);
    expect(warped().frameAt(13.5).dayIndex).toBe(2);
  });

  it('spreads a long day\u2019s comets across its whole length', () => {
    const m = warped();
    const frames = [9, 11, 12.5].map((t) => m.frameAt(t));
    expect(frames.reduce((n, f) => n + f.sky.comets.length, 0)).toBeGreaterThan(0);
    for (const comet of frames.flatMap((f) => f.sky.comets)) {
      expect(comet.progress).toBeGreaterThanOrEqual(0);
      expect(comet.progress).toBeLessThan(1);
    }
  });

  it('clamps time before the warp start so ignition effects stay in range', () => {
    const frame = warped().frameAt(0);
    expect(frame.sky.rings.every((ring) => ring.progress >= 0)).toBe(true);
    expect(frame.sky.stars.every((star) => star.flash <= 1)).toBe(true);
  });

  it('starts the day clock at the warp start', () => {
    expect(warped().frameAt(0).sky.comets).toEqual([]);
    expect(warped().warp).toBe(warp);
  });
});

describe('arrivals', () => {
  it('reports comets that finished within the last 0.4 s, with their age', () => {
    const m = model();
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
    expect(model().frameAt(0).arrivals).toEqual([]);
  });
});

describe('comet density on busy days', () => {
  const days = Array.from({ length: 1000 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10));
  const busy = {
    ...replay,
    since: days[0]!,
    chains: [
      { selector: 'a', name: 'alpha-mainnet', display_name: 'Alpha', first_day: days[0]! },
      { selector: 'b', name: 'beta-mainnet', display_name: 'Beta', first_day: days[0]! },
      { selector: 'c', name: 'gamma-mainnet', display_name: 'Gamma', first_day: days[0]! },
    ],
    lanes: [[0, 1], [1, 2], [2, 0]],
    days: days.map((day) => ({ day, lanes: [[0, 3000, 1e6], [1, 1500, 1e5], [2, 500, 1e4]] })),
  } as ReplayFile;
  const busyModel = () => new ReplayModel(busy, [], buildLayout(busy.chains), 30);
  const frameStep = 1 / 30;

  it('keeps comets spread along their whole flight instead of only the newest launches', () => {
    const progress = busyModel().frameAt(20).sky.comets.map((c) => c.progress).sort((a, b) => a - b);
    expect(progress.length).toBeGreaterThan(150);
    expect(progress[Math.floor(progress.length * 0.9)]).toBeGreaterThan(0.7);
  });

  it('keeps a drawn comet on the next frame unless it landed', () => {
    const m = busyModel();
    for (const t of [10, 20]) {
      const next = m.frameAt(t + frameStep).sky.comets;
      const flying = m.frameAt(t).sky.comets.filter((c) => c.progress + frameStep / REPLAY_COMET_S < 1);
      expect(flying.length).toBeGreaterThan(0);
      for (const c of flying) {
        expect(next.some((n) => n.from === c.from && n.to === c.to && Math.abs(n.progress - (c.progress + frameStep / REPLAY_COMET_S)) < 1e-9)).toBe(true);
      }
    }
  });

  it('lands only comets it drew', () => {
    const m = busyModel();
    for (const t of [10, 20]) {
      const arrivals = m.frameAt(t).arrivals;
      expect(arrivals.length).toBeGreaterThan(0);
      for (const a of arrivals) {
        const before = m.frameAt(t - a.age - 1 / 60).sky.comets;
        expect(before.some((c) => c.from === a.from && c.to === a.to && Math.abs(c.progress - (1 - 1 / 60 / REPLAY_COMET_S)) < 1e-6)).toBe(true);
      }
    }
  });

  it('thins the same way whatever was asked before', () => {
    const m = busyModel();
    m.frameAt(5);
    m.frameAt(25);
    expect(m.frameAt(20)).toEqual(busyModel().frameAt(20));
  });
});
