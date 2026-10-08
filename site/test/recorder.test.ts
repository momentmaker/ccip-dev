import { afterEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ added: [] as [number, number][], finalized: 0, cancelled: 0, failAt: -1, audioAdds: [] as unknown[], audioTracks: 0, codec: 'aac' as string | null }));

vi.mock('mediabunny', () => {
  class BufferTarget {
    buffer: ArrayBuffer | null = null;
  }
  class Mp4OutputFormat {
    constructor(readonly options: unknown) {}
  }
  class CanvasSource {
    constructor(readonly canvas: unknown, readonly config: unknown) {}
    async add(timestamp: number, duration: number) {
      if (calls.added.length === calls.failAt) throw new Error('encoder exploded');
      calls.added.push([timestamp, duration]);
    }
  }
  class AudioBufferSource {
    constructor(readonly config: unknown) {}
    async add(buffer: unknown) {
      calls.audioAdds.push(buffer);
    }
  }
  class Output {
    target: BufferTarget;
    constructor(options: { target: BufferTarget }) {
      this.target = options.target;
    }
    addVideoTrack() {}
    addAudioTrack() {
      calls.audioTracks += 1;
    }
    async start() {}
    async finalize() {
      calls.finalized += 1;
      this.target.buffer = new Uint8Array([0, 0, 0, 24]).buffer;
    }
    async cancel() {
      calls.cancelled += 1;
    }
  }
  const getFirstEncodableAudioCodec = async () => calls.codec;
  return { BufferTarget, Mp4OutputFormat, CanvasSource, AudioBufferSource, Output, getFirstEncodableAudioCodec };
});

import { audioCodecAvailable, canRecord, recordingFilename, recordReplay, totalFrames } from '../src/replay/recorder';

class FakeOffscreenCanvas {
  constructor(readonly width: number, readonly height: number) {}
  getContext() {
    return {};
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(calls, { added: [], finalized: 0, cancelled: 0, failAt: -1, audioAdds: [], audioTracks: 0, codec: 'aac' });
});

describe('recording helpers', () => {
  it('counts one frame per fps-second of the length and names the file', () => {
    expect(totalFrames(60)).toBe(1800);
    expect(recordingFilename('2026-10-06', '9:16')).toBe('ccip-replay-2026-10-06-9x16.mp4');
  });

  it('names a focus recording after its chain', () => {
    expect(recordingFilename('2026-10-06', '1:1', 'base')).toBe('ccip-replay-base-2026-10-06-1x1.mp4');
    expect(recordingFilename('2026-10-06', '16:9', null)).toBe('ccip-replay-2026-10-06-16x9.mp4');
  });

  it('records only where H.264 encoding is supported', async () => {
    expect(await canRecord('16:9')).toBe(false);
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal('VideoEncoder', { isConfigSupported: async () => ({ supported: true }) });
    expect(await canRecord('16:9')).toBe(true);
    vi.stubGlobal('VideoEncoder', { isConfigSupported: async () => ({ supported: false }) });
    expect(await canRecord('16:9')).toBe(false);
    vi.stubGlobal('VideoEncoder', { isConfigSupported: async () => { throw new Error('nope'); } });
    expect(await canRecord('16:9')).toBe(false);
  });
});

describe('recordReplay', () => {
  it('draws and encodes every frame at 30 fps, then returns an MP4', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const draws: number[] = [];
    const progress: number[] = [];
    const blob = await recordReplay({
      draw: (t, _ctx, width, height) => {
        draws.push(t);
        expect([width, height]).toEqual([1080, 1080]);
      },
      aspect: '1:1',
      lengthS: 1,
      onProgress: (p) => progress.push(p),
      signal: new AbortController().signal,
    });
    expect(draws).toHaveLength(30);
    expect(calls.added[1]).toEqual([1 / 30, 1 / 30]);
    expect(progress.at(-1)).toBe(1);
    expect(calls.finalized).toBe(1);
    expect(blob.type).toBe('video/mp4');
  });

  it('cancels the output when the viewer cancels', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const controller = new AbortController();
    const run = recordReplay({ draw: () => {}, aspect: '16:9', lengthS: 1, onProgress: (p) => p > 0.03 && controller.abort(), signal: controller.signal });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls.cancelled).toBe(1);
    expect(calls.finalized).toBe(0);
  });

  it('cancels instead of delivering a file when aborted on the last frame', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const controller = new AbortController();
    const run = recordReplay({ draw: () => {}, aspect: '16:9', lengthS: 1, onProgress: (p) => p === 1 && controller.abort(), signal: controller.signal });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls.cancelled).toBe(1);
    expect(calls.finalized).toBe(0);
  });

  it('cancels the output and rethrows when encoding fails', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    calls.failAt = 5;
    await expect(
      recordReplay({ draw: () => {}, aspect: '16:9', lengthS: 1, onProgress: () => {}, signal: new AbortController().signal }),
    ).rejects.toThrow('encoder exploded');
    expect(calls.cancelled).toBe(1);
  });
});

describe('audio', () => {
  it('adds an AAC track and the score buffer when audio is given', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const audio = { duration: 1 } as unknown as AudioBuffer;
    await recordReplay({ draw: () => {}, aspect: '1:1', lengthS: 1, onProgress: () => {}, signal: new AbortController().signal, audio });
    expect(calls.audioTracks).toBe(1);
    expect(calls.audioAdds).toEqual([audio]);
  });

  it('records silently without audio', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    await recordReplay({ draw: () => {}, aspect: '1:1', lengthS: 1, onProgress: () => {}, signal: new AbortController().signal });
    expect(calls.audioTracks).toBe(0);
  });

  it('reports AAC only when the encoder exists and supports it', async () => {
    expect(await audioCodecAvailable()).toBe(false);
    vi.stubGlobal('AudioEncoder', class {});
    calls.codec = 'aac';
    expect(await audioCodecAvailable()).toBe(true);
    calls.codec = null;
    expect(await audioCodecAvailable()).toBe(false);
  });
});
