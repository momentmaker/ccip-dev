export const GOLDEN_ANGLE_RAD = (137.5078 * Math.PI) / 180;
export const STRETCH_MAX = 1.6;

export interface StarPoint {
  selector: string;
  x: number;
  y: number;
}

export type Projector = (x: number, y: number) => [number, number];

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function spiralPoint(index: number): { x: number; y: number } {
  const r = Math.sqrt(index + 1);
  const theta = index * GOLDEN_ANGLE_RAD;
  return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
}

export function orderChains(chains: readonly { selector: string; first_day: string }[]): string[] {
  return [...chains]
    .sort((a, b) =>
      a.first_day < b.first_day ? -1 : a.first_day > b.first_day ? 1 : a.selector < b.selector ? -1 : a.selector > b.selector ? 1 : 0,
    )
    .map((c) => c.selector);
}

function place(selector: string, index: number, scale: number): StarPoint {
  const p = spiralPoint(index);
  return { selector, x: round4(p.x / scale), y: round4(p.y / scale) };
}

export function buildLayout(chains: readonly { selector: string; first_day: string }[]): StarPoint[] {
  const order = orderChains(chains);
  const scale = Math.sqrt(Math.max(order.length, 1));
  return order.map((selector, i) => place(selector, i, scale));
}

export function appendStar(layout: StarPoint[], selector: string): StarPoint[] {
  if (layout.some((s) => s.selector === selector)) return layout;
  const first = layout[0];
  const scale = first ? 1 / Math.hypot(first.x, first.y) : 1;
  return [...layout, place(selector, layout.length, scale)];
}

const EXTENT_BREATHING = 1.08;

export function projector(width: number, height: number, stars: readonly StarPoint[], margin = 0.08, extentOverride?: number): Projector {
  const extent =
    extentOverride === undefined
      ? Math.max(1, ...stars.map((s) => Math.max(Math.abs(s.x), Math.abs(s.y))))
      : Math.max(extentOverride, 1e-6) * EXTENT_BREATHING;
  const half = (Math.min(width, height) / 2) * (1 - margin);
  const sx = width > height ? Math.min(width / height, STRETCH_MAX) : 1;
  const sy = height > width ? Math.min(height / width, STRETCH_MAX) : 1;
  return (x, y) => [width / 2 + (x / extent) * half * sx, height / 2 + (y / extent) * half * sy];
}
