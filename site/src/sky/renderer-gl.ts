import type { SkyFrame } from './frame';
import { buildInstances, buildLaneVertices, FLOATS_PER_INSTANCE } from './instances';
import type { Projector } from './layout';
import type { SkyCanvas, SkyRenderer } from './renderer';

const QUAD_VERT = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_center;
layout(location = 2) in float a_radius;
layout(location = 3) in vec4 a_color;
layout(location = 4) in float a_shape;
uniform vec2 u_resolution;
out vec2 v_local;
out vec4 v_color;
flat out float v_shape;
void main() {
  v_local = a_corner;
  v_color = a_color;
  v_shape = a_shape;
  vec2 clip = (a_center + a_corner * a_radius) / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const QUAD_FRAG = `#version 300 es
precision mediump float;
in vec2 v_local;
in vec4 v_color;
flat in float v_shape;
out vec4 outColor;
void main() {
  float d = length(v_local);
  if (d > 1.0) discard;
  float a;
  if (v_shape < 0.5) a = pow(1.0 - d, 2.0);
  else if (v_shape < 1.5) a = smoothstep(0.8, 0.9, d) * (1.0 - smoothstep(0.92, 1.0, d));
  else a = 1.0 - smoothstep(0.7, 1.0, d);
  float alpha = v_color.a * a;
  outColor = vec4(v_color.rgb * alpha, alpha);
}`;

const LINE_VERT = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in float a_alpha;
uniform vec2 u_resolution;
out float v_alpha;
void main() {
  v_alpha = a_alpha;
  vec2 clip = a_pos / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const LINE_FRAG = `#version 300 es
precision mediump float;
in float v_alpha;
out vec4 outColor;
void main() {
  outColor = vec4(vec3(0.290, 0.498, 0.941) * v_alpha, v_alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL: createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`WebGL: shader compile failed: ${gl.getShaderInfoLog(shader)}`);
  return shader;
}

function link(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('WebGL: createProgram failed');
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vert));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`WebGL: program link failed: ${gl.getProgramInfoLog(program)}`);
  return program;
}

export class GlRenderer implements SkyRenderer {
  readonly kind = 'gl' as const;
  private quadProgram: WebGLProgram | null = null;
  private lineProgram: WebGLProgram | null = null;
  private quadVao: WebGLVertexArrayObject | null = null;
  private lineVao: WebGLVertexArrayObject | null = null;
  private buffers: WebGLBuffer[] = [];

  static create(canvas: SkyCanvas): GlRenderer | null {
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true }) as WebGL2RenderingContext | null;
    if (!gl) return null;
    const renderer = new GlRenderer(canvas, gl);
    renderer.init();
    return renderer;
  }

  private constructor(
    private readonly canvas: SkyCanvas,
    private readonly gl: WebGL2RenderingContext,
  ) {}

  init(): void {
    const gl = this.gl;
    this.quadProgram = link(gl, QUAD_VERT, QUAD_FRAG);
    this.lineProgram = link(gl, LINE_VERT, LINE_FRAG);
    const corners = gl.createBuffer()!;
    const instances = gl.createBuffer()!;
    const lines = gl.createBuffer()!;
    this.buffers = [corners, instances, lines];

    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    const stride = FLOATS_PER_INSTANCE * 4;
    for (const [location, size, offset] of [[1, 2, 0], [2, 1, 2], [3, 4, 3], [4, 1, 7]] as const) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * 4);
      gl.vertexAttribDivisor(location, 1);
    }

    this.lineVao = gl.createVertexArray();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, lines);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);
    gl.bindVertexArray(null);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
  }

  draw(frame: SkyFrame, project: Projector, sizeScale: number): void {
    const gl = this.gl;
    if (gl.isContextLost() || !this.quadProgram || !this.lineProgram) return;
    const { width, height } = this.canvas;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const lines = buildLaneVertices(frame, project);
    gl.useProgram(this.lineProgram);
    gl.uniform2f(gl.getUniformLocation(this.lineProgram, 'u_resolution'), width, height);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[2]!);
    gl.bufferData(gl.ARRAY_BUFFER, lines, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, lines.length / 3);

    const instances = buildInstances(frame, project, sizeScale);
    gl.useProgram(this.quadProgram);
    gl.uniform2f(gl.getUniformLocation(this.quadProgram, 'u_resolution'), width, height);
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[1]!);
    gl.bufferData(gl.ARRAY_BUFFER, instances, gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instances.length / FLOATS_PER_INSTANCE);
    gl.bindVertexArray(null);
  }

  destroy(): void {
    const gl = this.gl;
    for (const b of this.buffers) gl.deleteBuffer(b);
    if (this.quadVao) gl.deleteVertexArray(this.quadVao);
    if (this.lineVao) gl.deleteVertexArray(this.lineVao);
    if (this.quadProgram) gl.deleteProgram(this.quadProgram);
    if (this.lineProgram) gl.deleteProgram(this.lineProgram);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
