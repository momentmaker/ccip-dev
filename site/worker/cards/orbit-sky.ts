import { LETTERMARK_BG, lettermarkLetter } from '../../src/lib/chain-icons';
import { laneControl, type Point } from '../../src/sky/geometry';
import { h, type VNode } from '../h';

export const ORBIT_W = 1200;
export const ORBIT_H = 675;
export const STRIP_TOP = 611;
export const HUB: Point = { x: 860, y: 300 };
/** Coin centers by rank, the hub first: the layout of the chosen mockup. */
export const SLOTS: readonly Point[] = [
  { x: 860, y: 300 }, { x: 1075, y: 205 }, { x: 1010, y: 470 }, { x: 715, y: 468 }, { x: 1118, y: 378 }, { x: 728, y: 150 },
  { x: 925, y: 118 }, { x: 650, y: 300 }, { x: 830, y: 560 }, { x: 1140, y: 545 }, { x: 655, y: 570 },
];
export const COIN_R_MAX = 46;
export const COIN_R_MIN = 17;
export const LABEL_MIN_R = 22;
export const MAX_LANES = 12;
export const STAR_COUNT = 170;

const ORBIT_RADII = [120, 210, 300];
/** The icon fills 125% of the coin, as in the mockup, so its rounded-square background covers the whole circle. */
const ICON_ZOOM = 1.25;
const DIM = 0.45;

export interface OrbitChain {
  selector: string;
  name: string;
  value: number;
}

export interface OrbitLane {
  src: string;
  dst: string;
  usd: number;
}

export interface OrbitCoin {
  selector: string;
  name: string;
  x: number;
  y: number;
  r: number;
  label: boolean;
  gold: boolean;
}

export interface OrbitSky {
  svg: string;
  coins: OrbitCoin[];
  dim: boolean;
}

export interface OrbitOptions {
  chains: readonly OrbitChain[];
  lanes: readonly OrbitLane[];
  seed: number;
  dim?: boolean;
  gold?: string | null;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** mulberry32: a small seeded generator, so a day's stars are the same on every render. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function starField(seed: number, count = STAR_COUNT): string {
  const rand = seeded(seed);
  const sizes = [1, 1, 1, 1.6, 2.4];
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = Math.round(rand() * ORBIT_W);
    const y = Math.round(rand() * STRIP_TOP);
    const r = sizes[Math.floor(rand() * sizes.length)]!;
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${(0.15 + rand() * 0.6).toFixed(2)}"/>`;
  }
  return out;
}

const BASE_DEFS = [
  '<radialGradient id="neb1" cx="72%" cy="42%" r="45%"><stop offset="0" stop-color="#1d3b8a" stop-opacity="0.55"/><stop offset="1" stop-color="#0c0f14" stop-opacity="0"/></radialGradient>',
  '<radialGradient id="neb2" cx="95%" cy="85%" r="35%"><stop offset="0" stop-color="#5b2a86" stop-opacity="0.35"/><stop offset="1" stop-color="#0c0f14" stop-opacity="0"/></radialGradient>',
  '<radialGradient id="halo"><stop offset="0" stop-color="#4a7ff0" stop-opacity="0.55"/><stop offset="1" stop-color="#4a7ff0" stop-opacity="0"/></radialGradient>',
  '<radialGradient id="gold"><stop offset="0" stop-color="#ffcf5a" stop-opacity="0.6"/><stop offset="1" stop-color="#ffcf5a" stop-opacity="0"/></radialGradient>',
].join('');

/** The night sky every broadcast card shares: the background, two nebulas and seeded stars, then `body`. */
export function skySvg(seed: number, defs: string, body: string): string {
  const rect = (fill: string) => `<rect width="${ORBIT_W}" height="${ORBIT_H}" fill="${fill}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ORBIT_W}" height="${ORBIT_H}" viewBox="0 0 ${ORBIT_W} ${ORBIT_H}">` +
    `<defs>${BASE_DEFS}${defs}</defs>${rect('#070a10')}${rect('url(#neb1)')}${rect('url(#neb2)')}${starField(seed)}${body}</svg>`
  );
}

export const svgDataUri = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;

/**
 * The sky's SVG holds only shapes and gradients: resvg draws no image or text nested inside an image, so coins and labels
 * are card elements (skyNodes). Lane gradients use user-space coordinates, because a bounding-box gradient on a straight
 * stroke draws nothing.
 */
export function orbitSky(o: OrbitOptions): OrbitSky {
  const ranked = o.chains
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value || (a.selector < b.selector ? -1 : a.selector > b.selector ? 1 : 0))
    .slice(0, SLOTS.length);
  const max = ranked[0]?.value ?? 0;
  const coins = ranked.map((c, i): OrbitCoin => {
    const r = r1(COIN_R_MIN + (COIN_R_MAX - COIN_R_MIN) * Math.sqrt(c.value / max));
    return { selector: c.selector, name: c.name, x: SLOTS[i]!.x, y: SLOTS[i]!.y, r, label: r >= LABEL_MIN_R, gold: c.selector === o.gold };
  });
  const at = new Map(coins.map((c) => [c.selector, c]));
  const lanes = o.lanes
    .filter((l) => l.usd > 0 && l.src !== l.dst && at.has(l.src) && at.has(l.dst))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, MAX_LANES);
  const maxLane = lanes[0]?.usd ?? 0;
  const fade = o.dim ? DIM : 1;
  const gradients = lanes
    .map((l, i) => {
      const a = at.get(l.src)!;
      const b = at.get(l.dst)!;
      const [from, to] = i % 2 === 0 ? ['#4a7ff0', '#7de3ff'] : ['#7a5cff', '#4a7ff0'];
      return `<linearGradient id="lane${i}" gradientUnits="userSpaceOnUse" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;
    })
    .join('');
  const rings = ORBIT_RADII.map(
    (r) => `<circle cx="${HUB.x}" cy="${HUB.y}" r="${r}" fill="none" stroke="#4a7ff0" stroke-opacity="0.12" stroke-width="1.5" stroke-dasharray="3 9"/>`,
  ).join('');
  const paths = lanes
    .map((l, i) => {
      const a = at.get(l.src)!;
      const b = at.get(l.dst)!;
      const c = laneControl(a, b);
      return `<path d="M${a.x} ${a.y}Q${r1(c.x)} ${r1(c.y)} ${b.x} ${b.y}" stroke="url(#lane${i})" stroke-width="${r1(1.6 + 4.4 * (l.usd / maxLane))}" fill="none" stroke-linecap="round" opacity="${(0.7 * fade).toFixed(3)}"/>`;
    })
    .join('');
  const halos = coins
    .map((c) => `<circle cx="${c.x}" cy="${c.y}" r="${r1(c.r * 2)}" fill="url(#${c.gold ? 'gold' : 'halo'})" opacity="${c.gold ? '1' : (0.9 * fade).toFixed(3)}"/>`)
    .join('');
  return { svg: skySvg(o.seed, gradients, rings + paths + halos), coins, dim: Boolean(o.dim) };
}

function coinNode(c: OrbitCoin, src: string | null, dim: boolean): VNode {
  const d = r1(c.r * 2);
  const box = {
    position: 'absolute',
    left: r1(c.x - c.r),
    top: r1(c.y - c.r),
    width: d,
    height: d,
    borderRadius: c.r,
    overflow: 'hidden',
    display: 'flex',
    backgroundColor: src ? '#0c0f14' : LETTERMARK_BG,
    boxShadow: c.gold ? '0 0 0 2px rgba(255,207,90,0.9)' : '0 0 0 2px rgba(255,255,255,0.28)',
    opacity: dim && !c.gold ? DIM : 1,
  };
  if (!src) {
    return h('div', { style: { ...box, alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontSize: Math.round(c.r), fontWeight: 700 } }, lettermarkLetter(c.name));
  }
  const zoomed = r1(d * ICON_ZOOM);
  const shift = r1((zoomed - d) / 2);
  return h('div', { style: box }, h('img', { src, width: zoomed, height: zoomed, style: { width: zoomed, height: zoomed, marginLeft: -shift, marginTop: -shift, flexShrink: 0 } }));
}

function labelNode(c: OrbitCoin, dim: boolean): VNode {
  return h(
    'div',
    {
      style: {
        position: 'absolute', left: c.x - 90, top: r1(c.y + c.r + 6), width: 180, display: 'flex', justifyContent: 'center', fontSize: 17, fontWeight: 700,
        color: '#c9d3e6', opacity: dim ? DIM : 1, whiteSpace: 'nowrap', overflow: 'hidden',
      },
    },
    c.name,
  );
}

export function skyNodes(sky: OrbitSky, icons: ReadonlyMap<string, string | null>): VNode[] {
  return [
    h('img', { src: svgDataUri(sky.svg), width: ORBIT_W, height: ORBIT_H, style: { position: 'absolute', left: 0, top: 0, width: ORBIT_W, height: ORBIT_H } }),
    ...sky.coins.map((c) => coinNode(c, icons.get(c.selector) ?? null, sky.dim)),
    ...sky.coins.filter((c) => c.label).map((c) => labelNode(c, sky.dim)),
  ];
}
