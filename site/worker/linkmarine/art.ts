import { seededRandom } from '@ccip-dev/core/linkmarine';
import { h, type Child, type VNode } from '../h';

export const KINO_SIZE = { width: 1200, height: 675 } as const;
/** The approved mockups were drawn at 760×428: every number below is theirs, scaled up by S. */
export const MOCK = { width: 760, height: 428 } as const;
export const S = KINO_SIZE.width / MOCK.width;
export const MONO = 'JetBrains Mono';

export const INK = {
  navy: '#0a0f1e',
  text: '#e8eaed',
  soft: '#c3cad5',
  sub: '#aab3c0',
  muted: '#8892a0',
  gold: '#f5c451',
  paleGold: '#f5d77a',
  cream: '#fff6cf',
  blue: '#6c9bff',
  ccip: '#3c7bff',
  lane: '#cfe0ff',
  up: '#5fe0a4',
  down: '#f5b04a',
  live: '#ff6b7a',
} as const;

/** To a tenth of a pixel. */
export const r1 = (v: number) => Math.round(v * 10) / 10;

export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** A day ("2026-10-13") or a timestamp, as a Date read in UTC. */
export const utcDate = (dayOrIso: string) => new Date(dayOrIso.length === 10 ? `${dayOrIso}T00:00:00.000Z` : dayOrIso);

/** "13 OCT 2026", from a day or a timestamp, in UTC. */
export function capDay(dayOrIso: string): string {
  const d = utcDate(dayOrIso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** A length in the mockups' coordinates, in card pixels. */
export const px = (n: number) => r1(n * S);

/** The corners of a pointy-top hexagon around (cx, cy) with circumradius r. */
export function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, k) => {
    const a = ((-90 + 60 * k) * Math.PI) / 180;
    return `${r1(cx + r * Math.cos(a))},${r1(cy + r * Math.sin(a))}`;
  }).join(' ');
}

/** The same hexagon as a CSS clip-path on a box 0.866·2r wide and 2r tall. */
export const HEX_CLIP = 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)';

export const svgDataUri = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;

/**
 * A full-card layer of SVG art, written in the mockups' 760×428 coordinates. resvg draws no raster image and no text
 * inside an SVG that is itself an image, so memes, icons, avatars and words are card elements on top.
 */
export function artLayer(body: string, defs = ''): VNode {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${KINO_SIZE.width}" height="${KINO_SIZE.height}" viewBox="0 0 ${MOCK.width} ${MOCK.height}" preserveAspectRatio="none"><defs>${defs}</defs>${body}</svg>`;
  return h('img', { src: svgDataUri(svg), width: KINO_SIZE.width, height: KINO_SIZE.height, style: { position: 'absolute', left: 0, top: 0, width: KINO_SIZE.width, height: KINO_SIZE.height } });
}

/** A card element placed in the mockups' coordinates. */
export function at(left: number, top: number, style: Record<string, unknown>, ...children: Child[]): VNode {
  return h('div', { style: { position: 'absolute', left: px(left), top: px(top), display: 'flex', ...style } }, ...children);
}

/** Type in the mockups' sizes: `size` and `tracking` (em) as the mockups' CSS has them. */
export function font(family: 'Inter' | typeof MONO, weight: number, size: number, color: string, tracking = 0): Record<string, unknown> {
  return { fontFamily: family, fontWeight: weight, fontSize: px(size), color, letterSpacing: r1(tracking * size * S), whiteSpace: 'nowrap' };
}

/** A navy night sky: the base colour, soft radial glows, and stars the seed places. */
export function skyLayer(seed: number, glows: readonly { x: number; y: number; color: string; stop: number }[], extra = '', extraDefs = ''): VNode {
  const defs = glows
    .map((g, i) => {
      const rx = Math.max(g.x, MOCK.width - g.x) * Math.SQRT2;
      const ry = Math.max(g.y, MOCK.height - g.y) * Math.SQRT2;
      return `<radialGradient id="glow${i}" gradientUnits="userSpaceOnUse" cx="${r1(g.x)}" cy="${r1(g.y)}" r="${r1(rx)}" gradientTransform="translate(${r1(g.x)} ${r1(g.y)}) scale(1 ${(ry / rx).toFixed(4)}) translate(${r1(-g.x)} ${r1(-g.y)})"><stop offset="0" stop-color="${g.color}"/><stop offset="${g.stop}" stop-color="${g.color}" stop-opacity="0"/></radialGradient>`;
    })
    .join('');
  const rect = (fill: string) => `<rect width="${MOCK.width}" height="${MOCK.height}" fill="${fill}"/>`;
  return artLayer(`${rect(INK.navy)}${glows.map((_, i) => rect(`url(#glow${i})`)).join('')}${stars(seed)}${extra}`, `${defs}${extraDefs}`);
}

const STAR_COUNT = 70;

function stars(seed: number): string {
  const random = seededRandom(seed);
  let out = '';
  for (let i = 0; i < STAR_COUNT; i++) {
    const x = r1(random() * MOCK.width);
    const y = r1(random() * MOCK.height);
    const r = random() < 0.8 ? 0.6 : 1;
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${(0.25 + random() * 0.5).toFixed(2)}"/>`;
  }
  return out;
}

export interface HaloRing {
  r: number;
  width: number;
  opacity: number;
}

/** The Chainlink halo: concentric hexagons, a soft blurred copy under crisp ones, over a radial glow. */
export function halo(id: string, cx: number, cy: number, color: string, rings: readonly HaloRing[], glow: { r: number; opacity: number } | null, rotate = 0): { defs: string; body: string } {
  const hexes = rings.map((ring) => `<polygon points="${hexPoints(cx, cy, ring.r)}" fill="none" stroke="${color}" stroke-width="${ring.width}" opacity="${ring.opacity}"/>`).join('');
  const defs =
    `<filter id="${id}-blur"><feGaussianBlur stdDeviation="3"/></filter>` +
    (glow ? `<radialGradient id="${id}-glow"><stop offset="0" stop-color="${color}" stop-opacity="${glow.opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>` : '');
  const body =
    (glow ? `<circle cx="${cx}" cy="${cy}" r="${glow.r}" fill="url(#${id}-glow)"/>` : '') +
    `<g transform="rotate(${rotate.toFixed(2)} ${cx} ${cy})"><g filter="url(#${id}-blur)">${hexes}</g>${hexes}</g>`;
  return { defs, body };
}

/** A soft glowing dot: a lane's message pulse. */
export function pulse(x: number, y: number, r = 5): string {
  return `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" fill="${INK.cream}" filter="url(#dot)"/><circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r * 0.44)}" fill="#fff"/>`;
}

export const DOT_FILTER = '<filter id="dot" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.5"/></filter>';

/** The point at t along the quadratic curve from a to b through control c. */
export function onCurve(a: { x: number; y: number }, c: { x: number; y: number }, b: { x: number; y: number }, t: number): { x: number; y: number } {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

/** An image clipped to a pointy-top hexagon of circumradius r around (cx, cy), in the mockups' coordinates. */
export function hexImage(src: string, cx: number, cy: number, r: number, style: Record<string, unknown> = {}): VNode {
  const width = px(r * Math.sqrt(3));
  const height = px(r * 2);
  return h('img', {
    src,
    width,
    height,
    style: { position: 'absolute', left: px(cx - (r * Math.sqrt(3)) / 2), top: px(cy - r), width, height, objectFit: 'cover', clipPath: HEX_CLIP, ...style },
  });
}

const DRAWABLE = /^[\u0020-\u007e\u00a0-\u00ff\u2000-\u206f\u20ac\u2122]$/;

/** Text in the card fonts' Latin subset only: anything else (emoji, CJK, ◆) would be drawn as nothing. */
export function drawable(text: string): string {
  return [...text].filter((ch) => DRAWABLE.test(ch)).join('').replace(/\s+/g, ' ').trim();
}

/** The fonts have no ◆ or ◇: three diamonds as an image, the first `filled` solid. */
export function pips(filled: number, size: number, color: string): VNode {
  const shapes = [0, 1, 2]
    .map((i) => {
      const cx = 6 + i * 13;
      const d = `M${cx} 1 L${cx + 5} 6 L${cx} 11 L${cx - 5} 6 Z`;
      return i < filled ? `<path d="${d}" fill="${color}"/>` : `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.4"/>`;
    })
    .join('');
  const width = r1((size * 38) / 12);
  return h('img', {
    src: svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="38" height="12" viewBox="0 0 38 12">${shapes}</svg>`),
    width,
    height: size,
    style: { width, height: size, flexShrink: 0 },
  });
}

/** The ⬡ bullet the intel rows start with, which the fonts lack. */
export function hexBullet(size: number, color: string): VNode {
  return h('img', {
    src: svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><polygon points="${hexPoints(12, 12, 10)}" fill="none" stroke="${color}" stroke-width="2.4"/></svg>`),
    width: size,
    height: size,
    style: { width: size, height: size, flexShrink: 0 },
  });
}
