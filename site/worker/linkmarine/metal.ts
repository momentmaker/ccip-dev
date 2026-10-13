import type { Tier } from '@ccip-dev/core/linkmarine';

export interface Stop {
  at: number;
  color: string;
}

const stops = (list: readonly Stop[]) => list.map((s) => `<stop offset="${s.at}" stop-color="${s.color.slice(0, 7)}"${s.color.length === 9 ? ` stop-opacity="${(parseInt(s.color.slice(7), 16) / 255).toFixed(3)}"` : ''}/>`).join('');

/** A CSS linear-gradient(angle) on a w×h box, as SVG: the same line through the centre, the same length. */
export function cssLinear(id: string, angle: number, w: number, h: number, list: readonly Stop[]): string {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const f = (v: number) => Math.round(v * 100) / 100;
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(w / 2 - dx * half)}" y1="${f(h / 2 - dy * half)}" x2="${f(w / 2 + dx * half)}" y2="${f(h / 2 + dy * half)}">${stops(list)}</linearGradient>`;
}

/** A CSS radial-gradient(circle at x% y%, …) on a w×h box: farthest-corner, as CSS sizes it. */
export function cssRadialSpot(id: string, xPct: number, yPct: number, w: number, h: number, list: readonly Stop[]): string {
  const cx = (w * xPct) / 100;
  const cy = (h * yPct) / 100;
  const r = Math.max(...[[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => Math.hypot(x! - cx, y! - cy)));
  const f = (v: number) => Math.round(v * 100) / 100;
  return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}">${stops(list)}</radialGradient>`;
}

export interface TierLook {
  /** The metal: linear gradient stops at an angle, with optional patina spots and brushing. */
  metal: { angle: number; stops: readonly Stop[]; spots: readonly { x: number; y: number; stops: readonly Stop[] }[]; brushed: boolean };
  /** Embossed type on the metal. */
  ink: string;
  /** The halo, the planets' glow and frames. */
  color: string;
  /** The wordmark: a vertical gradient. */
  word: string;
  /** The odds line, the pips and the outer frames of a ◆◆◆ planet. */
  accent: string;
  halo: { strength: number; glow: boolean };
  sheen: 'holo' | 'soft' | null;
  sparkles: boolean;
}

export const TIER_LOOKS: Readonly<Record<Tier, TierLook>> = {
  common: {
    metal: {
      angle: 135,
      stops: [{ at: 0, color: '#4a5260' }, { at: 0.28, color: '#c9d1dc' }, { at: 0.4, color: '#f4f7fb' }, { at: 0.62, color: '#8e98a6' }, { at: 1, color: '#5b6472' }],
      spots: [],
      brushed: true,
    },
    ink: '#1d2430',
    color: '#c9d1dc',
    word: 'linear-gradient(180deg, #ffffff, #c9d1dc 45%, #6b7584)',
    accent: '#e4e9f0',
    halo: { strength: 0.35, glow: false },
    sheen: null,
    sparkles: false,
  },
  uncommon: {
    metal: {
      angle: 135,
      stops: [{ at: 0, color: '#5a3416' }, { at: 0.3, color: '#c98a4b' }, { at: 0.42, color: '#f0c08a' }, { at: 0.64, color: '#9a5f2c' }, { at: 1, color: '#4e2c12' }],
      spots: [
        { x: 78, y: 30, stops: [{ at: 0, color: '#4fae8c99' }, { at: 0.09, color: '#4fae8c99' }, { at: 0.16, color: '#4fae8c00' }] },
        { x: 22, y: 78, stops: [{ at: 0, color: '#3f9c7b88' }, { at: 0.07, color: '#3f9c7b88' }, { at: 0.13, color: '#3f9c7b00' }] },
        { x: 60, y: 85, stops: [{ at: 0, color: '#5fbf9a66' }, { at: 0.05, color: '#5fbf9a66' }, { at: 0.1, color: '#5fbf9a00' }] },
      ],
      brushed: false,
    },
    ink: '#2e1606',
    color: '#d9955a',
    word: 'linear-gradient(180deg, #ffe2bf, #d9955a 45%, #6e3d16)',
    accent: '#f0c08a',
    halo: { strength: 0.35, glow: false },
    sheen: null,
    sparkles: false,
  },
  rare: {
    metal: {
      angle: 120,
      stops: [{ at: 0, color: '#2b3a8f' }, { at: 0.22, color: '#4f7cff' }, { at: 0.42, color: '#b07cff' }, { at: 0.58, color: '#ffd27a' }, { at: 0.76, color: '#4fd1c5' }, { at: 1, color: '#2b3a8f' }],
      spots: [],
      brushed: false,
    },
    ink: '#141a46',
    color: '#8f8cff',
    word: 'linear-gradient(180deg, #eef2ff, #8fa8ff 40%, #b07cff 70%, #4fd1c5)',
    accent: '#c3b8ff',
    halo: { strength: 0.65, glow: true },
    sheen: 'soft',
    sparkles: false,
  },
  legendary: {
    metal: {
      angle: 135,
      stops: [{ at: 0, color: '#6e4a0c' }, { at: 0.2, color: '#f5c451' }, { at: 0.36, color: '#fff6cf' }, { at: 0.54, color: '#c8901e' }, { at: 0.72, color: '#f7dc85' }, { at: 1, color: '#7d570f' }],
      spots: [],
      brushed: false,
    },
    ink: '#3a2706',
    color: '#f5c451',
    word: 'linear-gradient(180deg, #fff6cf, #f5c451 45%, #b07a12)',
    accent: '#f5d77a',
    halo: { strength: 1, glow: true },
    sheen: 'holo',
    sparkles: true,
  },
};

export const HOLO_STOPS: readonly Stop[] = [
  { at: 0.2, color: '#ff7ad900' },
  { at: 0.32, color: '#ff7ad955' },
  { at: 0.4, color: '#7af0ff55' },
  { at: 0.48, color: '#fff7a855' },
  { at: 0.6, color: '#fff7a800' },
];
