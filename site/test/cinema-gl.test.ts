import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTarget, targetFormat } from '../src/replay/cinema/gl';
import { CinemaRenderer } from '../src/replay/cinema/renderer';
import type { CinemaScene } from '../src/replay/cinema/scene';

const CONSTANTS = {
  RGBA16F: 0x881a,
  HALF_FLOAT: 0x140b,
  RGBA8: 0x8058,
  UNSIGNED_BYTE: 0x1401,
  RGBA: 0x1908,
  TEXTURE_2D: 0x0de1,
  FRAMEBUFFER: 0x8d40,
  COLOR_ATTACHMENT0: 0x8ce0,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  FRAMEBUFFER_INCOMPLETE_ATTACHMENT: 0x8cd6,
  TEXTURE_MIN_FILTER: 1,
  TEXTURE_MAG_FILTER: 2,
  TEXTURE_WRAP_S: 3,
  TEXTURE_WRAP_T: 4,
  LINEAR: 5,
  CLAMP_TO_EDGE: 6,
};

const fakeGl = (float: boolean, completeFormats: number[] = [CONSTANTS.RGBA16F, CONSTANTS.RGBA8]) => {
  const allocated: number[] = [];
  const deleted = { textures: 0, framebuffers: 0 };
  const gl = {
    ...CONSTANTS,
    getExtension: (name: string) => (float && name === 'EXT_color_buffer_float' ? {} : null),
    createTexture: () => ({}),
    createFramebuffer: () => ({}),
    bindTexture: () => {},
    bindFramebuffer: () => {},
    texParameteri: () => {},
    framebufferTexture2D: () => {},
    texImage2D: (_t: number, _l: number, internal: number) => {
      allocated.push(internal);
    },
    checkFramebufferStatus: () =>
      completeFormats.includes(allocated[allocated.length - 1]!) ? CONSTANTS.FRAMEBUFFER_COMPLETE : CONSTANTS.FRAMEBUFFER_INCOMPLETE_ATTACHMENT,
    deleteTexture: () => {
      deleted.textures++;
    },
    deleteFramebuffer: () => {
      deleted.framebuffers++;
    },
  };
  return { gl: gl as unknown as WebGL2RenderingContext, allocated, deleted };
};

describe('targetFormat', () => {
  it('uses half-float HDR targets when color-buffer float is available', () => {
    expect(targetFormat(fakeGl(true).gl)).toEqual({ internal: 0x881a, type: 0x140b, hdr: true });
  });

  it('falls back to RGBA8 targets without it', () => {
    expect(targetFormat(fakeGl(false).gl)).toEqual({ internal: 0x8058, type: 0x1401, hdr: false });
  });
});

describe('createTarget', () => {
  it('keeps the HDR format when the framebuffer is complete', () => {
    const { gl, allocated } = fakeGl(true);
    const target = createTarget(gl, 64, 32, targetFormat(gl));
    expect(allocated).toEqual([0x881a]);
    expect(target).toMatchObject({ width: 64, height: 32, hdr: true });
  });

  it('falls back to RGBA8 when the RGBA16F framebuffer is incomplete', () => {
    const { gl, allocated, deleted } = fakeGl(true, [CONSTANTS.RGBA8]);
    const target = createTarget(gl, 64, 32, targetFormat(gl));
    expect(allocated).toEqual([0x881a, 0x8058]);
    expect(target.hdr).toBe(false);
    expect(deleted).toEqual({ textures: 1, framebuffers: 1 });
  });

  it('throws when even RGBA8 is incomplete', () => {
    const { gl } = fakeGl(false, []);
    expect(() => createTarget(gl, 64, 32, targetFormat(gl))).toThrow('render target incomplete');
  });
});

interface ProxyGl {
  gl: WebGL2RenderingContext;
  calls: string[];
  state: { lost: boolean; compileOk: boolean; linkOk: boolean; framebufferOk: boolean };
  loseContext: ReturnType<typeof vi.fn>;
}

function proxyGl(): ProxyGl {
  const calls: string[] = [];
  const state = { lost: false, compileOk: true, linkOk: true, framebufferOk: true };
  const loseContext = vi.fn();
  const constants = new Map<string, number>();
  const overrides: Record<string, (...args: unknown[]) => unknown> = {
    isContextLost: () => state.lost,
    getShaderParameter: () => state.compileOk,
    getProgramParameter: () => state.linkOk,
    getShaderInfoLog: () => 'bad shader',
    getProgramInfoLog: () => 'bad link',
    getExtension: (name) => (name === 'WEBGL_lose_context' ? { loseContext } : {}),
    checkFramebufferStatus: () => (state.framebufferOk ? constants.get('FRAMEBUFFER_COMPLETE') : 0),
  };
  const gl = new Proxy(
    {},
    {
      get(_target, name: string) {
        if (/^[A-Z0-9_]+$/.test(name)) {
          if (!constants.has(name)) constants.set(name, constants.size + 1);
          return constants.get(name);
        }
        return (...args: unknown[]) => {
          calls.push(name);
          if (overrides[name]) return overrides[name](...args);
          return name.startsWith('create') ? { name } : undefined;
        };
      },
    },
  ) as unknown as WebGL2RenderingContext;
  return { gl, calls, state, loseContext };
}

const canvasFor = (gl: WebGL2RenderingContext | null) =>
  ({ width: 0, height: 0, getContext: () => gl }) as unknown as HTMLCanvasElement;

const sceneWith = (bloom: CinemaScene['bloom']): CinemaScene => ({
  width: 320,
  height: 180,
  nebula: null,
  lines: new Float32Array(0),
  quads: new Float32Array(0),
  coins: new Float32Array(0),
  shock: null,
  exposure: 1,
  bloom,
  frame: 0,
  edgeFeather: 0,
});

describe('CinemaRenderer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns null without WebGL2', () => {
    expect(CinemaRenderer.create(canvasFor(null))).toBeNull();
  });

  it('returns null, warns and loses the context when a shader fails to compile', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = proxyGl();
    f.state.compileOk = false;
    expect(CinemaRenderer.create(canvasFor(f.gl))).toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(f.loseContext).toHaveBeenCalled();
  });

  it('returns null, warns and loses the context when a program fails to link', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = proxyGl();
    f.state.linkOk = false;
    expect(CinemaRenderer.create(canvasFor(f.gl))).toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(f.loseContext).toHaveBeenCalled();
  });

  it('never throws once the context is lost', () => {
    const f = proxyGl();
    const r = CinemaRenderer.create(canvasFor(f.gl))!;
    f.state.lost = true;
    expect(() => {
      r.resize(100, 100);
      r.setAtlas({} as TexImageSource);
      r.render(sceneWith('full'));
    }).not.toThrow();
    expect(r.lost).toBe(true);
  });

  it('reports lost and does not throw when a target cannot be created in render', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = proxyGl();
    const r = CinemaRenderer.create(canvasFor(f.gl))!;
    f.state.framebufferOk = false;
    expect(() => r.render(sceneWith('full'))).not.toThrow();
    expect(r.lost).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('deletes the bloom targets when bloom turns off', () => {
    const f = proxyGl();
    const r = CinemaRenderer.create(canvasFor(f.gl))!;
    r.render(sceneWith('full'));
    const before = f.calls.filter((c) => c === 'deleteFramebuffer').length;
    r.render(sceneWith('off'));
    const released = f.calls.filter((c) => c === 'deleteFramebuffer').length - before;
    expect(released).toBeGreaterThan(0);
    r.render(sceneWith('off'));
    expect(f.calls.filter((c) => c === 'deleteFramebuffer').length - before).toBe(released);
  });

  it('ends destroy with loseContext and tolerates a second destroy and a later render', () => {
    const f = proxyGl();
    const r = CinemaRenderer.create(canvasFor(f.gl))!;
    r.destroy();
    expect(f.loseContext).toHaveBeenCalledTimes(1);
    expect(() => {
      r.destroy();
      r.render(sceneWith('full'));
    }).not.toThrow();
  });
});
