import type { CountedDay } from './all-time';

export type PulseMetric = 'messages' | 'usd_value' | 'fee_usd';
export const PULSE_METRICS: readonly { key: PulseMetric; label: string }[] = [
  { key: 'messages', label: 'Messages' },
  { key: 'usd_value', label: 'Value' },
  { key: 'fee_usd', label: 'Fees' },
];
export const PULSE_DAYS = 90;

export interface PulseFrame {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PulseGeometry {
  line: string;
  area: string;
  ticks: { value: number; y: number }[];
  /** x of each finalized day, then today's at the end. */
  xs: number[];
  ys: (number | null)[];
  high: { index: number; value: number; x: number; y: number } | null;
  today: { x: number; y: number; value: number; paced: { y: number; value: number } | null } | null;
  /** The value axis top. */
  max: number;
}

export const pulseValue = (d: CountedDay, metric: PulseMetric): number | null => (metric === 'fee_usd' ? d.fee_usd : d[metric]);

/** Round-number ticks from zero that cover `max` in about `count` steps. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const m = raw / power;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * power;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

/**
 * The 90-day chart: the finalized days as a line and area, today's live point after them, and the dashed line to
 * where today is heading at its pace. Today and its pace count toward the axis so neither runs off the top.
 */
export function pulseGeometry(
  days: readonly CountedDay[],
  metric: PulseMetric,
  today: { value: number | null; paced: number | null } | null,
  frame: PulseFrame,
): PulseGeometry {
  const values = days.map((d) => pulseValue(d, metric));
  const slots = days.length + (today ? 1 : 0);
  const known = values.filter((v): v is number => v !== null);
  const peak = Math.max(0, ...known, today?.value ?? 0, today?.paced ?? 0);
  const ticks = niceTicks(peak);
  const max = ticks.at(-1)!;
  const plotW = frame.width - frame.left - frame.right;
  const plotH = frame.height - frame.top - frame.bottom;
  const x = (i: number) => frame.left + (slots <= 1 ? plotW : (i / (slots - 1)) * plotW);
  const y = (v: number) => frame.top + plotH * (1 - v / max);
  const xs = Array.from({ length: slots }, (_, i) => x(i));
  const ys = values.map((v) => (v === null ? null : y(v)));
  const pts: string[] = [];
  let firstX: number | null = null;
  let lastX = 0;
  values.forEach((v, i) => {
    if (v === null) return;
    firstX ??= xs[i]!;
    lastX = xs[i]!;
    pts.push(`${xs[i]!.toFixed(1)},${y(v).toFixed(1)}`);
  });
  const base = y(0).toFixed(1);
  const line = pts.length > 0 ? `M${pts.join('L')}` : '';
  const area = pts.length > 0 ? `M${firstX!.toFixed(1)},${base}L${pts.join('L')}L${lastX.toFixed(1)},${base}Z` : '';
  let high: PulseGeometry['high'] = null;
  values.forEach((v, i) => {
    if (v !== null && (high === null || v > high.value)) high = { index: i, value: v, x: xs[i]!, y: y(v) };
  });
  const todayPoint =
    today && today.value !== null
      ? { x: xs.at(-1)!, y: y(today.value), value: today.value, paced: today.paced === null ? null : { y: y(today.paced), value: today.paced } }
      : null;
  return { line, area, ticks: ticks.map((value) => ({ value, y: y(value) })), xs, ys, high, today: todayPoint, max };
}

/** The slot nearest a pointer at `px` across the plot. */
export function pulseIndex(px: number, xs: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i]! - px) < Math.abs(xs[best]! - px)) best = i;
  return best;
}
