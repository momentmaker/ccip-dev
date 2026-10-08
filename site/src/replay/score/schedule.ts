import type { Show } from '../director/show';

export const BPM = 96;
export const BEAT_S = 60 / BPM;
export const EIGHTH_S = BEAT_S / 2;
export const MAX_PLUCKS_PER_S = 8;
export const SCALE = [62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81] as const;
export const PROGRESSION = [
  [50, 57, 62, 65],
  [43, 50, 55, 59],
  [53, 60, 65, 69],
  [48, 55, 60, 64],
] as const;
export const FINAL_CHORD = [50, 57, 62, 66, 69, 73, 76] as const;
const RUN = [74, 76, 77, 79, 81, 86] as const;
export const CHORD_S = BEAT_S * 8;
const PAD_CUTOFF_MIN = 0.2;
const PULSE_GAIN_MIN = 0.3;

export type ScoreEvent =
  | { kind: 'pad'; time: number; duration: number; chord: readonly number[]; cutoff: number }
  | { kind: 'pulse'; time: number; gain: number }
  | { kind: 'pluck'; time: number; note: number; gain: number }
  | { kind: 'chime'; time: number; note: number }
  | { kind: 'boom'; time: number }
  | { kind: 'run'; time: number; notes: readonly number[] }
  | { kind: 'swell'; time: number; duration: number; chord: readonly number[] };

type PluckEvent = Extract<ScoreEvent, { kind: 'pluck' }>;

export interface ScoreSource {
  length: Show['length'];
  timing: Show['timing'];
  warp: Show['warp'];
  slams: Show['slams'];
  cards: Show['cards'];
  frameAt: Show['frameAt'];
  dailyMessages: Show['dailyMessages'];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function capPlucks(plucks: readonly PluckEvent[], max: number): PluckEvent[] {
  const kept: PluckEvent[] = [];
  let windowStart = 0;
  for (const p of plucks) {
    while (kept[windowStart] && kept[windowStart]!.time <= p.time - 1) windowStart++;
    if (kept.length - windowStart < max) kept.push(p);
  }
  return kept;
}

export function scoreFor(show: ScoreSource): ScoreEvent[] {
  const length = show.length;
  const storyStart = show.warp.start;
  const finaleStart = length - show.timing.finale;
  const daily = show.dailyMessages();
  const busiestDay = Math.max(1, ...daily);
  const finalUsd = Math.max(1e-9, show.frameAt(length).story.usd);
  const events: ScoreEvent[] = [];
  for (let i = 0, t = 0; t < finaleStart; i++, t += CHORD_S) {
    const cutoff = PAD_CUTOFF_MIN + (1 - PAD_CUTOFF_MIN) * clamp01(show.frameAt(t).story.usd / finalUsd);
    events.push({ kind: 'pad', time: t, duration: Math.min(CHORD_S, finaleStart - t), chord: PROGRESSION[i % PROGRESSION.length]!, cutoff });
  }
  for (let t = Math.ceil(storyStart / BEAT_S) * BEAT_S; t < finaleStart; t += BEAT_S) {
    const messages = daily[show.warp.dayAt(t).index] ?? 0;
    events.push({ kind: 'pulse', time: t, gain: PULSE_GAIN_MIN + (1 - PULSE_GAIN_MIN) * clamp01(messages / busiestDay) });
  }
  const plucks: PluckEvent[] = [];
  for (let k = Math.ceil(storyStart / EIGHTH_S); k * EIGHTH_S < finaleStart; k++) {
    const t = k * EIGHTH_S;
    const comets = show.frameAt(t).base.sky.comets;
    if (comets.length === 0) continue;
    const index = (comets.reduce((s, c) => s + c.from + 2 * c.to, 0) + k) % SCALE.length;
    plucks.push({ kind: 'pluck', time: t, note: SCALE[index]!, gain: Math.min(1, 0.25 + 0.15 * Math.log2(1 + comets.length)) });
  }
  events.push(...capPlucks(plucks, MAX_PLUCKS_PER_S));
  let chimes = 0;
  for (const c of show.cards) {
    if (c.kind === 'record') events.push({ kind: 'run', time: c.start, notes: RUN });
    else events.push({ kind: 'chime', time: c.start, note: chimes++ % 2 === 0 ? 86 : 93 });
  }
  for (const s of show.slams) events.push({ kind: 'boom', time: s.start });
  events.push({ kind: 'swell', time: finaleStart, duration: length - finaleStart, chord: FINAL_CHORD });
  return events.filter((e) => e.time >= 0 && e.time < length).sort((a, b) => a.time - b.time);
}
