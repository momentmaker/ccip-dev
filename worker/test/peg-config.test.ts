import { DEFAULT_PEG_THRESHOLDS } from '@ccip-dev/core';
import { describe, expect, it, vi } from 'vitest';
import { pegConfig } from '../src/peg-config';

describe('pegConfig', () => {
  it('reads the thresholds as percents', () => {
    expect(pegConfig({ PEG_ALERT_PRIVATE_PCT: '0.3', PEG_ALERT_PUBLIC_PCT: '0.75', PEG_PUBLIC: 'on' })).toEqual({ thresholds: { private: 0.003, public: 0.0075 }, publicPosts: true });
  });

  it('defaults when unset, with public posts off', () => {
    expect(pegConfig({})).toEqual({ thresholds: DEFAULT_PEG_THRESHOLDS, publicPosts: false });
  });

  it.each([
    ['not a number', { PEG_ALERT_PRIVATE_PCT: 'abc' }],
    ['negative', { PEG_ALERT_PUBLIC_PCT: '-1' }],
    ['public under private', { PEG_ALERT_PRIVATE_PCT: '1', PEG_ALERT_PUBLIC_PCT: '0.5' }],
  ])('falls back to both defaults, with a warning, when a threshold is %s', (_name, env) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(pegConfig(env).thresholds).toEqual(DEFAULT_PEG_THRESHOLDS);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('posts publicly only on an exact "on"', () => {
    expect(pegConfig({ PEG_PUBLIC: 'yes' }).publicPosts).toBe(false);
  });
});
