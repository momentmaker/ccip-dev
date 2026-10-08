import { describe, expect, it } from 'vitest';
import { LETTERMARK_BG, lettermarkLetter, lettermarkSvg } from '../scripts/chain-icons/lettermark';

describe('lettermarkLetter', () => {
  it.each([['sui-mainnet', 'S'], ['0G Mainnet', '0'], ['B^2 Mainnet', 'B'], ['—', '?']])('%s → %s', (name, letter) => {
    expect(lettermarkLetter(name)).toBe(letter);
  });
});

describe('lettermarkSvg', () => {
  it('renders a 32 px rounded square with the letter as paths, needing no font', async () => {
    const svg = await lettermarkSvg('Sui');
    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg).toContain(`fill="${LETTERMARK_BG}"`);
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).toMatch(/<path x="0" y="0" width="32" height="32" fill="#2a3446" d="M4,0 /);
    expect(svg).toMatch(/<path fill="#ffffff" d="M[\d.]+ /);
    expect(svg).not.toContain('<text');
  });

  it('draws a different glyph for a different letter', async () => {
    const glyph = (svg: string) => /<path fill="#ffffff" d="([^"]+)"/.exec(svg)![1];
    expect(glyph(await lettermarkSvg('Sui'))).not.toBe(glyph(await lettermarkSvg('Base')));
    expect(glyph(await lettermarkSvg('Sui'))).toBe(glyph(await lettermarkSvg('Solana')));
  });
});
