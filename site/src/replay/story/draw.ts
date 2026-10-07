import { formatCount, formatUtcDay } from '../../lib/format';
import { chainName, type ChainNames } from '../../lib/names';
import { stripCells, stripColumns, type BoardRow } from '../director/leaderboard';
import type { ShowFrame } from '../director/show';
import type { Box, StoryLayout } from './layout';
import { odometer, rollOf } from './odometer';

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
const chainCount = (n: number) => `${n} ${n === 1 ? 'chain' : 'chains'}`;

export function fitText(ctx: Ctx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  for (let n = text.length - 1; n > 0; n--) {
    const cut = `${text.slice(0, n)}…`;
    if (ctx.measureText(cut).width <= maxWidth) return cut;
  }
  return ctx.measureText('…').width <= maxWidth ? '…' : '';
}

function setFittedFont(ctx: Ctx, text: string, weight: number, basePx: number, family: string, maxWidth: number): void {
  ctx.font = `${weight} ${basePx}px ${family}`;
  const width = ctx.measureText(text).width;
  if (width > maxWidth) ctx.font = `${weight} ${(basePx * maxWidth) / width}px ${family}`;
}

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
  setFittedFont(ctx, hook.title, 800, 86 * u, SANS, l.title.w);
  ctx.fillText(hook.title, cx, l.title.y + l.title.h * 0.38);
  ctx.fillStyle = BLUE;
  setFittedFont(ctx, hook.subtitle, 600, 44 * u, SANS, l.title.w);
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
  ctx.font = `600 ${size}px ${MONO}`;
  ctx.fillStyle = FG;
  const lastDigit = text.search(/\d(?=[^\d]*$)/);
  let carrying = true;
  const rolling = new Set<number>();
  for (let i = text.length - 1; i >= 0 && lastDigit >= 0; i--) {
    if (!/\d/.test(text[i]!)) continue;
    if (carrying) rolling.add(i);
    carrying = carrying && text[i] === '9';
  }
  const roll = rollOf(frac, frame.phase === 'finale' ? frame.finale / 0.15 : 0);
  const cell = ctx.measureText('0').width;
  for (let i = 0; i < text.length; i++) {
    const x = l.counter.x + ctx.measureText(text.slice(0, i)).width;
    if (roll === 0 || !rolling.has(i)) {
      ctx.fillText(text[i]!, x, l.counter.y);
      continue;
    }
    const digit = Number(text[i]);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, l.counter.y, cell, size);
    ctx.clip();
    ctx.fillText(String(digit), x, l.counter.y - roll * size);
    ctx.fillText(String((digit + 1) % 10), x, l.counter.y + (1 - roll) * size);
    ctx.restore();
  }
  ctx.font = `400 ${26 * u}px ${SANS}`;
  ctx.fillStyle = MUTED;
  ctx.fillText(`moved · ${formatCount(frame.story.messages)} messages · ${chainCount(frame.story.chains)}`, l.sub.x, l.sub.y);
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
  const labelX = b.x + 24 * u + d + Math.max(0, card.selectors.length - 1) * d * 0.7 + 18 * u;
  const maxWidth = b.x + b.w - 24 * u - labelX;
  ctx.fillStyle = FG;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `600 ${32 * u}px ${SANS}`;
  if (ctx.measureText(card.label).width > maxWidth) ctx.font = `600 ${26 * u}px ${SANS}`;
  ctx.fillText(fitText(ctx, card.label, maxWidth), labelX, b.y + b.h / 2);
  ctx.restore();
}

function drawSlam(ctx: Ctx, frame: ShowFrame, l: StoryLayout): void {
  const slam = frame.slam!;
  const u = l.unit;
  const scale = 1.4 - 0.4 * ease(slam.progress / 0.25);
  const alpha = ease(slam.progress / 0.15) * (1 - ease((slam.progress - 0.8) / 0.2));
  ctx.save();
  setFittedFont(ctx, slam.label, 800, 110 * u, SANS, l.slam.w);
  ctx.globalAlpha = alpha;
  const blur = (1 - ease(slam.progress / 0.25)) * 12 * u;
  ctx.filter = blur > 0.05 ? `blur(${blur}px)` : 'none';
  ctx.translate(l.width / 2, l.slam.y + l.slam.h / 2);
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = FG;
  ctx.fillText(slam.label, 0, 0);
  ctx.restore();
}

const descending = (r: BoardRow) => r.to > r.from && r.swap < 1;

function crossingAlpha(r: BoardRow): number {
  return descending(r) ? r.alpha * (1 - 0.5 * Math.sin(Math.PI * r.swap)) : r.alpha;
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
    for (const r of [...rows.filter(descending), ...rows.filter((x) => !descending(x))]) {
      const y = l.board.y + r.rank * rowH;
      ctx.globalAlpha = crossingAlpha(r);
      if (r.focus) {
        roundRect(ctx, { x: l.board.x - 8 * u, y: y + 4 * u, w: l.board.w + 16 * u, h: rowH - 8 * u }, 10 * u);
        ctx.fillStyle = 'rgba(19, 36, 77, 0.9)';
        ctx.fill();
      }
      coin(ctx, assets, r.selector, l.board.x + 20 * u, y + rowH / 2, 36 * u);
      ctx.fillStyle = FG;
      ctx.font = `600 ${24 * u}px ${SANS}`;
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, chainName(assets.names, r.selector), l.board.w - 48 * u - 110 * u), l.board.x + 48 * u, y + rowH / 2 - 8 * u);
      ctx.fillStyle = 'rgba(74, 127, 240, 0.55)';
      ctx.fillRect(l.board.x + 48 * u, y + rowH / 2 + 10 * u, (l.board.w - 160 * u) * (r.value / max), 6 * u);
      ctx.fillStyle = MUTED;
      ctx.font = `600 ${20 * u}px ${MONO}`;
      ctx.textAlign = 'right';
      ctx.fillText(odometer(r.value).text, l.board.x + l.board.w, y + rowH / 2);
    }
  } else {
    const focusCut = frame.focus !== null;
    const colW = l.board.w / stripColumns(focusCut);
    for (const { row: r, column, alpha } of stripCells(rows, focusCut)) {
      const x = l.board.x + column * colW;
      ctx.globalAlpha = alpha;
      coin(ctx, assets, r.selector, x + 28 * u, l.board.y + 40 * u, 44 * u);
      ctx.fillStyle = r.focus ? BLUE : FG;
      ctx.font = `600 ${22 * u}px ${SANS}`;
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, chainName(assets.names, r.selector), colW - 68 * u), x + 60 * u, l.board.y + 30 * u);
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

export function drawStory(ctx: Ctx, frame: ShowFrame, layout: StoryLayout, assets: StoryAssets, opts: { chrome?: boolean } = {}): void {
  const chrome = opts.chrome ?? true;
  if (frame.hook) {
    drawTitle(ctx, frame, layout);
    if (chrome) drawWatermark(ctx, layout);
    return;
  }
  drawDate(ctx, frame, layout);
  drawCounter(ctx, frame, layout);
  if (chrome) drawTimeline(ctx, frame, layout, assets);
  drawBoard(ctx, frame, layout, assets);
  if (frame.card) drawCard(ctx, frame, layout, assets);
  if (frame.slam) drawSlam(ctx, frame, layout);
  if (chrome) drawWatermark(ctx, layout);
  if (frame.phase === 'finale') drawEndTitle(ctx, frame, layout);
}
