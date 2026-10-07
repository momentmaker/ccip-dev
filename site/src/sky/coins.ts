import { topSelectors } from './weights';

export const COIN_MIN = 18;
export const COIN_MAX = 40;
export const COIN_SCALE = 2.4;
export const COINS_WIDE = 12;
export const COINS_NARROW = 8;
export const NARROW_PX = 640;

export interface Reachable {
  selector: string;
  x: number;
  y: number;
  reach: number;
}

export function coinCount(widthCss: number): number {
  return widthCss < NARROW_PX ? COINS_NARROW : COINS_WIDE;
}

export function coinDiameter(radius: number): number {
  return Math.min(COIN_MAX, Math.max(COIN_MIN, COIN_SCALE * radius));
}

export function coinSelectors(values: Map<string, number>, count: number, hasIcon: (selector: string) => boolean): string[] {
  return topSelectors(new Map([...values].filter(([selector, value]) => value > 0 && hasIcon(selector))), count);
}

export function nearestStar(points: readonly Reachable[], x: number, y: number): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const p of points) {
    const distance = Math.hypot(p.x - x, p.y - y);
    if (distance <= p.reach && distance < bestDistance) {
      best = p.selector;
      bestDistance = distance;
    }
  }
  return best;
}

export function chainMessages(lanes: readonly { src: string; dst: string; messages: number }[], selector: string): number {
  return lanes.reduce((sum, l) => (l.src === selector || l.dst === selector ? sum + l.messages : sum), 0);
}
