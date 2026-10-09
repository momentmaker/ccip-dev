import { area, line } from 'd3-shape';
import { CHART_H, CHART_W, pointX } from './charts';
import { formatUtcDay } from './format';

export interface WeeklySeries {
  key: string;
  label: string;
  values: number[];
}

/** Stacked: each series is an area on top of the ones before it. Not stacked: each series is a line, all on one scale. */
export function weeklyPaths(series: readonly WeeklySeries[], stacked: boolean, width = CHART_W, height = CHART_H, pad = 4): { key: string; d: string }[] {
  const count = series[0]?.values.length ?? 0;
  const zero = Array.from({ length: count }, () => 0);
  const lower: number[][] = [];
  const upper: number[][] = [];
  let base = zero;
  for (const s of series) {
    const bottom = stacked ? base : zero;
    const top = s.values.map((v, i) => bottom[i]! + v);
    lower.push(bottom);
    upper.push(top);
    if (stacked) base = top;
  }
  const max = Math.max(0, ...upper.flat()) || 1;
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);
  const x = (i: number) => pointX(i, count, width, pad);
  const index = Array.from({ length: count }, (_, i) => i);
  return series.map((s, k) => ({
    key: s.key,
    d: stacked
      ? (area<number>().x(x).y0((i) => y(lower[k]![i]!)).y1((i) => y(upper[k]![i]!))(index) ?? '')
      : (line<number>().x(x).y((i) => y(upper[k]![i]!))(index) ?? ''),
  }));
}

export function weeklySummary(title: string, weeks: readonly string[], series: readonly WeeklySeries[], format: (v: number | null) => string): string {
  if (weeks.length === 0) return `${title}: no complete weeks yet`;
  const last = weeks.length - 1;
  return `${title}, weeks of ${formatUtcDay(weeks[0]!)} to ${formatUtcDay(weeks[last]!)}. Latest week: ${series.map((s) => `${s.label} ${format(s.values[last] ?? null)}`).join(', ')}`;
}
