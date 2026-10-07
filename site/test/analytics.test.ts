import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('analytics', () => {
  it('sends events to Umami when it is loaded', async () => {
    const umamiTrack = vi.fn();
    vi.stubGlobal('window', { umami: { track: umamiTrack } });
    const { track } = await import('../src/lib/analytics');
    track('share', { view: 'home', channel: 'x' });
    expect(umamiTrack).toHaveBeenCalledWith('share', { view: 'home', channel: 'x' });
  });

  it('does nothing when Umami is absent', async () => {
    vi.stubGlobal('window', {});
    const { track } = await import('../src/lib/analytics');
    expect(() => track('share')).not.toThrow();
  });

  it('reports each failing data file once per page view', async () => {
    const umamiTrack = vi.fn();
    vi.stubGlobal('window', { umami: { track: umamiTrack } });
    const { trackDataError } = await import('../src/lib/analytics');
    trackDataError('live.json');
    trackDataError('live.json');
    trackDataError('today.json');
    expect(umamiTrack.mock.calls).toEqual([
      ['data_error', { file: 'live.json' }],
      ['data_error', { file: 'today.json' }],
    ]);
  });
});
