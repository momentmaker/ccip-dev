import { formatCount, formatDuration, formatFeeTotal, formatShare, formatUsd } from '@ccip-dev/core/format';
import type { IntelLane, SitrepCard } from '@ccip-dev/core/linkmarine';
import { h, type VNode } from '../h';
import { artLayer, at, DOT_FILTER, font, INK, MONO, onCurve, pulse, px, r1 } from './art';
import { chainHexFrame, chainHexIcon, chainHexUnder, chainLabel, NO_ART, type ChainArt } from './chain-hex';
import { b, bend, BLUE_TEXT, bulletRow, caption, capWeekday, change, clock, daySeed, eyebrow, intelFrame, textRow } from './intel-frame';

const RADAR = { x: 590, y: 215 };
/** Where the lanes' chains sit, busiest first, around the radar. */
export const LANE_SLOTS: readonly { x: number; y: number }[] = [
  { x: 585, y: 120 }, { x: 690, y: 215 }, { x: 520, y: 300 }, { x: 665, y: 330 }, { x: 478, y: 172 }, { x: 722, y: 110 }, { x: 600, y: 232 }, { x: 728, y: 300 },
];
const CHAIN_R = 26;
const DAY_MS = 86_400_000;

/** A projection rounded to three figures, as "~1,430" reads. */
export function roughCount(n: number): number {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, n))) - 2);
  return Math.round(n / step) * step;
}

/** The share of the UTC day gone at `iso`. */
export function dayFraction(iso: string): number {
  const t = Date.parse(iso);
  return (t - Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`)) / DAY_MS;
}

/** The lanes that fit, with each end's slot: chains take slots by the value of their lanes, the busiest first. */
export function placeLanes(lanes: readonly IntelLane[]): { lane: IntelLane; a: { x: number; y: number }; b: { x: number; y: number } }[] {
  const weight = new Map<string, number>();
  for (const l of lanes) for (const c of [l.src, l.dst]) weight.set(c.selector, (weight.get(c.selector) ?? 0) + l.usd);
  const order = [...weight].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map(([s]) => s);
  const slot = new Map(order.slice(0, LANE_SLOTS.length).map((s, i) => [s, LANE_SLOTS[i]!]));
  return lanes.flatMap((lane) => {
    const a = slot.get(lane.src.selector);
    const b = slot.get(lane.dst.selector);
    return a && b ? [{ lane, a, b }] : [];
  });
}

function radarSvg(placed: ReturnType<typeof placeLanes>, arts: ReadonlyMap<string, ChainArt>, fraction: number): { under: string; over: string; defs: string; labels: { x: number; y: number; text: string }[] } {
  const rings = [60, 110, 160, 210].map((r, i) => `<circle cx="${RADAR.x}" cy="${RADAR.y}" r="${r}" fill="none" stroke="${INK.ccip}" stroke-opacity="${[0.25, 0.2, 0.14, 0.08][i]}" stroke-width="1"/>`).join('');
  const sweep = `<path d="M${RADAR.x} ${RADAR.y} L ${RADAR.x + 160} ${RADAR.y} A 160 160 0 0 0 ${RADAR.x + 113} ${RADAR.y - 113} Z" fill="url(#sweep)"/><line x1="${RADAR.x}" y1="${RADAR.y}" x2="${RADAR.x + 113}" y2="${RADAR.y - 113}" stroke="${INK.up}" stroke-opacity="0.5" stroke-width="1.2"/>`;
  const max = Math.max(1, ...placed.map((p) => p.lane.usd));
  const ctrls = placed.map((p) => bend(p.a, p.b, 0.18));
  const lanes = placed
    .map((p, i) => `<path d="M${p.a.x} ${p.a.y} Q ${r1(ctrls[i]!.x)} ${r1(ctrls[i]!.y)} ${p.b.x} ${p.b.y}" stroke="${i < 2 ? INK.gold : INK.lane}" stroke-width="${r1(1.6 + 5.4 * (p.lane.usd / max))}" fill="none" opacity="0.8" stroke-linecap="round"/>`)
    .join('');
  const mids = placed.map((p, i) => onCurve(p.a, ctrls[i]!, p.b, 0.5));
  const chains = new Map<string, { x: number; y: number }>();
  for (const p of placed) {
    chains.set(p.lane.src.selector, p.a);
    chains.set(p.lane.dst.selector, p.b);
  }
  const under = [...chains].map(([s, p], i) => chainHexUnder(`c${i}`, p.x, p.y, CHAIN_R, arts.get(s) ?? NO_ART));
  const barX = 30 + 700 * Math.min(1, Math.max(0, fraction));
  const bar = `<rect x="30" y="398" width="700" height="4" rx="2" fill="#ffffff14"/><rect x="30" y="398" width="${r1(barX - 30)}" height="4" rx="2" fill="${INK.ccip}"/><circle cx="${r1(barX)}" cy="400" r="5" fill="#fff" filter="url(#dot)"/><circle cx="${r1(barX)}" cy="400" r="3" fill="#fff"/>`;
  return {
    defs: `${DOT_FILTER}<linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${INK.up}" stop-opacity="0"/><stop offset="1" stop-color="${INK.up}" stop-opacity="0.22"/></linearGradient>${under.map((u) => u.defs).join('')}`,
    under: rings + sweep + lanes + mids.map((m) => pulse(m.x, m.y)).join('') + under.map((u) => u.body).join('') + bar,
    over: [...chains].map(([s, p]) => chainHexFrame(p.x, p.y, CHAIN_R, arts.get(s) ?? NO_ART)).join(''),
    labels: placed.slice(0, 3).map((p, i) => ({ x: mids[i]!.x, y: mids[i]!.y - 14, text: formatUsd(p.lane.usd) })),
  };
}

/** A lane's value in a dark pill above its pulse. */
export function laneLabel(x: number, y: number, text: string): VNode {
  const pill = h('div', { style: { ...font(MONO, 700, 10, INK.text), padding: `${px(2)}px ${px(6)}px`, borderRadius: px(6), backgroundColor: '#0a0f1ecc', border: '1px solid #ffffff1a' } }, text);
  return at(x - 40, y - 9, { width: px(80), height: px(18), justifyContent: 'center', alignItems: 'center' }, pill);
}

function paceRow(card: SitrepCard): VNode {
  if (!card.pace) return textRow(['early in the day'], { marginTop: px(12) });
  const rough = `~${formatCount(roughCount(card.pace.projected))}`;
  if (card.pace.yesterday === null || card.pace.yesterday <= 0) return textRow([`on pace for ${rough}`], { marginTop: px(12) });
  return textRow([change((card.pace.projected / card.pace.yesterday - 1) * 100, 0), ` on pace for ${rough} · yesterday `, b(formatCount(card.pace.yesterday))], { marginTop: px(12) });
}

/** /cciptoday: today so far, its pace against yesterday, and a radar over today's top lanes. */
export function sitrepTree(card: SitrepCard, arts: ReadonlyMap<string, ChainArt>): VNode {
  const placed = placeLanes(card.lanes.slice(0, 5));
  const radar = radarSvg(placed, arts, dayFraction(card.updatedAt));
  const chains = new Map(placed.flatMap((p) => [[p.lane.src.selector, { ...p.a, name: chainLabel(p.lane.src) }], [p.lane.dst.selector, { ...p.b, name: chainLabel(p.lane.dst) }]] as const));
  const live = h(
    'div',
    { style: { display: 'flex', alignItems: 'center', color: INK.live, marginRight: px(10) } },
    h('div', { style: { width: px(8), height: px(8), borderRadius: px(4), backgroundColor: '#ff4d5e', boxShadow: `0 0 ${px(10)}px #ff4d5e`, marginRight: px(6) } }),
    'LIVE',
  );
  return intelFrame(
    daySeed(card.updatedAt),
    [{ x: 608, y: 0, color: '#1d3a7a', stop: 0.55 }],
    { body: radar.under, defs: radar.defs },
    ...[...chains].map(([s, c]) => chainHexIcon(c.x, c.y, CHAIN_R, arts.get(s) ?? NO_ART, c.name)),
    artLayer(radar.over),
    eyebrow(30, 24, `SITREP · ${capWeekday(card.updatedAt)} · ${clock(card.updatedAt)}`, live),
    at(
      30,
      70,
      { flexDirection: 'column' },
      h('div', { style: { ...font('Inter', 900, 92, INK.text, -0.02), lineHeight: 0.9, ...BLUE_TEXT } }, formatCount(card.messages)),
      h('div', { style: { ...font('Inter', 700, 14, INK.sub), marginTop: px(8) } }, 'messages so far today'),
      paceRow(card),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', marginTop: px(11) } },
        bulletRow([b(formatUsd(card.usd)), ' moved']),
        bulletRow([b(formatFeeTotal(card.feesUsd)), ' in fees · ', b(formatShare(card.linkSharePct)), ' in LINK']),
        bulletRow([b(formatCount(card.senders)), ' senders · median delivery ', b(formatDuration(card.medianDeliveryS))]),
      ),
    ),
    caption(470, 58, 'TOP LANES TODAY'),
    ...radar.labels.map((l) => laneLabel(l.x, l.y, l.text)),
    caption(30, 376, '00:00'),
    caption(630, 376, '24:00 UTC', INK.muted, { width: px(100), justifyContent: 'flex-end' }),
  );
}
