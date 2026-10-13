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

/** The month cut's end card has more to say, so its finale runs a second longer. */
const MONTH_TIMING: Record<number, ShotTiming> = {
  15: { hook: 1.5, finale: 3 },
  30: { hook: 2, finale: 4 },
  60: { hook: 2, finale: 4 },
};

export function shotTiming(length: number): ShotTiming {
  return TIMING[length] ?? { hook: Math.min(2, length * 0.1), finale: Math.min(3, length * 0.1) };
}

export function monthTiming(length: number): ShotTiming {
  return MONTH_TIMING[length] ?? shotTiming(length);
}

export function phaseAt(t: number, length: number, timing: ShotTiming = shotTiming(length)): Phase {
  return t < timing.hook ? 'hook' : t < length - timing.finale ? 'story' : 'finale';
}
