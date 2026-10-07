import { formatCount, formatUtcDay } from '../../lib/format';
import { chainName, type ChainNames } from '../../lib/names';
import type { ShowFrame } from '../director/show';
import type { Box, StoryLayout } from './layout';
import { odometer } from './odometer';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface StoryAssets {
  names: ChainNames;
  coins: ReadonlyMap<string, CanvasImageSource>;
  ticks: readonly { at: number; label: string }[];
}

const FG = '#e8eaed';
const MUTED = '#8892a0';
const BLUE = '#4a7ff0';
const CARD = 'rgba(22, 27, 35, 0.88)';
const BORDER = 'rgba(47, 98, 223, 0.45)';
const SANS = 'Inter, sans-serif';
const MONO = '"JetBrains Mono", monospace';
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => 1 - (1 - clamp01(x)) ** 3;

function roundRect(ctx: Ctx, b: Box, r: number): void {
  ctx.beginPath();
  ctx.moveTo(b.x + r, b.y);
  ctx.lineTo(b.x + b.w - r, b.y);
  ctx.arc(b.x + b.w - r, b.y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(b.x + b.w, b.y + b.h - r);
  ctx.arc(b.x + b.w - r, b.y + b.h - r, r, 0, Math.PI / 2);
  ctx.lineTo(b.x + r, b.y + b.h);
  ctx.arc(b.x + r, b.y + b.h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(b.x, b.y + r);
  ctx.arc(b.x + r, b.y + r, r, Math.PI, (3 * Math.PI) / 2);
  ctx.closePath();
}

function coin(ctx: Ctx, assets: StoryAssets, selector: string, cx: number, cy: number, d: number): void {
  const image = assets.coins.get(selector);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  if (image) {
    ctx.clip();
    ctx.drawImage(image, cx - d / 2, cy - d / 2, d, d);
  } else {
    ctx.fillStyle = BLUE;
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = Math.max(1, d / 30);
  ctx.stroke();
}

function drawTitle(ctx: Ctx, frame: ShowFrame, l: StoryLayout): void {
  const hook = frame.hook!;
  const u = l.unit;
  const appear = ease(hook.progress / 0.35);
  const leave = 1 - ease((hook.progress - 0.8) / 0.2);
  ctx.save();
  ctx.globalAlpha = appear * leave;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = l.width / 2;
  const sweep = ctx.createLinearGradient(l.title.x, 0, l.title.x + l.title.w, 0);
  const at = clamp01(hook.progress * 1.4 - 0.2);
  sweep.addColorStop(0, FG);
  sweep.addColorStop(Math.max(0, at - 0.08), FG);
  sweep.addColorStop(at, '#ffffff');
  sweep.addColorStop(Math.min(1, at + 0.08), FG);
  sweep.addColorStop(1, FG);
  ctx.fillStyle = sweep;
  ctx.font = `800 ${86 * u}px ${SANS}`;
  ctx.fillText(hook.title, cx, l.title.y + l.title.h * 0.38);
  ctx.fillStyle = BLUE;
  ctx.font = `600 ${44 * u}px ${SANS}`;
  ctx.fillText(hook.subtitle, cx, l.title.y + l.title.h * 0.78);
  ctx.restore();
}

function drawCounter(ctx: Ctx, frame: ShowFrame, l: StoryLayout): void {
  const u = l.unit;
  const { text, frac } = odometer(frame.story.usd);
  const size = 96 * u;
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.font = `700 ${size}px ${MONO}`;
  ctx.fillStyle = FG;
  const digitIndex = text.search(/\d(?=[^\d]*$)/);
  const digit = digitIndex >= 0 ? Number(text[digitIndex]) : null;
  const tail = digitIndex >= 0 ? text.slice(digitIndex + 1) : '';
  const prefix = digitIndex >= 0 ? text.slice(0, digitIndex) : text;
  ctx.fillText(prefix, l.counter.x, l.counter.y);
  if (digit !== null) {
    const x = l.counter.x + ctx.measureText(prefix).width;
    const w = ctx.measureText('0').width;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, l.counter.y, w, size * 1.1);
    ctx.clip();
    ctx.fillText(String(digit), x, l.counter.y - frac * size);
    ctx.fillText(String((digit + 1) % 10), x, l.counter.y + (1 - frac) * size);
    ctx.restore();
    ctx.fillText(tail, x + w, l.counter.y);
  }
  ctx.font = `400 ${26 * u}px ${SANS}`;
  ctx.fillStyle = MUTED;
  ctx.fillText(`moved · ${formatCount(frame.story.messages)} messages · ${frame.story.chains} chains`, l.sub.x, l.sub.y);
  ctx.restore();
}

function drawDate(ctx: Ctx, frame: ShowFrame, l: StoryLayout): void {
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.font = `600 ${48 * l.unit}px ${MONO}`;
  ctx.fillStyle = FG;
  ctx.fillText(formatUtcDay(frame.story.day), l.date.x, l.date.y);
  ctx.restore();
}

function drawTimeline(ctx: Ctx, frame: ShowFrame, l: StoryLayout, assets: StoryAssets): void {
  const u = l.unit;
  const b = l.timeline;
  const y = b.y + 8 * u;
  ctx.save();
  ctx.fillStyle = 'rgba(232, 234, 237, 0.14)';
  ctx.fillRect(b.x, y, b.w, 4 * u);
  const fill = ctx.createLinearGradient(b.x, 0, b.x + b.w, 0);
  fill.addColorStop(0, '#2f62df');
  fill.addColorStop(1, '#6c9bff');
  ctx.fillStyle = fill;
  ctx.fillRect(b.x, y, b.w * frame.story.timeline, 4 * u);
  ctx.fillStyle = MUTED;
  ctx.font = `600 ${18 * u}px ${MONO}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  for (const tick of assets.ticks) ctx.fillText(tick.label, b.x + b.w * tick.at, y + 12 * u);
  ctx.restore();
}

function drawCard(ctx: Ctx, frame: ShowFrame, l: StoryLayout, assets: StoryAssets): void {
  const card = frame.card!;
  const u = l.unit;
  const enter = ease(card.progress / 0.15);
  const exit = 1 - ease((card.progress - 0.85) / 0.15);
  const dim = frame.slam ? 0.4 : 1;
  const b = { ...l.card, y: l.card.y + (1 - enter) * 24 * u };
  ctx.save();
  ctx.globalAlpha = Math.min(enter, exit) * dim;
  roundRect(ctx, b, 18 * u);
  ctx.fillStyle = CARD;
  ctx.fill();
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 2 * u;
  ctx.stroke();
  const d = 56 * u;
  card.selectors.forEach((s, i) => coin(ctx, assets, s, b.x + 24 * u + d / 2 + i * d * 0.7, b.y + b.h / 2, d));
  ctx.font = `600 ${32 * u}px ${SANS}`;
  ctx.fillStyle = FG;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(card.label, b.x + 24 * u + d + Math.max(0, card.selectors.length - 1) * d * 0.7 + 18 * u, b.y + b.h / 2);
  ctx.restore();
}

function drawSlam(ctx: Ctx, frame: ShowFrame, l: StoryLayout): void {
  const slam = frame.slam!;
  const u = l.unit;
  const scale = 1.4 - 0.4 * ease(slam.progress / 0.25);
  const alpha = ease(slam.progress / 0.15) * (1 - ease((slam.progress - 0.8) / 0.2));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(l.width / 2, l.slam.y + l.slam.h / 2);
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${110 * u}px ${SANS}`;
  ctx.fillStyle = FG;
  ctx.fillText(slam.label, 0, 0);
  ctx.restore();
}

function drawBoard(ctx: Ctx, frame: ShowFrame, l: StoryLayout, assets: StoryAssets): void {
  const u = l.unit;
  const rows = frame.board;
  if (rows.length === 0) return;
  const max = Math.max(...rows.map((r) => r.value), 1);
  ctx.save();
  ctx.textBaseline = 'middle';
  if (l.aspect === 'wide') {
    const rowH = 60 * u;
    for (const r of rows) {
      const y = l.board.y + r.rank * rowH;
      ctx.globalAlpha = r.alpha;
      if (r.focus) {
        roundRect(ctx, { x: l.board.x - 8 * u, y: y + 4 * u, w: l.board.w + 16 * u, h: rowH - 8 * u }, 10 * u);
        ctx.fillStyle = 'rgba(19, 36, 77, 0.9)';
        ctx.fill();
      }
      coin(ctx, assets, r.selector, l.board.x + 20 * u, y + rowH / 2, 36 * u);
      ctx.fillStyle = FG;
      ctx.font = `600 ${24 * u}px ${SANS}`;
      ctx.textAlign = 'left';
      ctx.fillText(chainName(assets.names, r.selector), l.board.x + 48 * u, y + rowH / 2 - 8 * u);
      ctx.fillStyle = 'rgba(74, 127, 240, 0.55)';
      ctx.fillRect(l.board.x + 48 * u, y + rowH / 2 + 10 * u, (l.board.w - 160 * u) * (r.value / max), 6 * u);
      ctx.fillStyle = MUTED;
      ctx.font = `600 ${20 * u}px ${MONO}`;
      ctx.textAlign = 'right';
      ctx.fillText(odometer(r.value).text, l.board.x + l.board.w, y + rowH / 2);
    }
  } else {
    const shown = rows.filter((r) => r.rank < 3 || r.focus);
    const colW = l.board.w / Math.max(3, shown.length);
    for (const r of shown) {
      const x = l.board.x + Math.min(r.rank, 3) * colW;
      ctx.globalAlpha = r.alpha;
      coin(ctx, assets, r.selector, x + 28 * u, l.board.y + 40 * u, 44 * u);
      ctx.fillStyle = r.focus ? BLUE : FG;
      ctx.font = `600 ${22 * u}px ${SANS}`;
      ctx.textAlign = 'left';
      ctx.fillText(chainName(assets.names, r.selector), x + 60 * u, l.board.y + 30 * u);
      ctx.fillStyle = MUTED;
      ctx.font = `600 ${18 * u}px ${MONO}`;
      ctx.fillText(odometer(r.value).text, x + 60 * u, l.board.y + 58 * u);
    }
  }
  ctx.restore();
}

function drawWatermark(ctx: Ctx, l: StoryLayout): void {
  ctx.save();
  ctx.font = `600 ${22 * l.unit}px ${SANS}`;
  ctx.fillStyle = BLUE;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('ccip.dev · @ccipdev', l.watermark.x + l.watermark.w, l.watermark.y);
  ctx.restore();
}

function drawEndTitle(ctx: Ctx, frame: ShowFrame, l: StoryLayout): void {
  const alpha = ease((frame.finale - 0.3) / 0.4);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${130 * l.unit}px ${SANS}`;
  ctx.fillStyle = BLUE;
  ctx.fillText('ccip.dev', l.width / 2, l.height / 2);
  ctx.restore();
}

export function drawStory(ctx: Ctx, frame: ShowFrame, layout: StoryLayout, assets: StoryAssets): void {
  if (frame.hook) {
    drawTitle(ctx, frame, layout);
    drawWatermark(ctx, layout);
    return;
  }
  drawDate(ctx, frame, layout);
  drawCounter(ctx, frame, layout);
  drawTimeline(ctx, frame, layout, assets);
  drawBoard(ctx, frame, layout, assets);
  if (frame.card) drawCard(ctx, frame, layout, assets);
  if (frame.slam) drawSlam(ctx, frame, layout);
  drawWatermark(ctx, layout);
  if (frame.phase === 'finale') drawEndTitle(ctx, frame, layout);
}
