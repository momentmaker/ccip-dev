import { describe, expect, it, vi } from 'vitest';
import { ContextLossTracker, createRenderer } from '../src/sky/renderer';
import { GlRenderer } from '../src/sky/renderer-gl';

const fakeCanvas = (contexts: Record<string, unknown>) => {
  const getContext = vi.fn((kind: string) => contexts[kind] ?? null);
  return { canvas: { width: 0, height: 0, getContext } as unknown as HTMLCanvasElement, getContext };
};

describe('createRenderer', () => {
  it('falls back to Canvas 2D when WebGL2 is unavailable', () => {
    const { canvas } = fakeCanvas({ '2d': {} });
    expect(createRenderer(canvas).kind).toBe('2d');
  });

  it('skips WebGL2 entirely when asked to', () => {
    const { canvas, getContext } = fakeCanvas({ '2d': {} });
    expect(createRenderer(canvas, { preferGl: false }).kind).toBe('2d');
    expect(getContext).not.toHaveBeenCalledWith('webgl2', expect.anything());
  });

  it('throws when no context is available', () => {
    expect(() => createRenderer(fakeCanvas({}).canvas)).toThrow('no canvas context available');
  });
});

describe('ContextLossTracker', () => {
  it('restores after one loss and falls back after a second loss within 60 s', () => {
    const tracker = new ContextLossTracker();
    expect(tracker.record(0)).toBe('restore');
    expect(tracker.record(30_000)).toBe('fallback');
  });

  it('forgets losses older than 60 s', () => {
    const tracker = new ContextLossTracker();
    tracker.record(0);
    expect(tracker.record(61_000)).toBe('restore');
  });
});

function fakeGl(extension: { loseContext: () => void } | null) {
  return new Proxy({} as Record<string | symbol, unknown>, {
    get: (_t, key) => {
      if (key === 'getExtension') return (name: string) => (name === 'WEBGL_lose_context' ? extension : null);
      if (key === 'getShaderParameter' || key === 'getProgramParameter') return () => true;
      if (key === 'isContextLost') return () => false;
      if (typeof key === 'string' && /^[A-Z_0-9]+$/.test(key)) return 1;
      return () => ({});
    },
  });
}

describe('GlRenderer.destroy', () => {
  it('releases its WebGL context, so switching cuts does not pile up contexts', () => {
    const extension = { loseContext: vi.fn() };
    const { canvas } = fakeCanvas({ webgl2: fakeGl(extension) });
    GlRenderer.create(canvas)!.destroy();
    expect(extension.loseContext).toHaveBeenCalledOnce();
  });

  it('still cleans up where the lose-context extension is missing', () => {
    const { canvas } = fakeCanvas({ webgl2: fakeGl(null) });
    expect(() => GlRenderer.create(canvas)!.destroy()).not.toThrow();
  });
});

function recordingGl() {
  const calls: { name: string; args: unknown[] }[] = [];
  const gl = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_t, key) => {
      if (key === 'getExtension') return () => null;
      if (key === 'getShaderParameter' || key === 'getProgramParameter') return () => true;
      if (key === 'isContextLost') return () => false;
      if (key === 'DYNAMIC_DRAW') return 7;
      if (key === 'STATIC_DRAW') return 8;
      if (typeof key === 'string' && /^[A-Z_0-9]+$/.test(key)) return 1;
      if (typeof key !== 'string') return undefined;
      return (...args: unknown[]) => {
        calls.push({ name: key, args });
        return /^create/.test(key) ? { created: key, n: calls.length } : undefined;
      };
    },
  });
  const named = (name: string) => calls.filter((c) => c.name === name);
  return { gl, calls, named };
}

describe('GlRenderer.init', () => {
  it('releases the previous programs, buffers and vertex arrays when run again after a context restore', () => {
    const { gl, named } = recordingGl();
    const { canvas } = fakeCanvas({ webgl2: gl });
    const renderer = GlRenderer.create(canvas)!;
    const firstBuffers = named('createBuffer').length;
    const firstVaos = named('createVertexArray').length;
    renderer.init();
    expect(named('deleteBuffer')).toHaveLength(firstBuffers);
    expect(named('deleteVertexArray')).toHaveLength(firstVaos);
    expect(named('deleteProgram')).toHaveLength(2);
  });

  it('does not lose the context while re-initialising', () => {
    const extension = { loseContext: vi.fn() };
    const { gl } = recordingGl();
    const withExtension = new Proxy(gl, { get: (t, key) => (key === 'getExtension' ? () => extension : Reflect.get(t, key)) });
    const renderer = GlRenderer.create(fakeCanvas({ webgl2: withExtension }).canvas)!;
    renderer.init();
    expect(extension.loseContext).not.toHaveBeenCalled();
  });
});

describe('GlRenderer.draw', () => {
  const frame = {
    stars: [
      { x: -1, y: 0, radius: 4, brightness: 1, flash: 0 },
      { x: 1, y: 0, radius: 2, brightness: 0.5, flash: 0 },
    ],
    lanes: [{ from: 0, to: 1, opacity: 0.3 }],
    comets: [],
    rings: [],
  };
  const project = (x: number, y: number): [number, number] => [100 + x * 50, 100 + y * 50];

  it('allocates GPU storage once and then streams each frame with bufferSubData', () => {
    const { gl, named } = recordingGl();
    const renderer = GlRenderer.create(fakeCanvas({ webgl2: gl }).canvas)!;
    renderer.draw(frame, project, 1);
    renderer.draw(frame, project, 1);
    renderer.draw(frame, project, 1);
    expect(named('bufferData').filter((c) => c.args[2] === 7)).toHaveLength(2);
    expect(named('bufferSubData')).toHaveLength(6);
  });

  it('allocates again after the buffers are recreated', () => {
    const { gl, named } = recordingGl();
    const renderer = GlRenderer.create(fakeCanvas({ webgl2: gl }).canvas)!;
    renderer.draw(frame, project, 1);
    const before = named('bufferData').length;
    renderer.init();
    renderer.draw(frame, project, 1);
    expect(named('bufferData').length - before).toBe(3);
  });
});
