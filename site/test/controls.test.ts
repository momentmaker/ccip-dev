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
