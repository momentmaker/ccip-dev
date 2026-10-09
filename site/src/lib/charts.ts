import type { DayTotals } from '@ccip-dev/core/public';
import { area, line } from 'd3-shape';
import type { HistoryRange } from './card-paths';
import { addDays } from './days';
import { formatUtcDay } from './format';

export type HistoryMetric = 'messages' | 'usd_value' | 'fee_usd' | 'take_rate_bps' | 'unique_senders' | 'median_delivery_s';

export interface ChartPoint {
  day: string;
  value: number | null;
}

export interface ChartGeometry {
  line: string;
  area: string;
  min: number;
  max: number;
  last: ChartPoint | null;
}

export const ADDITIVE: ReadonlySet<HistoryMetric> = new Set<HistoryMetric>(['messages', 'usd_value', 'fee_usd']);
/** Charts that start where fee data starts, as the fees chart does. */
export const FEE_METRICS: ReadonlySet<HistoryMetric> = new Set<HistoryMetric>(['fee_usd', 'take_rate_bps']);

/** Fees as basis points of value moved; none for a day without fees or without value moved. */
export function takeRateBps(d: Pick<DayTotals, 'fee_usd' | 'usd_value'>): number | null {
  return d.fee_usd === null || d.fee_usd === 0 || d.usd_value === 0 ? null : (d.fee_usd * 10_000) / d.usd_value;
}

const metricValue = (d: DayTotals, metric: HistoryMetric): number | null => (metric === 'take_rate_bps' ? takeRateBps(d) : d[metric]);

export const RANGE_DAYS: Record<HistoryRange, number | null> = { '30d': 30, '90d': 90, '1y': 365, all: null };
export const CHART_W = 600;
export const CHART_H = 160;

export function rangeRows(days: readonly DayTotals[], range: HistoryRange, lastDay: string): DayTotals[] {
  const n = RANGE_DAYS[range];
  const from = n === null ? null : addDays(lastDay, -(n - 1));
  return days.filter((d) => d.day <= lastDay && (from === null || d.day >= from));
}

export function chartSeries(rows: readonly DayTotals[], metric: HistoryMetric, cumulative: boolean): ChartPoint[] {
  if (!cumulative || !ADDITIVE.has(metric)) return rows.map((d) => ({ day: d.day, value: metricValue(d, metric) }));
  let sum = 0;
  let seen = false;
  return rows.map((d) => {
    const v = metricValue(d, metric);
    if (v !== null) {
      sum += v;
      seen = true;
    }
    return { day: d.day, value: seen ? sum : null };
  });
}

export function pointX(i: number, count: number, width: number, pad = 4): number {
  return pad + (i / Math.max(count - 1, 1)) * (width - pad * 2);
}

export function nearestIndex(x: number, width: number, count: number, pad = 4): number {
  const raw = Math.round(((x - pad) / (width - pad * 2)) * Math.max(count - 1, 0));
  return Math.min(Math.max(raw, 0), Math.max(count - 1, 0));
}

export function chartGeometry(points: readonly ChartPoint[], width: number, height: number, pad = 4): ChartGeometry {
  const values = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const x = (i: number) => pointX(i, points.length, width, pad);
  const defined = (p: ChartPoint) => p.value !== null;
  const lineGen = line<ChartPoint>().defined(defined).x((_, i) => x(i)).y((p) => y(p.value!));
  const areaGen = area<ChartPoint>().defined(defined).x((_, i) => x(i)).y0(y(0)).y1((p) => y(p.value!));
  const list = [...points];
  return { line: lineGen(list) ?? '', area: areaGen(list) ?? '', min, max, last: [...list].reverse().find(defined) ?? null };
}

export function rangeTotals(rows: readonly DayTotals[]): { messages: number; usd_value: number; fee_usd: number | null } {
  const fees = rows.flatMap((d) => (d.fee_usd === null ? [] : [d.fee_usd]));
  return {
    messages: rows.reduce((s, d) => s + d.messages, 0),
    usd_value: rows.reduce((s, d) => s + d.usd_value, 0),
    fee_usd: fees.length === 0 ? null : fees.reduce((s, v) => s + v, 0),
  };
}

export function linkShare(rows: readonly DayTotals[], day: string, cumulative: boolean): number | null {
  const scoped = rows.filter((d) => (cumulative ? d.day <= day : d.day === day));
  let fee = 0;
  let link = 0;
  for (const d of scoped) {
    if (d.fee_usd === null || d.fee_link_usd === null) continue;
    fee += d.fee_usd;
    link += d.fee_link_usd;
  }
  return fee === 0 ? null : (link / fee) * 100;
}

export function stepIndex(current: number | null, key: string, count: number): number | null {
  const last = count - 1;
  switch (key) {
    case 'ArrowLeft':
      return current === null ? last : Math.max(current - 1, 0);
    case 'ArrowRight':
      return current === null ? 0 : Math.min(current + 1, last);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return current;
  }
}

export function chartSummary(title: string, points: readonly ChartPoint[], format: (v: number | null) => string, cumulative: boolean): string {
  const present = points.filter((p) => p.value !== null);
  if (present.length === 0) return `${title}: no data`;
  const max = Math.max(...present.map((p) => p.value!));
  const first = present[0]!;
  const last = present[present.length - 1]!;
  return `${title}${cumulative ? ', cumulative' : ''}, ${formatUtcDay(first.day)} to ${formatUtcDay(last.day)}: latest ${format(last.value)}, high ${format(max)}`;
}
