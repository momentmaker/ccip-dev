import { describe, expect, it, vi } from 'vitest';
import { catchCoin, COIN_CATCH_MS, coinCatchKeyframes } from '../src/sky/arrival';

describe('coinCatchKeyframes', () => {
  it('pops the coin and settles it, always keeping it centered on its star', () => {
    const frames = coinCatchKeyframes('token');
    expect(frames.map((f) => f.transform)).toEqual(['translate(-50%, -50%) scale(1)', 'translate(-50%, -50%) scale(1.15)', 'translate(-50%, -50%) scale(1)']);
  });

  it('glows in the comet color with the same three shadow layers in every frame, so they interpolate', () => {
    const frames = coinCatchKeyframes('gold');
    for (const f of frames) expect(String(f.boxShadow).match(/rgba\(/g)).toHaveLength(3);
    expect(String(frames[1]!.boxShadow)).toContain('245, 196, 81');
    expect(String(coinCatchKeyframes('data')[1]!.boxShadow)).toContain('201, 214, 245');
  });
});

describe('catchCoin', () => {
  it('restarts the catch on a coin that is still glowing', () => {
    const running = { cancel: vi.fn() };
    const coin = { getAnimations: () => [running], animate: vi.fn() };
    catchCoin(coin, 'data');
    expect(running.cancel).toHaveBeenCalledOnce();
    expect(coin.animate).toHaveBeenCalledWith(coinCatchKeyframes('data'), { duration: COIN_CATCH_MS });
  });

  it('does nothing for a chain without a coin', () => {
    expect(() => catchCoin(undefined, 'data')).not.toThrow();
  });
});
