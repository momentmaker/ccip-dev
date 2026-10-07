import type { SkyFrame } from './frame';
import { laneControl } from './geometry';
import { buildInstances, FLOATS_PER_INSTANCE, SHAPE } from './instances';
import type { Projector } from './layout';
import type { SkyCanvas, SkyRenderer } from './renderer';

type Ctx2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const rgb = (r: number, g: number, b: number) => `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`;

export class Canvas2dRenderer implements SkyRenderer {
  readonly kind = '2d' as const;

  static create(canvas: SkyCanvas): Canvas2dRenderer | null {
    const ctx = canvas.getContext('2d') as Ctx2d | null;
    return ctx ? new Canvas2dRenderer(canvas, ctx) : null;
  }

  private constructor(
    private readonly canvas: SkyCanvas,
    private readonly ctx: Ctx2d,
  ) {}

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  draw(frame: SkyFrame, project: Projector, sizeScale: number): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const pts = frame.stars.map((s) => project(s.x, s.y));
    ctx.lineWidth = 1;
    for (const lane of frame.lanes) {
      const [ax, ay] = pts[lane.from]!;
      const [bx, by] = pts[lane.to]!;
      const c = laneControl({ x: ax, y: ay }, { x: bx, y: by });
      ctx.strokeStyle = `rgba(74,127,240,${lane.opacity})`;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(c.x, c.y, bx, by);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    const data = buildInstances(frame, project, sizeScale, { trail: 3 });
    for (let i = 0; i < data.length; i += FLOATS_PER_INSTANCE) {
      const [x, y, r, cr, cg, cb, a, shape] = data.subarray(i, i + FLOATS_PER_INSTANCE) as unknown as number[];
      if (!r || !a) continue;
      const color = rgb(cr!, cg!, cb!);
      if (shape === SHAPE.ring) {
        ctx.strokeStyle = `rgba(${color},${a})`;
        ctx.lineWidth = Math.max(1, r! * 0.08);
        ctx.beginPath();
        ctx.arc(x!, y!, r! * 0.92, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      const g = ctx.createRadialGradient(x!, y!, 0, x!, y!, r!);
      g.addColorStop(0, `rgba(${color},${a})`);
      g.addColorStop(shape === SHAPE.disc ? 0.7 : 0.35, `rgba(${color},${shape === SHAPE.disc ? a : a! * 0.35})`);
      g.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x!, y!, r!, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  destroy(): void {}
}
