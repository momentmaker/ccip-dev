export const SPREAD_MS = 30_000;
export const FIRST_WINDOW_MS = 120_000;
export const FIRST_SPREAD_MS = 10_000;
export const RESUME_GAP_MS = 60_000;

export interface Timed {
  id: string;
  send_ts: string;
}

export interface Planned<T> {
  at: number;
  message: T;
}

export function spread<T extends Timed>(sorted: readonly T[], nowMs: number, windowMs: number): Planned<T>[] {
  if (sorted.length === 0) return [];
  const t0 = Date.parse(sorted[0]!.send_ts);
  const span = Date.parse(sorted.at(-1)!.send_ts) - t0;
  const factor = span > windowMs ? windowMs / span : 1;
  return sorted.map((message) => ({ at: nowMs + Math.round((Date.parse(message.send_ts) - t0) * factor), message }));
}

export function pruneStale<T>(queue: readonly Planned<T>[], nowMs: number, maxAgeMs = 2_000): Planned<T>[] {
  return queue.filter((p) => p.at >= nowMs - maxAgeMs);
}

export class LiveScheduler<T extends Timed> {
  private seen = new Set<string>();
  private lastIngest: number | null = null;

  ingest(messages: readonly T[], nowMs: number): { comets: Planned<T>[]; feedOnly: T[]; catchUp: boolean } {
    const fresh = messages.filter((m) => !this.seen.has(m.id));
    this.seen = new Set(messages.map((m) => m.id));
    const catchUp = this.lastIngest === null || nowMs - this.lastIngest > RESUME_GAP_MS;
    this.lastIngest = nowMs;
    const byTime = [...fresh].sort((a, b) => Date.parse(a.send_ts) - Date.parse(b.send_ts));
    if (!catchUp) return { comets: spread(byTime, nowMs, SPREAD_MS), feedOnly: [], catchUp };
    if (byTime.length === 0) return { comets: [], feedOnly: [], catchUp };
    const newest = Date.parse(byTime.at(-1)!.send_ts);
    const recent = byTime.filter((m) => newest - Date.parse(m.send_ts) <= FIRST_WINDOW_MS);
    const recentIds = new Set(recent.map((m) => m.id));
    return { comets: spread(recent, nowMs, FIRST_SPREAD_MS), feedOnly: byTime.filter((m) => !recentIds.has(m.id)), catchUp };
  }
}
