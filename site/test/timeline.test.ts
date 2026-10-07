import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { computeMilestones } from '../src/lib/records';
import { cometCount, daySpawns, mulberry32, REPLAY_COMET_S, ReplayModel } from '../src/replay/timeline';
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
const model = () => new ReplayModel(replay, history, computeMilestones(history, replay.chains), stars, 60);

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
    expect(m.secondsPerDay).toBe(15);
    expect(m.duration).toBe(62);
  });

  it('ignites chains on their first day and counts the running totals', () => {
    const m = model();
    const start = m.frameAt(0);
    expect(start.day).toBe('2023-07-06');
    expect(start.sky.stars.map((s) => s.radius > 0)).toEqual([true, true, false, false]);
    expect(start.sky.stars[0]!.flash).toBe(1);
    expect(start.sky.rings.map((r) => r.star)).toEqual([0, 1]);
    expect(start.captions).toEqual(['Polygon joins', 'Ethereum joins']);
    expect(start.activeChains).toBe(2);

    const base = m.frameAt(30);
    expect(base.day).toBe('2023-07-08');
    expect(base.activeChains).toBe(3);
    expect(base.cumulativeMessages).toBe(52);
    expect(base.captions).toEqual(['Base joins']);
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
    const frame = m.frameAt(m.dayStart(1) + first.offset * m.secondsPerDay + 0.1);
    expect(frame.sky.comets.length).toBeGreaterThan(0);
    for (const c of frame.sky.comets) {
      expect(c.progress).toBeGreaterThanOrEqual(0);
      expect(c.progress).toBeLessThan(1);
      expect(frame.sky.stars[c.from]!.radius).toBeGreaterThan(0);
    }
    expect(REPLAY_COMET_S).toBe(0.8);
  });
});
