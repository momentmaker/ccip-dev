import { describe, expect, it } from 'vitest';
import { AdaptiveRate, Pacer, RATE } from '../backfill/fees/rate';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; }, sleep: async (ms: number) => { t += ms; } };
}

/** A fake clock whose sleeps resolve in wake-time order, as real timers do, so concurrent sleepers share one timeline. */
function timers(start = 0) {
  let t = start;
  const pending: { at: number; wake: () => void }[] = [];
  return {
    now: () => t,
    sleep: (ms: number) => new Promise<void>((wake) => { pending.push({ at: t + ms, wake }); }),
    async drain() {
      for (;;) {
        await new Promise((resolve) => setImmediate(resolve));
        pending.sort((a, b) => a.at - b.at);
        const next = pending.shift();
        if (!next) return;
        t = Math.max(t, next.at);
        next.wake();
      }
    },
  };
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
    healthy(rate, c, 600 * 3 + 1);

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

  it('a later 429 cannot shorten the pause', () => {
    // #given
    const c = clock();
    const rate = new AdaptiveRate(c.now);

    // #when
    rate.record({ kind: 'throttled', retryAfterMs: 30_000 });
    c.advance(100);
    rate.record({ kind: 'throttled', retryAfterMs: 2_000 });

    // #then
    expect(rate.pausedUntil() - c.now()).toBe(29_900);
  });

  it('two consecutive 429s halve once, not twice', () => {
    // #given
    const c = clock();
    const rate = new AdaptiveRate(c.now, () => {}, 6);

    // #when
    rate.record({ kind: 'throttled', retryAfterMs: 5_000 });
    rate.record({ kind: 'throttled', retryAfterMs: 5_000 });

    // #then
    expect(rate.rps).toBe(3);
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

  it('respects a pause recorded during a reserved sleep', async () => {
    // #given
    const c = clock();
    const rate = new AdaptiveRate(c.now, () => {}, 10);
    const pacer = new Pacer(rate, c);
    const starts: number[] = [];

    // First request starts immediately at t=0, reserves next slot at t=100
    await pacer.acquire();

    // #when - second request needs to sleep until t=100, but a 429 comes at t=50
    const secondRequestPromise = (async () => {
      await pacer.acquire();
      starts.push(c.now());
    })();

    // Simulate the sleep advancing time by 50ms, then record a throttle
    c.advance(50);
    rate.record({ kind: 'throttled', retryAfterMs: 10_000 });

    // Finish the sleep to t=100, but now the pause is active until t=10_150
    c.advance(50);

    await secondRequestPromise;

    // #then - should have waited out the 10s pause, not started at 100ms
    expect(starts[0]).toBe(10_150);
  });

  it('re-spaces callers that were asleep when a pause began', async () => {
    // #given two callers asleep on slots reserved at 4 req/s
    const c = timers(0);
    const rate = new AdaptiveRate(c.now, () => {}, 4);
    const pacer = new Pacer(rate, c);
    const starts: number[] = [];
    await pacer.acquire();
    const a = pacer.acquire().then(() => starts.push(c.now()));
    const b = pacer.acquire().then(() => starts.push(c.now()));

    // #when a 429 pauses for 10 s and halves the rate, and a third caller arrives after it
    rate.record({ kind: 'throttled', retryAfterMs: 10_000 });
    const late = pacer.acquire().then(() => starts.push(c.now()));
    await c.drain();
    await Promise.all([a, b, late]);

    // #then every start is after the pause, one interval apart
    const sorted = [...starts].sort((x, y) => x - y);
    expect({ first: sorted[0], gaps: sorted.slice(1).map((s, i) => s - sorted[i]!) }).toEqual({ first: 10_000, gaps: [500, 500] });
  });

});

describe('AdaptiveRate hold', () => {
  it('does not step up until 600s after backoff', () => {
    // #given
    const c = clock();
    const rate = new AdaptiveRate(c.now, () => {}, 6);
    rate.record({ kind: 'throttled', retryAfterMs: 5_000 });

    // #when - feed 599s of healthy data (just under hold period)
    healthy(rate, c, 599);

    // #then - rate should stay at 3 (not stepped up)
    expect(rate.rps).toBe(3);
  });

  it('steps up after 600s following backoff', () => {
    // #given
    const c = clock();
    const rate = new AdaptiveRate(c.now, () => {}, 6);
    rate.record({ kind: 'throttled', retryAfterMs: 5_000 });

    // #when - feed exactly 600s + 1 (past hold period, one window)
    healthy(rate, c, 600 + 1);

    // #then - rate should step up to 4
    expect(rate.rps).toBe(4);
  });
});
