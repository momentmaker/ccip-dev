import type { SkyCanvas } from '../../sky/renderer';
import type { StarPoint } from '../../sky/layout';
import { COIN_RASTER_PX } from '../coin-images';
import type { CompositorAssets } from '../compose';
import type { Show, ShowFrame } from '../director/show';
import { drawStory, endTitleFont } from '../story/draw';
import { END_TITLE, layoutFor } from '../story/layout';
import { atlasLayout } from './atlas';
import { textTargets } from './fx';
import { QualityController, TIERS, type Tier } from './quality';
import { CinemaRenderer } from './renderer';
import { buildScene, dustField, type DustField } from './scene';

type Ctx2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type ShowSource = Pick<Show, 'frameAt' | 'timing' | 'length' | 'warp'>;
export type RendererLike = Pick<CinemaRenderer, 'render' | 'resize' | 'setAtlas' | 'destroy' | 'lost'>;

export interface CinemaOptions {
  quality: 'auto' | 'high';
  reducedMotion: boolean;
  chrome?: boolean;
  featherEdge?: boolean;
  startQuality?: { tier: Tier; decided: boolean };
  createRenderer?: (canvas: SkyCanvas) => RendererLike | null;
}

const TITLE_RASTER_PX = 150;
const TITLE_SAMPLE_PX = 6;
const MAX_TITLE_PARTICLES = 700;
const SEED = 5;
const EDGE_FEATHER = 0.06;

function rasterTitle(createCanvas: () => SkyCanvas): { x: number; y: number }[] {
  const canvas = createCanvas();
  const ctx = canvas.getContext('2d') as Ctx2d | null;
  if (!ctx) return [];
  ctx.font = endTitleFont(TITLE_RASTER_PX);
  const width = Math.ceil(ctx.measureText(END_TITLE).width + TITLE_RASTER_PX);
  const height = TITLE_RASTER_PX * 2;
  canvas.width = width;
  canvas.height = height;
  ctx.font = endTitleFont(TITLE_RASTER_PX);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(END_TITLE, width / 2, height / 2);
  const image = ctx.getImageData(0, 0, width, height);
  let points = textTargets(image, TITLE_SAMPLE_PX);
  for (let step = TITLE_SAMPLE_PX + 1; points.length > MAX_TITLE_PARTICLES; step++) points = textTargets(image, step);
  return points.map((p) => ({ x: (p.x * width - width / 2) / TITLE_RASTER_PX, y: (p.y * height - height / 2) / TITLE_RASTER_PX }));
}

export class CinemaCompositor {
  private readonly glCanvas: SkyCanvas;
  private readonly renderer: RendererLike;
  private readonly quality: QualityController;
  private readonly dust: DustField;
  private readonly fullExtent: number;
  private titleTargets: { x: number; y: number }[] = [];
  private atlas = new Map<string, readonly [number, number, number, number]>();
  private coinImages: ReadonlyMap<string, CanvasImageSource> = new Map();
  private loopCache: { width: number; height: number; canvas: SkyCanvas } | null = null;
  private loopCacheWarned = false;
  private destroyed = false;

  static isSupported(createCanvas: () => SkyCanvas): boolean {
    try {
      const gl = createCanvas().getContext('webgl2') as WebGL2RenderingContext | null;
      if (!gl) return false;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return true;
    } catch {
      return false;
    }
  }

  constructor(
    private readonly show: ShowSource,
    stars: readonly StarPoint[],
    private readonly assets: CompositorAssets,
    private readonly createCanvas: () => SkyCanvas,
    private readonly opts: CinemaOptions,
  ) {
    this.glCanvas = createCanvas();
    const renderer = (opts.createRenderer ?? ((c: SkyCanvas) => CinemaRenderer.create(c)))(this.glCanvas);
    if (!renderer) throw new Error('cinema: WebGL2 is unavailable');
    this.renderer = renderer;
    this.quality = new QualityController({ start: opts.startQuality?.tier, decided: opts.startQuality?.decided, locked: opts.quality === 'high' });
    this.fullExtent = Math.max(1e-6, ...stars.map((s) => Math.hypot(s.x, s.y)));
    this.dust = dustField(17, this.fullExtent);
  }

  get lost(): boolean {
    return !this.destroyed && this.renderer.lost;
  }

  get tier(): Tier {
    return this.quality.tier;
  }

  get qualityDecided(): boolean {
    return this.quality.decided;
  }

  noteFrame(ms: number, nowS: number): void {
    this.quality.sample(ms, nowS);
  }

  refreshTitle(): void {
    this.titleTargets = rasterTitle(this.createCanvas);
  }

  setCoinImages(images: ReadonlyMap<string, CanvasImageSource>): void {
    this.coinImages = images;
    this.loopCache = null;
    const entries = [...images];
    this.atlas = new Map();
    if (entries.length === 0) {
      this.renderer.setAtlas(null);
      return;
    }
    const layout = atlasLayout(entries.length, COIN_RASTER_PX);
    const canvas = this.createCanvas();
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d') as Ctx2d | null;
    if (!ctx) return;
    entries.forEach(([selector, image], i) => {
      const uv = layout.uv(i);
      ctx.drawImage(image, uv[0] * layout.width, uv[1] * layout.height, layout.cell, layout.cell);
      this.atlas.set(selector, uv);
    });
    this.renderer.setAtlas(canvas as unknown as TexImageSource);
  }

  draw(t: number, target: Ctx2d, width: number, height: number): ShowFrame {
    const frame = this.show.frameAt(t);
    if (this.destroyed) return frame;
    if (frame.loop > 0) this.ensureLoopCache(width, height);
    this.compose(frame, target, width, height);
    if (frame.loop > 0 && this.loopCache) {
      target.save();
      target.globalAlpha = frame.loop;
      target.drawImage(this.loopCache.canvas, 0, 0);
      target.restore();
    }
    return frame;
  }

  private ensureLoopCache(width: number, height: number): void {
    if (this.loopCache && this.loopCache.width === width && this.loopCache.height === height) return;
    const canvas = this.createCanvas();
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d') as Ctx2d | null;
    if (!ctx) {
      if (!this.loopCacheWarned) console.warn('Replay loop crossfade unavailable: no 2D context for the cached opening frame');
      this.loopCacheWarned = true;
      return;
    }
    this.compose(this.show.frameAt(0), ctx, width, height);
    this.loopCache = { width, height, canvas };
  }

  private compose(frame: ShowFrame, target: Ctx2d, width: number, height: number): void {
    const scene = buildScene(frame, {
      width,
      height,
      tier: TIERS[this.quality.tier],
      dust: this.dust,
      fullExtent: this.fullExtent,
      atlas: this.atlas,
      titleTargets: this.titleTargets,
      reducedMotion: this.opts.reducedMotion,
      seed: SEED,
      finaleSeconds: this.show.timing.finale,
      edgeFeather: this.opts.featherEdge ? EDGE_FEATHER : 0,
    });
    this.renderer.render(scene);
    target.drawImage(this.glCanvas, 0, 0);
    drawStory(target, frame, layoutFor(width, height), { names: this.assets.names, coins: this.coinImages, ticks: this.assets.ticks }, { chrome: this.opts.chrome ?? true });
  }

  destroy(): void {
    this.destroyed = true;
    this.renderer.destroy();
  }
}
