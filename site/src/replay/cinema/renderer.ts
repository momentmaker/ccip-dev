import type { SkyCanvas } from '../../sky/renderer';
import { link } from '../../sky/renderer-gl';
import { createTarget, deleteTarget, targetFormat, type Target, type TargetFormat } from './gl';
import { COIN_FLOATS, LINE_FLOATS, QUAD_FLOATS, type CinemaScene } from './scene';
import {
  BACKGROUND_FRAG,
  BRIGHT_FRAG,
  COIN_FRAG,
  COIN_VERT,
  COMPOSITE_FRAG,
  DOWN_FRAG,
  FULLSCREEN_VERT,
  LINE_FRAG,
  LINE_VERT,
  QUAD_FRAG,
  QUAD_VERT,
  UP_FRAG,
} from './shaders';

const BLOOM_LEVELS = 5;
const BLOOM_THRESHOLD = 0.8;
const BLOOM_STRENGTH = 0.9;

interface Programs {
  background: WebGLProgram;
  quad: WebGLProgram;
  line: WebGLProgram;
  coin: WebGLProgram;
  bright: WebGLProgram;
  down: WebGLProgram;
  up: WebGLProgram;
  composite: WebGLProgram;
}

export class CinemaRenderer {
  private programs: Programs | null = null;
  private quadVao: WebGLVertexArrayObject | null = null;
  private coinVao: WebGLVertexArrayObject | null = null;
  private lineVao: WebGLVertexArrayObject | null = null;
  private emptyVao: WebGLVertexArrayObject | null = null;
  private buffers: WebGLBuffer[] = [];
  private scene: Target | null = null;
  private bloom: Target[] = [];
  private bloomMode: CinemaScene['bloom'] | null = null;
  private black: WebGLTexture | null = null;
  private atlas: WebGLTexture | null = null;
  private format: TargetFormat;

  static create(canvas: SkyCanvas): CinemaRenderer | null {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    if (!gl) return null;
    const r = new CinemaRenderer(canvas, gl);
    r.init();
    return r;
  }

  private constructor(
    private readonly canvas: SkyCanvas,
    private readonly gl: WebGL2RenderingContext,
  ) {
    this.format = targetFormat(gl);
  }

  get lost(): boolean {
    return this.gl.isContextLost();
  }

  private init(): void {
    const gl = this.gl;
    this.programs = {
      background: link(gl, FULLSCREEN_VERT, BACKGROUND_FRAG),
      quad: link(gl, QUAD_VERT, QUAD_FRAG),
      line: link(gl, LINE_VERT, LINE_FRAG),
      coin: link(gl, COIN_VERT, COIN_FRAG),
      bright: link(gl, FULLSCREEN_VERT, BRIGHT_FRAG),
      down: link(gl, FULLSCREEN_VERT, DOWN_FRAG),
      up: link(gl, FULLSCREEN_VERT, UP_FRAG),
      composite: link(gl, FULLSCREEN_VERT, COMPOSITE_FRAG),
    };
    const corners = gl.createBuffer()!;
    const quads = gl.createBuffer()!;
    const coins = gl.createBuffer()!;
    const lines = gl.createBuffer()!;
    this.buffers = [corners, quads, coins, lines];
    const cornerData = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, cornerData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, quads);
    for (const [loc, size, offset] of [[1, 2, 0], [2, 2, 2], [3, 1, 4], [4, 4, 5], [5, 1, 9]] as const) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, QUAD_FLOATS * 4, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
    }

    this.coinVao = gl.createVertexArray();
    gl.bindVertexArray(this.coinVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, coins);
    for (const [loc, size, offset] of [[1, 2, 0], [2, 1, 2], [3, 1, 3], [4, 4, 4]] as const) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, COIN_FLOATS * 4, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
    }

    this.lineVao = gl.createVertexArray();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, lines);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, LINE_FLOATS * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, LINE_FLOATS * 4, 8);

    this.emptyVao = gl.createVertexArray();
    gl.bindVertexArray(null);

    this.black = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.black);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.disable(gl.DEPTH_TEST);
  }

  setAtlas(source: TexImageSource | null): void {
    const gl = this.gl;
    if (this.atlas) gl.deleteTexture(this.atlas);
    this.atlas = null;
    if (!source) return;
    this.atlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  resize(width: number, height: number): void {
    if (this.canvas.width === width && this.canvas.height === height && this.scene) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.releaseTargets();
    this.scene = createTarget(this.gl, width, height, this.format);
    if (this.format.hdr && !this.scene.hdr) this.format = { internal: this.gl.RGBA8, type: this.gl.UNSIGNED_BYTE, hdr: false };
  }

  private releaseBloom(): void {
    for (const t of this.bloom) deleteTarget(this.gl, t);
    this.bloom = [];
    this.bloomMode = null;
  }

  private releaseTargets(): void {
    if (this.scene) deleteTarget(this.gl, this.scene);
    this.scene = null;
    this.releaseBloom();
  }

  private ensureBloom(mode: CinemaScene['bloom']): void {
    if (this.bloomMode === mode) return;
    this.releaseBloom();
    if (mode === 'off') return;
    let w = Math.max(1, Math.floor(this.canvas.width / (mode === 'full' ? 2 : 4)));
    let h = Math.max(1, Math.floor(this.canvas.height / (mode === 'full' ? 2 : 4)));
    for (let i = 0; i < BLOOM_LEVELS && w >= 2 && h >= 2; i++) {
      this.bloom.push(createTarget(this.gl, w, h, this.format));
      w = Math.floor(w / 2);
      h = Math.floor(h / 2);
    }
    this.bloomMode = mode;
  }

  private fullscreen(program: WebGLProgram, target: Target | null, setup: (u: (name: string) => WebGLUniformLocation | null) => void): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.width : this.canvas.width, target ? target.height : this.canvas.height);
    gl.useProgram(program);
    setup((name) => gl.getUniformLocation(program, name));
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private bindTexture(unit: number, tex: WebGLTexture | null): void {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
  }

  render(scene: CinemaScene): void {
    const gl = this.gl;
    const p = this.programs;
    if (!p || gl.isContextLost()) return;
    this.resize(scene.width, scene.height);
    const target = this.scene!;
    const { width, height } = scene;

    gl.disable(gl.BLEND);
    this.fullscreen(p.background, target, (u) => {
      gl.uniform2f(u('u_offset'), scene.nebula?.offset[0] ?? 0, scene.nebula?.offset[1] ?? 0);
      gl.uniform1f(u('u_intensity'), scene.nebula?.intensity ?? 0);
      gl.uniform1f(u('u_seed'), scene.nebula?.seed ?? 0);
      gl.uniform2f(u('u_aspect'), width / height, 1);
    });

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(p.line);
    gl.uniform2f(gl.getUniformLocation(p.line, 'u_resolution'), width, height);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[3]!);
    gl.bufferData(gl.ARRAY_BUFFER, scene.lines, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, scene.lines.length / LINE_FLOATS);

    gl.useProgram(p.quad);
    gl.uniform2f(gl.getUniformLocation(p.quad, 'u_resolution'), width, height);
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[1]!);
    gl.bufferData(gl.ARRAY_BUFFER, scene.quads, gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, scene.quads.length / QUAD_FLOATS);

    if (this.atlas && scene.coins.length > 0) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(p.coin);
      gl.uniform2f(gl.getUniformLocation(p.coin, 'u_resolution'), width, height);
      this.bindTexture(0, this.atlas);
      gl.uniform1i(gl.getUniformLocation(p.coin, 'u_atlas'), 0);
      gl.bindVertexArray(this.coinVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[2]!);
      gl.bufferData(gl.ARRAY_BUFFER, scene.coins, gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, scene.coins.length / COIN_FLOATS);
    }

    let bloomTex: WebGLTexture | null = this.black;
    this.ensureBloom(scene.bloom);
    if (scene.bloom !== 'off') {
      if (this.bloom.length > 0) {
        gl.disable(gl.BLEND);
        this.bindTexture(0, target.tex);
        this.fullscreen(p.bright, this.bloom[0]!, (u) => {
          gl.uniform1i(u('u_src'), 0);
          gl.uniform1f(u('u_threshold'), this.format.hdr ? BLOOM_THRESHOLD : 0.55);
        });
        for (let i = 1; i < this.bloom.length; i++) {
          const src = this.bloom[i - 1]!;
          this.bindTexture(0, src.tex);
          this.fullscreen(p.down, this.bloom[i]!, (u) => {
            gl.uniform1i(u('u_src'), 0);
            gl.uniform2f(u('u_texel'), 1 / src.width, 1 / src.height);
          });
        }
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        for (let i = this.bloom.length - 1; i > 0; i--) {
          const src = this.bloom[i]!;
          this.bindTexture(0, src.tex);
          this.fullscreen(p.up, this.bloom[i - 1]!, (u) => {
            gl.uniform1i(u('u_src'), 0);
            gl.uniform2f(u('u_texel'), 1 / src.width, 1 / src.height);
          });
        }
        bloomTex = this.bloom[0]!.tex;
      }
    }

    gl.disable(gl.BLEND);
    this.bindTexture(0, target.tex);
    this.bindTexture(1, bloomTex);
    this.fullscreen(p.composite, null, (u) => {
      gl.uniform1i(u('u_scene'), 0);
      gl.uniform1i(u('u_bloom'), 1);
      gl.uniform1f(u('u_bloomStrength'), scene.bloom === 'off' ? 0 : BLOOM_STRENGTH);
      gl.uniform1f(u('u_exposure'), scene.exposure);
      gl.uniform1f(u('u_frame'), scene.frame);
      gl.uniform2f(u('u_resolution'), width, height);
      gl.uniform4f(u('u_shock'), scene.shock?.x ?? 0.5, scene.shock?.y ?? 0.5, scene.shock?.progress ?? 0, scene.shock?.strength ?? 0);
    });
    gl.bindVertexArray(null);
  }

  destroy(): void {
    const gl = this.gl;
    this.releaseTargets();
    for (const b of this.buffers) gl.deleteBuffer(b);
    for (const vao of [this.quadVao, this.coinVao, this.lineVao, this.emptyVao]) if (vao) gl.deleteVertexArray(vao);
    if (this.programs) for (const program of Object.values(this.programs)) gl.deleteProgram(program);
    if (this.black) gl.deleteTexture(this.black);
    if (this.atlas) gl.deleteTexture(this.atlas);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
