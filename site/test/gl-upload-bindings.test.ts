import { describe, expect, it } from 'vitest';
import { CinemaRenderer } from '../src/replay/cinema/renderer';
import type { CinemaScene } from '../src/replay/cinema/scene';
import type { SkyFrame } from '../src/sky/frame';
import { GlRenderer } from '../src/sky/renderer-gl';

function trackingGl() {
  const constants = new Map<string, number>();
  const buffers: object[] = [];
  const uploads: { call: string; bound: unknown }[] = [];
  const binding = new Map<number, unknown>();
  const gl = new Proxy({} as Record<string, unknown>, {
    get(_t, name: string) {
      if (/^[A-Z0-9_]+$/.test(name)) {
        if (!constants.has(name)) constants.set(name, constants.size + 1);
        return constants.get(name);
      }
      return (...args: unknown[]) => {
        if (name === 'isContextLost') return false;
        if (name === 'getShaderParameter' || name === 'getProgramParameter') return true;
        if (name === 'getExtension') return {};
        if (name === 'checkFramebufferStatus') return constants.get('FRAMEBUFFER_COMPLETE');
        if (name === 'bindBuffer') binding.set(args[0] as number, args[1]);
        if (name === 'bufferSubData' || (name === 'bufferData' && args[2] === constants.get('DYNAMIC_DRAW'))) uploads.push({ call: name, bound: binding.get(args[0] as number) });
        if (name === 'createBuffer') {
          const buffer = {};
          buffers.push(buffer);
          return buffer;
        }
        return name.startsWith('create') ? {} : undefined;
      };
    },
  }) as unknown as WebGL2RenderingContext;
  const canvas = { width: 0, height: 0, getContext: () => gl } as unknown as HTMLCanvasElement;
  return { canvas, buffers, uploads };
}

const indexOf = (buffers: object[], uploads: { bound: unknown }[]) => uploads.map((u) => buffers.indexOf(u.bound as object));

describe('CinemaRenderer uploads', () => {
  it('sends lines, quads and coins to their own buffers', () => {
    const { canvas, buffers, uploads } = trackingGl();
    const renderer = CinemaRenderer.create(canvas)!;
    renderer.setAtlas({} as TexImageSource);
    const scene: CinemaScene = {
      width: 320,
      height: 180,
      nebula: null,
      lines: new Float32Array(6),
      quads: new Float32Array(10),
      coins: new Float32Array(8),
      shock: null,
      exposure: 1,
      bloom: 'off',
      frame: 0,
      edgeFeather: 0,
    };
    renderer.render(scene);
    expect(indexOf(buffers, uploads.filter((u) => u.call === 'bufferSubData'))).toEqual([3, 1, 2]);
  });

  it('also targets the right buffer when it has to grow', () => {
    const { canvas, buffers, uploads } = trackingGl();
    const renderer = CinemaRenderer.create(canvas)!;
    const base = { width: 320, height: 180, nebula: null, coins: new Float32Array(0), shock: null, exposure: 1, bloom: 'off', frame: 0, edgeFeather: 0 } as const;
    renderer.render({ ...base, lines: new Float32Array(6), quads: new Float32Array(10) });
    uploads.length = 0;
    renderer.render({ ...base, lines: new Float32Array(6), quads: new Float32Array(40) });
    expect(indexOf(buffers, uploads.filter((u) => u.call === 'bufferData'))).toEqual([1]);
  });
});

describe('GlRenderer uploads', () => {
  it('sends lane vertices to the line buffer and instances to the instance buffer', () => {
    const { canvas, buffers, uploads } = trackingGl();
    const renderer = GlRenderer.create(canvas)!;
    const frame: SkyFrame = {
      stars: [
        { x: -1, y: 0, radius: 4, brightness: 1, flash: 0 },
        { x: 1, y: 0, radius: 2, brightness: 0.5, flash: 0 },
      ],
      lanes: [{ from: 0, to: 1, opacity: 0.3 }],
      comets: [],
      rings: [],
    };
    renderer.draw(frame, (x, y) => [100 + x, 100 + y], 1);
    expect(indexOf(buffers, uploads.filter((u) => u.call === 'bufferSubData'))).toEqual([2, 1]);
  });
});
