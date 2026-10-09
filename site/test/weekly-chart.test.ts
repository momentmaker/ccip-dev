import { describe, expect, it } from 'vitest';
import { formatUsd } from '../src/lib/format';
import { weeklyPaths, weeklySummary } from '../src/lib/weekly-chart';

describe('weeklyPaths', () => {
  it('stacks each series on the ones before it', () => {
    // #given two weeks: a = [1, 3] and b = [1, 1], so the top of b reaches 4
    const series = [{ key: 'a', label: 'A', values: [1, 3] }, { key: 'b', label: 'B', values: [1, 1] }];
    // #when, #then
    expect(weeklyPaths(series, true)).toEqual([
      { key: 'a', d: 'M4,118L596,42L596,156L4,156Z' },
      { key: 'b', d: 'M4,80L596,4L596,42L4,118Z' },
    ]);
  });

  it('draws side-by-side series as lines on one scale', () => {
    const series = [{ key: 'f', label: 'F', values: [2, 4] }, { key: 'd', label: 'D', values: [0, 8] }];
    expect(weeklyPaths(series, false)).toEqual([
      { key: 'f', d: 'M4,118L596,80' },
      { key: 'd', d: 'M4,156L596,4' },
    ]);
  });
});

describe('weeklySummary', () => {
  it('names the weeks covered and the latest week of each series', () => {
    // #given
    const series = [{ key: 'l', label: 'LINK', values: [1000, 2500] }, { key: 'o', label: 'Other', values: [10, 20] }];
    // #when, #then
    expect(weeklySummary('Weekly fee mix', ['2026-09-28', '2026-10-05'], series, formatUsd)).toBe(
      'Weekly fee mix, weeks of Sep 28, 2026 to Oct 5, 2026. Latest week: LINK $2.5K, Other $20',
    );
  });

  it('says when there are no complete weeks', () => {
    expect(weeklySummary('Weekly fee mix', [], [], formatUsd)).toBe('Weekly fee mix: no complete weeks yet');
  });
});
