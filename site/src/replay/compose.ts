import type { ChainNames } from '../lib/names';
import { cameraProjector, type Projector, type StarPoint } from '../sky/layout';
import { coinDiameter } from '../sky/coins';
import { createRenderer, type SkyCanvas, type SkyRenderer } from '../sky/renderer';
import type { Show, ShowFrame } from './director/show';
import { drawStory } from './story/draw';
import { layoutFor } from './story/layout';

type ShowSource = Pick<Show, 'frameAt' | 'timing' | 'length' | 'warp'>;

type Ctx2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const REPLAY_COIN_UNIT = 800;

export interface DrawnCoin {
  x: number;
  y: number;
  d: number;
  alpha: number;
  image: CanvasImageSource;
}

export function drawCoins(ctx: Ctx2d, coins: readonly DrawnCoin[]): void {
  ctx.save();
  for (const c of coins) {
    ctx.globalAlpha = c.alpha;
    ctx.drawImage(c.image, c.x - c.d / 2, c.y - c.d / 2, c.d, c.d);
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.d / 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = Math.max(1, c.d / 40);
    ctx.stroke();
  }
  ctx.restore();
}

export interface CompositorAssets {
  names: ChainNames;
  ticks: readonly { at: number; label: string }[];
}

export class ReplayCompositor {
  private readonly skyCanvas: SkyCanvas;
  private readonly renderer: SkyRenderer;
  private coinImages: ReadonlyMap<string, CanvasImageSource> = new Map();
  private loopCache: { width: number; height: number; canvas: SkyCanvas } | null = null;
  private loopCacheWarned = false;
  private destroyed = false;

  constructor(
    private readonly show: ShowSource,
    private readonly stars: readonly StarPoint[],
    private readonly assets: CompositorAssets,
    private readonly createCanvas: () => SkyCanvas,
    private readonly options: { chrome?: boolean } = {},
  ) {
    let canvas = createCanvas();
    let renderer: SkyRenderer;
    try {
      renderer = createRenderer(canvas);
    } catch {
      canvas = createCanvas();
      renderer = createRenderer(canvas, { preferGl: false });
    }
    this.skyCanvas = canvas;
    this.renderer = renderer;
  }

  setCoinImages(images: ReadonlyMap<string, CanvasImageSource>): void {
    this.coinImages = images;
    this.loopCache = null;
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
    if (this.skyCanvas.width !== width || this.skyCanvas.height !== height) this.renderer.resize(width, height);
    const project = cameraProjector(width, height, frame.camera);
    this.renderer.draw(frame.base.sky, project, Math.min(width, height) / 1000);
    target.fillStyle = '#0c0f14';
    target.fillRect(0, 0, width, height);
    const glow = target.createRadialGradient(width / 2, 0, 0, width / 2, 0, Math.max(width, height) * 0.7);
    glow.addColorStop(0, 'rgba(47, 98, 223, 0.10)');
    glow.addColorStop(1, 'rgba(47, 98, 223, 0)');
    target.fillStyle = glow;
    target.fillRect(0, 0, width, height);
    target.drawImage(this.skyCanvas, 0, 0);
    const coins = this.placeCoins(frame, project, width, height);
    drawCoins(target, coins);
    if (frame.phase === 'finale') this.drawCoinWave(target, frame, coins, project, width, height);
    drawStory(target, frame, layoutFor(width, height), { names: this.assets.names, coins: this.coinImages, ticks: this.assets.ticks }, { chrome: this.options.chrome ?? true });
  }

  private drawCoinWave(target: Ctx2d, frame: ShowFrame, coins: readonly DrawnCoin[], project: Projector, width: number, height: number): void {
    const [ox, oy] = project(this.stars[0]?.x ?? 0, this.stars[0]?.y ?? 0);
    const reach = Math.hypot(width, height) / 2;
    const seconds = frame.finale * this.show.timing.finale;
    target.save();
    for (const c of coins) {
      const p = (seconds - 0.6 * (Math.hypot(c.x - ox, c.y - oy) / reach)) / 0.5;
      if (p <= 0 || p >= 1) continue;
      target.globalAlpha = 1 - p;
      target.beginPath();
      target.arc(c.x, c.y, (c.d / 2) * (1 + 0.8 * p), 0, Math.PI * 2);
      target.strokeStyle = '#6c9bff';
      target.lineWidth = Math.max(1.5, c.d / 18);
      target.stroke();
    }
    target.restore();
  }

  private placeCoins(frame: ShowFrame, project: Projector, width: number, height: number): DrawnCoin[] {
    const unit = Math.min(width, height) / REPLAY_COIN_UNIT;
    return frame.base.coins.flatMap((c) => {
      const image = this.coinImages.get(c.selector);
      const star = frame.base.sky.stars[c.star];
      if (!image || !star || star.radius <= 0) return [];
      const [x, y] = project(star.x, star.y);
      return [{ x, y, d: coinDiameter(star.radius) * unit, alpha: c.alpha, image }];
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.renderer.destroy();
  }
}
