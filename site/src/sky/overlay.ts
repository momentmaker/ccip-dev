import { coinDiameter, coinSelectors, type Reachable } from './coins';
import { projector, type StarPoint } from './layout';
import { starRadius, topSelectors } from './weights';

export interface OverlayPoint extends Reachable {
  d: number;
}

export interface OverlayCoin {
  selector: string;
  x: number;
  y: number;
  d: number;
}

export interface OverlayLabel {
  selector: string;
  x: number;
  y: number;
}

export function skyOverlay(
  stars: readonly StarPoint[],
  values: Map<string, number>,
  width: number,
  height: number,
  opts: { coins: number; labels: number; bottomReserve: number; hasIcon: (selector: string) => boolean },
): { points: OverlayPoint[]; coins: OverlayCoin[]; labels: OverlayLabel[] } {
  const project = projector(width, height, stars);
  const max = Math.max(0, ...values.values());
  const scale = Math.min(width, height) / 700;
  const placed = stars.map((s) => {
    const [x, y] = project(s.x, s.y);
    const r = starRadius(values.get(s.selector) ?? 0, max) * scale;
    const d = coinDiameter(r);
    return { selector: s.selector, x, y, r, d, reach: Math.max(12, d / 2 + 4) };
  });
  const bySelector = new Map(placed.map((p) => [p.selector, p]));
  const clearOfStrip = new Set(placed.filter((p) => p.y + Math.max(p.d, 12) / 2 <= height - opts.bottomReserve).map((p) => p.selector));
  const eligible = new Map([...values].filter(([selector]) => clearOfStrip.has(selector)));
  const coins = coinSelectors(eligible, opts.coins, opts.hasIcon).flatMap((selector) => {
    const p = bySelector.get(selector);
    return p ? [{ selector, x: p.x, y: p.y, d: p.d }] : [];
  });
  const withCoin = new Set(coins.map((c) => c.selector));
  const labels = topSelectors(eligible, opts.labels).flatMap((selector) => {
    const p = bySelector.get(selector);
    return p ? [{ selector, x: p.x + Math.max(10, (withCoin.has(selector) ? p.d / 2 : p.r) + 6), y: p.y }] : [];
  });
  return { points: placed.map(({ selector, x, y, d, reach }) => ({ selector, x, y, d, reach })), coins, labels };
}

export const CARD_EDGE = 8;
export const CARD_GAP = 12;

export function cardSize(wrapWidth: number): { width: number; height: number } {
  return { width: Math.min(340, wrapWidth - 2 * CARD_EDGE), height: 64 };
}

export function cardPosition(
  star: { x: number; y: number; d: number },
  wrap: { width: number; height: number },
  card: { width: number; height: number },
): { left: number; top: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const right = star.x + star.d / 2 + CARD_GAP;
  const left = star.x - star.d / 2 - CARD_GAP - card.width;
  const sideTop = clamp(star.y - card.height / 2, CARD_EDGE, wrap.height - card.height - CARD_EDGE);
  if (right + card.width <= wrap.width - CARD_EDGE) return { left: right, top: sideTop };
  if (left >= CARD_EDGE) return { left, top: sideTop };
  const below = star.y + star.d / 2 + CARD_GAP;
  const top = below + card.height <= wrap.height - CARD_EDGE ? below : star.y - star.d / 2 - CARD_GAP - card.height;
  return { left: clamp(star.x - card.width / 2, CARD_EDGE, wrap.width - card.width - CARD_EDGE), top: clamp(top, CARD_EDGE, wrap.height - card.height - CARD_EDGE) };
}
