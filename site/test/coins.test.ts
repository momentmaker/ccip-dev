import { describe, expect, it } from 'vitest';
import { chainMessages, coinCount, coinDiameter, coinSelectors, nearestStar } from '../src/sky/coins';

describe('coinCount', () => {
  it('shows 12 coins from 640 px up and 8 below', () => {
    expect(coinCount(640)).toBe(12);
    expect(coinCount(639)).toBe(8);
  });
});

describe('coinDiameter', () => {
  it('is 2.4 × the radius, clamped to 18–40', () => {
    expect(coinDiameter(10)).toBe(24);
    expect(coinDiameter(2)).toBe(18);
    expect(coinDiameter(50)).toBe(40);
  });
});

describe('coinSelectors', () => {
  const values = new Map([['a', 50], ['b', 90], ['c', 90], ['d', 0], ['e', 70]]);
  const all = () => true;

  it('ranks by value with ties broken by selector', () => {
    expect(coinSelectors(values, 3, all)).toEqual(['b', 'c', 'e']);
  });

  it('skips chains with no icon', () => {
    expect(coinSelectors(values, 3, (s) => s !== 'c')).toEqual(['b', 'e', 'a']);
  });

  it('skips chains with no value', () => {
    expect(coinSelectors(values, 10, all)).toEqual(['b', 'c', 'e', 'a']);
  });
});

describe('nearestStar', () => {
  const points = [
    { selector: 'a', x: 100, y: 100, reach: 12 },
    { selector: 'b', x: 120, y: 100, reach: 30 },
  ];

  it('picks the nearest star within its reach', () => {
    expect(nearestStar(points, 104, 100)).toBe('a');
    expect(nearestStar(points, 112, 100)).toBe('b');
  });

  it('returns null when no star is in reach', () => {
    expect(nearestStar(points, 200, 200)).toBeNull();
  });
});

describe('chainMessages', () => {
  it('sums lanes touching the chain and counts a self-lane once', () => {
    const lanes = [
      { src: 'a', dst: 'b', messages: 5 },
      { src: 'b', dst: 'a', messages: 3 },
      { src: 'a', dst: 'a', messages: 2 },
      { src: 'b', dst: 'c', messages: 7 },
    ];
    expect(chainMessages(lanes, 'a')).toBe(10);
    expect(chainMessages(lanes, 'z')).toBe(0);
  });
});
