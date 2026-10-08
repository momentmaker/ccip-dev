import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { realDeps } from '../src/deps';

function hangingFetch() {
  const seen: { signal: AbortSignal | undefined }[] = [];
  const impl = vi.fn((_input: unknown, init?: RequestInit) => {
    seen.push({ signal: init?.signal ?? undefined });
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    });
  });
  return { impl, seen };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('The operation timed out', 'TimeoutError')), ms);
    return controller.signal;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('realDeps.fetch timeout', () => {
  it('aborts a request that has not answered after 30 seconds, and not before', async () => {
    const { impl } = hangingFetch();
    vi.stubGlobal('fetch', impl);
    let outcome: unknown = 'pending';
    realDeps.fetch('https://example.test/slow').then((r) => { outcome = r; }, (e: unknown) => { outcome = e; });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(outcome).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toMatchObject({ name: 'TimeoutError' });
    expect(AbortSignal.timeout).toHaveBeenCalledWith(30_000);
  });

  it('keeps a caller supplied signal instead of adding its own timeout', async () => {
    const { impl, seen } = hangingFetch();
    vi.stubGlobal('fetch', impl);
    const controller = new AbortController();
    let outcome: unknown = 'pending';
    realDeps.fetch('https://example.test/slow', { signal: controller.signal }).then((r) => { outcome = r; }, (e: unknown) => { outcome = e; });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(seen[0]!.signal).toBe(controller.signal);
    expect(outcome).toBe('pending');

    controller.abort(new Error('caller gave up'));
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toMatchObject({ message: 'caller gave up' });
  });
});
