import { describe, expect, it, vi } from 'vitest';
import { loadCoinImages, settleWithin, sizedSvg } from '../src/replay/coin-images';

describe('sizedSvg', () => {
  it('sets the root size and keeps the viewBox and children', () => {
    expect(sizedSvg('<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32"/></svg>', 128)).toBe(
      '<svg width="128" height="128" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32"/></svg>',
    );
  });

  it('adds a size to a root without one', () => {
    expect(sizedSvg('<svg viewBox="0 0 32 32"/>', 64)).toBe('<svg width="64" height="64" viewBox="0 0 32 32"/>');
  });
});

describe('loadCoinImages', () => {
  it('keeps the icons that load and skips one that fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = { tag: 'ok' } as unknown as CanvasImageSource;
    const images = await loadCoinImages(new Map([['a', '/chains/a.svg'], ['b', '/chains/b.svg']]), async (href) => {
      if (href.endsWith('b.svg')) throw new Error('HTTP 404');
      return ok;
    });
    expect([...images]).toEqual([['a', ok]]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('settleWithin', () => {
  it('resolves with the promise when it is fast enough', async () => {
    await expect(settleWithin(Promise.resolve('fast'), 50, 'slow')).resolves.toBe('fast');
  });

  it('falls back after the timeout', async () => {
    vi.useFakeTimers();
    const pending = settleWithin(new Promise<string>(() => {}), 5_000, 'fallback');
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toBe('fallback');
    vi.useRealTimers();
  });
});
