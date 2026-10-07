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

describe('avoid rects', () => {
  const around = (selector: string, halfW: number, halfH: number) => {
    const [x, y] = at(selector);
    return { left: x - halfW, top: y - halfH, right: x + halfW, bottom: y + halfH };
  };
  const rightLabelBox = (selector: string, width: number) => {
    const [x, y] = at(selector);
    return { left: x + 18, top: y - 9, right: x + 18 + width, bottom: y + 9 };
  };

  it('skips a chain whose coin box meets a rect, gives the coin to the next chain and keeps its point', () => {
    const { coins, points } = skyOverlay(stars, values, 700, 700, { coins: 1, labels: 0, hasIcon: all, avoid: [around('a', 2, 2)] });
    expect(coins.map((c) => c.selector)).toEqual(['b']);
    expect(points.map((p) => p.selector)).toContain('a');
  });

  it('slides a coin that only grazes a rect out of it, and keeps its label beside the coin', () => {
    const [ax, ay] = at('a');
    const card = { left: ax - 100, top: ay - 100, right: ax + 100, bottom: ay - 11 };
    const { coins, labels } = skyOverlay(stars, values, 700, 700, { coins: 1, labels: 1, hasIcon: all, labelWidth: () => 60, avoid: [card] });
    expect(coins).toEqual([{ selector: 'a', x: ax, y: ay + 1, d: 24 }]);
    expect(labels[0]!.y).toBe(ay + 1);
  });

  it('drops a coin when sliding it clear would take more than a quarter of its width', () => {
    const [ax, ay] = at('a');
    const card = { left: ax - 100, top: ay - 100, right: ax + 100, bottom: ay - 5 };
    const { coins } = skyOverlay(stars, values, 700, 700, { coins: 1, labels: 0, hasIcon: all, avoid: [card] });
    expect(coins.map((c) => c.selector)).toEqual(['b']);
  });

  it('puts the label on the left when only the right-side box is covered', () => {
    const { coins, labels } = skyOverlay(stars, values, 700, 700, {
      coins: 1,
      labels: 1,
      hasIcon: all,
      labelWidth: () => 60,
      avoid: [rightLabelBox('a', 60)],
    });
    const [ax] = at('a');
    expect(coins.map((c) => c.selector)).toEqual(['a']);
    expect(labels).toEqual([expect.objectContaining({ selector: 'a', side: 'left' })]);
    expect(labels[0]!.x).toBeCloseTo(ax - 18, 5);
  });

  it('drops the label but keeps the coin when both sides are covered', () => {
    const [x, y] = at('a');
    const { coins, labels } = skyOverlay(stars, values, 700, 700, {
      coins: 1,
      labels: 1,
      hasIcon: all,
      labelWidth: () => 60,
      avoid: [rightLabelBox('a', 60), { left: x - 18 - 60, top: y - 9, right: x - 18, bottom: y + 9 }],
    });
    expect(coins.map((c) => c.selector)).toEqual(['a']);
    expect(labels).toEqual([]);
  });

  it('ranks and places everything on the right when nothing is avoided', () => {
    const { coins, labels } = skyOverlay(stars, values, 700, 700, { coins: 2, labels: 3, hasIcon: all });
    expect(coins.map((c) => c.selector)).toEqual(['a', 'b']);
    expect(labels.map((l) => l.selector)).toEqual(['a', 'b', 'c']);
    expect(labels.every((l) => l.side === 'right')).toBe(true);
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

  it('sizes the card to 340 px, or the wrap minus its edges when narrow', () => {
    expect(cardSize(300).width).toBe(284);
    expect(cardSize(390).width).toBe(340);
    expect(cardSize(1440).width).toBe(340);
  });
});
