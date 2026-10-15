import type { MarineWebCard } from '@ccip-dev/core/linkmarine';
import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { marine, webMarine } from '../../test/fixtures/linkmarine';
import { h } from '../h';
import { px } from '../linkmarine/art';
import { LinkMarineCards } from '../linkmarine/entrypoint';
import { FRONT_TAG, onTag, TAGS_DROP } from '../linkmarine/marine-card';
import { renderKino } from '../linkmarine/render';
import { callsignSize, STORY_HEXES, STORY_TAGS } from '../linkmarine/story';
import { pngImage, pngPixel } from './png';

const size = (png: Uint8Array) => [new DataView(png.buffer, png.byteOffset).getUint32(16), new DataView(png.buffer, png.byteOffset).getUint32(20)];
const solid = async (color: string) => (await renderKino(h('div', { style: { width: 240, height: 240, display: 'flex', backgroundColor: color } }), { width: 240, height: 240 })).png;
const cards = () => new LinkMarineCards(createExecutionContext(), {} as never);
/** A point on a tag, in the mockups' units, where it lands on the Story card. */
const inStory = (p: { x: number; y: number }) => [Math.round(STORY_TAGS.left + px(p.x) * STORY_TAGS.scale), Math.round(STORY_TAGS.top + px(p.y + TAGS_DROP) * STORY_TAGS.scale)] as const;

describe('the LinkMarineCards entrypoint: the Story card', () => {
  it('draws a 1080×1920 card with the tags large in the tier metal', async () => {
    // #given a red meme
    const red = await solid('#d01818');
    // #when
    const png = await cards().renderMarineStory(webMarine('legendary', [red]));
    // #then the front tag's bare metal is gold
    const [x, y] = inStory(onTag(FRONT_TAG, 250, 40));
    const metal = await pngPixel(png, x, y);
    expect({ size: size(png), gold: metal[0]! > metal[2]! + 60 }).toEqual({ size: [1080, 1920], gold: true });
  });

  it('draws no name and no avatar, even when handed a whole card', async () => {
    // #given the full card of the same Marine, with a name and an avatar
    const red = await solid('#d01818');
    const full = marine('common', [red], await solid('#00ff00')) as MarineWebCard;
    // #when
    const [fromFull, fromWeb] = await Promise.all([cards().renderMarineStory(full), cards().renderMarineStory(webMarine('common', [red]))]);
    // #then
    expect([...fromFull]).toEqual([...fromWeb]);
  });

  it('clips each meme to its hexagon, none of it poking out past the slants', async () => {
    // #given a red meme in all three hexagons
    const red = await solid('#d01818');
    // #when
    const image = await pngImage(await cards().renderMarineStory(webMarine('legendary', [red])));
    // #then a point 2 px outside each right-hand slant, inside the gap before the frame, is background, and 2 px inside it, the meme
    const reds = STORY_HEXES.flatMap((hex) => {
      const x = Math.round(hex.left + 0.95 * hex.width);
      const upper = hex.top + (0.9 * hex.height) / 4;
      const lower = hex.top + hex.height - (0.9 * hex.height) / 4;
      return [image.at(x, Math.round(upper - 2))[0], image.at(x, Math.round(lower + 2))[0], image.at(x, Math.round(upper + 3))[0], image.at(x, Math.round(lower - 3))[0]];
    });
    expect(reds.map((r) => r > 150)).toEqual(STORY_HEXES.flatMap(() => [false, false, true, true]));
  });

  it('sets the callsign in the column, the longest one smaller', () => {
    // #then 23 characters, and three 13-character tags with their hyphens
    expect([callsignSize('painting-space-prophecy'), callsignSize('abcdefghijklm-abcdefghijklm-abcdefghijklm')]).toEqual([66, 35]);
  });
});
