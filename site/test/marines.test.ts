import { describe, expect, it } from 'vitest';
import { ROSTER_FIXTURE } from '@ccip-dev/core/testing';
import { enlistedText, marinePath, marineTitle, marineUrl, memeUrl, NARROW_FRAME, pipText, planetLayout, PLANET_LABEL_H, PLANET_LABEL_W, rarestBarPct, serialFromPath, shareLine, tierName, tipPosition, webCardUrl, WIDE_FRAME, type PlanetFrame } from '../src/lib/marines';

describe('Marine URLs', () => {
  it('pads the page path, and keeps the web card on the bare serial', () => {
    // #then
    expect([marinePath(7), marineUrl(7), marineTitle(7), webCardUrl(7), marinePath(12345)]).toEqual([
      '/marines/0007/',
      'https://ccip.dev/marines/0007/',
      'LINK MARINE #0007',
      'https://discord.ccip.dev/web/7.png',
      '/marines/12345/',
    ]);
  });

  it('escapes a meme file name for the bot', () => {
    // #then
    expect(memeUrl('b c#1.gif')).toBe('https://discord.ccip.dev/memes/b%20c%231.gif.png');
  });

  it('reads the serial from a Marine page path, and nothing else', () => {
    // #then
    expect(['/marines/0007/', '/marines/7', '/marines/0/', '/marines/marine/', '/marines/', '/marines/1234567890/'].map(serialFromPath)).toEqual([7, 7, null, null, null, null]);
  });
});

describe('wording', () => {
  it('names tiers, dates enlistments, draws pips and writes the share line', () => {
    // #then
    expect([tierName('legendary'), enlistedText('2026-10-13'), pipText(1), pipText(5), pipText(400), shareLine(ROSTER_FIXTURE.marines[1]!)]).toEqual([
      'Legendary',
      '13 Oct 2026',
      '◆◆◆',
      '◆◆◇',
      '◇◇◇',
      'LINK MARINE #0002 · painting-space-prophecy · LEGENDARY',
    ]);
  });

  it('runs a rarest-ten bar from 20% at the roster’s lowest score to 100% at its highest', () => {
    // #then
    expect([rarestBarPct(14.2, 14.2, 18.74), rarestBarPct(18.74, 14.2, 18.74), rarestBarPct(16.47, 14.2, 18.74), rarestBarPct(15, 15, 15)]).toEqual([20, 100, 60, 100]);
  });
});

describe('the constellation layout', () => {
  /** A planet's box: its hexagon (size × 1.12) and its label below, as wide as the widest label if that is wider. */
  const box = (p: { x: number; y: number; size: number }) => ({ left: p.x - Math.max(p.size, PLANET_LABEL_W) / 2, right: p.x + Math.max(p.size, PLANET_LABEL_W) / 2, top: p.y - p.size * 0.56, bottom: p.y + p.size * 0.56 + PLANET_LABEL_H });
  const overlaps = (ps: { x: number; y: number; size: number }[]) =>
    ps.flatMap((p, i) => ps.slice(i + 1).map((q) => [box(p), box(q)])).filter(([a, b]) => a!.left < b!.right && b!.left < a!.right && a!.top < b!.bottom && b!.top < a!.bottom).length;
  const outside = (ps: { x: number; y: number; size: number }[], f: PlanetFrame) => ps.map(box).filter((b) => b.left < 0 || b.top < 0 || b.right > f.width || b.bottom > f.height).length;

  it('never overlaps two planets or leaves the frame, wide or narrow, however the carriers fall', () => {
    // #given
    const cases = [Array(24).fill(3), Array.from({ length: 24 }, (_, i) => 30 - i), [1]];
    // #when
    const wide = cases.map((c) => planetLayout(c, WIDE_FRAME));
    const narrow = cases.map((c) => planetLayout(c.slice(0, 12), NARROW_FRAME));
    // #then
    expect([...wide.map((p) => [overlaps(p), outside(p, WIDE_FRAME)]), ...narrow.map((p) => [overlaps(p), outside(p, NARROW_FRAME)])]).toEqual(Array(6).fill([0, 0]));
  });

  it('lays the same carriers out the same way every time, the busiest planet biggest and nearest the middle', () => {
    // #when
    const [a, b] = [planetLayout([9, 3, 1], WIDE_FRAME), planetLayout([9, 3, 1], WIDE_FRAME)];
    // #then
    expect({ same: a, biggest: a[0]!.size, central: Math.abs(a[0]!.x - WIDE_FRAME.width / 2) < WIDE_FRAME.width / WIDE_FRAME.cols }).toEqual({ same: b, biggest: WIDE_FRAME.max, central: true });
  });
});

describe('tipPosition', () => {
  const viewport = { width: 1280, height: 800 };

  it('sits beside the pointer', () => {
    // #then
    expect(tipPosition(100, 200, viewport)).toEqual({ left: 114, top: 214 });
  });

  it('flips to the left of the pointer at the right edge', () => {
    // #then
    expect(tipPosition(1000, 200, viewport)).toEqual({ left: 686, top: 214 });
  });

  it('flips above the pointer at the bottom edge', () => {
    // #then
    expect(tipPosition(100, 750, viewport)).toEqual({ left: 114, top: 636 });
  });

  it('never leaves the left or top of the viewport', () => {
    // #then
    expect(tipPosition(100, 50, { width: 200, height: 100 })).toEqual({ left: 8, top: 8 });
  });
});
