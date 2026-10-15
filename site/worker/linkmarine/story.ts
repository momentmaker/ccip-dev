import { marineOdds, serialText, type MarineWebCard, type Tier } from '@ccip-dev/core/linkmarine';
import { h, type VNode } from '../h';
import { halo, hexClipInside, hexPoints, INK, KINO_SIZE, MONO, pngUri, svgDataUri } from './art';
import { TIER_LOOKS } from './metal';
import { TAGS_BOX } from './sticker';

export const STORY_SIZE = { width: 1080, height: 1920 } as const;
/** The chain's apex rises into the top 250 px, which Telegram covers with its own bar; the tags themselves sit below it. */
export const STORY_TAGS = { left: 40, top: 60, scale: 1000 / TAGS_BOX.width } as const;
const HEX = { width: 210, height: 242, gap: 45, top: 1290 } as const;
/** Top of each line's box. Everything of weight ends by y 1620: Telegram's reply bar covers the bottom of a Story. */
const ROW = { serial: 915, callsign: 990, tier: 1085, odds: 1215, labelGap: 24, footer: 1640 } as const;
const HALO_CENTER_Y = 470;
export const STORY_HEXES = [0, 1, 2].map((i) => ({ left: (STORY_SIZE.width - (3 * HEX.width + 2 * HEX.gap)) / 2 + i * (HEX.width + HEX.gap), top: HEX.top, width: HEX.width, height: HEX.height }));
const TEXT_WIDTH = 960;
/** JetBrains Mono advances 0.6 em, and the callsign's letter-spacing adds 2 px. */
const MONO_ADVANCE = 0.6;
const CALLSIGN_TRACKING = 2;

/** 76 px, smaller when a long callsign would run past the text column. */
export function callsignSize(callsign: string): number {
  return Math.min(76, Math.floor((TEXT_WIDTH / callsign.length - CALLSIGN_TRACKING) / MONO_ADVANCE));
}

const centred = (top: number, style: Record<string, unknown>, ...children: (VNode | string)[]): VNode =>
  h('div', { style: { position: 'absolute', left: 0, top, width: STORY_SIZE.width, display: 'flex', justifyContent: 'center', ...style } }, ...children);

function haloImage(tier: Tier): VNode {
  const look = TIER_LOOKS[tier];
  const rings = [
    { r: 330, width: 5, opacity: 0.55 },
    { r: 440, width: 3.5, opacity: 0.35 },
    { r: 560, width: 2.5, opacity: 0.22 },
    { r: 690, width: 2, opacity: 0.12 },
  ].map((r) => ({ ...r, opacity: Math.round(r.opacity * look.halo.strength * 100) / 100 }));
  const art = halo('story', 540, HALO_CENTER_Y, look.color, rings, look.halo.glow ? { r: 520, opacity: 0.3 * look.halo.strength } : null);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${STORY_SIZE.width}" height="${STORY_SIZE.height}" viewBox="0 0 ${STORY_SIZE.width} ${STORY_SIZE.height}"><defs>${art.defs}</defs>${art.body}</svg>`;
  return h('img', { src: svgDataUri(svg), width: STORY_SIZE.width, height: STORY_SIZE.height, style: { position: 'absolute', left: 0, top: 0, width: STORY_SIZE.width, height: STORY_SIZE.height } });
}

function memeHex(png: Uint8Array, left: number, color: string): VNode {
  const frame = svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${HEX.width + 20}" height="${HEX.height + 20}" viewBox="0 0 ${HEX.width + 20} ${HEX.height + 20}"><polygon points="${hexPoints((HEX.width + 20) / 2, (HEX.height + 20) / 2, HEX.height / 2 + 8)}" fill="none" stroke="${color}" stroke-width="5"/></svg>`,
  );
  return h(
    'div',
    { style: { position: 'absolute', left: left - 10, top: HEX.top - 10, width: HEX.width + 20, height: HEX.height + 20, display: 'flex' } },
    // A square box, so `cover` does not rescale the square meme and skew the clip's percentages; the hexagon is cut out of it.
    h('img', { src: pngUri(png), width: HEX.height, height: HEX.height, style: { position: 'absolute', left: 10 - (HEX.height - HEX.width) / 2, top: 10, width: HEX.height, height: HEX.height, objectFit: 'cover', clipPath: hexClipInside(2) } }),
    h('img', { src: frame, width: HEX.width + 20, height: HEX.height + 20, style: { position: 'absolute', left: 0, top: 0, width: HEX.width + 20, height: HEX.height + 20 } }),
  );
}

/** The tags arrive already drawn by tagsTree, the same pass as the sticker. Draws no name and no avatar. */
export function storyTree(card: MarineWebCard, tagsPng: Uint8Array): VNode {
  const look = TIER_LOOKS[card.tier];
  const odds = marineOdds(card.tier, card.percentile);
  const tagsWidth = Math.round(KINO_SIZE.width * STORY_TAGS.scale);
  const tagsHeight = Math.round(KINO_SIZE.height * STORY_TAGS.scale);
  return h(
    'div',
    { style: { width: STORY_SIZE.width, height: STORY_SIZE.height, display: 'flex', position: 'relative', backgroundColor: INK.navy, fontFamily: 'Inter', color: INK.text } },
    h('div', { style: { position: 'absolute', left: 0, top: 0, width: STORY_SIZE.width, height: STORY_SIZE.height, display: 'flex', backgroundImage: 'radial-gradient(circle at 50% 100%, #1d3a7a 0%, #1d3a7a00 55%)' } }),
    haloImage(card.tier),
    h('img', { src: pngUri(tagsPng), width: tagsWidth, height: tagsHeight, style: { position: 'absolute', left: STORY_TAGS.left, top: STORY_TAGS.top, width: tagsWidth, height: tagsHeight } }),
    centred(ROW.serial, { fontFamily: MONO, fontWeight: 700, fontSize: 52, color: INK.paleGold, letterSpacing: 6 }, `LINK MARINE #${serialText(card.serial)}`),
    centred(ROW.callsign, { fontFamily: MONO, fontWeight: 700, fontSize: callsignSize(card.callsign), color: INK.text, letterSpacing: CALLSIGN_TRACKING }, card.callsign.toUpperCase()),
    centred(ROW.tier, { fontFamily: 'Inter', fontWeight: 900, fontSize: 120, color: 'transparent', backgroundImage: look.word, backgroundClip: 'text', lineHeight: 1 }, card.tier.toUpperCase()),
    ...(odds === null ? [] : [centred(ROW.odds, { fontFamily: MONO, fontWeight: 700, fontSize: 34, color: look.accent }, odds)]),
    ...card.memes.map((m, i) => memeHex(m.png, STORY_HEXES[i]!.left, look.color)),
    ...card.memes.map((m, i) =>
      h('div', { style: { position: 'absolute', left: STORY_HEXES[i]!.left - 40, top: HEX.top + HEX.height + ROW.labelGap, width: HEX.width + 80, display: 'flex', justifyContent: 'center', fontFamily: MONO, fontWeight: 700, fontSize: 32, color: INK.text } }, m.tag),
    ),
    centred(ROW.footer, { fontFamily: MONO, fontWeight: 700, fontSize: 36, color: INK.blue, letterSpacing: 4 }, 'ccip.dev · LinkMarines'),
  );
}
