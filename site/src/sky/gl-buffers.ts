export class GrowingFloats {
  private backing = new Float32Array(0);

  take(length: number): Float32Array {
    if (length > this.backing.length) this.backing = new Float32Array(Math.max(length, this.backing.length * 2));
    return this.backing.subarray(0, length);
  }
}

export interface DynamicBufferState {
  capacity: number;
}

export function newDynamicBufferState(): DynamicBufferState {
  return { capacity: 0 };
}

export function uploadDynamic(gl: WebGL2RenderingContext, buffer: WebGLBuffer, state: DynamicBufferState, view: Float32Array): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  if (view.byteLength > state.capacity) {
    state.capacity = Math.max(view.byteLength, state.capacity * 2);
    gl.bufferData(gl.ARRAY_BUFFER, state.capacity, gl.DYNAMIC_DRAW);
  }
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, view);
}
