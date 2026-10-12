import { formatShare } from '@ccip-dev/core/format';
import { h, type Child, type VNode } from '../h';
import type { Cta } from './cta';
import type { CardSize } from './frame';
import { glyph, withArrows } from './glyphs';

export const BROADCAST_SIZE: CardSize = { width: 1200, height: 675 };
export const STRIP_H = 64;
export const COLORS = { up: '#7fd4a0', down: '#e58a8a', muted: '#8892a0', strong: '#ffffff', soft: '#c9d3e6', brand: '#4a7ff0', gold: '#ffcf5a' } as const;

const utc = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options });
const CARD_DAY = utc({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
export const MONTH_DAY = utc({ month: 'short', day: 'numeric' });
export const date = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00.000Z`);
/** "Sat, Oct 10, 2026" */
export const cardDay = (day: string) => CARD_DAY.format(date(day));
/** Days since 1970-01-01 (UTC): the stars' seed and the call to action's turn. */
export const dayNumber = (day: string) => Math.floor(Date.parse(`${day.slice(0, 10)}T00:00:00.000Z`) / 86_400_000);

export function eyebrow(text: string, style: Record<string, unknown> = {}): VNode {
  return h('div', { style: { fontSize: 20, fontWeight: 700, letterSpacing: 4, color: COLORS.muted, textTransform: 'uppercase', ...style } }, text);
}

export function bold(text: string): VNode {
  return h('span', { style: { color: COLORS.strong, fontWeight: 700 } }, text);
}

/** A line of mixed text and glyphs; white-space is kept so the spaces between pieces survive. */
export function row(children: readonly Child[], style: Record<string, unknown> = {}): VNode {
  return h('div', { style: { display: 'flex', alignItems: 'center', whiteSpace: 'pre', ...style } }, ...children);
}

export function boldArrows(text: string, size = 16): VNode {
  return row(withArrows(text, size, COLORS.strong), { color: COLORS.strong, fontWeight: 700 });
}

export interface StatView {
  label: string;
  value: string;
  sub: Child[];
  tone: 'up' | 'down' | 'muted';
}

export function deltaStat(label: string, value: string, pct: number | null, suffix: string): StatView {
  if (pct === null) return { label, value, sub: [], tone: 'muted' };
  const up = pct >= 0;
  return { label, value, sub: [glyph(up ? 'up' : 'down', 14, up ? COLORS.up : COLORS.down, { right: 6 }), `${formatShare(Math.abs(pct))}${suffix}`], tone: up ? 'up' : 'down' };
}

export function mutedStat(label: string, value: string, sub: string): StatView {
  return { label, value, sub: [sub], tone: 'muted' };
}

function statNode(s: StatView): VNode {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', width: 230, marginTop: 14 } },
    h('div', { style: { fontSize: 18, fontWeight: 700, letterSpacing: 3, color: COLORS.muted, textTransform: 'uppercase' } }, s.label),
    h('div', { style: { fontSize: 46, fontWeight: 800, fontFamily: 'JetBrains Mono', letterSpacing: -1, marginTop: 6 } }, s.value),
    row(s.sub, { fontSize: 20, marginTop: 4, height: 26, color: COLORS[s.tone] }),
  );
}

export function statsPanel(title: string, stats: readonly StatView[], footer: VNode | null): VNode {
  return h(
    'div',
    {
      style: {
        position: 'absolute', left: 52, top: 112, width: 520, display: 'flex', flexDirection: 'column', padding: '26px 30px',
        backgroundColor: 'rgba(10,13,19,0.8)', border: '1px solid #233047', borderRadius: 22, boxShadow: '0 10px 40px rgba(0,0,0,0.45)',
      },
    },
    eyebrow(title),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', width: 460 } }, ...stats.map(statNode)),
    footer,
  );
}

export function feeBars(values: readonly number[]): VNode {
  const max = Math.max(0, ...values);
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', marginTop: 18 } },
    h('div', { style: { fontSize: 18, fontWeight: 700, letterSpacing: 3, color: COLORS.muted, textTransform: 'uppercase' } }, 'Fees by day'),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'flex-end', height: 64, marginTop: 8 } },
      ...values.map((v, i) =>
        h('div', { style: { width: 56, height: max > 0 ? Math.max(2, Math.round((64 * v) / max)) : 2, marginLeft: i === 0 ? 0 : 11, backgroundColor: COLORS.brand, opacity: 0.85, borderRadius: '5px 5px 0 0' } }),
      ),
    ),
  );
}

function topBar(text: string): VNode {
  return h(
    'div',
    { style: { position: 'absolute', left: 56, top: 44, width: 1088, display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
    h('div', { style: { fontSize: 34, fontWeight: 800, color: COLORS.brand, letterSpacing: -0.5 } }, 'ccip.dev'),
    eyebrow(text),
  );
}

/** Each piece keeps its width, so a long insight is clipped at the strip's middle rather than squeezed into its neighbours. */
function strip(insight: readonly Child[], cta: Cta): VNode {
  const pieces = insight.map((c) => (typeof c === 'string' ? h('span', { style: { flexShrink: 0 } }, c) : c));
  return h(
    'div',
    {
      style: {
        position: 'absolute', left: 0, top: BROADCAST_SIZE.height - STRIP_H, width: BROADCAST_SIZE.width, height: STRIP_H, display: 'flex',
        justifyContent: 'space-between', alignItems: 'center', padding: '0 56px', backgroundImage: 'linear-gradient(90deg, #13244d, #0f1a33)',
        fontSize: 22, color: COLORS.soft,
      },
    },
    row(pieces, { flexShrink: 1, minWidth: 0, overflow: 'hidden', marginRight: 24 }),
    row([glyph('play', 16, COLORS.soft, { right: 8 }), cta.lead ? `${cta.lead} ` : null, bold(cta.path)], { flexShrink: 0 }),
  );
}

export interface FrameSpec {
  background: readonly VNode[];
  eyebrow: string;
  body: VNode;
  insight: readonly Child[];
  cta: Cta;
}

export function broadcastFrame(spec: FrameSpec): VNode {
  return h(
    'div',
    { style: { width: BROADCAST_SIZE.width, height: BROADCAST_SIZE.height, display: 'flex', position: 'relative', backgroundColor: '#070a10', fontFamily: 'Inter', color: '#e8eaed' } },
    ...spec.background,
    topBar(spec.eyebrow),
    spec.body,
    strip(spec.insight, spec.cta),
  );
}
