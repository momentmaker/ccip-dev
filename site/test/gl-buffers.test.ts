import { describe, expect, it } from 'vitest';
import { GrowingFloats, newDynamicBufferState, uploadDynamic } from '../src/sky/gl-buffers';

const fakeGl = () => {
  const calls: [string, ...unknown[]][] = [];
  const gl = {
    ARRAY_BUFFER: 1,
    DYNAMIC_DRAW: 2,
    bindBuffer: (...a: unknown[]) => calls.push(['bindBuffer', ...a]),
    bufferData: (...a: unknown[]) => calls.push(['bufferData', ...a]),
    bufferSubData: (...a: unknown[]) => calls.push(['bufferSubData', ...a]),
  };
  const named = (name: string) => calls.filter((c) => c[0] === name);
  return { gl: gl as unknown as WebGL2RenderingContext, calls, named };
};
const buffer = {} as WebGLBuffer;

describe('uploadDynamic', () => {
  it('allocates once on first use, then writes with bufferSubData', () => {
    const { gl, named } = fakeGl();
    const state = newDynamicBufferState();
    const view = new Float32Array(10);
    uploadDynamic(gl, buffer, state, view);
    expect(named('bufferData')).toEqual([['bufferData', 1, 40, 2]]);
    expect(named('bufferSubData')).toEqual([['bufferSubData', 1, 0, view]]);
  });

  it('does not reallocate when the data fits, even when it shrinks', () => {
    const { gl, named } = fakeGl();
    const state = newDynamicBufferState();
    uploadDynamic(gl, buffer, state, new Float32Array(10));
    uploadDynamic(gl, buffer, state, new Float32Array(10));
    uploadDynamic(gl, buffer, state, new Float32Array(3));
    expect(named('bufferData')).toHaveLength(1);
    expect(named('bufferSubData')).toHaveLength(3);
  });

  it('doubles the capacity when the data outgrows it', () => {
    const { gl, named } = fakeGl();
    const state = newDynamicBufferState();
    uploadDynamic(gl, buffer, state, new Float32Array(10));
    uploadDynamic(gl, buffer, state, new Float32Array(11));
    expect(named('bufferData')[1]).toEqual(['bufferData', 1, 80, 2]);
    expect(state.capacity).toBe(80);
  });

  it('takes the data size when it exceeds a doubling', () => {
    const { gl, named } = fakeGl();
    const state = newDynamicBufferState();
    uploadDynamic(gl, buffer, state, new Float32Array(10));
    uploadDynamic(gl, buffer, state, new Float32Array(100));
    expect(named('bufferData')[1]).toEqual(['bufferData', 1, 400, 2]);
  });
});

describe('GrowingFloats', () => {
  it('returns exact-length views over a reused backing store', () => {
    const floats = new GrowingFloats();
    const a = floats.take(8);
    const b = floats.take(4);
    expect(a.length).toBe(8);
    expect(b.length).toBe(4);
    expect(b.buffer).toBe(a.buffer);
  });

  it('grows by at least doubling', () => {
    const floats = new GrowingFloats();
    floats.take(8);
    expect(floats.take(9).buffer.byteLength).toBe(16 * 4);
  });
});
