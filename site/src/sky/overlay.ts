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

const COIN_SLIDE_MAX = 0.25;

const LABEL_EDGE = 8;
const intersects = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const squareAt = (x: number, y: number, d: number): Rect => ({ left: x - d / 2, top: y - d / 2, right: x + d / 2, bottom: y + d / 2 });

function shortestExit(box: Rect, rect: Rect): { dx: number; dy: number } {
  const exits = [
    { dx: rect.left - box.right, dy: 0 },
    { dx: rect.right - box.left, dy: 0 },
    { dx: 0, dy: rect.top - box.bottom },
    { dx: 0, dy: rect.bottom - box.top },
  ];
  return exits.reduce((best, e) => (Math.abs(e.dx + e.dy) < Math.abs(best.dx + best.dy) ? e : best));
}

// A coin that grazes the UI slides clear by up to a quarter of its width; one that would need more stays off.
function placeCoin(p: { x: number; y: number; d: number }, avoid: readonly Rect[]): { x: number; y: number } | null {
  let x = p.x;
  let y = p.y;
  for (const rect of avoid) {
    const box = squareAt(x, y, p.d);
    if (!intersects(box, rect)) continue;
    const { dx, dy } = shortestExit(box, rect);
    x += dx;
    y += dy;
  }
  if (Math.hypot(x - p.x, y - p.y) > p.d * COIN_SLIDE_MAX) return null;
  return avoid.some((rect) => intersects(squareAt(x, y, p.d), rect)) ? null : { x, y };
}

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
  const coinSpots = new Map(placed.flatMap((p) => {
    const spot = placeCoin(p, avoid);
    return spot ? [[p.selector, spot] as const] : [];
  }));
  const coins = coinSelectors(values, opts.coins, (s) => opts.hasIcon(s) && coinSpots.has(s)).map((selector) => {
    const spot = coinSpots.get(selector)!;
    return { selector, x: spot.x, y: spot.y, d: bySelector.get(selector)!.d };
  });
  const coinBySelector = new Map(coins.map((c) => [c.selector, c]));
  const labels = topSelectors(values, opts.labels).flatMap((selector): OverlayLabel[] => {
    const p = bySelector.get(selector);
    if (!p) return [];
    const coin = coinBySelector.get(selector);
    const { x, y } = coin ?? p;
    const offset = Math.max(10, (coin ? coin.d / 2 : p.r) + 6);
    const w = labelWidth(selector);
    const top = y - LABEL_HALF_HEIGHT;
    const bottom = y + LABEL_HALF_HEIGHT;
    const rightBox = { left: x + offset, top, right: x + offset + w, bottom };
    const clear = (box: Rect) => box.left >= LABEL_EDGE && box.right <= width - LABEL_EDGE && !avoid.some((rect) => intersects(box, rect));
    if (clear(rightBox)) return [{ selector, x: x + offset, y, side: 'right' }];
    const leftBox = { left: x - offset - w, top, right: x - offset, bottom };
    if (clear(leftBox)) return [{ selector, x: x - offset, y, side: 'left' }];
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
