import type { SkyFrame } from './frame';
import type { Projector } from './layout';
import { Canvas2dRenderer } from './renderer-2d';
import { GlRenderer } from './renderer-gl';

export type SkyCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface SkyRenderer {
  readonly kind: 'gl' | '2d';
  resize(width: number, height: number): void;
  draw(frame: SkyFrame, project: Projector, sizeScale: number): void;
  destroy(): void;
}

export function createRenderer(canvas: SkyCanvas, opts: { preferGl?: boolean } = {}): SkyRenderer {
  if (opts.preferGl !== false) {
    const gl = GlRenderer.create(canvas);
    if (gl) return gl;
  }
  const flat = Canvas2dRenderer.create(canvas);
  if (flat) return flat;
  throw new Error('no canvas context available');
}

const LOSS_WINDOW_MS = 60_000;

export class ContextLossTracker {
  private losses: number[] = [];

  record(nowMs: number): 'restore' | 'fallback' {
    this.losses = this.losses.filter((t) => nowMs - t < LOSS_WINDOW_MS);
    this.losses.push(nowMs);
    return this.losses.length >= 2 ? 'fallback' : 'restore';
  }
}
