import { describe, expect, it } from 'vitest';
import { createTarget, targetFormat } from '../src/replay/cinema/gl';

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
