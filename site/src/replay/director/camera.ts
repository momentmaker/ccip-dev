export interface Camera {
  cx: number;
  cy: number;
  extent: number;
  rotation: number;
}

export interface CameraInput {
  t: number;
  baseExtent: number;
  fullExtent: number;
  storyStart: number;
  storyEnd: number;
  slamStarts: readonly number[];
  focus: { x: number; y: number } | null;
}

export const ORBIT_RAD = (20 * Math.PI) / 180;
export const PUNCH = 0.06;
export const PUNCH_IN_S = 0.3;
export const PUNCH_OUT_S = 0.8;
export const FOCUS_PAN = 0.35;
export const FOCUS_FROM = 0.75;
export const FINALE_EASE_S = 2;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

export function punch(age: number): number {
  if (age < 0 || age >= PUNCH_IN_S + PUNCH_OUT_S) return 0;
  if (age < PUNCH_IN_S) return smoothstep(age / PUNCH_IN_S);
  return 1 - smoothstep((age - PUNCH_IN_S) / PUNCH_OUT_S);
}

export function cameraAt(i: CameraInput): Camera {
  const story = clamp01((i.t - i.storyStart) / Math.max(1e-9, i.storyEnd - i.storyStart));
  const finale = smoothstep((i.t - i.storyEnd) / FINALE_EASE_S);
  const pan = i.focus ? FOCUS_PAN * smoothstep((story - FOCUS_FROM) / (1 - FOCUS_FROM)) : 0;
  const cx = i.focus ? i.focus.x * pan : 0;
  const cy = i.focus ? i.focus.y * pan : 0;
  const push = Math.max(0, ...i.slamStarts.map((s) => punch(i.t - s)));
  const extent = (i.baseExtent + (i.fullExtent - i.baseExtent) * finale) * (1 - PUNCH * push) + Math.hypot(cx, cy);
  return { cx, cy, extent, rotation: ORBIT_RAD * story * (1 - finale) };
}
