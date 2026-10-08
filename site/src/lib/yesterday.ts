import type { DayTotals, TodayFile } from '@ccip-dev/core/public';

const DAY_MS = 86_400_000;

export function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

export function yesterdayFor(days: readonly DayTotals[], today: string): DayTotals | null {
  const target = previousDay(today);
  return days.find((d) => d.day === target) ?? null;
}

export interface DaySnapshot {
  day: string;
  messages: number;
  usd_value: number;
}

export function rolloverSnapshot(lastPolled: TodayFile | null, incomingDay: string): DaySnapshot | null {
  if (!lastPolled || lastPolled.day === incomingDay) return null;
  return { day: lastPolled.day, messages: lastPolled.totals.messages, usd_value: lastPolled.totals.usd_value };
}
