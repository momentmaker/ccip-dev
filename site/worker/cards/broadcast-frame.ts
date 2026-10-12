import { formatShare } from '@ccip-dev/core/format';
import { chainName, chainNameMap, type ChainNames } from '@ccip-dev/core/names';
import type { PublicFile, PublicFileName, ReplayFile } from '@ccip-dev/core/public';
import type { MilestoneMetric } from '@ccip-dev/core/records';
import { addDays } from '@ccip-dev/core/time';
import { windowWeights } from '../../src/sky/weights';
import { h, type Child, type VNode } from '../h';
import type { Cta } from './cta';
import type { CardSize } from './frame';
import { glyph, withArrows, type GlyphName } from './glyphs';
import { orbitSky, type OrbitSky, type StarFreeZone } from './orbit-sky';

export interface BroadcastInputs {
  load: <N extends PublicFileName>(name: N) => Promise<PublicFile<N>>;
  icon: (selector: string) => Promise<string | null>;
}

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

/** The left text column of the cards whose text sits on the open sky, with no glass panel behind it. */
export const TEXT_COLUMN: StarFreeZone = { x: 40, y: 40, width: 660, height: 440 };

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

export function boldArrows(text: string, size = 16, style: Record<string, unknown> = {}): VNode {
  return row(withArrows(text, size, COLORS.strong), { color: COLORS.strong, fontWeight: 700, ...style });
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

/** "Oct 5 – 9, 2026", or "Sep 28 – Oct 2, 2026" across a month. */
export function cardDays(from: string, to: string): string {
  const end = from.slice(0, 7) === to.slice(0, 7) ? String(Number(to.slice(8))) : MONTH_DAY.format(date(to));
  return `${MONTH_DAY.format(date(from))} – ${end}, ${to.slice(0, 4)}`;
}

/** "Oct 5 – 11, 2026", or "Sep 28 – Oct 4, 2026" across a month. */
export function cardWeek(monday: string): string {
  return cardDays(monday, addDays(monday, 6));
}

export const MILESTONE_TITLES: Record<MilestoneMetric, string> = {
  messages: 'All-time messages on CCIP',
  value: 'All-time value moved over CCIP',
  fees: 'All-time fees paid to CCIP',
};

export async function iconsFor(sky: OrbitSky, icon: BroadcastInputs['icon']): Promise<Map<string, string | null>> {
  return new Map(await Promise.all(sky.coins.map(async (c) => [c.selector, await icon(c.selector)] as const)));
}

export const namesOf = (replay: ReplayFile, chains: PublicFile<'chains.json'>): ChainNames => chainNameMap([...replay.chains, ...chains.chains]);

export const hasReplayDay = (replay: ReplayFile, day: string) => replay.days.some((d) => d.day === day);

type SkyExtra = { dim?: boolean; gold?: string | null; starFree?: readonly StarFreeZone[] };

/** The day's (or week's) chains and lanes from replay.json, around the busiest chain. */
export function skyFor(replay: ReplayFile, names: ChainNames, from: string, to: string, extra: SkyExtra = {}): OrbitSky {
  const weights = windowWeights(replay, from, to);
  return orbitSky({
    chains: [...weights.chains].map(([selector, value]) => ({ selector, value, name: chainName(names, selector) })),
    lanes: weights.lanes,
    seed: dayNumber(to),
    ...extra,
  });
}

/**
 * One chain at the hub of its own sky with the chains it shared a lane with over [from, to] around it. Messages count
 * with value, so a partner on an unpriced lane still shows, and the hub always outweighs its partners.
 */
export function hubSky(replay: ReplayFile, names: ChainNames, hub: string, from: string, to: string, extra: SkyExtra = {}): OrbitSky {
  const lanes = windowWeights(replay, from, to).lanes.filter((l) => l.src === hub || l.dst === hub);
  const partners = new Map<string, number>();
  for (const l of lanes) {
    const other = l.src === hub ? l.dst : l.src;
    partners.set(other, (partners.get(other) ?? 0) + l.usd + l.messages);
  }
  const top = Math.max(1, ...partners.values());
  return orbitSky({
    chains: [{ selector: hub, value: top * 3, name: chainName(names, hub) }, ...[...partners].map(([selector, value]) => ({ selector, value, name: chainName(names, selector) }))],
    lanes: lanes.map((l) => ({ src: l.src, dst: l.dst, usd: l.usd + l.messages })),
    seed: dayNumber(to),
    ...extra,
  });
}

export const PILLS = {
  gold: { from: '#ffcf5a', to: '#ff9f43', ink: '#1a1205' },
  welcome: { from: '#7de3ff', to: '#4a7ff0', ink: '#04101f' },
  violet: { from: '#c6a8ff', to: '#7d5cff', ink: '#120a26' },
  green: { from: '#7fd4a0', to: '#2bb673', ink: '#04160c' },
} as const;

export function pill(text: string, colors: (typeof PILLS)[keyof typeof PILLS], icon: GlyphName | null = null): VNode {
  return row([icon ? glyph(icon, 18, colors.ink, { right: 8 }) : null, text], {
    alignSelf: 'flex-start', padding: '8px 16px', borderRadius: 999, backgroundImage: `linear-gradient(90deg, ${colors.from}, ${colors.to})`,
    color: colors.ink, fontWeight: 800, fontSize: 20, letterSpacing: 3,
  });
}

export const MOMENT_COLUMN_WIDTH = 660;

/** The left text column of a moment card, on the open sky. */
export function momentColumn(...children: (VNode | null)[]): VNode {
  return h('div', { style: { position: 'absolute', left: 52, top: 118, width: MOMENT_COLUMN_WIDTH, display: 'flex', flexDirection: 'column' } }, ...children);
}

/** A name or figure at headline size, with a soft glow. */
export function bigText(text: string, size: number, glow = 'rgba(74,127,240,0.45)'): VNode {
  return h('div', { style: { fontSize: size, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05, color: '#ffffff', textShadow: `0 0 40px ${glow}`, marginTop: 6, maxWidth: MOMENT_COLUMN_WIDTH } }, text);
}

/** A line inside the text column that wraps instead of running into the sky. */
export function columnLine(children: readonly Child[], style: Record<string, unknown> = {}): VNode {
  return row(children, { marginTop: 10, alignSelf: 'flex-start', maxWidth: MOMENT_COLUMN_WIDTH, flexWrap: 'wrap', fontSize: 26, color: COLORS.muted, ...style });
}

/** Headline size for a record or milestone figure. */
export function bigSize(text: string): number {
  return text.length <= 7 ? 132 : text.length <= 10 ? 104 : 80;
}

/** Headline size for a name: large for a short one, smaller as it grows, so it stays on one line in the column. */
export function nameSize(text: string): number {
  return text.length <= 9 ? 96 : text.length <= 14 ? 72 : 52;
}
