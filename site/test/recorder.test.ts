import { afterEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ added: [] as [number, number][], finalized: 0, cancelled: 0, failAt: -1 }));

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
  class Output {
    target: BufferTarget;
    constructor(options: { target: BufferTarget }) {
      this.target = options.target;
    }
    addVideoTrack() {}
    async start() {}
    async finalize() {
      calls.finalized += 1;
      this.target.buffer = new Uint8Array([0, 0, 0, 24]).buffer;
    }
    async cancel() {
      calls.cancelled += 1;
    }
  }
  return { BufferTarget, Mp4OutputFormat, CanvasSource, Output };
});

import { canRecord, recordingFilename, recordReplay, totalFrames } from '../src/replay/recorder';

class FakeOffscreenCanvas {
  constructor(readonly width: number, readonly height: number) {}
  getContext() {
    return {};
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(calls, { added: [], finalized: 0, cancelled: 0, failAt: -1 });
});

describe('recording helpers', () => {
  it('counts one frame per fps-second of the length and names the file', () => {
    expect(totalFrames(60)).toBe(1800);
    expect(recordingFilename('2026-10-06', '9:16')).toBe('ccip-replay-2026-10-06-9x16.mp4');
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
