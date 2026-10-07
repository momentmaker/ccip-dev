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
