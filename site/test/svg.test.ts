import { describe, expect, it } from 'vitest';
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
