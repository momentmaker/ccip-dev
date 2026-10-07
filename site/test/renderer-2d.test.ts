import { describe, expect, it } from 'vitest';
import type { SkyFrame } from '../src/sky/frame';
import type { Projector } from '../src/sky/layout';
import { Canvas2dRenderer } from '../src/sky/renderer-2d';

type Call = [string, ...unknown[]];

const recordingContext = () => {
  const calls: Call[] = [];
  const record = (name: string) => (...args: unknown[]) => {
    calls.push([name, ...args]);
  };
  const ctx: Record<string, unknown> = {
    clearRect: record('clearRect'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    quadraticCurveTo: record('quadraticCurveTo'),
    stroke: record('stroke'),
    arc: record('arc'),
    fill: record('fill'),
    createRadialGradient: (...args: unknown[]) => {
      calls.push(['createRadialGradient', ...args]);
      return { addColorStop: record('addColorStop') };
    },
  };
  for (const prop of ['strokeStyle', 'fillStyle', 'lineWidth', 'globalCompositeOperation']) {
    Object.defineProperty(ctx, prop, {
      set: (value: unknown) => {
        calls.push([`set ${prop}`, value]);
      },
    });
  }
  return { ctx, calls };
};

const draw = (frame: SkyFrame) => {
  const { ctx, calls } = recordingContext();
  const canvas = { width: 300, height: 200, getContext: () => ctx } as unknown as HTMLCanvasElement;
  Canvas2dRenderer.create(canvas)!.draw(frame, project, 1);
  return calls;
};
const named = (calls: Call[], name: string) => calls.filter((c) => c[0] === name);

const frame: SkyFrame = {
  stars: [
    { x: -1, y: 0, radius: 4, brightness: 1, flash: 0 },
    { x: 1, y: 0, radius: 2, brightness: 0.5, flash: 0 },
  ],
  lanes: [{ from: 0, to: 1, opacity: 0.3 }],
  comets: [{ from: 0, to: 1, progress: 0.5, size: 1, kind: 'gold' }],
  rings: [{ star: 1, progress: 0.25 }],
};
const project: Projector = (x, y) => [100 + x * 50, 100 + y * 50];

describe('Canvas2dRenderer.draw', () => {
  it('clears the canvas before drawing anything', () => {
    expect(draw(frame)[1]).toEqual(['clearRect', 0, 0, 300, 200]);
  });

  it('strokes each lane as a curve in the lane opacity', () => {
    const calls = draw(frame);
    expect(named(calls, 'moveTo')).toEqual([['moveTo', 50, 100]]);
    expect(named(calls, 'quadraticCurveTo')).toEqual([['quadraticCurveTo', 100, 120, 150, 100]]);
    expect(calls).toContainEqual(['set strokeStyle', 'rgba(74,127,240,0.3)']);
  });

  it('paints a star halo with a radial gradient', () => {
    expect(named(draw(frame), 'createRadialGradient')).toContainEqual(['createRadialGradient', 50, 100, 0, 50, 100, 16]);
  });

  it('strokes a ring in gold at its grown radius', () => {
    const calls = draw(frame);
    expect(named(calls, 'arc')).toContainEqual(['arc', 150, 100, 22.5 * 0.92, 0, Math.PI * 2]);
    expect(calls).toContainEqual(['set strokeStyle', 'rgba(245,196,81,0.75)']);
    const ringArc = calls.findIndex((c) => c[0] === 'arc' && c[1] === 150 && c[3] === 22.5 * 0.92);
    expect(calls[ringArc + 1]).toEqual(['stroke']);
  });

  it('draws every visible instance as one arc', () => {
    expect(named(draw(frame), 'arc')).toHaveLength(2 * 2 + 5 + 1);
  });

  it('skips zero-alpha trail points', () => {
    const early = { ...frame, comets: [{ ...frame.comets[0]!, progress: 0.01 }] };
    expect(named(draw(early), 'arc')).toHaveLength(2 * 2 + 2 + 1);
  });

  it('restores source-over compositing when done', () => {
    const modes = draw(frame).filter((c) => c[0] === 'set globalCompositeOperation');
    expect(modes.at(-1)).toEqual(['set globalCompositeOperation', 'source-over']);
    expect(modes).toContainEqual(['set globalCompositeOperation', 'lighter']);
  });
});
