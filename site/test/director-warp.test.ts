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

describe('warp edge cases', () => {
  it('clamps the milestone dwell so plain time keeps half the span', () => {
    const milestone = { join: false, milestone: true, record: false };
    const warp = storyWarp(Array(10).fill(0), Array(10).fill(milestone), 0, 2, 30);
    expect(warp.end).toBeCloseTo(2, 9);
    for (let i = 0; i < 10; i++) expect(warp.dayLength(i)).toBeCloseTo(0.2, 9);
    const total = Array.from({ length: 10 }, (_, i) => warp.dayLength(i)).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(2, 9);
  });

  it('handles a zero-length day', () => {
    const warp = durationWarp([1, 0, 2], 0);
    expect(warp.dayStart(3)).toBe(3);
    expect(warp.end).toBe(3);
    expect(warp.dayLength(1)).toBe(0);
    expect(warp.dayAt(1).index).toBe(2);
  });
});
