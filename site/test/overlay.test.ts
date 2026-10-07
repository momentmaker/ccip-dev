import { describe, expect, it } from 'vitest';
import { buildLayout, projector } from '../src/sky/layout';
import { skyOverlay } from '../src/sky/overlay';
import { starRadius } from '../src/sky/weights';

const stars = buildLayout([
  { selector: 'a', first_day: '2023-07-06' },
  { selector: 'b', first_day: '2023-07-07' },
  { selector: 'c', first_day: '2023-07-08' },
]);
const values = new Map([['a', 300], ['b', 200], ['c', 100]]);
const all = () => true;
const at = (selector: string) => {
  const s = stars.find((p) => p.selector === selector)!;
  return projector(700, 700, stars)(s.x, s.y);
};

describe('skyOverlay', () => {
  it('puts coins on the top chains at their projected stars', () => {
    const { coins } = skyOverlay(stars, values, 700, 700, { coins: 2, labels: 0, hasIcon: all });
    const [ax, ay] = at('a');
    expect(coins.map((c) => c.selector)).toEqual(['a', 'b']);
    expect(coins[0]).toEqual({ selector: 'a', x: ax, y: ay, d: 24 });
  });

  it('leaves out chains whose icon is missing or broke', () => {
    const { coins } = skyOverlay(stars, values, 700, 700, { coins: 2, labels: 0, hasIcon: (s) => s !== 'a' });
    expect(coins.map((c) => c.selector)).toEqual(['b', 'c']);
  });

  it('moves a coin chain’s label past its coin and keeps others beside their star', () => {
    const { labels } = skyOverlay(stars, values, 700, 700, { coins: 1, labels: 3, hasIcon: all });
    const [ax] = at('a');
    const [cx] = at('c');
    const rc = starRadius(100, 300);
    expect(labels.find((l) => l.selector === 'a')!.x).toBeCloseTo(ax + 18, 5);
    expect(labels.find((l) => l.selector === 'c')!.x).toBeCloseTo(cx + Math.max(10, rc + 6), 5);
  });

  it('gives every star a hover reach of at least 12 px', () => {
    const { points } = skyOverlay(stars, values, 700, 700, { coins: 0, labels: 0, hasIcon: all });
    expect(points.find((p) => p.selector === 'a')!.reach).toBe(16);
    expect(points.every((p) => p.reach >= 12)).toBe(true);
  });
});
