import { addDays } from '@ccip-dev/core';
import { describe, expect, it } from 'vitest';
import { dropPriceOutliers } from '../backfill/price-outliers';

/** A daily series from `from` on, one point per value; null leaves that day without a point. */
function series(from: string, values: (number | null)[]): Record<string, number> {
  return Object.fromEntries(values.flatMap((v, i) => (v === null ? [] : [[addDays(from, i), v]])));
}

const without = (s: Record<string, number>, ...days: string[]) =>
  Object.fromEntries(Object.entries(s).filter(([day]) => !days.includes(day)));

describe('dropPriceOutliers', () => {
  it('drops elizaOS\'s bogus launch-day point and keeps the days after it', () => {
    const eliza = series('2025-11-07', [125_176.45, 0.0101, 0.0092, 0.0095, 0.0098, 0.0089, 0.0091, 0.0087]);
    expect(dropPriceOutliers(eliza)).toEqual({ kept: without(eliza, '2025-11-07'), dropped: ['2025-11-07'] });
  });

  it('keeps a genuine 3x move', () => {
    const move = series('2026-01-01', [1, 1, 1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3, 3]);
    expect(dropPriceOutliers(move)).toEqual({ kept: move, dropped: [] });
  });

  it('keeps a series with fewer than three other points as it is', () => {
    const short = series('2026-01-01', [1, 1000, 1]);
    expect(dropPriceOutliers(short)).toEqual({ kept: short, dropped: [] });
  });

  it('drops an interior spike above 20x and a dip below 1/20 of the median around it', () => {
    const spiky = series('2026-01-01', [1, 1.1, 0.9, 25, 1, 1.05, 0.95, 0.04, 1, 1]);
    expect(dropPriceOutliers(spiky).dropped).toEqual(['2026-01-04', '2026-01-08']);
  });

  it('keeps a point at exactly 20x or 1/20 of the median', () => {
    const edge = series('2026-01-01', [1, 1, 1, 20, 1, 0.05, 1, 1]);
    expect(dropPriceOutliers(edge).dropped).toEqual([]);
  });

  it('judges a point with fewer than three others within 7 days against the nearest three, at any distance', () => {
    const sparse = series('2026-01-01', [1, 1, 1, ...Array<null>(27).fill(null), 30]);
    const kept = series('2026-01-01', [1, 1, 1, ...Array<null>(27).fill(null), 15]);
    expect([dropPriceOutliers(sparse).dropped, dropPriceOutliers(kept).dropped]).toEqual([['2026-01-31'], []]);
  });

  it('judges every point against the raw series in one pass, so a dropped spike still counts among its neighbours', () => {
    const byOffset: Record<number, number> = { 0: 1, 1: 1, 2: 1, 3: 1, 10: 25, 11: 100_000, 17: 2, 22: 2, 23: 2, 24: 2 };
    const raw = Object.fromEntries(Object.entries(byOffset).map(([offset, price]) => [addDays('2026-01-01', Number(offset)), price]));
    const once = dropPriceOutliers(raw);
    // Day 10 is kept: its window holds days 3, 11 and 17, median 2. Without the dropped day 11 it would reach day 2, median 1.
    expect([once.dropped, dropPriceOutliers(once.kept).dropped]).toEqual([['2026-01-12'], ['2026-01-11']]);
  });
});
