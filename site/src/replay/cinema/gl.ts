export interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
  hdr: boolean;
}

export interface TargetFormat {
  internal: number;
  type: number;
  hdr: boolean;
}

export function targetFormat(gl: WebGL2RenderingContext): TargetFormat {
  return gl.getExtension('EXT_color_buffer_float')
    ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT, hdr: true }
    : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE, hdr: false };
}

function attempt(gl: WebGL2RenderingContext, width: number, height: number, format: TargetFormat): Target | null {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) throw new Error('WebGL: could not create a render target');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, format.internal, width, height, 0, gl.RGBA, format.type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!complete) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    return null;
  }
  return { fbo, tex, width, height, hdr: format.hdr };
}

export function createTarget(gl: WebGL2RenderingContext, width: number, height: number, format: TargetFormat): Target {
  const target = attempt(gl, width, height, format);
  if (target) return target;
  if (format.internal !== gl.RGBA8) {
    const fallback = attempt(gl, width, height, { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE, hdr: false });
    if (fallback) return fallback;
  }
  throw new Error('WebGL: render target incomplete');
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target): void {
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}
