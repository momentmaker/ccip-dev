import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { marine } from '../../test/fixtures/linkmarine';
import { h } from '../h';
import { LinkMarineCards } from '../linkmarine/entrypoint';
import { renderKino } from '../linkmarine/render';

const solid = async (color: string) => (await renderKino(h('div', { style: { width: 240, height: 240, display: 'flex', backgroundColor: color } }), { width: 240, height: 240 })).png;

/** A GIF's logical size, loop count and frame delays (ms), read from its blocks. */
function gifInfo(gif: Uint8Array): { header: string; width: number; height: number; loop: number | null; delays: number[] } {
  const u16 = (at: number) => gif[at]! | (gif[at + 1]! << 8);
  const skipSubBlocks = (at: number) => {
    while (gif[at] !== 0) at += gif[at]! + 1;
    return at + 1;
  };
  let at = 13 + (gif[10]! & 0x80 ? 3 * (1 << ((gif[10]! & 7) + 1)) : 0);
  let loop: number | null = null;
  const delays: number[] = [];
  while (at < gif.length && gif[at] !== 0x3b) {
    if (gif[at] === 0x21 && gif[at + 1] === 0xf9) {
      delays.push(u16(at + 4) * 10);
      at = skipSubBlocks(at + 2);
    } else if (gif[at] === 0x21 && gif[at + 1] === 0xff) {
      if (String.fromCharCode(...gif.subarray(at + 3, at + 14)) === 'NETSCAPE2.0') loop = u16(at + 16);
      at = skipSubBlocks(at + 2);
    } else if (gif[at] === 0x2c) {
      const local = gif[at + 9]! & 0x80 ? 3 * (1 << ((gif[at + 9]! & 7) + 1)) : 0;
      at = skipSubBlocks(at + 10 + local + 1);
    } else {
      throw new Error(`unexpected GIF block 0x${gif[at]!.toString(16)} at ${at}`);
    }
  }
  return { header: String.fromCharCode(...gif.subarray(0, 6)), width: u16(6), height: u16(8), loop, delays };
}

describe('the LinkMarineCards entrypoint: the animated glint', () => {
  it('animates Rare and Legendary as a looping 1200×675 GIF of about 1.3 s, under 2 MB', async () => {
    // #given
    const cards = new LinkMarineCards(createExecutionContext(), {} as never);
    const memes = [await solid('#d01818'), await solid('#1f6fb2')];
    // #when
    const gifs = await Promise.all((['rare', 'legendary'] as const).map((tier) => cards.renderMarineGlint(marine(tier, memes))));
    // #then
    expect(
      gifs.map((gif) => {
        const info = gifInfo(gif!);
        return { ...info, delays: info.delays.reduce((s, d) => s + d, 0), frames: info.delays.length, small: gif!.length < 2_000_000 };
      }),
    ).toEqual([0, 1].map(() => ({ header: 'GIF89a', width: 1200, height: 675, loop: 0, delays: 1320, frames: 13, small: true })));
  });

  it('has no glint for Common and Uncommon', async () => {
    // #given
    const cards = new LinkMarineCards(createExecutionContext(), {} as never);
    const memes = [await solid('#d01818')];
    // #when
    const gifs = await Promise.all((['common', 'uncommon'] as const).map((tier) => cards.renderMarineGlint(marine(tier, memes))));
    // #then
    expect(gifs).toEqual([null, null]);
  });
});
