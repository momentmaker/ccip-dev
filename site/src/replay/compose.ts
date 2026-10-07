import { formatCount, formatUsd, formatUtcDay } from '../lib/format';
import { coinDiameter } from '../sky/coins';
import { projector, type Projector, type StarPoint } from '../sky/layout';
import { createRenderer, type SkyCanvas, type SkyRenderer } from '../sky/renderer';
import type { ReplayFrameState, ReplayModel } from './timeline';

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

export interface OverlayText {
  date: string;
  totals: string;
  chains: string;
  captions: string[];
  watermark: string;
  endCard: { title: string; lines: string[] } | null;
}

export function overlayText(state: ReplayFrameState, since: string, lastDay: string): OverlayText {
  return {
    date: formatUtcDay(state.day),
    totals: `${formatCount(state.cumulativeMessages)} messages · ${formatUsd(state.cumulativeUsd)} moved`,
    chains: `${state.activeChains} ${state.activeChains === 1 ? 'chain' : 'chains'}`,
    captions: state.captions,
    watermark: `ccip.dev · ${since} → ${lastDay}`,
    endCard: state.endCard
      ? {
          title: 'ccip.dev',
          lines: [
            `${formatCount(state.cumulativeMessages)} CCIP messages`,
            `${formatUsd(state.cumulativeUsd)} moved across ${state.activeChains} chains`,
            'Live CCIP stats at ccip.dev',
          ],
        }
      : null,
  };
}

export function drawOverlay(ctx: Ctx2d, text: OverlayText, width: number, height: number): void {
  const s = Math.min(width, height) / 1080;
  const pad = 48 * s;
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8eaed';
  ctx.font = `600 ${56 * s}px "JetBrains Mono", monospace`;
  ctx.fillText(text.date, pad, pad);
  ctx.fillStyle = '#8892a0';
  ctx.font = `400 ${28 * s}px Inter, sans-serif`;
  ctx.fillText(text.totals, pad, pad + 72 * s);
  ctx.fillText(text.chains, pad, pad + 112 * s);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f5c451';
  ctx.font = `600 ${34 * s}px Inter, sans-serif`;
  text.captions.forEach((caption, i) => ctx.fillText(caption, width / 2, height - pad - 160 * s + i * 46 * s));
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#4a7ff0';
  ctx.font = `600 ${24 * s}px Inter, sans-serif`;
  ctx.fillText(text.watermark, width - pad, height - pad);
  if (text.endCard) {
    ctx.fillStyle = 'rgba(12, 15, 20, 0.86)';
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#4a7ff0';
    ctx.font = `800 ${120 * s}px Inter, sans-serif`;
    ctx.fillText(text.endCard.title, width / 2, height / 2 - 140 * s);
    ctx.fillStyle = '#e8eaed';
    ctx.font = `600 ${40 * s}px Inter, sans-serif`;
    text.endCard.lines.forEach((line, i) => ctx.fillText(line, width / 2, height / 2 + i * 60 * s));
  }
  ctx.restore();
}

export class ReplayCompositor {
  private readonly skyCanvas: SkyCanvas;
  private readonly renderer: SkyRenderer;
  private destroyed = false;
  private coinImages: ReadonlyMap<string, CanvasImageSource> = new Map();

  constructor(
    private readonly model: ReplayModel,
    private readonly stars: readonly StarPoint[],
    private readonly since: string,
    private readonly lastDay: string,
    createCanvas: () => SkyCanvas,
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

  draw(t: number, target: Ctx2d, width: number, height: number): ReplayFrameState {
    if (this.destroyed) return this.model.frameAt(t);
    if (this.skyCanvas.width !== width || this.skyCanvas.height !== height) this.renderer.resize(width, height);
    const state = this.model.frameAt(t);
    const project = projector(width, height, this.stars, undefined, state.extent);
    this.renderer.draw(state.sky, project, Math.min(width, height) / 1000);
    target.fillStyle = '#0c0f14';
    target.fillRect(0, 0, width, height);
    const glow = target.createRadialGradient(width / 2, 0, 0, width / 2, 0, Math.max(width, height) * 0.7);
    glow.addColorStop(0, 'rgba(47, 98, 223, 0.10)');
    glow.addColorStop(1, 'rgba(47, 98, 223, 0)');
    target.fillStyle = glow;
    target.fillRect(0, 0, width, height);
    target.drawImage(this.skyCanvas, 0, 0);
    drawCoins(target, this.placeCoins(state, project, width, height));
    drawOverlay(target, overlayText(state, this.since, this.lastDay), width, height);
    return state;
  }

  setCoinImages(images: ReadonlyMap<string, CanvasImageSource>): void {
    this.coinImages = images;
  }

  private placeCoins(state: ReplayFrameState, project: Projector, width: number, height: number): DrawnCoin[] {
    const unit = Math.min(width, height) / REPLAY_COIN_UNIT;
    return state.coins.flatMap((c) => {
      const image = this.coinImages.get(c.selector);
      const star = state.sky.stars[c.star];
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
