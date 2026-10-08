import { coinDiameter } from '../../sky/coins';
import { COLORS, kindColor } from '../../sky/frame';
import { laneControl, quadPoint } from '../../sky/geometry';
import { LANE_SEGMENTS } from '../../sky/instances';
import { cameraProjector } from '../../sky/layout';
import { REPLAY_COIN_UNIT } from '../compose';
import type { ShowFrame } from '../director/show';
import { END_TITLE_PX, storyUnit } from '../story/layout';
import { IGNITE_S, mulberry32 } from '../timeline';
import { arrivalSeed, assemble, burst, clamp01, cometFade, easeOut, elasticPop, heartbeat, NOVA_PARTICLE_S, NOVA_PARTICLES, novaFlash, novaRing, SPARK_LIFE, shockAt } from './fx';
import type { TierConfig } from './quality';

export const QUAD_FLOATS = 10;
export const COIN_FLOATS = 8;
export const LINE_FLOATS = 3;
export const CINEMA_SHAPE = { glow: 0, ring: 1, disc: 2, streak: 3, spark: 4 } as const;
export const DUST_COUNTS = [300, 180, 90] as const;
export const DUST_PARALLAX = [0.2, 0.4, 0.7] as const;
export const MAX_SCENE_QUADS = 8000;
export const MAX_SCENE_LANES = 2048;
export const MAX_SCENE_COINS = 64;
const DUST_SPREAD = 3;
const TITLE_PARTICLES_FROM = 0.1;
const TITLE_PARTICLES_SPAN = 0.35;
const PULSE_AT_S = 0.6;
const PULSE_WIDTH_S = 0.3;
const RECORD_RIPPLE_S = 1.2;
const TITLE_PARTICLE_GAIN = 3;

export interface DustField {
  layers: Float32Array[];
}

export interface SceneContext {
  width: number;
  height: number;
  tier: TierConfig;
  dust: DustField;
  fullExtent: number;
  atlas: ReadonlyMap<string, readonly [number, number, number, number]>;
  titleTargets: readonly { x: number; y: number }[];
  reducedMotion: boolean;
  seed: number;
  finaleSeconds: number;
  edgeFeather?: number;
}

export interface CinemaScene {
  width: number;
  height: number;
  nebula: { offset: [number, number]; intensity: number; seed: number } | null;
  lines: Float32Array;
  quads: Float32Array;
  coins: Float32Array;
  shock: { x: number; y: number; progress: number; strength: number } | null;
  exposure: number;
  bloom: TierConfig['bloom'];
  frame: number;
  edgeFeather: number;
}

type Rgb = readonly number[];
const mixRgb = (a: Rgb, b: Rgb, k: number): Rgb => a.map((v, i) => v + (b[i]! - v) * k);

export function titleAssembly(finale: number): number {
  return clamp01((finale - TITLE_PARTICLES_FROM) / TITLE_PARTICLES_SPAN);
}

export function titleParticleFade(finale: number): number {
  return 1 - clamp01((finale - 0.75) / 0.15);
}

export function dustField(seed: number, spread: number): DustField {
  const rng = mulberry32(seed);
  return {
    layers: DUST_COUNTS.map((count) => {
      const out = new Float32Array(count * 5);
      for (let i = 0; i < count; i++) {
        out.set([(rng() * 2 - 1) * spread * DUST_SPREAD, (rng() * 2 - 1) * spread * DUST_SPREAD, 0.6 + rng() * 1.4, 0.15 + rng() * 0.35, rng() * Math.PI * 2], i * 5);
      }
      return out;
    }),
  };
}

export function buildScene(frame: ShowFrame, ctx: SceneContext): CinemaScene {
  const { width: w, height: h, tier } = ctx;
  const unit = Math.min(w, h) / 1000;
  const cam = frame.camera;
  const project = cameraProjector(w, h, cam);
  const sky = frame.base.sky;
  const coreCount = sky.stars.filter((s) => s.radius > 0).length;
  const effectLimit = Math.max(0, MAX_SCENE_QUADS - coreCount);
  const quads: number[] = [];
  const coreQuads: number[] = [];
  const push = (out: number[], x: number, y: number, sx: number, sy: number, angle: number, c: Rgb, a: number, shape: number, gain: number) => {
    out.push(x, y, sx, sy, angle, c[0]! * gain, c[1]! * gain, c[2]! * gain, Math.min(1, a), shape);
  };
  const put = (x: number, y: number, sx: number, sy: number, angle: number, c: Rgb, a: number, shape: number, gain = 1) => {
    if (a <= 0.002 || quads.length / QUAD_FLOATS >= effectLimit) return;
    push(quads, x, y, sx, sy, angle, c, a, shape, gain);
  };
  const onScreen = (x: number, y: number, pad: number) => x > -pad && y > -pad && x < w + pad && y < h + pad;

  for (let layer = 0; layer < Math.min(tier.dust, ctx.dust.layers.length); layer++) {
    const par = DUST_PARALLAX[layer]!;
    const proj = cameraProjector(w, h, { cx: cam.cx * par, cy: cam.cy * par, extent: ctx.fullExtent + (cam.extent - ctx.fullExtent) * par, rotation: cam.rotation * par });
    const pts = ctx.dust.layers[layer]!;
    for (let i = 0; i < pts.length; i += 5) {
      const [x, y] = proj(pts[i]!, pts[i + 1]!);
      if (!onScreen(x, y, 4)) continue;
      const twinkle = 0.85 + 0.15 * Math.sin(frame.t * 1.7 + pts[i + 4]!);
      const size = pts[i + 2]! * unit * 2;
      put(x, y, size, size, 0, COLORS.pale, pts[i + 3]! * twinkle, CINEMA_SHAPE.spark);
    }
  }

  const points = sky.stars.map((s) => {
    const [x, y] = project(s.x, s.y);
    return { x, y };
  });

  const lanes = [...sky.lanes].sort((a, b) => b.opacity - a.opacity).slice(0, MAX_SCENE_LANES);
  const lines: number[] = [];
  for (const lane of lanes) {
    const a = points[lane.from];
    const b = points[lane.to];
    if (!a || !b) continue;
    const c = laneControl(a, b);
    let prev = a;
    for (let s = 1; s <= LANE_SEGMENTS; s++) {
      const p = quadPoint(a, c, b, s / LANE_SEGMENTS);
      lines.push(prev.x, prev.y, lane.opacity * 0.9, p.x, p.y, lane.opacity * 0.9);
      prev = p;
    }
  }

  const activity = new Array<number>(sky.stars.length).fill(0);
  for (const lane of lanes) {
    activity[lane.from] = (activity[lane.from] ?? 0) + lane.opacity;
    activity[lane.to] = (activity[lane.to] ?? 0) + lane.opacity;
  }
  const maxActivity = Math.max(1e-9, ...activity);
  sky.stars.forEach((s, i) => {
    if (s.radius <= 0) return;
    const p = points[i]!;
    const r = s.radius * unit;
    const beat = heartbeat(activity[i]! / maxActivity);
    put(p.x, p.y, r * 4 * beat, r * 4 * beat, 0, COLORS.blue, (0.22 * s.brightness + 0.5 * s.flash) * beat, CINEMA_SHAPE.glow, 1.4);
  });

  sky.stars.forEach((s, i) => {
    if (s.radius <= 0) return;
    const p = points[i]!;
    const core = Math.max(1, s.radius * unit);
    push(coreQuads, p.x, p.y, core, core, 0, COLORS.star, 0.55 + 0.45 * s.brightness + s.flash, CINEMA_SHAPE.disc, 1.1);
  });

  for (const c of sky.comets) {
    const a = points[c.from];
    const b = points[c.to];
    if (!a || !b) continue;
    const ctrl = laneControl(a, b);
    const head = quadPoint(a, ctrl, b, c.progress);
    const ahead = quadPoint(a, ctrl, b, Math.min(1, c.progress + 0.01));
    const angle = Math.atan2(ahead.y - head.y, ahead.x - head.x);
    const color = kindColor(c.kind);
    const size = (10 + 16 * c.size) * unit;
    const half = (size * (6 + 8 * c.size)) / 4;
    const fade = cometFade(c.progress);
    put(head.x - Math.cos(angle) * half, head.y - Math.sin(angle) * half, half, size * 0.35, angle, color, 0.9 * fade, CINEMA_SHAPE.streak, c.kind === 'gold' ? 2.2 : 1.6);
    put(head.x, head.y, size, size, 0, color, fade, CINEMA_SHAPE.glow, 1.6);
    put(head.x, head.y, (2.2 + 3 * c.size) * unit, (2.2 + 3 * c.size) * unit, 0, mixRgb(color, COLORS.star, 0.5), fade, CINEMA_SHAPE.disc, 1.2);
  }

  for (const arrival of frame.base.arrivals) {
    const dest = points[arrival.to];
    if (!dest) continue;
    const color = kindColor(arrival.kind);
    const count = Math.round((8 + 8 * arrival.size) * tier.particles);
    for (const p of burst(arrivalSeed(arrival.to, frame.t - arrival.age), count, arrival.age, SPARK_LIFE, dest.x, dest.y, (30 + 40 * arrival.size) * unit)) {
      put(p.x, p.y, 3 * unit * p.size, 3 * unit * p.size, 0, color, p.alpha, CINEMA_SHAPE.spark, 2);
    }
    const ripple = (10 + 40 * (arrival.age / SPARK_LIFE)) * unit;
    put(dest.x, dest.y, ripple, ripple, 0, color, 1 - arrival.age / SPARK_LIFE, CINEMA_SHAPE.ring, 1.2);
  }

  for (const ring of sky.rings) {
    const p = points[ring.star];
    const age = ring.progress * IGNITE_S;
    if (!p || age < 0) continue;
    put(p.x, p.y, 60 * unit, 60 * unit, 0, COLORS.blue, novaFlash(age), CINEMA_SHAPE.glow, 3);
    const nr = novaRing(age);
    const radius = (12 + 90 * nr.radius) * unit;
    put(p.x, p.y, radius, radius, 0, COLORS.blue, nr.alpha, CINEMA_SHAPE.ring, 2);
    for (const q of burst(ring.star * 7919 + 1, Math.round(NOVA_PARTICLES * tier.particles), age, NOVA_PARTICLE_S, p.x, p.y, 80 * unit)) {
      put(q.x, q.y, 2.5 * unit * q.size, 2.5 * unit * q.size, 0, COLORS.pale, q.alpha, CINEMA_SHAPE.spark, 2);
    }
  }

  if (frame.card?.kind === 'record') {
    const age = frame.t - frame.card.start;
    if (age >= 0 && age < RECORD_RIPPLE_S) {
      const radius = (40 + 600 * easeOut(age / RECORD_RIPPLE_S)) * unit;
      put(w / 2, h / 2, radius, radius, 0, COLORS.gold, 1 - age / RECORD_RIPPLE_S, CINEMA_SHAPE.ring, 1.5);
    }
  }

  const coins: number[] = [];
  for (const c of frame.base.coins) {
    if (coins.length / COIN_FLOATS >= MAX_SCENE_COINS) break;
    const uv = ctx.atlas.get(c.selector);
    const star = sky.stars[c.star];
    const p = points[c.star];
    if (!uv || !star || !p || star.radius <= 0) continue;
    const ring = sky.rings.find((r) => r.star === c.star);
    const pop = ring ? elasticPop(ring.progress * IGNITE_S) : 1;
    coins.push(p.x, p.y, coinDiameter(star.radius) * (Math.min(w, h) / REPLAY_COIN_UNIT) * pop, c.alpha, uv[0], uv[1], uv[2], uv[3]);
  }

  let exposure = 1;
  if (frame.phase === 'finale') {
    const seconds = frame.finale * ctx.finaleSeconds;
    exposure = 1 + 0.35 * Math.max(0, 1 - Math.abs(seconds - PULSE_AT_S) / PULSE_WIDTH_S);
    const origin = points.find((_, i) => (sky.stars[i]?.radius ?? 0) > 0) ?? { x: w / 2, y: h / 2 };
    const reach = Math.hypot(w, h) / 2;
    for (let i = 0; i < coins.length; i += COIN_FLOATS) {
      const x = coins[i]!;
      const y = coins[i + 1]!;
      const d = coins[i + 2]!;
      const p = (seconds - 0.6 * (Math.hypot(x - origin.x, y - origin.y) / reach)) / 0.5;
      if (p > 0 && p < 1) put(x, y, (d / 2) * (1 + 0.8 * p), (d / 2) * (1 + 0.8 * p), 0, COLORS.blue, 1 - p, CINEMA_SHAPE.ring, 1.6);
    }
    const p = titleAssembly(frame.finale);
    const fade = titleParticleFade(frame.finale);
    if (p > 0 && fade > 0 && ctx.titleTargets.length > 0) {
      const sources = points.filter((_, i) => (sky.stars[i]?.radius ?? 0) > 0).slice(0, 60);
      const em = END_TITLE_PX * storyUnit(w, h);
      const targets = ctx.titleTargets.map((t) => ({ x: w / 2 + t.x * em, y: h / 2 + t.y * em }));
      const step = Math.max(1, Math.round(1 / tier.particles));
      assemble(ctx.seed, sources, targets, p).forEach((q, i) => {
        if (i % step === 0) put(q.x, q.y, 3.5 * unit * q.size, 3.5 * unit * q.size, 0, mixRgb(COLORS.blue, COLORS.star, 0.6), q.alpha * fade, CINEMA_SHAPE.spark, TITLE_PARTICLE_GAIN);
      });
    }
  }

  const shock = ctx.reducedMotion || !frame.slam ? null : shockAt(frame.t - frame.slam.start);
  return {
    width: w,
    height: h,
    nebula: tier.nebula ? { offset: [frame.t * 0.02 + cam.cx * 0.05, cam.cy * 0.05], intensity: 0.08, seed: (ctx.seed % 997) / 997 } : null,
    lines: new Float32Array(lines),
    quads: new Float32Array([...quads, ...coreQuads]),
    coins: new Float32Array(coins),
    shock: shock ? { x: 0.5, y: 0.5, progress: shock.progress, strength: shock.strength } : null,
    exposure,
    bloom: tier.bloom,
    frame: Math.round(frame.t * 30),
    edgeFeather: ctx.edgeFeather ?? 0,
  };
}
