import { TIERS } from '@ccip-dev/core/linkmarine';
import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { marine, webMarine } from '../../test/fixtures/linkmarine';
import { h } from '../h';
import { LinkMarineCards } from '../linkmarine/entrypoint';
import { px } from '../linkmarine/art';
import { BACK_TAG, FRONT_TAG, onTag } from '../linkmarine/marine-card';
import { renderKino } from '../linkmarine/render';
import { pngPixel } from './png';

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
/** A 16×16 JPEG, red on the left half and blue on the right. */
const JPEG = bytes('/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAEAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAQEBAQEBAgEBAgMCAgIDBAMDAwMEBQQEBAQEBQYFBQUFBQUGBgYGBgYGBgcHBwcHBwgICAgICQkJCQkJCQkJCf/bAEMBAQEBAgICBAICBAkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCf/dAAQAAf/aAAwDAQACEQMRAD8A+F6+R6+uK+R6/vz9gP8A81Z/3Jf+7Z/qB/pBX/NI/wDc9/7pn//Z');
/** An 8×8 GIF of two frames, red then blue. */
const GIF = bytes('R0lGODlhCAAIAIEAAMgeHgAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAACAAIAAAIDwABCBxIsKDBgwgTKkwYEAAh+QQBCgABACwAAAAACAAIAIEeHsgAAAAAAAAAAAAIDwABCBxIsKDBgwgTKkwYEAA7');

const size = (png: Uint8Array) => [new DataView(png.buffer, png.byteOffset).getUint32(16), new DataView(png.buffer, png.byteOffset).getUint32(20)];
const solid = async (color: string) => (await renderKino(h('div', { style: { width: 240, height: 240, display: 'flex', backgroundColor: color } }), { width: 240, height: 240 })).png;
const cards = () => new LinkMarineCards(createExecutionContext(), {} as never);
const at = (p: { x: number; y: number }) => [Math.round(px(p.x)), Math.round(px(p.y))] as const;

describe('the LinkMarineCards entrypoint: memes', () => {
  it('keeps a JPEG, a PNG or a GIF meme as a 240×240 PNG, an animated GIF by its first frame', async () => {
    // #when
    const [fromJpeg, fromPng, fromGif] = await Promise.all([cards().prepareMeme(JPEG), cards().prepareMeme(await solid('#336699')), cards().prepareMeme(GIF)]);
    // #then
    const [r, g] = await pngPixel(fromGif, 120, 120);
    expect({ sizes: [fromJpeg, fromPng, fromGif].map(size), signature: [...fromJpeg.slice(0, 4)], firstFrame: r > 150 && g < 80 }).toEqual({
      sizes: [[240, 240], [240, 240], [240, 240]],
      signature: [137, 80, 78, 71],
      firstFrame: true,
    });
  });

  it('refuses bytes that are not an image', async () => {
    // #then
    await expect(cards().prepareMeme(new TextEncoder().encode('<html>404</html>'))).rejects.toThrow('not a JPEG, PNG or GIF');
  });
});

describe('the LinkMarineCards entrypoint: the dog tag card', () => {
  it('renders every tier at 1200×675, each tag in its own metal', async () => {
    // #given a red meme
    const red = await solid('#d01818');
    // #when
    const pngs = await Promise.all(TIERS.map((tier) => cards().renderMarineCard(marine(tier, [red]))));
    // #then the front tag's bare metal at its upper right differs tier by tier, gold is warm
    const [x, y] = at(onTag(FRONT_TAG, 250, 40));
    const metals = await Promise.all(pngs.map((png) => pngPixel(png, x, y)));
    const gold = metals[3]!;
    expect({ sizes: pngs.map(size), distinct: new Set(metals.map((m) => m.join())).size, gold: gold[0]! > gold[2]! + 60 }).toEqual({ sizes: TIERS.map(() => [1200, 675]), distinct: 4, gold: true });
  });

  it('etches the memes into the back tag without colour, and shows them in colour as planets', async () => {
    // #given a red meme and a white one; painting-space-prophecy puts its first planet at (580, 214)
    const [red, white] = await Promise.all([solid('#d01818'), solid('#ffffff')]);
    const [onRed, onWhite] = await Promise.all([cards().renderMarineCard(marine('legendary', [red])), cards().renderMarineCard(marine('legendary', [white]))]);
    // #when the third etching, above the front tag, and the first planet's centre
    const [ex, ey] = at(onTag(BACK_TAG, 254, 50));
    const [etchedRed, etchedWhite, planet] = await Promise.all([pngPixel(onRed, ex, ey), pngPixel(onWhite, ex, ey), pngPixel(onRed, Math.round(px(580)), Math.round(px(214)))]);
    // #then the etching follows the meme but loses its red; the planet keeps it
    expect({ etched: etchedWhite[0]! - etchedRed[0]! > 100, etchedRed: etchedRed[0]! - etchedRed[1]! > 60, planetRed: planet[0]! - planet[1]! > 120 }).toEqual({ etched: true, etchedRed: false, planetRed: true });
  });
});

describe('the LinkMarineCards entrypoint: the web card', () => {
  it('renders the roster’s card at 1200×675', async () => {
    // #given a red meme
    const red = await solid('#d01818');
    // #when
    const png = await cards().renderMarineWebCard(webMarine('legendary', [red]));
    // #then
    expect(size(png)).toEqual([1200, 675]);
  });
});
