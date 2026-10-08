import { describe, expect, it } from 'vitest';
import { aspectOf, intersects, layoutFor, type Box } from '../src/replay/story/layout';
import { odometer, rollOf } from '../src/replay/story/odometer';

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

describe('odometer across a unit switch', () => {
  it.each([
    [999_800, '$999.8K'],
    [999_900, '$999.9K'],
    [999_999, '$999.9K'],
    [1_000_000, '$1.0M'],
    [1_000_099, '$1.0M'],
    [1_100_000, '$1.1M'],
    [999_900_000, '$999.9M'],
    [1_000_000_000, '$1.0B'],
    [999_900_000_000, '$999.9B'],
    [1_000_000_000_000, '$1.0T'],
  ])('%s reads %s', (value, text) => {
    expect(odometer(value).text).toBe(text);
  });

  it('rolls toward the next digit just before the switch, then starts the new unit at rest', () => {
    expect(odometer(999_999).frac).toBeCloseTo(0.99, 2);
    expect(odometer(1_000_000).frac).toBe(0);
  });

  it('never shows a digit or suffix that disagrees with the value while climbing through $1M', () => {
    let last = 0;
    for (let v = 999_000; v <= 1_002_000; v += 50) {
      const { text } = odometer(v);
      const match = /^\$(\d+\.\d)(K|M)$/.exec(text);
      expect(match).not.toBeNull();
      const shown = Number(match![1]) * (match![2] === 'K' ? 1e3 : 1e6);
      expect(shown).toBeLessThanOrEqual(v + 1e-6);
      expect(v - shown).toBeLessThan(shown >= 1e6 ? 100_000 : 100);
      expect(shown).toBeGreaterThanOrEqual(last);
      last = shown;
    }
  });
});

describe('rollOf', () => {
  it.each([
    [0.3, 0, 0],
    [0.75, 0, 0.5],
    [1, 0, 1],
    [0.9, 1, 0],
  ])('frac %s settle %s rolls %s', (frac, settle, roll) => {
    expect(rollOf(frac, settle)).toBeCloseTo(roll, 6);
  });
});
