import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { Show } from '../src/replay/director/show';
import { BEAT_S, capPlucks, CHORD_S, EIGHTH_S, MAX_PLUCKS_PER_S, PROGRESSION, scoreFor, type ScoreEvent, type ScoreSource } from '../src/replay/score/schedule';
import { buildLayout } from '../src/sky/layout';
import replayJson from './fixtures/replay.json';

const replay = replayJson as ReplayFile;
const history = replay.days.map((d) => ({ day: d.day, messages: 10, token_messages: 10, usd_value: 1000, fee_usd: null, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null })) as DayTotals[];
const stars = buildLayout(replay.chains);
const show = (length = 30) => new Show({ replay, history, stars, length, focus: null, eligible: () => true });

const sourceOf = (s: Show, override: Partial<ScoreSource> = {}): ScoreSource => ({
  length: s.length,
  timing: s.timing,
  warp: s.warp,
  slams: s.slams,
  cards: s.cards,
  frameAt: (t) => s.frameAt(t),
  dailyMessages: () => s.dailyMessages(),
  ...override,
});

type Pluck = Extract<ScoreEvent, { kind: 'pluck' }>;
type Pulse = Extract<ScoreEvent, { kind: 'pulse' }>;
type Pad = Extract<ScoreEvent, { kind: 'pad' }>;
const pluck = (time: number): Pluck => ({ kind: 'pluck', time, note: 62, gain: 0.5 });

describe('scoreFor', () => {
  it('keeps every event inside the video and in time order', () => {
    for (const length of [15, 30, 60]) {
      const events = scoreFor(show(length));
      expect(events.every((e) => e.time >= 0 && e.time < length)).toBe(true);
      expect(events.map((e) => e.time)).toEqual([...events.map((e) => e.time)].sort((a, b) => a - b));
    }
  });

  it('lands a boom exactly on every milestone slam', () => {
    const s = show();
    const fake = sourceOf(s, { slams: [{ start: 10, label: '$1B moved' }, { start: 20.4, label: '1M messages' }] as never });
    expect(scoreFor(fake).filter((e) => e.kind === 'boom').map((e) => e.time)).toEqual([10, 20.4]);
  });

  it('chimes for each join card, in order', () => {
    const s = show();
    const chimes = scoreFor(s).filter((e) => e.kind === 'chime');
    const joins = s.cards.filter((c) => c.kind !== 'record');
    expect(chimes.map((e) => e.time)).toEqual(joins.map((c) => c.start));
  });

  it('runs for each record card', () => {
    const s = show();
    const runs = scoreFor(s).filter((e) => e.kind === 'run');
    expect(runs.map((e) => e.time)).toEqual(s.cards.filter((c) => c.kind === 'record').map((c) => c.start));
  });

  it('plucks only on eighths, within the cap, when comets fly', () => {
    const plucks = scoreFor(show()).filter((e): e is Pluck => e.kind === 'pluck');
    expect(plucks.length).toBeGreaterThan(0);
    for (const p of plucks) expect(Math.abs(p.time / EIGHTH_S - Math.round(p.time / EIGHTH_S))).toBeLessThan(1e-6);
    for (const p of plucks) expect(plucks.filter((q) => q.time >= p.time && q.time < p.time + 1).length).toBeLessThanOrEqual(MAX_PLUCKS_PER_S);
  });

  it('plucks nothing when no comets fly', () => {
    const s = show();
    const quiet = sourceOf(s, {
      frameAt: (t) => {
        const f = s.frameAt(t);
        return { ...f, base: { ...f.base, sky: { ...f.base.sky, comets: [] } } };
      },
    });
    expect(scoreFor(quiet).some((e) => e.kind === 'pluck')).toBe(false);
  });

  it('swells across the whole finale', () => {
    const swell = scoreFor(show()).find((e) => e.kind === 'swell')!;
    expect(swell.time).toBe(27);
    expect((swell as Extract<ScoreEvent, { kind: 'swell' }>).duration).toBe(3);
  });

  it('is deterministic', () => {
    expect(scoreFor(show())).toEqual(scoreFor(show()));
  });

  it('keeps the pad inside D dorian', () => {
    const dorian = new Set([2, 4, 5, 7, 9, 11, 0]);
    for (const chord of PROGRESSION) for (const note of chord) expect(dorian.has(note % 12)).toBe(true);
  });

  it('changes the pad chord every CHORD_S', () => {
    const pads = scoreFor(show()).filter((e): e is Pad => e.kind === 'pad');
    expect(pads[1]!.time - pads[0]!.time).toBeCloseTo(CHORD_S);
  });

  it('opens the pad filter with cumulative value, not time', () => {
    const s = show();
    const flat = sourceOf(s, { frameAt: (t) => ({ ...s.frameAt(t), story: { ...s.frameAt(t).story, usd: 0 } }) });
    const closedPads = scoreFor(flat).filter((e): e is Pad => e.kind === 'pad');
    expect(closedPads.every((p) => p.cutoff === 0.2)).toBe(true);
    const pads = scoreFor(s).filter((e): e is Pad => e.kind === 'pad');
    expect(pads.at(-1)!.cutoff).toBeGreaterThan(0.8);
    expect(pads.map((p) => p.cutoff)).toEqual([...pads.map((p) => p.cutoff)].sort((a, b) => a - b));
  });

  it('drives pulse gain from the day messages relative to the busiest day', () => {
    const s = show();
    const quietDay = scoreFor(sourceOf(s, { dailyMessages: () => s.dailyMessages().map(() => 5) })).filter((e): e is Pulse => e.kind === 'pulse');
    expect(quietDay.every((p) => Math.abs(p.gain - 1) < 1e-9)).toBe(true);
    const ramp = s.dailyMessages().map((_, i, all) => (i === all.length - 1 ? 1000 : 1));
    const pulses = scoreFor(sourceOf(s, { dailyMessages: () => ramp })).filter((e): e is Pulse => e.kind === 'pulse');
    expect(Math.min(...pulses.map((p) => p.gain))).toBeLessThan(0.5);
  });

  it('pulses on every beat of the story', () => {
    const pulses = scoreFor(show()).filter((e): e is Pulse => e.kind === 'pulse');
    for (const p of pulses) expect(Math.abs(p.time / BEAT_S - Math.round(p.time / BEAT_S))).toBeLessThan(1e-6);
  });
});

describe('capPlucks', () => {
  it('limits a dense synthetic schedule to the cap in every one-second window', () => {
    const dense = Array.from({ length: 40 }, (_, i) => pluck(i * 0.05));
    const kept = capPlucks(dense, MAX_PLUCKS_PER_S);
    expect(dense.filter((p) => p.time < 1).length).toBeGreaterThan(MAX_PLUCKS_PER_S);
    for (const p of kept) expect(kept.filter((q) => q.time >= p.time && q.time < p.time + 1).length).toBeLessThanOrEqual(MAX_PLUCKS_PER_S);
    expect(kept.length).toBeGreaterThan(MAX_PLUCKS_PER_S);
  });

  it('keeps everything when under the cap', () => {
    const sparse = Array.from({ length: 10 }, (_, i) => pluck(i * 0.3125));
    expect(capPlucks(sparse, MAX_PLUCKS_PER_S)).toEqual(sparse);
  });
});
