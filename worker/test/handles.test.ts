import { describe, expect, it } from 'vitest';
import { bundledHandles } from '../src/handles';
import { harness } from './helpers';

describe('handles in the run context', () => {
  it('bundles the compiled tables, and tests start from empty ones', () => {
    // #when
    const { c } = harness({ now: '2026-10-11T00:07:00.000Z' });
    // #then
    expect({ bundled: Object.keys(bundledHandles).sort(), test: c.handles }).toEqual({ bundled: ['chains', 'tokens'], test: { chains: {}, tokens: [] } });
  });
});
