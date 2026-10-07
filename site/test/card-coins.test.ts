import { describe, expect, it } from 'vitest';
import { CARD_COIN_SCALE, cardCoins } from '../src/sky/card-coins';
import { coinDiameter } from '../src/sky/coins';
import { buildLayout, projector } from '../src/sky/layout';

const stars = buildLayout([
  { selector: 'a', first_day: '2023-07-06' },
  { selector: 'b', first_day: '2023-07-07' },
  { selector: 'c', first_day: '2023-07-08' },
]);
const chainValues = new Map([['a', 300], ['b', 200], ['c', 100]]);
const src = (s: string) => (s === 'b' ? null : `data:image/svg+xml;base64,${s}`);

describe('cardCoins', () => {
  it('places the top chains with icons at their projected stars', () => {
    const coins = cardCoins({ width: 700, height: 700, stars, chainValues, count: 2, src });
    const [ax, ay] = projector(700, 700, stars)(stars.find((s) => s.selector === 'a')!.x, stars.find((s) => s.selector === 'a')!.y);
    expect(coins.map((c) => c.src)).toEqual(['data:image/svg+xml;base64,a', 'data:image/svg+xml;base64,c']);
    expect(coins[0]!.x).toBeCloseTo(ax, 1);
    expect(coins[0]!.y).toBeCloseTo(ay, 1);
  });

  it('scales coins up for cards', () => {
    const [coin] = cardCoins({ width: 700, height: 700, stars, chainValues, count: 1, src });
    expect(coin!.d).toBeCloseTo(coinDiameter(10) * CARD_COIN_SCALE, 1);
  });

  it('skips chains without an icon and returns nothing for an empty sky', () => {
    expect(cardCoins({ width: 700, height: 700, stars, chainValues, count: 8, src }).some((c) => c.src.endsWith(',b'))).toBe(false);
    expect(cardCoins({ width: 700, height: 700, stars, chainValues: new Map(), count: 8, src })).toEqual([]);
  });
});
