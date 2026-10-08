export const RATE = {
  startRps: 3,
  maxRps: 8,
  minRps: 1,
  stepRps: 1,
  windowMs: 10 * 60_000,
  holdMs: 10 * 60_000,
  maxErrorRate: 0.01,
  minSamplesForErrorRate: 20,
  latencyFactor: 2,
  defaultPauseMs: 5_000,
  maxPauseMs: 30_000,
} as const;

export type RateSample = { kind: 'ok'; latencyMs: number | null } | { kind: 'throttled'; retryAfterMs: number | null } | { kind: 'error' };

/** Additive increase, multiplicative decrease: one more request per second after each healthy window, half on trouble. */
export class AdaptiveRate {
  private current: number;
  private windowStart: number;
  private ok = 0;
  private errors = 0;
  private latencies: number[] = [];
  private baselineMs: number | null = null;
  private pause = 0;

  constructor(private readonly now: () => number, private readonly log: (line: string) => void = () => {}, start: number = RATE.startRps) {
    this.current = start;
    this.windowStart = now();
  }

  get rps(): number {
    return this.current;
  }

  intervalMs(): number {
    return 1000 / this.current;
  }

  pausedUntil(): number {
    return this.pause;
  }

  record(sample: RateSample): void {
    const now = this.now();
    if (sample.kind === 'throttled') {
      const alreadyPaused = now < this.pause;
      this.pause = Math.max(this.pause, now + Math.min(sample.retryAfterMs ?? RATE.defaultPauseMs, RATE.maxPauseMs));
      this.backOff(now, 'HTTP 429', alreadyPaused);
      return;
    }
    if (sample.kind === 'ok') {
      this.ok += 1;
      if (sample.latencyMs !== null) this.latencies.push(sample.latencyMs);
    } else {
      this.errors += 1;
    }
    const total = this.ok + this.errors;
    if (total >= RATE.minSamplesForErrorRate && this.errors / total > RATE.maxErrorRate) {
      this.backOff(now, `${this.errors} of ${total} requests failed`);
      return;
    }
    if (now - this.windowStart >= RATE.windowMs) this.closeWindow(now);
  }

  private closeWindow(now: number): void {
    const median = medianOf(this.latencies);
    if (this.baselineMs === null) this.baselineMs = median;
    const total = this.ok + this.errors;
    const fewErrors = total === 0 || this.errors / total <= RATE.maxErrorRate;
    const fast = median === null || this.baselineMs === null || median <= this.baselineMs * RATE.latencyFactor;
    if (fewErrors && fast && this.current < RATE.maxRps) {
      const next = Math.min(RATE.maxRps, this.current + RATE.stepRps);
      this.log(`rate ${this.current} -> ${next} req/s (healthy window, median ${Math.round(median ?? 0)} ms)`);
      this.current = next;
    }
    this.resetWindow(now);
  }

  private backOff(now: number, why: string, alreadyPaused: boolean = false): void {
    if (!alreadyPaused) {
      const next = Math.max(RATE.minRps, Math.floor(this.current / 2));
      this.log(`rate ${this.current} -> ${next} req/s (${why}); holding ${RATE.holdMs / 60_000} min`);
      this.current = next;
      this.resetWindow(now);
    }
  }

  private resetWindow(now: number): void {
    this.windowStart = now;
    this.ok = 0;
    this.errors = 0;
    this.latencies = [];
  }
}

/** Spaces request starts by the current rate. Each start is reserved before awaiting, so concurrent callers never share a slot. */
export class Pacer {
  private next = 0;

  constructor(private readonly rate: AdaptiveRate, private readonly clock: { now: () => number; sleep: (ms: number) => Promise<void> }) {}

  async acquire(): Promise<void> {
    while (true) {
      const now = this.clock.now();
      const at = Math.max(now, this.next, this.rate.pausedUntil());
      this.next = at + this.rate.intervalMs();
      if (at <= now) return;
      await this.clock.sleep(at - now);
      if (this.clock.now() >= this.rate.pausedUntil()) return;
    }
  }
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
