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
    expect(svg).toContain('<path');
    expect(svg).not.toContain('<text');
  });
});
