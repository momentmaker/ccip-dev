import { coinDiameter, coinSelectors } from './coins';
import { projector, type StarPoint } from './layout';
import { starRadius } from './weights';

export const CARD_COINS = 8;
export const CARD_COIN_SCALE = 1.6;

export interface CardCoin {
  x: number;
  y: number;
  d: number;
  src: string;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function cardCoins(o: {
  width: number;
  height: number;
  stars: readonly StarPoint[];
  chainValues: Map<string, number>;
  count: number;
  src: (selector: string) => string | null;
}): CardCoin[] {
  const project = projector(o.width, o.height, o.stars);
  const max = Math.max(0, ...o.chainValues.values());
  const scale = Math.min(o.width, o.height) / 700;
  const sources = new Map<string, string | null>();
  const srcOf = (selector: string) => {
    if (!sources.has(selector)) sources.set(selector, o.src(selector));
    return sources.get(selector)!;
  };
  return coinSelectors(o.chainValues, o.count, (s) => srcOf(s) !== null).flatMap((selector) => {
    const star = o.stars.find((s) => s.selector === selector);
    const src = srcOf(selector);
    if (!star || !src) return [];
    const [x, y] = project(star.x, star.y);
    const d = coinDiameter(starRadius(o.chainValues.get(selector) ?? 0, max) * scale) * CARD_COIN_SCALE;
    return [{ x: r1(x), y: r1(y), d: r1(d), src }];
  });
}
