const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function dayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

export function addDays(day: string, n: number): string {
  return new Date(dayStartMs(day) + n * DAY_MS).toISOString().slice(0, 10);
}

export function isDay(value: string): boolean {
  if (!DAY_RE.test(value)) return false;
  const ms = dayStartMs(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}
