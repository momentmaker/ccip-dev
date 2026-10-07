import { describe, expect, it } from 'vitest';
import { buildLayout } from '../src/sky/layout';
import { skySvg } from '../src/sky/svg';

const stars = [
  { selector: 'A', x: -1, y: 0 },
  { selector: 'B', x: 1, y: 0 },
];

describe('skySvg', () => {
  it('draws a halo and a core per star, one path per known lane, and optional labels', () => {
    const svg = skySvg({
      width: 400,
      height: 200,
      stars,
      chainValues: new Map([['A', 10], ['B', 5]]),
      lanes: [{ src: 'A', dst: 'B', usd: 10 }, { src: 'A', dst: 'MISSING', usd: 1 }],
      labels: new Map([['A', 'Ethereum <L1>']]),
      labelCount: 1,
      background: true,
      title: 'Sky & stars',
    });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"')).toBe(true);
    expect(svg.match(/<circle /g)).toHaveLength(4);
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg).toContain('<rect width="400" height="200" fill="#0c0f14"/>');
    expect(svg).toContain('Ethereum &lt;L1&gt;');
    expect(svg).toContain('aria-label="Sky &amp; stars"');
  });

  it('draws no labels or background unless asked', () => {
    const svg = skySvg({ width: 100, height: 100, stars, chainValues: new Map(), lanes: [] });
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('<rect');
  });
});

describe('skySvg coins', () => {
  const stars = buildLayout([
    { selector: 'a', first_day: '2023-07-06' },
    { selector: 'b', first_day: '2023-07-07' },
    { selector: 'c', first_day: '2023-07-08' },
  ]);
  const chainValues = new Map([['a', 300], ['b', 200], ['c', 100]]);
  const href = (s: string) => (s === 'c' ? null : `/chains/${s}.svg`);

  it('draws one clipped coin with a ring per top chain that has an icon', () => {
    const svg = skySvg({ width: 700, height: 700, stars, chainValues, lanes: [], coins: { count: 3, href } });
    expect(svg.match(/<image /g)).toHaveLength(2);
    expect(svg).toContain('href="/chains/a.svg"');
    expect(svg).toContain('href="/chains/b.svg"');
    expect(svg).toContain('<clipPath id="coin-clip" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath>');
    expect(svg.match(/clip-path="url\(#coin-clip\)"/g)).toHaveLength(2);
  });

  it('sizes a coin at 2.4 × the star radius', () => {
    const svg = skySvg({ width: 700, height: 700, stars, chainValues, lanes: [], coins: { count: 1, href } });
    expect(svg).toMatch(/<image href="\/chains\/a\.svg" x="[\d.-]+" y="[\d.-]+" width="24" height="24"/);
  });

  it('adds nothing without the coins option', () => {
    const svg = skySvg({ width: 700, height: 700, stars, chainValues, lanes: [] });
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('coin-clip');
  });

  it('moves a coin chain’s label past the coin', () => {
    const labels = new Map([['a', 'Alpha']]);
    const withCoin = skySvg({ width: 700, height: 700, stars, chainValues, lanes: [], labels, labelCount: 1, coins: { count: 1, href } });
    const without = skySvg({ width: 700, height: 700, stars, chainValues, lanes: [], labels, labelCount: 1 });
    const x = (svg: string) => Number(/<text x="([\d.]+)"/.exec(svg)![1]);
    expect(x(withCoin) - x(without)).toBeCloseTo(2, 1);
  });
});
