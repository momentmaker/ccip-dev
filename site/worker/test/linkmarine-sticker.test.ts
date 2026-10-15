import { TIERS, type MarineWebCard } from '@ccip-dev/core/linkmarine';
import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { marine, webMarine } from '../../test/fixtures/linkmarine';
import { h } from '../h';
import { px } from '../linkmarine/art';
import { LinkMarineCards } from '../linkmarine/entrypoint';
import { FRONT_TAG, onTag, TAGS_DROP } from '../linkmarine/marine-card';
import { renderKino } from '../linkmarine/render';
import { STICKER_FIT } from '../linkmarine/sticker';
import { pngRgba } from './png';

const size = (png: Uint8Array) => [new DataView(png.buffer, png.byteOffset).getUint32(16), new DataView(png.buffer, png.byteOffset).getUint32(20)];
const solid = async (color: string) => (await renderKino(h('div', { style: { width: 240, height: 240, display: 'flex', backgroundColor: color } }), { width: 240, height: 240 })).png;
const cards = () => new LinkMarineCards(createExecutionContext(), {} as never);
/** A point on a tag, in the mockups' units, where it lands in the sticker. */
const inSticker = (p: { x: number; y: number }) => [Math.round(STICKER_FIT.left + px(p.x) * STICKER_FIT.scale), Math.round(px(p.y + TAGS_DROP) * STICKER_FIT.scale)] as const;

describe('the LinkMarineCards entrypoint: the sticker', () => {
  // Four stickers take about 40 s in workerd, which is too close to the 60 s default for a gate that runs before deploy.
  it('draws a 512×512 PNG with an alpha channel: clear around the tags, solid tier metal on them', { timeout: 120_000 }, async () => {
    // #given a red meme
    const red = await solid('#d01818');
    // #when
    const pngs = await Promise.all(TIERS.map((tier) => cards().renderMarineSticker(webMarine(tier, [red]))));
    // #then the corner is clear, and the front tag's bare metal is opaque and differs tier by tier, gold warm
    const [x, y] = inSticker(onTag(FRONT_TAG, 250, 40));
    const corners = await Promise.all(pngs.map((png) => pngRgba(png, 2, 2)));
    const metals = await Promise.all(pngs.map((png) => pngRgba(png, x, y)));
    const gold = metals[3]!;
    expect({
      sizes: pngs.map(size),
      colorTypes: pngs.map((png) => png[25]),
      clear: corners.map((c) => c[3]),
      opaque: metals.map((m) => m[3]),
      distinct: new Set(metals.map((m) => m.slice(0, 3).join())).size,
      gold: gold[0]! > gold[2]! + 60,
    }).toEqual({ sizes: TIERS.map(() => [512, 512]), colorTypes: [6, 6, 6, 6], clear: [0, 0, 0, 0], opaque: [255, 255, 255, 255], distinct: 4, gold: true });
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
