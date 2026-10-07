export interface DayFlags {
  join: boolean;
  milestone: boolean;
  record: boolean;
}

export interface Warp {
  readonly dayCount: number;
  readonly start: number;
  readonly end: number;
  dayStart(index: number): number;
  dayLength(index: number): number;
  dayAt(t: number): { index: number; progress: number };
}

export const WARP_MESSAGES = 0.6;
export const WARP_JOIN = 1.5;
export const WARP_MILESTONE = 2.5;
export const WARP_RECORD = 1.5;
export const WARP_DWELL_S = 0.6;
export const WARP_PRE_JOIN_SHARE = 0.15;
const MIN_PLAIN_SHARE = 0.5;
const NO_FLAGS: DayFlags = { join: false, milestone: false, record: false };

export function durationWarp(durations: readonly number[], start: number): Warp {
  const starts = [start];
  for (const d of durations) starts.push(starts.at(-1)! + d);
  const dayCount = durations.length;
  const end = starts[dayCount]!;
  return {
    dayCount,
    start,
    end,
    dayStart: (index) => starts[Math.max(0, Math.min(dayCount, index))]!,
    dayLength: (index) => durations[index] ?? 0,
    dayAt(t) {
      if (dayCount === 0 || t <= start) return { index: 0, progress: 0 };
      if (t >= end) return { index: dayCount - 1, progress: 1 };
      let lo = 0;
      let hi = dayCount - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid]! <= t) lo = mid;
        else hi = mid - 1;
      }
      const length = durations[lo]!;
      return { index: lo, progress: length > 0 ? (t - starts[lo]!) / length : 0 };
    },
  };
}

export function linearWarp(dayCount: number, start: number, end: number): Warp {
  return durationWarp(Array.from({ length: dayCount }, () => (end - start) / Math.max(1, dayCount)), start);
}

export function dayWeight(messages: number, flags: DayFlags): number {
  return (
    1 +
    WARP_MESSAGES * Math.log10(1 + Math.max(0, messages)) +
    (flags.join ? WARP_JOIN : 0) +
    (flags.milestone ? WARP_MILESTONE : 0) +
    (flags.record ? WARP_RECORD : 0)
  );
}

export interface PreJoinLimit {
  preDays: number;
  preShareMax: number;
}

const total = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

function limitPreShare(durations: number[], span: number, { preDays, preShareMax }: PreJoinLimit): number[] {
  const pre = total(durations.slice(0, preDays));
  const post = span - pre;
  if (preDays <= 0 || preDays >= durations.length || pre <= preShareMax * span || post <= 0) return durations;
  const preScale = (preShareMax * span) / pre;
  const postScale = ((1 - preShareMax) * span) / post;
  return durations.map((d, i) => d * (i < preDays ? preScale : postScale));
}

export function storyWarp(
  messages: readonly number[],
  flags: readonly DayFlags[],
  start: number,
  end: number,
  length: number,
  preJoin?: PreJoinLimit,
): Warp {
  const span = end - start;
  const milestoneDays = flags.filter((f) => f.milestone).length;
  const totalDwell = Math.min(milestoneDays * WARP_DWELL_S * (length / 30), span * (1 - MIN_PLAIN_SHARE));
  const dwell = milestoneDays > 0 ? totalDwell / milestoneDays : 0;
  const weights = messages.map((m, i) => dayWeight(m, flags[i] ?? NO_FLAGS));
  const sum = total(weights) || 1;
  const rest = span - totalDwell;
  const durations = weights.map((w, i) => (rest * w) / sum + ((flags[i] ?? NO_FLAGS).milestone ? dwell : 0));
  return durationWarp(preJoin ? limitPreShare(durations, span, preJoin) : durations, start);
}
