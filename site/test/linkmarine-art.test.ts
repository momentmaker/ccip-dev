import { describe, expect, it } from 'vitest';
import { capDay, drawable, font, halo, hexPoints, onCurve, pips, px, S } from '../worker/linkmarine/art';

describe('kino art', () => {
  it('scales the mockups by 1200/760 and draws pointy-top hexagons', () => {
    // #when
    const known = { s: S, widths: [px(760), px(30), px(46)], hexagon: hexPoints(100, 100, 10).split(' ') };
    // #then
    expect(known).toEqual({ s: 1200 / 760, widths: [1200, 47.4, 72.6], hexagon: ['100,90', '108.7,95', '108.7,105', '100,110', '91.3,105', '91.3,95'] });
  });

  it("sets type at the mockups' size and tracking", () => {
    // #when
    const style = font('JetBrains Mono', 700, 11, '#8892a0', 0.16);
    // #then 11 px at 0.16em, scaled
    expect(style).toEqual({ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 17.4, color: '#8892a0', letterSpacing: 2.8, whiteSpace: 'nowrap' });
  });

  it('writes a day as the mockups do, in UTC', () => {
    // #then
    expect([capDay('2026-10-13'), capDay('2023-07-06T23:59:59.000Z'), capDay('2026-12-01T00:00:00.000Z')]).toEqual(['13 OCT 2026', '6 JUL 2023', '1 DEC 2026']);
  });

  it('keeps only the text the card fonts can draw', () => {
    // #when
    const kept = ['momentmaker 🚀', '日本語', 'Zoë · O’Neil', '  two   spaces  '].map(drawable);
    // #then
    expect(kept).toEqual(['momentmaker', '', 'Zoë · O’Neil', 'two spaces']);
  });

  it('draws pips as an image, the first ones filled', () => {
    // #when
    const node = pips(2, 12.6, '#f5c451') as { type: string; props: { src: string; width: number } };
    const svg = atob(node.props.src.replace('data:image/svg+xml;base64,', ''));
    // #then
    expect({ type: node.type, width: node.props.width, filled: (svg.match(/fill="#f5c451"/g) ?? []).length, hollow: (svg.match(/fill="none"/g) ?? []).length }).toEqual({ type: 'img', width: 39.9, filled: 2, hollow: 1 });
  });

  it('finds a point along a lane, and rings the halo with a blurred and a crisp copy of each hexagon', () => {
    // #when
    const mid = onCurve({ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }, 0.5);
    const ring = halo('h', 100, 100, '#f5c451', [{ r: 50, width: 2, opacity: 0.5 }, { r: 80, width: 1, opacity: 0.2 }], { r: 120, opacity: 0.3 }, 4);
    // #then
    expect({ mid, hexagons: (ring.body.match(/<polygon/g) ?? []).length, turned: ring.body.includes('rotate(4.00 100 100)'), glow: ring.defs.includes('stop-opacity="0.3"') }).toEqual({
      mid: { x: 50, y: 50 },
      hexagons: 4,
      turned: true,
      glow: true,
    });
  });
});
