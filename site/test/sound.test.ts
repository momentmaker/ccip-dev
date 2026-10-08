import { afterEach, describe, expect, it, vi } from 'vitest';
import { chordFrequencies, NoteLimiter, noteFrequency, noteIndex, preferPlaybackSession, SkySound, SOUND_KEY } from '../src/lib/sound';

function fakeAudio() {
  const oscillators: { frequency: { value: number } }[] = [];
  const param = () => ({ setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const ctx = {
    currentTime: 0,
    destination: {},
    resume: vi.fn(async () => {}),
    createOscillator: () => {
      const osc = { type: '', frequency: { value: 0 }, connect: (n: unknown) => n, start: vi.fn(), stop: vi.fn() };
      oscillators.push(osc);
      return osc;
    },
    createGain: () => ({ gain: param(), connect: (n: unknown) => n }),
  };
  return { ctx: ctx as unknown as AudioContext, oscillators };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe('note mapping', () => {
  it.each([
    [null, 0, 261.63],
    [0, 0, 261.63],
    [1, 0, 261.63],
    [100, 3, 392],
    [1_000_000, 9, 880],
    [1e9, 14, 1760],
    [1e15, 14, 1760],
  ])('$%s → note %s at %s Hz', (usd, index, hz) => {
    expect(noteIndex(usd)).toBe(index);
    expect(noteFrequency(usd)).toBeCloseTo(hz, 2);
  });

  it('builds a major chord on the base note', () => {
    expect(chordFrequencies(400)).toEqual([400, 500, 600]);
  });
});

describe('NoteLimiter', () => {
  it('allows at most 6 notes in any second', () => {
    const limiter = new NoteLimiter();
    expect(Array.from({ length: 7 }, (_, i) => limiter.allow(i * 10))).toEqual([true, true, true, true, true, true, false]);
    expect(limiter.allow(1000)).toBe(true);
  });
});

describe('SkySound', () => {
  it('is off by default and plays nothing', () => {
    const audio = fakeAudio();
    const sound = new SkySound(memoryStorage(), () => audio.ctx);
    sound.play(100, false, 0, false);
    expect(sound.enabled).toBe(false);
    expect(audio.oscillators).toHaveLength(0);
  });

  it('remembers the choice and plays a note, or a chord for gold', () => {
    const audio = fakeAudio();
    const storage = memoryStorage();
    const sound = new SkySound(storage, () => audio.ctx);
    sound.setEnabled(true);
    expect(storage.data.get(SOUND_KEY)).toBe('on');
    sound.play(100, false, 0, false);
    sound.play(2_000_000, true, 10, false);
    expect(audio.oscillators.map((o) => Math.round(o.frequency.value))).toEqual([392, 1047, 1308, 1570]);
    expect(new SkySound(storage, () => audio.ctx).enabled).toBe(true);
  });

  it('asks for a playback audio session before resuming, so the ringer switch does not mute it', () => {
    const session = { type: 'auto' };
    vi.stubGlobal('navigator', { audioSession: session });
    const audio = fakeAudio();
    new SkySound(memoryStorage(), () => audio.ctx).setEnabled(true);
    expect(session.type).toBe('playback');
    vi.unstubAllGlobals();
  });

  it('stays silent while the tab is hidden', () => {
    const audio = fakeAudio();
    const sound = new SkySound(memoryStorage(), () => audio.ctx);
    sound.setEnabled(true);
    sound.play(100, false, 0, true);
    expect(audio.oscillators).toHaveLength(0);
  });
});

describe('preferPlaybackSession', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('marks the audio session as playback where the browser has one', () => {
    const nav = { audioSession: { type: 'auto' } };
    preferPlaybackSession(nav);
    expect(nav.audioSession.type).toBe('playback');
  });

  it('does nothing where there is no audio session or no navigator', () => {
    expect(() => preferPlaybackSession({})).not.toThrow();
    expect(() => preferPlaybackSession(undefined)).not.toThrow();
  });

  it('warns instead of throwing when the session refuses the type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const nav = {
      audioSession: Object.defineProperty({}, 'type', {
        set() {
          throw new Error('nope');
        },
      }) as { type: string },
    };
    expect(() => preferPlaybackSession(nav)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
