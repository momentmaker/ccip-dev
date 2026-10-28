import { useEffect, useRef } from 'react';
import { formatCount, formatUsdFull, formatUtcDay } from '../../lib/format';
import type { MilestoneMetric } from '../../lib/records';
import ShareButton from '../ShareButton';

const SPARKS = 150;
const SHOW_MS = 16_000;
const COLORS = ['#f5c451', '#fff6cf', '#c8901e', '#4a7ff0', '#ffffff'];

export function crossingText(metric: MilestoneMetric, threshold: number): string {
  if (metric === 'messages') return `${formatCount(threshold)} CCIP messages`;
  return metric === 'value' ? `${formatUsdFull(threshold)} moved over CCIP` : `${formatUsdFull(threshold)} in CCIP fees`;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  spin: number;
  turn: number;
  color: string;
  life: number;
}

/** Gold hexagons thrown up from the odometer, falling away over about three seconds. */
function burst(canvas: HTMLCanvasElement, from: DOMRect | null): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const box = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(box.width * dpr);
  canvas.height = Math.round(box.height * dpr);
  ctx.scale(dpr, dpr);
  const ox = from ? from.left - box.left : box.width / 3;
  const ow = from ? from.width : box.width / 3;
  const oy = from ? from.top - box.top + from.height / 2 : box.height / 3;
  const sparks: Spark[] = Array.from({ length: SPARKS }, (_, i) => {
    const a = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 6;
    return { x: ox + Math.random() * ow, y: oy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 3, size: 2 + Math.random() * 4, spin: Math.random() * 6, turn: (Math.random() - 0.5) * 0.3, color: COLORS[i % COLORS.length]!, life: 1_600 + Math.random() * 1_400 };
  });
  const start = performance.now();
  let raf = requestAnimationFrame(function step(now) {
    const t = now - start;
    ctx.clearRect(0, 0, box.width, box.height);
    let alive = false;
    for (const s of sparks) {
      if (t > s.life) continue;
      alive = true;
      s.vy += 0.045;
      s.x += s.vx;
      s.y += s.vy;
      s.spin += s.turn;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.spin);
      ctx.globalAlpha = 1 - t / s.life;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        ctx[k === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * s.size, Math.sin(a) * s.size);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    raf = alive ? requestAnimationFrame(step) : 0;
  });
  return () => cancelAnimationFrame(raf);
}

/** The moment a milestone is crossed: sparks over the hero and a banner to share it, gone after 16 s or on Close. */
export default function Celebration({ metric, threshold, since, reducedMotion, onClose }: { metric: MilestoneMetric; threshold: number; since: string | null; reducedMotion: boolean; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const timer = setTimeout(() => closeRef.current(), SHOW_MS);
    if (reducedMotion || !canvasRef.current) return () => clearTimeout(timer);
    const stop = burst(canvasRef.current, document.querySelector('.hud .odo')?.getBoundingClientRect() ?? null);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [reducedMotion]);
  const text = crossingText(metric, threshold);
  return (
    <>
      <canvas ref={canvasRef} className="burst-sparks" aria-hidden="true" />
      <div className="burst" role="status">
        <p className="burst-eyebrow">Milestone crossed</p>
        <p className="burst-title">{text}</p>
        <p className="burst-sub">Every message{since ? ` since ${formatUtcDay(since)}` : ''}. Crossed today, live on ccip.dev.</p>
        <div className="burst-actions">
          <ShareButton view="milestone" headline={`${text}, crossed today`} url="https://ccip.dev/" cardUrl="/og/home.png" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </>
  );
}
