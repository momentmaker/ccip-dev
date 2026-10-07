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
  opts: { coins: number; labels: number; hasIcon: (selector: string) => boolean },
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
  const coins = coinSelectors(values, opts.coins, opts.hasIcon).flatMap((selector) => {
    const p = bySelector.get(selector);
    return p ? [{ selector, x: p.x, y: p.y, d: p.d }] : [];
  });
  const withCoin = new Set(coins.map((c) => c.selector));
  const labels = topSelectors(values, opts.labels).flatMap((selector) => {
    const p = bySelector.get(selector);
    return p ? [{ selector, x: p.x + Math.max(10, (withCoin.has(selector) ? p.d / 2 : p.r) + 6), y: p.y }] : [];
  });
  return { points: placed.map(({ selector, x, y, d, reach }) => ({ selector, x, y, d, reach })), coins, labels };
}
