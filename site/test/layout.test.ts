import { describe, expect, it } from 'vitest';
import { appendStar, buildLayout, cameraProjector, orderChains, projector, spiralPoint } from '../src/sky/layout';

const chains = [
  { selector: '5009297550715157269', first_day: '2023-07-06' },
  { selector: '4051577828743386545', first_day: '2023-07-06' },
  { selector: '124615329519749607', first_day: '2023-07-09' },
  { selector: '15971525489660198786', first_day: '2023-07-08' },
];

describe('spiral layout', () => {
  it('places index i at radius √(i+1) on the golden angle', () => {
    expect(spiralPoint(0).x).toBeCloseTo(1);
    expect(spiralPoint(0).y).toBeCloseTo(0);
    const p = spiralPoint(1);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(Math.SQRT2);
    expect((Math.atan2(p.y, p.x) * 180) / Math.PI).toBeCloseTo(137.5078, 3);
  });

  it('orders chains by first day, then selector as a string', () => {
    expect(orderChains(chains)).toEqual(['4051577828743386545', '5009297550715157269', '15971525489660198786', '124615329519749607']);
  });

  it('normalizes the outermost star to radius 1', () => {
    const layout = buildLayout(chains);
    expect(layout.map((s) => s.selector)).toEqual(orderChains(chains));
    expect(Math.hypot(layout[3]!.x, layout[3]!.y)).toBeCloseTo(1, 3);
  });

  it('keeps earlier stars on the same spiral when a newer chain is added', () => {
    const before = buildLayout(chains.filter((c) => c.selector !== '124615329519749607'));
    const after = buildLayout(chains);
    const scaleBefore = Math.sqrt(3);
    const scaleAfter = Math.sqrt(4);
    for (const star of before) {
      const moved = after.find((s) => s.selector === star.selector)!;
      expect(moved.x * scaleAfter).toBeCloseTo(star.x * scaleBefore, 2);
      expect(moved.y * scaleAfter).toBeCloseTo(star.y * scaleBefore, 2);
    }
  });

  it('appends a new chain on the next spiral slot at the same scale, once', () => {
    const layout = buildLayout(chains.slice(0, 3));
    const grown = appendStar(layout, 'NEW');
    expect(grown).toHaveLength(4);
    expect(grown.slice(0, 3)).toEqual(layout);
    const p = spiralPoint(3);
    expect(grown[3]!.x).toBeCloseTo(p.x / Math.sqrt(3), 3);
    expect(appendStar(grown, 'NEW')).toBe(grown);
    expect(appendStar([], 'FIRST')[0]).toEqual({ selector: 'FIRST', x: 1, y: 0 });
  });
});

describe('projector', () => {
  const stars = [{ selector: 'a', x: 1, y: 0 }, { selector: 'b', x: 0, y: 1 }];

  it('maps the center to the middle and stretches the long side up to 1.6×', () => {
    const wide = projector(1600, 900, stars);
    expect(wide(0, 0)).toEqual([800, 450]);
    expect(wide(1, 0)[0]).toBeCloseTo(800 + 414 * 1.6);
    expect(wide(0, 1)[1]).toBeCloseTo(450 + 414);
    const tall = projector(900, 1600, stars);
    expect(tall(0, 1)[1]).toBeCloseTo(800 + 414 * 1.6);
  });

  it('zooms out to fit stars beyond radius 1', () => {
    const p = projector(1000, 1000, [{ selector: 'far', x: 2, y: 0 }]);
    expect(p(2, 0)[0]).toBeCloseTo(500 + 460);
  });

  it('frames an explicit extent with 8% breathing room', () => {
    const p = projector(1000, 1000, stars, 0.08, 0.5);
    expect(p(0.5, 0)[0]).toBeCloseTo(500 + 460 / 1.08);
  });
});

describe('cameraProjector', () => {
  it('matches the plain projector when centered with no rotation', () => {
    const plain = projector(800, 800, [], 0.08, 2);
    const cam = cameraProjector(800, 800, { cx: 0, cy: 0, extent: 2, rotation: 0 });
    expect(cam(0.5, -0.25)).toEqual(plain(0.5, -0.25));
  });

  it('moves the center to the middle of the canvas and rotates around it', () => {
    const cam = cameraProjector(800, 800, { cx: 1, cy: 0, extent: 2, rotation: Math.PI / 2 });
    expect(cam(1, 0)).toEqual([400, 400]);
    const [x, y] = cam(2, 0);
    expect(x).toBeCloseTo(400, 6);
    expect(y).toBeGreaterThan(400);
  });
});
