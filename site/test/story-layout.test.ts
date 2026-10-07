import { describe, expect, it } from 'vitest';
import { aspectOf, intersects, layoutFor, type Box } from '../src/replay/story/layout';
import { odometer } from '../src/replay/story/odometer';

const sizes: [number, number][] = [[1920, 1080], [1080, 1080], [1080, 1920], [390, 390], [390, 693], [693, 390]];
const inside = (b: Box, w: number, h: number) => b.x >= 0 && b.y >= 0 && b.x + b.w <= w + 1e-6 && b.y + b.h <= h + 1e-6;

describe('aspectOf', () => {
  it.each([[1920, 1080, 'wide'], [1080, 1080, 'square'], [1080, 1920, 'tall'], [390, 390, 'square']])('%s×%s is %s', (w, h, a) => {
    expect(aspectOf(w, h)).toBe(a);
  });
});

describe.each(sizes)('layoutFor(%s, %s)', (w, h) => {
  const l = layoutFor(w, h);
  const reserved = [l.date, l.counter, l.sub, l.board, l.watermark, l.timeline, l.card];

  it('keeps every box inside the canvas', () => {
    for (const b of [...reserved, l.slam, l.title]) expect(inside(b, w, h)).toBe(true);
  });

  it('never overlaps two reserved boxes', () => {
    for (let i = 0; i < reserved.length; i++) for (let j = i + 1; j < reserved.length; j++) expect(intersects(reserved[i]!, reserved[j]!)).toBe(false);
  });

  it('keeps the milestone slam clear of the counter, card, board and timeline', () => {
    for (const b of [l.counter, l.card, l.board, l.timeline]) expect(intersects(l.slam, b)).toBe(false);
  });
});

describe('odometer', () => {
  it.each([
    [0, '$0', 0],
    [999.4, '$999', 0.4],
    [1500, '$1.5K', 0],
    [1_234_567, '$1.2M', 0.34567],
    [25_300_000_000, '$25.3B', 0],
  ])('%s shows %s rolling %s toward the next digit', (value, text, frac) => {
    const o = odometer(value);
    expect(o.text).toBe(text);
    expect(o.frac).toBeCloseTo(frac, 4);
  });
});
