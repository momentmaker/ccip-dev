import { TIERS, type MarineWebCard } from '@ccip-dev/core/linkmarine';
import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { marine, webMarine } from '../../test/fixtures/linkmarine';
import { h } from '../h';
import { INK, px } from '../linkmarine/art';
import { LinkMarineCards } from '../linkmarine/entrypoint';
import { CHAIN_TOP, FRONT_TAG, onTag, TAGS_DROP } from '../linkmarine/marine-card';
import { TIER_LOOKS } from '../linkmarine/metal';
import { renderKino } from '../linkmarine/render';
import { STICKER_FIT } from '../linkmarine/sticker';
import { pngRgba } from './png';

const size = (png: Uint8Array) => [new DataView(png.buffer, png.byteOffset).getUint32(16), new DataView(png.buffer, png.byteOffset).getUint32(20)];
const solid = async (color: string) => (await renderKino(h('div', { style: { width: 240, height: 240, display: 'flex', backgroundColor: color } }), { width: 240, height: 240 })).png;
const cards = () => new LinkMarineCards(createExecutionContext(), {} as never);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** A point on a tag, in the mockups' units, where it lands in the sticker. */
const inSticker = (p: { x: number; y: number }) => [Math.round(STICKER_FIT.left + px(p.x) * STICKER_FIT.scale), Math.round(px(p.y + TAGS_DROP) * STICKER_FIT.scale)] as const;

describe('the LinkMarineCards entrypoint: the sticker', () => {
  // Four stickers render here: kept above the 60 s default so a slow CI run cannot fail the gate that runs before deploy.
  it('draws a 512×512 PNG with an alpha channel: clear around the tags, solid tier metal on them, the chain whole, the plate', { timeout: 120_000 }, async () => {
    // #given a red meme
    const red = await solid('#d01818');
    // #when
    const pngs = await Promise.all(TIERS.map((tier) => cards().renderMarineSticker(webMarine(tier, [red]))));
    // #then the corner is clear, and the front tag's bare metal is opaque and differs tier by tier, gold warm,
    // the chain's top bead is there rather than sliced off, and the plate has its tier border and its pale gold text
    const [x, y] = inSticker(onTag(FRONT_TAG, 250, 40));
    const corners = await Promise.all(pngs.map((png) => pngRgba(png, 2, 2)));
    const metals = await Promise.all(pngs.map((png) => pngRgba(png, x, y)));
    const gold = metals[3]!;
    const [chainX, chainY] = inSticker(CHAIN_TOP);
    const chainTops = await Promise.all(pngs.map((png) => pngRgba(png, chainX, chainY)));
    // The plate's top border at its centre, and the stem of the I in MARINE, which the plate's centre falls on.
    const borders = await Promise.all(pngs.map((png) => pngRgba(png, 256, 448)));
    const inks = await Promise.all(pngs.map((png) => pngRgba(png, 256, 476)));
    expect({
      sizes: pngs.map(size),
      colorTypes: pngs.map((png) => png[25]),
      clear: corners.map((c) => c[3]),
      opaque: metals.map((m) => m[3]),
      distinct: new Set(metals.map((m) => m.slice(0, 3).join())).size,
      gold: gold[0]! > gold[2]! + 60,
      chain: chainTops.map((c) => c[3]! > 0),
      borders: borders.map((b) => [...b]),
      inks: inks.map((i) => [...i]),
    }).toEqual({
      sizes: TIERS.map(() => [512, 512]),
      colorTypes: [6, 6, 6, 6],
      clear: [0, 0, 0, 0],
      opaque: [255, 255, 255, 255],
      distinct: 4,
      gold: true,
      chain: [true, true, true, true],
      borders: TIERS.map((tier) => [...rgb(TIER_LOOKS[tier].color), 255]),
      inks: TIERS.map(() => [...rgb(INK.paleGold), 255]),
    });
  });

  it("stays under Telegram's 512 KB for a sticker", async () => {
    // #given
    const [red, blue] = await Promise.all([solid('#d01818'), solid('#1f6fb2')]);
    // #when
    const png = await cards().renderMarineSticker(webMarine('legendary', [red, blue]));
    // #then
    expect(png.byteLength).toBeLessThan(512 * 1024);
  });

  it('draws no name and no avatar, even when handed a whole card', async () => {
    // #given the full card of the same Marine, with a name and an avatar
    const red = await solid('#d01818');
    const full = marine('rare', [red], await solid('#00ff00')) as MarineWebCard;
    // #when
    const [fromFull, fromWeb] = await Promise.all([cards().renderMarineSticker(full), cards().renderMarineSticker(webMarine('rare', [red]))]);
    // #then
    expect([...fromFull]).toEqual([...fromWeb]);
  });
});
