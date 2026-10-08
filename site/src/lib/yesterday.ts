import type { DayTotals } from '@ccip-dev/core/public';

const DAY_MS = 86_400_000;

export function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

export function yesterdayFor(days: readonly DayTotals[], today: string): DayTotals | null {
  const target = previousDay(today);
  return days.find((d) => d.day === target) ?? null;
}
