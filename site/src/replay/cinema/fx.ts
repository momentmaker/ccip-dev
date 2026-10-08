import { mulberry32 } from '../timeline';

export const SPARK_LIFE = 0.4;
export const NOVA_FLASH_S = 0.3;
export const NOVA_RING_S = 0.8;
export const NOVA_PARTICLE_S = 1.2;
export const NOVA_PARTICLES = 40;
export const POP_S = 0.5;
export const SHOCK_S = 0.5;
const COMET_FADE_OUT = 0.05;

export interface Particle {
  x: number;
  y: number;
  alpha: number;
  size: number;
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
export const easeInOut = (x: number) => {
  const c = clamp01(x);
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
};

export function burst(seed: number, count: number, age: number, life: number, ox: number, oy: number, reach: number): Particle[] {
  if (age < 0 || age >= life) return [];
  const rng = mulberry32(seed);
  const p = age / life;
  const travel = easeOut(p);
  const alpha = (1 - p) ** 2;
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const speed = 0.4 + 0.6 * rng();
    const size = 0.5 + 0.5 * rng();
    out.push({ x: ox + Math.cos(angle) * speed * reach * travel, y: oy + Math.sin(angle) * speed * reach * travel, alpha, size });
  }
  return out;
}

export function novaFlash(age: number): number {
  return age < 0 ? 0 : clamp01(1 - age / NOVA_FLASH_S);
}

export function novaRing(age: number): { radius: number; alpha: number } {
  const p = clamp01(age / NOVA_RING_S);
  return { radius: easeOut(p), alpha: 1 - p };
}

export function elasticPop(age: number): number {
  const p = age / POP_S;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  if (p < 0.6) return 1.25 * easeOut(p / 0.6);
  return 1.25 - 0.25 * easeInOut((p - 0.6) / 0.4);
}

export function cometFade(progress: number): number {
  return clamp01((1 - progress) / COMET_FADE_OUT);
}

export function heartbeat(activity: number): number {
  return 0.8 + 0.4 * clamp01(activity);
}

export function shockAt(age: number): { progress: number; strength: number } | null {
  if (age < 0 || age >= SHOCK_S) return null;
  const progress = age / SHOCK_S;
  return { progress, strength: (1 - progress) ** 2 };
}

export function textTargets(image: { width: number; height: number; data: ArrayLike<number> }, step: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < image.height; y += step) {
    for (let x = 0; x < image.width; x += step) {
      if ((image.data[(y * image.width + x) * 4 + 3] ?? 0) > 127) out.push({ x: x / image.width, y: y / image.height });
    }
  }
  return out;
}

export function assemble(seed: number, sources: readonly { x: number; y: number }[], targets: readonly { x: number; y: number }[], p: number): Particle[] {
  if (sources.length === 0) return [];
  const rng = mulberry32(seed);
  return targets.map((target, i) => {
    const source = sources[i % sources.length]!;
    const delay = rng() * 0.4;
    const swirl = (rng() - 0.5) * 0.6;
    const k = p <= 0 ? 0 : p >= 1 ? 1 : easeInOut((p - delay) / 0.6);
    const mx = (source.x + target.x) / 2 - (target.y - source.y) * swirl;
    const my = (source.y + target.y) / 2 + (target.x - source.x) * swirl;
    const u = 1 - k;
    return {
      x: u * u * source.x + 2 * u * k * mx + k * k * target.x,
      y: u * u * source.y + 2 * u * k * my + k * k * target.y,
      alpha: clamp01(p * 4),
      size: 0.6 + 0.4 * rng(),
    };
  });
}

export function arrivalSeed(to: number, arrivalTime: number): number {
  return (to * 100_003 + Math.round(arrivalTime * 30)) >>> 0;
}
