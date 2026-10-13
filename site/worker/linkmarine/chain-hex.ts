import { iconHref, LETTERMARK_BG, lettermarkLetter } from '../../src/lib/chain-icons';
import { bytesToBase64, type AssetFetcher } from '../cards/coin-icons';
import { h, type VNode } from '../h';
import { chainSlug } from '../../src/lib/chain-slug';
import { drawable, font, hexImage, hexPoints, INK, px } from './art';

/** A chain's icon as the cards draw it: the logo, the hexagon's fill behind it, and the glow and frame around it. */
export interface ChainArt {
  src: string | null;
  bg: string;
  glow: string;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The fill of the icon's first shape, which is its background square; black when it has none, as SVG paints it. */
export function iconBackground(svg: string): string {
  const first = /<(?:rect|path|circle)\b[^>]*>/.exec(svg)?.[0];
  if (!first) return LETTERMARK_BG;
  const fill = /\sfill="([^"]*)"/.exec(first)?.[1];
  if (fill === undefined) return '#000000';
  const gradient = /^url\(#([^)]+)\)$/.exec(fill)?.[1];
  const color = gradient ? firstStop(svg, gradient) : fill;
  return color !== undefined && HEX.test(color) ? color.toLowerCase() : LETTERMARK_BG;
}

/** The first stop's colour of the gradient with this id, which is where its fill starts. */
function firstStop(svg: string, id: string): string | undefined {
  const start = new RegExp(`<(?:linear|radial)Gradient\\b[^>]*\\sid="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`).exec(svg);
  if (!start) return undefined;
  const stop = /<stop\b[^>]*>/.exec(svg.slice(start.index + start[0].length))?.[0];
  return stop && /\sstop-color="([^"]*)"/.exec(stop)?.[1];
}

const rgb = (hex: string): [number, number, number] => {
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  return [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
};

/** The background's hue, saturated and lit enough to glow on the navy sky: Ethereum's #627eea glows #9caef2; a grey glows pale blue. */
export function glowColor(bg: string): string {
  const [r, g, b] = rgb(bg);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 0.08) return INK.lane;
  const s = d / (1 - Math.abs(2 * l - 1));
  const hue = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const light = Math.min(0.78, Math.max(0.62, l + 0.15));
  const sat = Math.max(s, 0.6);
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const [r1, g1, b1] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hue)]!;
  const m = light - c / 2;
  return `#${[r1!, g1!, b1!].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Fetches a chain's icon from the site's own assets; a chain without one gets the lettermark's slate. */
export async function chainArt(assets: AssetFetcher, selector: string): Promise<ChainArt> {
  const href = iconHref(selector);
  const res = href ? await assets.fetch(new Request(`https://ccip.dev${href}`)) : null;
  if (!href || !res?.ok) return { src: null, bg: LETTERMARK_BG, glow: INK.lane };
  const bytes = new Uint8Array(await res.arrayBuffer());
  const svg = href.endsWith('.svg');
  const bg = svg ? iconBackground(new TextDecoder().decode(bytes)) : LETTERMARK_BG;
  return { src: `data:${svg ? 'image/svg+xml' : 'image/png'};base64,${bytesToBase64(bytes)}`, bg, glow: glowColor(bg) };
}

export async function chainArts(assets: AssetFetcher, selectors: readonly string[]): Promise<Map<string, ChainArt>> {
  const unique = [...new Set(selectors)];
  return new Map(await Promise.all(unique.map(async (s) => [s, await chainArt(assets, s)] as const)));
}

/** A chain's name as the fonts can draw it; a name with nothing drawable falls back to its slug in capitals. */
export function chainLabel(chain: { selector: string; name: string }): string {
  return drawable(chain.name) || chainSlug({ selector: chain.selector, display_name: chain.name, name: null }).toUpperCase();
}

export const NO_ART: ChainArt = { src: null, bg: LETTERMARK_BG, glow: INK.lane };

/** Under the icon: its glow and its background hexagon. */
export function chainHexUnder(id: string, cx: number, cy: number, r: number, art: ChainArt): { defs: string; body: string } {
  return {
    defs: `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>`,
    body: `<polygon points="${hexPoints(cx, cy, r + 6)}" fill="${art.glow}" opacity="0.6" filter="url(#${id})"/><polygon points="${hexPoints(cx, cy, r)}" fill="${art.bg}"/>`,
  };
}

/** Over the icon: its frame, doubled for a hero. */
export function chainHexFrame(cx: number, cy: number, r: number, art: ChainArt, double = false): string {
  return (
    `<polygon points="${hexPoints(cx, cy, r)}" fill="none" stroke="${art.glow}" stroke-width="2.4"/>` +
    (double
      ? `<polygon points="${hexPoints(cx, cy, r + 9)}" fill="none" stroke="${art.glow}" stroke-width="1.6" opacity="0.85"/><polygon points="${hexPoints(cx, cy, r + 16)}" fill="none" stroke="${art.glow}" stroke-width="1" opacity="0.45"/>`
      : '')
  );
}

/** The icon itself, filling the hexagon: its square fits the hexagon's width, so its corners fall outside and only its colour shows. */
export function chainHexIcon(cx: number, cy: number, r: number, art: ChainArt, name: string): VNode {
  if (art.src) return hexImage(art.src, cx, cy, r, { objectFit: 'contain' });
  return h(
    'div',
    { style: { position: 'absolute', left: px(cx - r), top: px(cy - r), width: px(2 * r), height: px(2 * r), display: 'flex', alignItems: 'center', justifyContent: 'center', ...font('Inter', 800, r * 0.9, '#ffffff') } },
    lettermarkLetter(name),
  );
}
