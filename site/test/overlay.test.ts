import { describe, expect, it } from 'vitest';
import { buildLayout, projector } from '../src/sky/layout';
import { cardPosition, cardSize, skyOverlay } from '../src/sky/overlay';
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
    const { coins } = skyOverlay(stars, values, 700, 700, { coins: 2, labels: 0, hasIcon: all, bottomReserve: 0 });
    const [ax, ay] = at('a');
    expect(coins.map((c) => c.selector)).toEqual(['a', 'b']);
    expect(coins[0]).toEqual({ selector: 'a', x: ax, y: ay, d: 24 });
  });

  it('leaves out chains whose icon is missing or broke', () => {
    const { coins } = skyOverlay(stars, values, 700, 700, { coins: 2, labels: 0, hasIcon: (s) => s !== 'a', bottomReserve: 0 });
    expect(coins.map((c) => c.selector)).toEqual(['b', 'c']);
  });

  it('moves a coin chain’s label past its coin and keeps others beside their star', () => {
    const { labels } = skyOverlay(stars, values, 700, 700, { coins: 1, labels: 3, hasIcon: all, bottomReserve: 0 });
    const [ax] = at('a');
    const [cx] = at('c');
    const rc = starRadius(100, 300);
    expect(labels.find((l) => l.selector === 'a')!.x).toBeCloseTo(ax + 18, 5);
    expect(labels.find((l) => l.selector === 'c')!.x).toBeCloseTo(cx + Math.max(10, rc + 6), 5);
  });

  it('gives every star a hover reach of at least 12 px', () => {
    const { points } = skyOverlay(stars, values, 700, 700, { coins: 0, labels: 0, hasIcon: all, bottomReserve: 0 });
    expect(points.find((p) => p.selector === 'a')!.reach).toBe(16);
    expect(points.every((p) => p.reach >= 12)).toBe(true);
  });
});

describe('bottomReserve', () => {
  it('skips a star in the reserved strip for coins and labels and takes the next chain', () => {
    const [, ay] = at('a');
    const reserve = 700 - ay + 1;
    const { coins, labels } = skyOverlay(stars, values, 700, 700, { coins: 1, labels: 1, hasIcon: all, bottomReserve: reserve });
    expect(coins.map((c) => c.selector)).not.toContain('a');
    expect(labels.map((l) => l.selector)).not.toContain('a');
    expect(coins).toHaveLength(1);
    expect(labels).toHaveLength(1);
  });

  it('still lets the skipped star be hovered', () => {
    const [, ay] = at('a');
    const { points } = skyOverlay(stars, values, 700, 700, { coins: 1, labels: 1, hasIcon: all, bottomReserve: 700 - ay + 1 });
    expect(points.map((p) => p.selector)).toContain('a');
  });
});

describe('cardPosition', () => {
  const card = { width: 320, height: 64 };
  it('sits right of the star, vertically centered, when there is room', () => {
    expect(cardPosition({ x: 300, y: 300, d: 24 }, { width: 1000, height: 700 }, card)).toEqual({ left: 324, top: 268 });
  });

  it('sits left of the star near the right edge', () => {
    const { left } = cardPosition({ x: 900, y: 300, d: 24 }, { width: 1000, height: 700 }, card);
    expect(left + card.width).toBeLessThanOrEqual(900 - 12 - 12);
    expect(left).toBeGreaterThanOrEqual(8);
  });

  it('goes below the star, clamped inside a 390 px wrap, when neither side fits', () => {
    const c = cardSize(390);
    const pos = cardPosition({ x: 200, y: 300, d: 24 }, { width: 390, height: 600 }, c);
    expect(pos.top).toBe(300 + 12 + 12);
    expect(pos.left).toBeGreaterThanOrEqual(8);
    expect(pos.left).toBeLessThanOrEqual(390 - c.width - 8);
  });

  it('stays inside the wrap vertically near the bottom edge', () => {
    const { top } = cardPosition({ x: 300, y: 690, d: 24 }, { width: 1000, height: 700 }, card);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top).toBeLessThanOrEqual(700 - 64 - 8);
  });

  it('sizes the card to 320 px, or the wrap minus its edges when narrow', () => {
    expect(cardSize(300).width).toBe(284);
    expect(cardSize(1440).width).toBe(320);
  });
});
