import { formatCompactCount, formatCount, formatPct, formatUsd, formatUtcDay } from '@ccip-dev/core/format';
import type { ReserveFile } from '@ccip-dev/core/public';
import { vaultFill } from '../../src/lib/reserve-view';
import { h, type VNode } from '../h';
import { CARD_H, CARD_W } from './frame';
import { glyph } from './glyphs';
import { svgDataUri } from './orbit-sky';

const GOLD = '#f5c451';
const GOLD_PALE = '#fff6cf';
const GOLD_DEEP = '#b07a12';
const MUTED = '#8892a0';
const UP = '#3ccf8e';
const DOWN = '#f06a6a';
/** The home page's vault art, drawn in its own 420-unit box around C and scaled onto the card at (x, y). */
const VAULT = { x: 930, y: 300, scale: 1.12 } as const;
const C = 210;
const BARS = { x: 56, top: 424, width: 600, height: 58, weeks: 26 } as const;

type Point = readonly [number, number];

const hex = (r: number): Point[] =>
  Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k - Math.PI / 2;
    return [C + Math.cos(a) * r, C + Math.sin(a) * r] as const;
  });
const points = (pts: readonly Point[]) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
/** Half the width of the vault's inside (a pointy-top hex of radius 132) at height y of its box. */
function insideHalfWidth(y: number): number {
  const side = 132 * (Math.sqrt(3) / 2);
  const fromTip = Math.min(y - (C - 132), C + 132 - y);
  return fromTip >= 66 ? side : Math.max(0, (side * fromTip) / 66);
}
/** A point of the vault's own box, on the card. */
const onCard = (x: number, y: number): Point => [VAULT.x + (x - C) * VAULT.scale, VAULT.y + (y - C) * VAULT.scale];

/** The liquid's surface and the dashed line at the last million, in the vault's box; null without a balance yet. */
function vaultLevels(link: number | null): { level: number; mark: number | null; fill: { target: number; fraction: number } } | null {
  const fill = vaultFill(link);
  if (fill === null) return null;
  const previous = fill.target - 1_000_000;
  return { level: C + 132 - fill.fraction * 264, mark: previous > 0 ? C + 132 - (previous / fill.target) * 264 : null, fill };
}

/** The vault as the home page draws it, standing still: rings, the gold frame and rivets, the liquid and the blue core. */
function vaultSvg(link: number | null): string {
  const v = vaultLevels(link);
  const inner = hex(132);
  // A still wave: the home page's animated surface, frozen.
  const liquid = v === null ? '' : `<g clip-path="url(#vaultInside)"><path d="M-70 ${v.level.toFixed(1)}${' q35 -9 70 0 t70 0'.repeat(8)} V430 H-70 Z" fill="url(#vaultLiquid)"/>${v.mark === null ? '' : `<line x1="0" x2="420" y1="${v.mark.toFixed(1)}" y2="${v.mark.toFixed(1)}" stroke="#fff6cf" stroke-opacity="0.35" stroke-dasharray="3 5"/>`}</g>`;
  const rivets = hex(150).map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="url(#vaultGold)" stroke="#5a3d08"/>`);
  return (
    `<g transform="translate(${VAULT.x - C * VAULT.scale} ${VAULT.y - C * VAULT.scale}) scale(${VAULT.scale})">` +
    `<circle cx="${C}" cy="${C}" r="205" fill="url(#vaultGlow)"/>` +
    `<polygon points="${points(hex(200))}" fill="none" stroke="${GOLD}" stroke-opacity="0.18"/>` +
    `<polygon points="${points(hex(178))}" fill="none" stroke="${GOLD}" stroke-opacity="0.28"/>` +
    `<polygon points="${points(inner)}" fill="#0b1020"/>` +
    liquid +
    `<polygon points="${points(hex(46))}" fill="none" stroke="#4a7ff0" stroke-width="12" stroke-linejoin="round"/>` +
    `<polygon points="${points(hex(46))}" fill="none" stroke="#8fb0ff" stroke-width="3" stroke-linejoin="round"/>` +
    `<polygon points="${points(hex(150))}" fill="none" stroke="url(#vaultGold)" stroke-width="12" stroke-linejoin="round"/>` +
    rivets.join('') +
    '</g>'
  );
}

/** The last weeks with a deposit as gold bars, the newest brightest, under the text column. */
function barsSvg(weekly: ReserveFile['weekly']): string {
  const weeks = weekly.filter((w) => w.deposits > 0).slice(-BARS.weeks);
  if (weeks.length === 0) return '';
  const gap = 5;
  const bw = (BARS.width - gap * (BARS.weeks - 1)) / BARS.weeks;
  const max = Math.max(...weeks.map((w) => w.link));
  const base = BARS.top + BARS.height;
  return weeks
    .map((w, i) => {
      const bh = Math.max(3, (w.link / max) * BARS.height);
      const x = BARS.x + i * (bw + gap);
      return `<rect class="bar" x="${x.toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="url(#barGold)" opacity="${i === weeks.length - 1 ? 1 : 0.62}"/>`;
    })
    .join('');
}

/** The background: night sky, the page's faint hex ground, a gold glow, the vault and the weekly deposits. */
export function reservePageSvg(reserve: Pick<ReserveFile, 'latest' | 'weekly'>): string {
  const ground = points(hex(16).map(([x, y]) => [x - C, y - C] as const));
  const tiles: string[] = [];
  for (let y = -20; y < CARD_H + 40; y += 24) {
    for (let x = ((y + 20) / 24) % 2 === 0 ? 0 : 13.9; x < CARD_W + 28; x += 27.7) tiles.push(`<polygon points="${ground}" transform="translate(${x} ${y})"/>`);
  }
  const inside = points(hex(132));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">` +
    '<defs>' +
    `<radialGradient id="glowR" cx="${VAULT.x / CARD_W}" cy="${VAULT.y / CARD_H}" r="0.42"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.22"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>` +
    '<radialGradient id="glowL" cx="0.05" cy="0" r="0.7"><stop offset="0" stop-color="#2f62df" stop-opacity="0.16"/><stop offset="1" stop-color="#2f62df" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="fade" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#070a10" stop-opacity="0.2"/><stop offset="1" stop-color="#070a10" stop-opacity="0.85"/></linearGradient>' +
    `<linearGradient id="vaultGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${GOLD_PALE}"/><stop offset="0.45" stop-color="${GOLD}"/><stop offset="1" stop-color="#8a5e10"/></linearGradient>` +
    `<linearGradient id="vaultLiquid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.6"/><stop offset="1" stop-color="#8a5e10" stop-opacity="0.28"/></linearGradient>` +
    `<radialGradient id="vaultGlow"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.3"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="barGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GOLD}"/><stop offset="1" stop-color="#8a5e10"/></linearGradient>` +
    `<clipPath id="vaultInside"><polygon points="${inside}"/></clipPath>` +
    '</defs>' +
    `<rect width="${CARD_W}" height="${CARD_H}" fill="#070a10"/>` +
    `<g fill="none" stroke="#4a8eff" stroke-opacity="0.07" stroke-width="1">${tiles.join('')}</g>` +
    `<rect width="${CARD_W}" height="${CARD_H}" fill="url(#fade)"/>` +
    `<rect width="${CARD_W}" height="${CARD_H}" fill="url(#glowL)"/>` +
    `<rect width="${CARD_W}" height="${CARD_H}" fill="url(#glowR)"/>` +
    vaultSvg(reserve.latest?.link ?? null) +
    barsSvg(reserve.weekly) +
    '</svg>'
  );
}

function tile(label: string, value: string, accent = '#ffffff'): VNode {
  return h(
    'div',
    {
      style: {
        display: 'flex', flexDirection: 'column', width: 142, marginRight: 12, padding: '12px 14px', borderRadius: 12,
        border: '1px solid rgba(245,196,81,0.28)', backgroundColor: 'rgba(245,196,81,0.06)',
      },
    },
    h('div', { style: { fontSize: 13, fontWeight: 700, letterSpacing: 1.6, color: MUTED, textTransform: 'uppercase' } }, label),
    h('div', { style: { fontSize: 30, fontWeight: 800, fontFamily: 'JetBrains Mono', color: accent, marginTop: 4, letterSpacing: -0.5 } }, value),
  );
}

/** The tiles that have a value: the change on its cost, the weekly pace, its share of all LINK and the next deposit. */
function tiles(reserve: ReserveFile): VNode[] {
  const change = reserve.cost_basis?.change_pct ?? null;
  const pace = reserve.pace;
  const next = pace?.next_expected_deposit ?? null;
  return [
    change === null ? null : tile('On its cost', formatPct(change), change >= 0 ? UP : DOWN),
    pace?.avg_weekly_link_4w == null ? null : tile('A week', `~${formatCompactCount(pace.avg_weekly_link_4w)}`),
    pace ? tile('Of all LINK', `${pace.supply_share_pct.toFixed(2)}%`) : null,
    next === null ? null : tile('Deposit due', pace?.deposit_overdue ? 'Now' : formatUtcDay(next).replace(/, \d{4}$/, ''), GOLD),
  ].filter((t): t is VNode => t !== null);
}

/** The vault's labels, set over the art as text: how full it is toward the next million, and the last million's mark. */
function vaultLabels(link: number | null): VNode[] {
  const v = vaultLevels(link);
  if (v === null) return [];
  const [, pctY] = onCard(C, C + 82);
  const labels = [
    h(
      'div',
      { style: { position: 'absolute', left: VAULT.x - 110, top: pctY - 27, width: 220, display: 'flex', flexDirection: 'column', alignItems: 'center' } },
      h('div', { style: { fontSize: 25, fontWeight: 800, color: GOLD_PALE } }, `${(v.fill.fraction * 100).toFixed(1)}%`),
      h('div', { style: { fontSize: 12, fontFamily: 'JetBrains Mono', letterSpacing: 1, color: 'rgba(255,246,207,0.7)' } }, `OF ${formatCount(v.fill.target)}`),
    ),
  ];
  if (v.mark !== null) {
    // At the line's right end, inside the vault where the line runs.
    const [markX, markY] = onCard(C + insideHalfWidth(v.mark) - 10, v.mark);
    labels.push(
      h('div', { style: { position: 'absolute', left: markX - 60, top: markY - 20, width: 60, display: 'flex', justifyContent: 'flex-end', fontSize: 13, fontFamily: 'JetBrains Mono', color: 'rgba(255,246,207,0.75)' } }, `${formatCount((v.fill.target - 1_000_000) / 1_000_000)}M`),
    );
  }
  return labels;
}

/** "LINK held · $76.9M at $11.87", with as much of the value as reserve.json has. */
function heldLine(reserve: ReserveFile): string {
  const link = reserve.latest?.link ?? null;
  const price = reserve.link_price_usd;
  const value = reserve.cost_basis?.value_usd ?? (link !== null && price !== null ? link * price : null);
  if (value === null) return 'LINK held';
  return `LINK held · ${formatUsd(value)}${price === null ? '' : ` at $${price.toFixed(2)}`}`;
}

/** The /reserve share card: the home page's Vault in one frame. */
export function reservePageTree(reserve: ReserveFile, _now: Date): VNode {
  const link = reserve.latest?.link ?? null;
  const streak = reserve.pace?.deposit_streak ?? 0;
  const bars = reserve.weekly.filter((w) => w.deposits > 0).slice(-BARS.weeks).length;
  return h(
    'div',
    { style: { width: CARD_W, height: CARD_H, display: 'flex', position: 'relative', backgroundColor: '#070a10', fontFamily: 'Inter', color: '#e8eaed' } },
    h('img', { src: svgDataUri(reservePageSvg(reserve)), width: CARD_W, height: CARD_H, style: { position: 'absolute', left: 0, top: 0 } }),
    ...vaultLabels(link),
    h(
      'div',
      { style: { position: 'absolute', left: 56, top: 40, display: 'flex', flexDirection: 'column', width: 640 } },
      h('div', { style: { fontSize: 34, fontWeight: 800, color: '#4a7ff0', letterSpacing: -0.5 } }, 'ccip.dev'),
      h('div', { style: { fontSize: 17, fontWeight: 800, fontFamily: 'JetBrains Mono', letterSpacing: 3.5, color: GOLD, marginTop: 28, textTransform: 'uppercase' } }, 'Chainlink Reserve · Ethereum'),
      h(
        'div',
        {
          style: {
            fontSize: 100, fontWeight: 800, letterSpacing: -4, lineHeight: 1, marginTop: 10,
            backgroundImage: `linear-gradient(180deg, ${GOLD_PALE} 8%, ${GOLD} 58%, ${GOLD_DEEP})`, backgroundClip: 'text', color: 'transparent',
          },
        },
        link === null ? '0' : formatCount(link),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', marginTop: 14 } },
        streak > 0
          ? h('div', { style: { display: 'flex', fontSize: 17, fontWeight: 800, letterSpacing: 2.5, color: '#2a2116', backgroundColor: GOLD, borderRadius: 6, padding: '5px 11px', marginRight: 14 } }, `${formatCount(streak)}-WEEK DEPOSIT STREAK`)
          : null,
        h('div', { style: { fontSize: 23, color: '#c9cfda' } }, heldLine(reserve)),
      ),
      h('div', { style: { display: 'flex', marginTop: 28 } }, ...tiles(reserve)),
    ),
    bars > 0
      ? h('div', { style: { position: 'absolute', left: BARS.x, top: BARS.top + BARS.height + 8, fontSize: 13, fontWeight: 700, fontFamily: 'JetBrains Mono', letterSpacing: 1, color: MUTED } }, `LINK DEPOSITED A WEEK · LAST ${bars} WEEKS`)
      : null,
    h(
      'div',
      { style: { position: 'absolute', left: 56, top: 548, display: 'flex', alignItems: 'center', fontSize: 21, color: '#c9cfda' } },
      glyph('play', 15, GOLD, { right: 10 }),
      h('span', { style: { color: '#ffffff', fontWeight: 700 } }, 'ccip.dev/reserve'),
      h('span', { style: { color: MUTED, marginLeft: 12 } }, '· deposits · cost basis · pace'),
    ),
  );
}
