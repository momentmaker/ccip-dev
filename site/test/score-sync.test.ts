import { describe, expect, it, vi } from 'vitest';
import { audioStartOffset, fade, FADE_S, idlePrefetchAllowed, resyncAfter, ScoreCache, scoreKey, scrubRestartDelay, soundPending, syncAction } from '../src/replay/score/sync';

describe('scoreKey', () => {
  it('changes with length, focus and data day', () => {
    const base = scoreKey({ length: 30, focus: null }, '2026-10-06');
    expect(scoreKey({ length: 15, focus: null }, '2026-10-06')).not.toBe(base);
    expect(scoreKey({ length: 30, focus: 'b' }, '2026-10-06')).not.toBe(base);
    expect(scoreKey({ length: 30, focus: null }, '2026-10-07')).not.toBe(base);
    expect(scoreKey({ length: 30, focus: null }, '2026-10-06')).toBe(base);
  });
});

describe('syncAction', () => {
  const idle = { playing: false, soundOn: false, t: 0 };
  it('starts audio at the playhead when playback starts with sound on', () => {
    expect(syncAction({ ...idle, soundOn: true }, { playing: true, soundOn: true, t: 4, scrubbed: false })).toEqual({ kind: 'start', offset: 4 });
  });

  it('starts when sound is switched on mid-play, and stops when it is switched off', () => {
    expect(syncAction({ playing: true, soundOn: false, t: 5 }, { playing: true, soundOn: true, t: 5.1, scrubbed: false })).toEqual({ kind: 'start', offset: 5.1 });
    expect(syncAction({ playing: true, soundOn: true, t: 5 }, { playing: true, soundOn: false, t: 5.1, scrubbed: false })).toEqual({ kind: 'stop' });
  });

  it('restarts at the new offset after a scrub, and stops on pause', () => {
    expect(syncAction({ playing: true, soundOn: true, t: 5 }, { playing: true, soundOn: true, t: 12, scrubbed: true })).toEqual({ kind: 'start', offset: 12 });
    expect(syncAction({ playing: true, soundOn: true, t: 5 }, { playing: false, soundOn: true, t: 5, scrubbed: false })).toEqual({ kind: 'stop' });
  });

  it('does nothing while playing steadily', () => {
    expect(syncAction({ playing: true, soundOn: true, t: 5 }, { playing: true, soundOn: true, t: 5.03, scrubbed: false })).toEqual({ kind: 'none' });
  });
});

describe('audioStartOffset', () => {
  it('leads the playhead by the output latency the browser reports', () => {
    expect(audioStartOffset(4, { outputLatency: 0.04, baseLatency: 0.01 }, 30)).toBeCloseTo(4.04, 9);
  });

  it('falls back to the base latency, then to none', () => {
    expect(audioStartOffset(4, { outputLatency: 0, baseLatency: 0.01 }, 30)).toBeCloseTo(4.01, 9);
    expect(audioStartOffset(4, { baseLatency: 0.01 }, 30)).toBeCloseTo(4.01, 9);
    expect(audioStartOffset(4, {}, 30)).toBe(4);
  });

  it('stays inside the buffer', () => {
    expect(audioStartOffset(29.99, { outputLatency: 0.05 }, 30)).toBe(30);
    expect(audioStartOffset(-1, {}, 30)).toBe(0);
  });
});

describe('ScoreCache', () => {
  const buffer = (duration: number) => ({ duration }) as unknown as AudioBuffer;

  it('renders once per key and hands every caller the same buffer', async () => {
    const render = vi.fn(async () => buffer(30));
    const cache = new ScoreCache(() => {});
    const first = cache.get('30|all|d', render);
    expect(cache.get('30|all|d', render)).toBe(first);
    expect(await first).toEqual(buffer(30));
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('lets a newer show replace an older render that is still in flight', async () => {
    let finishOld!: (b: AudioBuffer) => void;
    const cache = new ScoreCache(() => {});
    const old = cache.get('30|all|d', () => new Promise<AudioBuffer>((resolve) => (finishOld = resolve)));
    const fresh = cache.get('15|all|d', async () => buffer(15));
    expect(await fresh).toEqual(buffer(15));
    finishOld(buffer(30));
    await old;
    expect(cache.holds('30|all|d')).toBe(false);
    expect(cache.holds('15|all|d')).toBe(true);
  });

  it('turns a failed render into no sound, reports it once and forgets the failed promise', async () => {
    const failure = new Error('OfflineAudioContext exploded');
    const onFail = vi.fn();
    const cache = new ScoreCache(onFail);
    await expect(cache.get('30|all|d', async () => Promise.reject(failure))).resolves.toBeNull();
    expect(onFail).toHaveBeenCalledWith(failure);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(cache.holds('30|all|d')).toBe(false);
  });

  it('treats a render that throws before it starts like one that rejects', async () => {
    const onFail = vi.fn();
    const cache = new ScoreCache(onFail);
    const render = () => {
      throw new Error('OfflineAudioContext is not supported');
    };
    await expect(cache.get('30|all|d', render)).resolves.toBeNull();
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it('keeps a newer render, and Sound, when an older one fails late', async () => {
    let failOld!: (err: Error) => void;
    const onFail = vi.fn();
    const cache = new ScoreCache(onFail);
    const old = cache.get('30|all|d', () => new Promise<AudioBuffer>((_resolve, reject) => (failOld = reject)));
    const fresh = cache.get('15|all|d', async () => buffer(15));
    await fresh;
    failOld(new Error('late failure'));
    await old;
    expect(cache.holds('15|all|d')).toBe(true);
    expect(cache.get('15|all|d', async () => buffer(99))).toBe(fresh);
    expect(onFail).not.toHaveBeenCalled();
  });
});

describe('idlePrefetchAllowed', () => {
  it('prefetches where audio works', () => {
    expect(idlePrefetchAllowed({ audioSupported: true })).toBe(true);
    expect(idlePrefetchAllowed({ audioSupported: true, saveData: false, deviceMemory: 8 })).toBe(true);
    expect(idlePrefetchAllowed({ audioSupported: false })).toBe(false);
  });

  it('holds back for viewers saving data and for small devices', () => {
    expect(idlePrefetchAllowed({ audioSupported: true, saveData: true })).toBe(false);
    expect(idlePrefetchAllowed({ audioSupported: true, deviceMemory: 2 })).toBe(false);
    expect(idlePrefetchAllowed({ audioSupported: true, deviceMemory: 4 })).toBe(true);
  });
});

describe('soundPending', () => {
  it('is busy while Sound is on and the score is not ready', () => {
    expect(soundPending({ soundOn: true, playing: false, ready: false, live: false })).toBe(true);
  });

  it('stays busy during playback until the source starts', () => {
    expect(soundPending({ soundOn: true, playing: true, ready: true, live: false })).toBe(true);
    expect(soundPending({ soundOn: true, playing: true, ready: true, live: true })).toBe(false);
  });

  it('is idle when the score is ready and nothing should play, or when Sound is off', () => {
    expect(soundPending({ soundOn: true, playing: false, ready: true, live: false })).toBe(false);
    expect(soundPending({ soundOn: false, playing: true, ready: false, live: false })).toBe(false);
  });
});

describe('resyncAfter', () => {
  const audible = { playing: true, soundOn: true };
  it('rejoins the playhead when the page becomes visible while audible', () => {
    expect(resyncAfter('visible', audible, false)).toBe(true);
    expect(resyncAfter('visible', { playing: true, soundOn: false }, false)).toBe(false);
    expect(resyncAfter('visible', { playing: false, soundOn: true }, false)).toBe(false);
  });

  it('rejoins when the context runs again after an interruption, not after its own resume', () => {
    expect(resyncAfter('running', audible, true)).toBe(true);
    expect(resyncAfter('running', audible, false)).toBe(false);
    expect(resyncAfter('running', { playing: false, soundOn: true }, true)).toBe(false);
  });
});

describe('scrubRestartDelay', () => {
  it('restarts at once when the last restart is at least the interval old', () => {
    expect(scrubRestartDelay(-Infinity, 1000, 100)).toBe(0);
    expect(scrubRestartDelay(900, 1000, 100)).toBe(0);
  });

  it('defers a restart to the end of the interval while the viewer drags', () => {
    expect(scrubRestartDelay(960, 1000, 100)).toBe(60);
    expect(scrubRestartDelay(1000, 1000, 100)).toBe(100);
  });
});

describe('fade', () => {
  it('ramps a gain between two levels over a few milliseconds and returns when it ends', () => {
    const calls: [string, number, number][] = [];
    const gain = {
      setValueAtTime: (v: number, t: number) => calls.push(['set', v, t]),
      linearRampToValueAtTime: (v: number, t: number) => calls.push(['lin', v, t]),
    };
    expect(fade(gain, 1, 0, 2)).toBeCloseTo(2 + FADE_S, 9);
    expect(calls).toEqual([['set', 1, 2], ['lin', 0, 2 + FADE_S]]);
    expect(FADE_S).toBeGreaterThanOrEqual(0.005);
    expect(FADE_S).toBeLessThanOrEqual(0.01);
  });
});
