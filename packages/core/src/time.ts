function parse(timestamp: string | Date): Date {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp: ${String(timestamp)}`);
  return date;
}

export function dayOf(timestamp: string | Date): string {
  return parse(timestamp).toISOString().slice(0, 10);
}

export function toIsoUtc(timestamp: string): string {
  return parse(timestamp).toISOString();
}

export function dayStartIso(day: string): string {
  return `${day}T00:00:00.000Z`;
}

export function addDays(day: string, n: number): string {
  const date = parse(dayStartIso(day));
  date.setUTCDate(date.getUTCDate() + n);
  return dayOf(date);
}

export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

const DAY_MS = 86_400_000;

/** The Monday (UTC) of the week holding `iso`, as YYYY-MM-DD; the Reserve's weekly deposits use the same weeks. */
export function weekStart(iso: string): string {
  const midnight = Date.parse(dayStartIso(dayOf(iso)));
  const sinceMonday = (new Date(midnight).getUTCDay() + 6) % 7;
  return dayOf(new Date(midnight - sinceMonday * DAY_MS));
}
