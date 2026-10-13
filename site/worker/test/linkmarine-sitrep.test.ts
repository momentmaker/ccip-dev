import { describe, expect, it } from 'vitest';
import { BASE, DOSSIER, ETHEREUM, SITREP } from '../../test/fixtures/linkmarine';
import { px } from '../linkmarine/art';
import { chainArts } from '../linkmarine/chain-hex';
import { dossierTree } from '../linkmarine/dossier-card';
import { renderKino } from '../linkmarine/render';
import { LANE_SLOTS, sitrepTree } from '../linkmarine/sitrep-card';

const RED_SQUARE = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="#ff0000"/></svg>';
/** The site's assets with every chain icon missing but the ones given. */
const assets = (icons: Record<string, string>) => ({
  fetch: async (request: Request | string) => {
    const path = new URL(typeof request === 'string' ? request : request.url).pathname;
    return path in icons ? new Response(icons[path]) : new Response('missing', { status: 404 });
  },
});
const pixel = (r: { pixels: Uint8Array; width: number }, x: number, y: number) => [...r.pixels.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 3)];

describe('the SITREP and dossier cards', () => {
  it("fill each chain's hexagon with its icon from the site's assets, in its own colour", async () => {
    // #given Ethereum's icon is a red square, and Base's
    const arts = await chainArts(assets({ '/chains/ethereum-mainnet.svg': RED_SQUARE, '/chains/ethereum-mainnet-base-1.svg': RED_SQUARE }), [ETHEREUM.selector, BASE.selector]);
    // #when
    const [sitrep, dossier] = await Promise.all([renderKino(sitrepTree(SITREP, arts)), renderKino(dossierTree(DOSSIER, arts))]);
    // #then Ethereum sits in the busiest seat, Base is the dossier's hero at (200, 218), both red to the hexagon's tip
    const seat = LANE_SLOTS[0]!;
    expect({
      size: [sitrep.width, sitrep.height, dossier.width, dossier.height],
      ethereum: pixel(sitrep, Math.round(px(seat.x)), Math.round(px(seat.y))),
      tip: pixel(sitrep, Math.round(px(seat.x)), Math.round(px(seat.y - 23))),
      base: pixel(dossier, Math.round(px(200)), Math.round(px(218))),
      art: [arts.get(ETHEREUM.selector)!.bg, arts.get(ETHEREUM.selector)!.glow],
    }).toEqual({ size: [1200, 675, 1200, 675], ethereum: [255, 0, 0], tip: [255, 0, 0], base: [255, 0, 0], art: ['#ff0000', '#ff4d4d'] });
  });
});
