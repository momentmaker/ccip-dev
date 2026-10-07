import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPoller, type Visibility } from '../src/lib/poller';
import status from './fixtures/status.json';

function fakeVisibility(initial = true) {
  let visible = initial;
  const listeners = new Set<() => void>();
  const visibility: Visibility = {
    isVisible: () => visible,
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    visibility,
    set(next: boolean) {
      visible = next;
      for (const l of listeners) l();
    },
  };
}

function scriptedFetch(outcomes: ('ok' | 'fail')[]) {
  let calls = 0;
  const fn = (async () => {
    const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
    calls += 1;
    return outcome === 'ok'
      ? { ok: true, status: 200, json: async () => status }
      : { ok: false, status: 500, json: async () => ({}) };
  }) as unknown as typeof fetch;
  return { fn, calls: () => calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('startPoller', () => {
  it('polls at once, then every 30 s', async () => {
    const f = scriptedFetch(['ok']);
    const onData = vi.fn();
    const stop = startPoller({ name: 'status.json', onData, onError: vi.fn(), fetch: f.fn, visibility: fakeVisibility().visibility });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.calls()).toBe(2);
    expect(onData).toHaveBeenCalledTimes(2);
    stop();
  });

  it('backs off after failures and returns to 30 s after a success', async () => {
    const f = scriptedFetch(['fail', 'fail', 'ok', 'ok']);
    const onError = vi.fn();
    const stop = startPoller({ name: 'status.json', onData: vi.fn(), onError, fetch: f.fn, visibility: fakeVisibility().visibility });
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenLastCalledWith(expect.anything(), 1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(f.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls()).toBe(2);
    expect(onError).toHaveBeenLastCalledWith(expect.anything(), 2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.calls()).toBe(3);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.calls()).toBe(4);
    stop();
  });

  it('stops while hidden and polls at once when visible again', async () => {
    const f = scriptedFetch(['ok']);
    const v = fakeVisibility();
    const stop = startPoller({ name: 'status.json', onData: vi.fn(), onError: vi.fn(), fetch: f.fn, visibility: v.visibility });
    await vi.advanceTimersByTimeAsync(0);
    v.set(false);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(f.calls()).toBe(1);
    v.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls()).toBe(2);
    stop();
  });

  it('never polls again after stop', async () => {
    const f = scriptedFetch(['ok']);
    const stop = startPoller({ name: 'status.json', onData: vi.fn(), onError: vi.fn(), fetch: f.fn, visibility: fakeVisibility().visibility });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(f.calls()).toBe(1);
  });
});
