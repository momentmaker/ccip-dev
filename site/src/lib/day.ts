import type { DayTotals } from '@ccip-dev/core/public';
import { addDays } from './days';
import { formatFee, linkShareText } from './format';
import type { DayRecord, Milestone } from './records';

type Compared = 'messages' | 'usd_value' | 'unique_senders';

export interface DayDelta {
  vsPrevious: number | null;
  vsAvg7: number | null;
}

export interface DayView {
  row: DayTotals;
  previous: DayTotals | null;
  avg7: Record<Compared, number> | null;
  deltas: Record<Compared, DayDelta>;
  prevDay: string | null;
  nextDay: string | null;
}

const COMPARED: Compared[] = ['messages', 'usd_value', 'unique_senders'];

const pctChange = (current: number, base: number | null | undefined): number | null =>
  base === null || base === undefined || base <= 0 ? null : ((current - base) / base) * 100;

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

export function dayView(days: readonly DayTotals[], day: string): DayView | null {
  const sorted = [...days].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const index = sorted.findIndex((d) => d.day === day);
  if (index < 0) return null;
  const row = sorted[index]!;
  const previous = sorted.find((d) => d.day === addDays(day, -1)) ?? null;
  const week = sorted.filter((d) => d.day >= addDays(day, -7) && d.day < day);
  const avg7 = week.length === 0 ? null : (Object.fromEntries(COMPARED.map((k) => [k, mean(week.map((d) => d[k]))])) as Record<Compared, number>);
  const deltas = Object.fromEntries(
    COMPARED.map((k) => [k, { vsPrevious: pctChange(row[k], previous?.[k]), vsAvg7: pctChange(row[k], avg7?.[k]) }]),
  ) as Record<Compared, DayDelta>;
  return { row, previous, avg7, deltas, prevDay: sorted[index - 1]?.day ?? null, nextDay: sorted[index + 1]?.day ?? null };
}

export function dayHighlights(day: string, records: readonly DayRecord[], milestones: readonly Milestone[]): string[] {
  return [
    ...records.filter((r) => r.day === day).map((r) => `${r.title} ever: ${r.display}`),
    ...milestones.filter((m) => m.day === day).map((m) => m.label),
  ];
}

/** The Fees tile's sub-line: the fee per message, then the share paid in LINK when the day has a LINK figure. */
export function dayFeeLine(d: DayTotals): string | null {
  if (d.fee_usd === null || d.messages === 0) return null;
  const perMessage = `${formatFee(d.fee_usd / d.messages)} per message`;
  return d.fee_link_usd === null || d.fee_usd === 0 ? perMessage : `${perMessage} · ${linkShareText((d.fee_link_usd / d.fee_usd) * 100)}`;
}
