import { callsignSeed, filledPips, rimText, seededRandom, serialText, marineOdds, type MarineCard, type MarineWebCard, type Tier } from '@ccip-dev/core/linkmarine';
import { h, type VNode } from '../h';
import { artLayer, at, capDay, DOT_FILTER, drawable, font, halo, type HaloRing, hexClipCentred, hexImage, hexPoints, INK, KINO_SIZE, MONO, onCurve, pips, pngUri, pulse, px, r1, skyLayer } from './art';
import { cssLinear, cssRadialSpot, HOLO_STOPS, TIER_LOOKS, type TierLook } from './metal';

export interface TagBox {
  left: number;
  top: number;
  width: number;
  height: number;
  rotate: number;
}

export const BACK_TAG: TagBox = { left: 58, top: 92, width: 300, height: 176, rotate: -11 };
export const FRONT_TAG: TagBox = { left: 96, top: 150, width: 300, height: 176, rotate: 5 };
export const TAG_RADIUS = 40;
const HOLE = { x: 32, y: 88, r: 10 };
/** The front tag's text column: from the 58 px left padding to 20 px short of the right edge. */
const LORE_WIDTH = 222;
const RIM_INSET = 6;
const RIM_FONT = 6.5;
/** JetBrains Mono advances 0.6 em, and the rim's letter-spacing adds 0.22 em. */
const RIM_ADVANCE = RIM_FONT * (0.6 + 0.22);
/** The rim microtext stays on the bottom edge's straight part, between the rounded corners, less a small inset. */
const RIM_SPAN = FRONT_TAG.width - 2 * (TAG_RADIUS + RIM_INSET);
export const RIM_BUDGET = Math.floor(RIM_SPAN / RIM_ADVANCE);
export const CHAIN_TOP = { x: 260, y: -10 };
/** The etching: the mockup's grayscale(1) contrast(1.7) brightness(.95), toned towards the metal. */
export const ETCH_FILTER = 'grayscale(1) contrast(1.7) brightness(0.95) sepia(0.35)';
const ETCH_OPACITY = 0.62;
/** The three etched memes on the back tag, in the tag's own mockup units. */
export const ETCH_HEX = { left: 62, top: 30, width: 64, height: 72, gap: 10 } as const;

const HALO_CENTER = { x: 225, y: 230 };
const HALO_RINGS: readonly HaloRing[] = [
  { r: 150, width: 3, opacity: 0.55 },
  { r: 200, width: 2, opacity: 0.35 },
  { r: 255, width: 1.5, opacity: 0.22 },
  { r: 315, width: 1, opacity: 0.12 },
];

interface Point {
  x: number;
  y: number;
}

/**
 * Three planet layouts, picked by the callsign, in the mockups' coordinates: the planets (the first tag's first) and the
 * control points of the lanes A→B, B→C and A→C, bent so that no lane crosses a planet's label.
 */
export const PLANET_LAYOUTS: readonly { planets: readonly [Point, Point, Point]; lanes: readonly [Point, Point, Point] }[] = [
  { planets: [{ x: 478, y: 262 }, { x: 668, y: 212 }, { x: 600, y: 340 }], lanes: [{ x: 570, y: 170 }, { x: 600, y: 260 }, { x: 510, y: 360 }] },
  { planets: [{ x: 682, y: 262 }, { x: 492, y: 212 }, { x: 560, y: 340 }], lanes: [{ x: 590, y: 170 }, { x: 560, y: 260 }, { x: 650, y: 360 }] },
  { planets: [{ x: 580, y: 214 }, { x: 470, y: 318 }, { x: 690, y: 300 }], lanes: [{ x: 490, y: 230 }, { x: 580, y: 390 }, { x: 660, y: 220 }] },
];
export const PLANET_R = [46, 40, 30];

/** A point of a tag's own coordinates, where it lands on the card once the tag is turned about its centre. */
export function onTag(tag: TagBox, x: number, y: number): { x: number; y: number } {
  const cx = tag.left + tag.width / 2;
  const cy = tag.top + tag.height / 2;
  const a = (tag.rotate * Math.PI) / 180;
  const dx = tag.left + x - cx;
  const dy = tag.top + y - cy;
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
}

/** The card's look drawn from its callsign: the planet layout and the halo's turn. */
export function skyChoices(callsign: string): { seed: number; layout: number; haloTurn: number } {
  const seed = callsignSeed(callsign);
  const random = seededRandom(seed ^ 0x5bd1e995);
  return { seed, layout: Math.floor(random() * PLANET_LAYOUTS.length), haloTurn: r1((random() * 2 - 1) * 6) };
}

const roundRect = (y: number, w: number, hgt: number, r: number) =>
  `M0 ${y + r}a${r} ${r} 0 0 1 ${r} -${r}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${hgt - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1 -${r} -${r}z`;

/** A tag as the mockup's CSS draws it: shadow, metal, patina or brushing, sheen, inset edges, inner rim and the hole. */
function tagSvg(id: string, tag: TagBox, look: TierLook): { defs: string; body: string } {
  const { width: w, height: hgt } = tag;
  const R = TAG_RADIUS;
  // An inset shadow offset by dy: the tag less the tag moved by dy, inside the tag.
  const inset = (dy: number, fill: string, opacity: number) => `<path d="${roundRect(0, w, hgt, R)}${roundRect(dy, w, hgt, R)}" fill="${fill}" fill-opacity="${opacity}" fill-rule="evenodd"/>`;
  const plate = (fill: string, extra = '') => `<rect width="${w}" height="${hgt}" rx="${R}" fill="${fill}"${extra}/>`;
  const defs = [
    cssLinear(`${id}-metal`, look.metal.angle, w, hgt, look.metal.stops),
    ...look.metal.spots.map((s, i) => cssRadialSpot(`${id}-spot${i}`, s.x, s.y, w, hgt, s.stops)),
    look.sheen ? cssLinear(`${id}-sheen`, 115, w, hgt, HOLO_STOPS) : '',
    `<clipPath id="${id}-clip"><rect width="${w}" height="${hgt}" rx="${R}"/></clipPath>`,
    `<filter id="${id}-shadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="20"/></filter>`,
    look.metal.brushed ? `<pattern id="${id}-brush" width="3" height="${hgt}" patternUnits="userSpaceOnUse" patternTransform="rotate(2)"><rect width="1" height="${hgt}" fill="#fff" fill-opacity="0.063"/></pattern>` : '',
  ].join('');
  const body = [
    `<g transform="translate(${tag.left} ${tag.top}) rotate(${tag.rotate} ${w / 2} ${hgt / 2})">`,
    `<rect y="18" width="${w}" height="${hgt}" rx="${R}" fill="#000" opacity="0.73" filter="url(#${id}-shadow)"/>`,
    plate(`url(#${id}-metal)`),
    ...look.metal.spots.map((_, i) => plate(`url(#${id}-spot${i})`)),
    look.metal.brushed ? plate(`url(#${id}-brush)`) : '',
    look.sheen ? plate(`url(#${id}-sheen)`, ` opacity="${look.sheen === 'holo' ? 1 : 0.6}" style="mix-blend-mode:overlay"`) : '',
    `<g clip-path="url(#${id}-clip)">${inset(2, '#fff', 0.6)}${inset(-3, '#000', 0.33)}</g>`,
    `<rect x="10" y="10" width="${w - 20}" height="${hgt - 20}" rx="32" fill="none" stroke="#000" stroke-opacity="0.13" stroke-width="2"/>`,
    `<rect x="11" y="11" width="${w - 20}" height="${hgt - 20}" rx="32" fill="none" stroke="#fff" stroke-opacity="0.27" stroke-width="1.5"/>`,
    `<circle cx="${HOLE.x}" cy="${HOLE.y + 1}" r="${HOLE.r}" fill="#fff" fill-opacity="0.4"/>`,
    `<circle cx="${HOLE.x}" cy="${HOLE.y}" r="${HOLE.r}" fill="${INK.navy}"/>`,
    `<circle cx="${HOLE.x}" cy="${HOLE.y - 1}" r="${HOLE.r - 1.5}" fill="none" stroke="#000" stroke-opacity="0.85" stroke-width="2"/>`,
    '</g>',
  ].join('');
  return { defs, body };
}

function chainSvg(): string {
  const back = onTag(BACK_TAG, HOLE.x, HOLE.y);
  const front = onTag(FRONT_TAG, HOLE.x, HOLE.y);
  const bead = (d: string) =>
    `<path d="${d}" stroke="#5b6472" stroke-width="7" stroke-linecap="round" stroke-dasharray="0 10" fill="none" transform="translate(0.8 1)"/>` +
    `<path d="${d}" stroke="#d9dee6" stroke-width="7" stroke-linecap="round" stroke-dasharray="0 10" fill="none"/>`;
  return (
    bead(`M${CHAIN_TOP.x} ${CHAIN_TOP.y} C 200 40, 110 120, ${r1(back.x)} ${r1(back.y)}`) +
    bead(`M${CHAIN_TOP.x} ${CHAIN_TOP.y} C 250 80, 135 150, ${r1(front.x)} ${r1(front.y)}`)
  );
}

function sparkles(): string {
  const spark = (x: number, y: number, s: number) =>
    `<g transform="translate(${x} ${y}) scale(${s})"><circle r="5" fill="#ffe9a8" opacity="0.7" filter="url(#dot)"/><rect x="-7" y="-0.7" width="14" height="1.4" fill="#fff"/><rect x="-0.7" y="-7" width="1.4" height="14" fill="#fff"/><circle r="1.4" fill="#fff"/></g>`;
  return spark(81, 147, 1) + spark(379, 203, 0.7) + spark(337, 345, 1.2);
}

interface Planet {
  x: number;
  y: number;
  r: number;
  filled: number;
}

function planetsSvg(planets: readonly Planet[], ctrls: readonly [Point, Point, Point], look: TierLook): { under: string; over: string; defs: string } {
  const [a, b, c] = planets as [Planet, Planet, Planet];
  const lanes = [
    { from: a, to: b, ctrl: ctrls[0], color: look.color, alpha: '88' },
    { from: b, to: c, ctrl: ctrls[1], color: INK.lane, alpha: '77' },
    { from: a, to: c, ctrl: ctrls[2], color: INK.lane, alpha: '77' },
  ];
  const lanePaths = lanes
    .map((l) => `<path d="M${l.from.x} ${l.from.y} Q ${r1(l.ctrl.x)} ${r1(l.ctrl.y)} ${l.to.x} ${l.to.y}" stroke="${l.color}${l.alpha}" stroke-width="1.6" fill="none"/>`)
    .join('');
  const pulses = lanes.map((l) => onCurve(l.from, l.ctrl, l.to, 0.42)).map((p) => pulse(p.x, p.y, 4.5)).join('');
  const glows = planets.map((p) => `<polygon points="${hexPoints(p.x, p.y, p.r + 6)}" fill="${look.color}" opacity="0.55" filter="url(#planet-glow)"/>`).join('');
  const frames = planets
    .map(
      (p) =>
        `<polygon points="${hexPoints(p.x, p.y, p.r)}" fill="none" stroke="${look.color}" stroke-width="2.5"/>` +
        (p.filled === 3
          ? `<polygon points="${hexPoints(p.x, p.y, p.r + 9)}" fill="none" stroke="${look.accent}" stroke-width="1.6" opacity="0.9"/><polygon points="${hexPoints(p.x, p.y, p.r + 15)}" fill="none" stroke="${look.accent}" stroke-width="1" opacity="0.45"/>`
          : ''),
    )
    .join('');
  return {
    defs: '<filter id="planet-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>',
    under: lanePaths + pulses + glows,
    over: frames,
  };
}

/** Embossed type on the metal: a light edge up-left, a dark one down-right. */
const emboss = (ink: string, size: number) => ({ color: ink, textShadow: `-${px(size)}px -${px(size)}px 0 #ffffff99, ${px(size)}px ${px(size)}px 0 #00000066` });

function tagFace(tag: TagBox, ...children: VNode[]): VNode {
  return at(tag.left, tag.top, { width: px(tag.width), height: px(tag.height), transform: `rotate(${tag.rotate}deg)` }, ...children);
}

/** The lore rows' type size: 11 as in the mockup, smaller when a long line (FAITH FUNDAMENTALS) would run off the tag. */
export function loreSize(rows: readonly string[]): number {
  const longest = Math.max(...rows.map((r) => r.length));
  return Math.min(11, Math.floor((LORE_WIDTH / (longest * 0.7)) * 10) / 10);
}

export const loreRows = (card: MarineCard | MarineWebCard) => [`LM ${serialText(card.serial)} · BLOOD ${card.blood}`, `FAITH ${card.faith} · ${capDay(card.enlistedAt)}`];

function frontText(card: MarineCard | MarineWebCard, look: TierLook): VNode {
  const lines = card.callsign.toUpperCase().split('-');
  const rows = loreRows(card);
  const size = loreSize(rows);
  const line = (text: string) => h('div', { style: { ...font(MONO, 800, 21, look.ink, 0.03), ...emboss(look.ink, 1), lineHeight: 1.18 } }, text);
  const small = (text: string) => h('div', { style: { ...font(MONO, 800, size, `${look.ink}cc`, 0.1), ...emboss(`${look.ink}cc`, 1), lineHeight: 1.5 } }, text);
  return tagFace(
    FRONT_TAG,
    h(
      'div',
      { style: { position: 'absolute', left: px(58), top: px(22), display: 'flex', flexDirection: 'column' } },
      ...lines.map(line),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', marginTop: px(6) } },
        ...rows.map(small),
      ),
    ),
    h(
      'div',
      { style: { position: 'absolute', left: px(TAG_RADIUS + RIM_INSET), top: px(FRONT_TAG.height - 13 - 9), width: px(RIM_SPAN), display: 'flex', justifyContent: 'center' } },
      h('div', { style: { ...font(MONO, 700, RIM_FONT, `${look.ink}aa`, 0.22), textShadow: `-${px(0.5)}px -${px(0.5)}px 0 #ffffff88` } }, rimText(callsignSeed(card.callsign), RIM_BUDGET)),
    ),
  );
}

function backEtch(card: MarineCard | MarineWebCard, look: TierLook): VNode {
  // Square boxes, as hexImage's: Satori skews a clip-path on a box narrower than its cover-scaled meme.
  const etchSide = px(ETCH_HEX.height);
  return tagFace(
    BACK_TAG,
    h(
      'div',
      { style: { position: 'absolute', left: px(ETCH_HEX.left), top: px(ETCH_HEX.top), display: 'flex' } },
      ...card.memes.map((m, i) =>
        h('img', {
          src: pngUri(m.png),
          width: etchSide,
          height: etchSide,
          style: {
            position: 'absolute', left: px(i * (ETCH_HEX.width + ETCH_HEX.gap) - (ETCH_HEX.height - ETCH_HEX.width) / 2), top: 0, width: etchSide, height: etchSide, objectFit: 'cover', clipPath: hexClipCentred(ETCH_HEX.height, ETCH_HEX.width),
            // The mockup multiplies a grey, contrasty meme onto the metal; Satori has no blend modes, so a sepia tint and transparency stand in.
            filter: ETCH_FILTER, opacity: ETCH_OPACITY,
          },
        }),
      ),
    ),
    h('div', { style: { position: 'absolute', left: px(64), top: px(108), ...font(MONO, 800, 10, `${look.ink}aa`, 0.14), textShadow: `-${px(1)}px -${px(1)}px 0 #ffffff88` } }, 'LINK MARINES · ccip.dev'),
  );
}

/** The stamped name as the card can draw it; a name of emoji alone becomes "Marine". */
export function cardName(name: string): string {
  return drawable(name) || 'Marine';
}

function avatarNode(card: MarineCard): VNode {
  const size = px(26);
  const disc = { width: size, height: size, borderRadius: size / 2, flexShrink: 0 };
  return card.avatar
    ? h('img', { src: pngUri(card.avatar), width: size, height: size, style: { ...disc, objectFit: 'cover' } })
    : h('div', { style: { ...disc, backgroundImage: 'linear-gradient(135deg, #2f62df, #a27bf0)' } });
}

const TIER_WORD: Readonly<Record<Tier, string>> = { common: 'COMMON', uncommon: 'UNCOMMON', rare: 'RARE', legendary: 'LEGENDARY' };

function panel(card: MarineCard | MarineWebCard, look: TierLook): VNode {
  const odds = marineOdds(card.tier, card.percentile);
  // The web card keeps the row's height, so the tier word and the odds stay where the posted card has them.
  const stamp =
    'name' in card
      ? h('div', { style: { display: 'flex', alignItems: 'center' } }, avatarNode(card), h('div', { style: { ...font('Inter', 700, 14, INK.text), marginLeft: px(8), maxWidth: px(260), overflow: 'hidden', textOverflow: 'ellipsis' } }, cardName(card.name)))
      : h('div', { style: { display: 'flex', height: px(26) } });
  return at(
    430,
    30,
    { width: px(300), flexDirection: 'column' },
    stamp,
    h(
      'div',
      { style: { ...font('Inter', 900, 46, 'transparent', 0.02), lineHeight: 1, marginTop: px(16), backgroundImage: look.word, backgroundClip: 'text', filter: `drop-shadow(0 ${px(2)}px ${px(10)}px ${look.color}55)` } },
      TIER_WORD[card.tier],
    ),
    ...(odds === null ? [] : [h('div', { style: { ...font(MONO, 700, 13, look.accent), marginTop: px(10) } }, odds)]),
  );
}

function planetLabel(p: Planet, tag: string, count: number, look: TierLook): VNode {
  return at(
    p.x - 70,
    p.y + p.r + (p.filled === 3 ? 18 : 8),
    { width: px(140), flexDirection: 'column', alignItems: 'center' },
    h('div', { style: { ...font(MONO, 700, 11, INK.text), textShadow: `0 ${px(1)}px ${px(4)}px #000` } }, tag),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', marginTop: px(2) } },
      pips(p.filled, px(8), look.accent),
      h('div', { style: { ...font(MONO, 700, 10, INK.gold), marginLeft: px(5), textShadow: `0 ${px(1)}px ${px(4)}px #000` } }, `${count} ${count === 1 ? 'meme' : 'memes'}`),
    ),
  );
}

/** The roster's card from any card: only the fields it draws, so a stamped Discord name or avatar can never reach it. */
export function webCardOf(card: MarineWebCard): MarineWebCard {
  return { serial: card.serial, callsign: card.callsign, tier: card.tier, percentile: card.percentile, memes: card.memes, blood: card.blood, faith: card.faith, enlistedAt: card.enlistedAt };
}

/** The dog tag card: two tags on a ball chain over the tier's halo, and the panel with the meme planets. */
export function marineTree(card: MarineCard | MarineWebCard): VNode {
  const look = TIER_LOOKS[card.tier];
  const { seed, layout, haloTurn } = skyChoices(card.callsign);
  const strength = look.halo.strength;
  const glow = halo(
    'halo',
    HALO_CENTER.x,
    HALO_CENTER.y,
    look.color,
    HALO_RINGS.map((r) => ({ ...r, opacity: r1(r.opacity * strength * 100) / 100 })),
    look.halo.glow ? { r: 230, opacity: 0.3 * strength } : null,
    haloTurn,
  );
  const back = tagSvg('back', BACK_TAG, look);
  const front = tagSvg('front', FRONT_TAG, look);
  const chosen = PLANET_LAYOUTS[layout]!;
  const planets = chosen.planets.map((c, i): Planet => ({ ...c, r: PLANET_R[i]!, filled: filledPips(card.memes[i]!.count) }));
  const orbit = planetsSvg(planets, chosen.lanes, look);
  return h(
    'div',
    { style: { width: KINO_SIZE.width, height: KINO_SIZE.height, display: 'flex', position: 'relative', backgroundColor: INK.navy, fontFamily: 'Inter', color: INK.text } },
    skyLayer(seed, [{ x: 212.8, y: 192.6, color: `${look.color}33`, stop: 0.42 }, { x: 608, y: 42.8, color: '#1d3a7a', stop: 0.55 }], glow.body + back.body, glow.defs + back.defs),
    backEtch(card, look),
    artLayer(front.body, front.defs),
    frontText(card, look),
    artLayer(chainSvg() + (look.sparkles ? sparkles() : '') + orbit.under, DOT_FILTER + orbit.defs),
    ...planets.map((p, i) => hexImage(pngUri(card.memes[i]!.png), p.x, p.y, p.r)),
    artLayer(orbit.over),
    panel(card, look),
    ...planets.map((p, i) => planetLabel(p, card.memes[i]!.tag, card.memes[i]!.count, look)),
    at(30, 393, { ...font(MONO, 800, 15, INK.paleGold, 0.12), textShadow: `0 0 ${px(12)}px #f5c45155` }, `LINK MARINE #${serialText(card.serial)}`),
    at(680, 395, { width: px(50), justifyContent: 'flex-end', ...font(MONO, 700, 13, INK.blue) }, 'ccip.dev'),
  );
}

/** How far the tags come down from where the card hangs them, in the mockups' units, so the ball chain's top stays in frame. */
export const TAGS_DROP = 24;

/**
 * The two tags on their ball chain and nothing else, at the card's size on a transparent ground: the art of the
 * sticker and the Story card. It draws the callsign, the serial and the lore, never a name or an avatar.
 */
export function tagsTree(card: MarineWebCard): VNode {
  const look = TIER_LOOKS[card.tier];
  const back = tagSvg('back', BACK_TAG, look);
  const front = tagSvg('front', FRONT_TAG, look);
  return h(
    'div',
    { style: { width: KINO_SIZE.width, height: KINO_SIZE.height, display: 'flex', position: 'relative', fontFamily: 'Inter', color: INK.text } },
    h(
      'div',
      { style: { position: 'absolute', left: 0, top: px(TAGS_DROP), width: KINO_SIZE.width, height: KINO_SIZE.height, display: 'flex' } },
      artLayer(back.body, back.defs),
      backEtch(card, look),
      artLayer(front.body, front.defs),
      frontText(card, look),
    ),
    // An SVG layer clips at its own top edge, so the chain, which starts above the card, is dropped inside its layer, not with the div.
    artLayer(`<g transform="translate(0 ${TAGS_DROP})">${chainSvg() + (look.sparkles ? sparkles() : '')}</g>`, DOT_FILTER),
  );
}
