import { formatCount, formatUsd, formatUtcDay } from '../lib/format';
import { projector, type StarPoint } from '../sky/layout';
import { createRenderer, type SkyCanvas, type SkyRenderer } from '../sky/renderer';
import type { ReplayFrameState, ReplayModel } from './timeline';

type Ctx2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

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

  constructor(
    private readonly model: ReplayModel,
    private readonly stars: readonly StarPoint[],
    private readonly since: string,
    private readonly lastDay: string,
    createCanvas: () => SkyCanvas,
  ) {
    this.skyCanvas = createCanvas();
    this.renderer = createRenderer(this.skyCanvas);
  }

  draw(t: number, target: Ctx2d, width: number, height: number): ReplayFrameState {
    if (this.skyCanvas.width !== width || this.skyCanvas.height !== height) this.renderer.resize(width, height);
    const state = this.model.frameAt(t);
    this.renderer.draw(state.sky, projector(width, height, this.stars, undefined, state.extent), Math.min(width, height) / 1000);
    target.fillStyle = '#0c0f14';
    target.fillRect(0, 0, width, height);
    const glow = target.createRadialGradient(width / 2, 0, 0, width / 2, 0, Math.max(width, height) * 0.7);
    glow.addColorStop(0, 'rgba(47, 98, 223, 0.10)');
    glow.addColorStop(1, 'rgba(47, 98, 223, 0)');
    target.fillStyle = glow;
    target.fillRect(0, 0, width, height);
    target.drawImage(this.skyCanvas, 0, 0);
    drawOverlay(target, overlayText(state, this.since, this.lastDay), width, height);
    return state;
  }

  destroy(): void {
    this.renderer.destroy();
  }
}
