import { describe, expect, it } from 'vitest';
import { AdaptiveRate, Pacer, RATE } from '../backfill/fees/rate';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; }, sleep: async (ms: number) => { t += ms; } };
}

/** Feeds `seconds` of successful requests at the current rate, each with `latencyMs`. */
function healthy(rate: AdaptiveRate, c: ReturnType<typeof clock>, seconds: number, latencyMs = 200): void {
  const end = c.now() + seconds * 1000;
  while (c.now() < end) {
    c.advance(rate.intervalMs());
    rate.record({ kind: 'ok', latencyMs });
  }
}

describe('AdaptiveRate', () => {
  it('starts at 3 requests per second', () => {
    expect(new AdaptiveRate(clock().now).rps).toBe(3);
  });

  it('adds one request per second after a healthy ten-minute window', () => {
    // #given
    const c = clock();
    const rate = new AdaptiveRate(c.now);

    // #when
    healthy(rate, c, 600);

    // #then
    expect(rate.rps).toBe(4);
  });

  it('never goes past 8 requests per second', () => {
    const c = clock();
    const rate = new AdaptiveRate(c.now);
    healthy(rate, c, 600 * 12);
    expect(rate.rps).toBe(RATE.maxRps);
  });

  it('halves on a 429, pauses for its Retry-After, and holds before stepping up again', () => {
    // #given
    const c = clock();
    const rate = new AdaptiveRate(c.now);
    healthy(rate, c, 600 * 3);

    // #when
    rate.record({ kind: 'throttled', retryAfterMs: 12_000 });

    // #then
    expect({ rps: rate.rps, pausedFor: rate.pausedUntil() - c.now() }).toEqual({ rps: 3, pausedFor: 12_000 });
  });

  it('caps a long Retry-After at 30 seconds and assumes 5 seconds when there is none', () => {
    const c = clock();
    const a = new AdaptiveRate(c.now);
    a.record({ kind: 'throttled', retryAfterMs: 120_000 });
    const b = new AdaptiveRate(c.now);
    b.record({ kind: 'throttled', retryAfterMs: null });
    expect([a.pausedUntil(), b.pausedUntil()]).toEqual([30_000, 5_000]);
  });

  it('never drops below 1 request per second', () => {
    const c = clock();
    const rate = new AdaptiveRate(c.now);
    for (let i = 0; i < 5; i++) rate.record({ kind: 'throttled', retryAfterMs: 1_000 });
    expect(rate.rps).toBe(RATE.minRps);
  });

  it('halves when more than 1% of at least 20 requests fail', () => {
    // #given
    const c = clock();
    const rate = new AdaptiveRate(c.now, () => {}, 6);

    // #when
    for (let i = 0; i < 18; i++) rate.record({ kind: 'ok', latencyMs: 100 });
    rate.record({ kind: 'error' });
    rate.record({ kind: 'error' });

    // #then
    expect(rate.rps).toBe(3);
  });

  it('does not step up when the median latency more than doubles', () => {
    // #given
    const c = clock();
    const rate = new AdaptiveRate(c.now);
    healthy(rate, c, 600, 200);

    // #when
    healthy(rate, c, 600, 500);

    // #then
    expect(rate.rps).toBe(4);
  });
});

describe('Pacer', () => {
  it('spaces request starts by the rate even when callers ask at once', async () => {
    // #given
    const c = clock(1_000);
    const pacer = new Pacer(new AdaptiveRate(c.now, () => {}, 4), c);
    const starts: number[] = [];

    // #when
    for (let i = 0; i < 3; i++) {
      await pacer.acquire();
      starts.push(c.now());
    }

    // #then
    expect(starts).toEqual([1_000, 1_250, 1_500]);
  });

  it('waits out a pause before the next start', async () => {
    const c = clock();
    const rate = new AdaptiveRate(c.now);
    rate.record({ kind: 'throttled', retryAfterMs: 7_000 });
    await new Pacer(rate, c).acquire();
    expect(c.now()).toBe(7_000);
  });
});
