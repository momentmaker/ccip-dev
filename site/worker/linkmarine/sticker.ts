import { serialText, type MarineWebCard } from '@ccip-dev/core/linkmarine';
import { bytesToBase64 } from '../cards/coin-icons';
import { h, type VNode } from '../h';
import { INK, KINO_SIZE, MONO } from './art';
import { TIER_LOOKS } from './metal';

/** Telegram's static stickers: 512 px on a side, a PNG with transparency, at most 512 KB. */
export const STICKER_SIZE = { width: 512, height: 512 } as const;
/** What tagsTree draws on, in card pixels from its top left: the tags, the chain and the tags' shadow all fall inside. */
export const TAGS_BOX = { width: 700, height: 675 } as const;
const PLATE_H = 64;
const SCALE = Math.min(STICKER_SIZE.width / TAGS_BOX.width, (STICKER_SIZE.height - PLATE_H) / TAGS_BOX.height);
export const STICKER_FIT = { scale: SCALE, left: Math.round((STICKER_SIZE.width - TAGS_BOX.width * SCALE) / 2) } as const;

export const pngUri = (bytes: Uint8Array) => `data:image/png;base64,${bytesToBase64(bytes)}`;

export function stickerTree(card: MarineWebCard, tagsPng: Uint8Array): VNode {
  const width = Math.round(KINO_SIZE.width * STICKER_FIT.scale);
  const height = Math.round(KINO_SIZE.height * STICKER_FIT.scale);
  const look = TIER_LOOKS[card.tier];
  return h(
    'div',
    { style: { width: STICKER_SIZE.width, height: STICKER_SIZE.height, display: 'flex', position: 'relative' } },
    h('img', { src: pngUri(tagsPng), width, height, style: { position: 'absolute', left: STICKER_FIT.left, top: 0, width, height } }),
    h(
      'div',
      { style: { position: 'absolute', left: 0, top: STICKER_SIZE.height - PLATE_H, width: STICKER_SIZE.width, height: PLATE_H - 8, display: 'flex', justifyContent: 'center', alignItems: 'center' } },
      h(
        'div',
        { style: { display: 'flex', padding: '6px 18px', borderRadius: 28, backgroundColor: '#0a0f1ee6', border: `3px solid ${look.color}`, fontFamily: MONO, fontWeight: 700, fontSize: 30, color: INK.paleGold, letterSpacing: 2 } },
        `LINK MARINE #${serialText(card.serial)}`,
      ),
    ),
  );
}
