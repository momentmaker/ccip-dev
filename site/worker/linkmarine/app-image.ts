import type { MarineWebCard } from '@ccip-dev/core/linkmarine';
import { h, type VNode } from '../h';
import { INK, KINO_SIZE, MONO, pngUri } from './art';
import { TIER_LOOKS } from './metal';
import { TAGS_BOX } from './sticker';

/** The Mini App's photo in @BotFather: 640×360. */
export const APP_IMAGE_SIZE = { width: 640, height: 360 } as const;
const TAGS_SCALE = 340 / TAGS_BOX.height;

export function appImageTree(card: MarineWebCard, tagsPng: Uint8Array): VNode {
  const look = TIER_LOOKS[card.tier];
  const width = Math.round(KINO_SIZE.width * TAGS_SCALE);
  const height = Math.round(KINO_SIZE.height * TAGS_SCALE);
  return h(
    'div',
    { style: { width: APP_IMAGE_SIZE.width, height: APP_IMAGE_SIZE.height, display: 'flex', position: 'relative', backgroundColor: INK.navy, fontFamily: 'Inter', color: INK.text } },
    h('div', { style: { position: 'absolute', left: 0, top: 0, width: APP_IMAGE_SIZE.width, height: APP_IMAGE_SIZE.height, display: 'flex', backgroundImage: `radial-gradient(circle at 28% 50%, ${look.color}55 0%, ${look.color}00 60%)` } }),
    h('img', { src: pngUri(tagsPng), width, height, style: { position: 'absolute', left: 4, top: 10, width, height } }),
    h(
      'div',
      { style: { position: 'absolute', left: 356, top: 100, width: 268, display: 'flex', flexDirection: 'column' } },
      h('div', { style: { fontFamily: MONO, fontWeight: 700, fontSize: 15, color: INK.blue, letterSpacing: 3 } }, 'ccip.dev'),
      h('div', { style: { fontFamily: 'Inter', fontWeight: 900, fontSize: 38, lineHeight: 1.1, marginTop: 8, color: 'transparent', backgroundImage: look.word, backgroundClip: 'text' } }, 'LinkMarines'),
      h('div', { style: { fontFamily: 'Inter', fontWeight: 700, fontSize: 20, lineHeight: 1.35, marginTop: 14, color: INK.text } }, 'Enlist, Marine.'),
      h('div', { style: { fontFamily: 'Inter', fontWeight: 400, fontSize: 16, lineHeight: 1.4, marginTop: 6, color: INK.sub } }, 'Three meme tags become your callsign. One draw, forever.'),
    ),
  );
}
