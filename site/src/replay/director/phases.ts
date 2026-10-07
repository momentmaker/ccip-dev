export type Phase = 'hook' | 'story' | 'finale';

export interface ShotTiming {
  hook: number;
  finale: number;
}

const TIMING: Record<number, ShotTiming> = {
  15: { hook: 1.5, finale: 2 },
  30: { hook: 2, finale: 3 },
  60: { hook: 2, finale: 3 },
};

export function shotTiming(length: number): ShotTiming {
  return TIMING[length] ?? { hook: Math.min(2, length * 0.1), finale: Math.min(3, length * 0.1) };
}

export function phaseAt(t: number, length: number): Phase {
  const { hook, finale } = shotTiming(length);
  return t < hook ? 'hook' : t < length - finale ? 'story' : 'finale';
}
