import { COLORS, kindColor, type SkyFrame } from './frame';
import { laneControl, quadPoint, type Point } from './geometry';
import type { Projector } from './layout';

export const FLOATS_PER_INSTANCE = 8;
export const SHAPE = { glow: 0, ring: 1, disc: 2 } as const;
export const LANE_SEGMENTS = 16;
const TRAIL_STEP = 0.03;
const GOLD_RING_REACH = 50;

function projectStars(frame: SkyFrame, project: Projector): Point[] {
  return frame.stars.map((s) => {
    const [x, y] = project(s.x, s.y);
    return { x, y };
  });
}

export function buildInstances(frame: SkyFrame, project: Projector, sizeScale: number, opts = { trail: 6 }): Float32Array {
  const pts = projectStars(frame, project);
  const count = frame.stars.length * 2 + frame.comets.length * (2 + opts.trail) + frame.rings.length;
  const out = new Float32Array(count * FLOATS_PER_INSTANCE);
  let i = 0;
  const put = (x: number, y: number, radius: number, rgb: readonly number[], alpha: number, shape: number) => {
    out.set([x, y, radius, rgb[0]!, rgb[1]!, rgb[2]!, alpha, shape], i);
    i += FLOATS_PER_INSTANCE;
  };

  frame.stars.forEach((s, k) => {
    const p = pts[k]!;
    if (s.radius <= 0) {
      put(p.x, p.y, 0, COLORS.blue, 0, SHAPE.glow);
      put(p.x, p.y, 0, COLORS.star, 0, SHAPE.disc);
      return;
    }
    const r = s.radius * sizeScale;
    put(p.x, p.y, r * 4, COLORS.blue, Math.min(1, 0.18 * s.brightness + 0.5 * s.flash), SHAPE.glow);
    put(p.x, p.y, Math.max(1, r), COLORS.star, Math.min(1, 0.55 + 0.45 * s.brightness + s.flash), SHAPE.disc);
  });

  for (const c of frame.comets) {
    const a = pts[c.from];
    const b = pts[c.to];
    const color = kindColor(c.kind);
    const head = (10 + 16 * c.size) * sizeScale;
    const core = COLORS.star.map((v, ch) => (color[ch]! + v) / 2);
    for (let k = opts.trail; k >= 0; k--) {
      const t = c.progress - k * TRAIL_STEP;
      if (!a || !b || t < 0) {
        put(0, 0, 0, color, 0, SHAPE.glow);
        continue;
      }
      const p = quadPoint(a, laneControl(a, b), b, Math.min(1, t));
      put(p.x, p.y, head * 0.88 ** k, color, k === 0 ? 1 : 0.55 * 0.72 ** k, SHAPE.glow);
      if (k === 0) put(p.x, p.y, (2.2 + 3 * c.size) * sizeScale, core, 1, SHAPE.disc);
    }
  }

  for (const r of frame.rings) {
    const p = pts[r.star];
    put(p?.x ?? 0, p?.y ?? 0, p ? (10 + (r.reach ?? GOLD_RING_REACH) * r.progress) * sizeScale : 0, kindColor(r.kind ?? 'gold'), p ? 1 - r.progress : 0, SHAPE.ring);
  }
  return out;
}

export function buildLaneVertices(frame: SkyFrame, project: Projector, segments = LANE_SEGMENTS): Float32Array {
  const pts = projectStars(frame, project);
  const out = new Float32Array(frame.lanes.length * segments * 2 * 3);
  let i = 0;
  for (const lane of frame.lanes) {
    const a = pts[lane.from]!;
    const b = pts[lane.to]!;
    const c = laneControl(a, b);
    let prev = a;
    for (let s = 1; s <= segments; s++) {
      const p = quadPoint(a, c, b, s / segments);
      out.set([prev.x, prev.y, lane.opacity, p.x, p.y, lane.opacity], i);
      i += 6;
      prev = p;
    }
  }
  return out;
}
