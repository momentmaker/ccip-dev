import { describe, expect, it } from 'vitest';
import { glyph, MISSING_GLYPHS, withArrows } from '../worker/cards/glyphs';

describe('glyphs', () => {
  it('draws a glyph as an inline SVG in the given color', () => {
    // #when
    const svg = atob(String(glyph('up', 14, '#7fd4a0').props.src).split(',')[1]!);
    // #then
    expect(svg).toContain('fill="#7fd4a0"');
  });

  it('draws each " → " in a lane label as an arrow glyph', () => {
    // #when
    const parts = withArrows('Ethereum → Arc', 16, '#ffffff');
    // #then
    expect({ parts: parts.map((p) => (typeof p === 'string' ? p : 'arrow')), text: parts.some((p) => typeof p === 'string' && MISSING_GLYPHS.test(p)) }).toEqual({
      parts: ['Ethereum', 'arrow', 'Arc'],
      text: false,
    });
  });
});
