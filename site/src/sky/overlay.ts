import { coinDiameter, coinSelectors, type Reachable } from './coins';
import { projector, type StarPoint } from './layout';
import { skyScale, starRadius, topSelectors } from './weights';

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
  side: 'right' | 'left';
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const LABEL_HALF_HEIGHT = 9;
const DEFAULT_LABEL_WIDTH = 80;

const intersects = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

export function skyOverlay(
  stars: readonly StarPoint[],
  values: Map<string, number>,
  width: number,
  height: number,
  opts: {
    coins: number;
    labels: number;
    hasIcon: (selector: string) => boolean;
    avoid?: readonly Rect[];
    labelWidth?: (selector: string) => number;
  },
): { points: OverlayPoint[]; coins: OverlayCoin[]; labels: OverlayLabel[] } {
  const project = projector(width, height, stars);
  const max = Math.max(0, ...values.values());
  const scale = skyScale(width, height);
  const placed = stars.map((s) => {
    const [x, y] = project(s.x, s.y);
    const r = starRadius(values.get(s.selector) ?? 0, max) * scale;
    const d = coinDiameter(r);
    return { selector: s.selector, x, y, r, d, reach: Math.max(12, d / 2 + 4) };
  });
  const bySelector = new Map(placed.map((p) => [p.selector, p]));
  const avoid = opts.avoid ?? [];
  const labelWidth = opts.labelWidth ?? (() => DEFAULT_LABEL_WIDTH);
  const coinClear = (selector: string) => {
    const p = bySelector.get(selector);
    if (!p) return false;
    const box = { left: p.x - p.d / 2, top: p.y - p.d / 2, right: p.x + p.d / 2, bottom: p.y + p.d / 2 };
    return !avoid.some((rect) => intersects(box, rect));
  };
  const coins = coinSelectors(values, opts.coins, (s) => opts.hasIcon(s) && coinClear(s)).flatMap((selector) => {
    const p = bySelector.get(selector)!;
    return [{ selector, x: p.x, y: p.y, d: p.d }];
  });
  const withCoin = new Set(coins.map((c) => c.selector));
  const labels = topSelectors(values, opts.labels).flatMap((selector): OverlayLabel[] => {
    const p = bySelector.get(selector);
    if (!p) return [];
    const offset = Math.max(10, (withCoin.has(selector) ? p.d / 2 : p.r) + 6);
    const w = labelWidth(selector);
    const top = p.y - LABEL_HALF_HEIGHT;
    const bottom = p.y + LABEL_HALF_HEIGHT;
    const rightBox = { left: p.x + offset, top, right: p.x + offset + w, bottom };
    if (!avoid.some((rect) => intersects(rightBox, rect))) return [{ selector, x: p.x + offset, y: p.y, side: 'right' }];
    const leftBox = { left: p.x - offset - w, top, right: p.x - offset, bottom };
    if (!avoid.some((rect) => intersects(leftBox, rect))) return [{ selector, x: p.x - offset, y: p.y, side: 'left' }];
    return [];
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
