import type { PegFile, PegHistoryFile } from '@ccip-dev/core/public';
import { formatCount } from './format';

type Side = 'discount' | 'premium';
type Row = PegHistoryFile['hours'][number];
type Marker = PegHistoryFile['markers'][number];
type Episode = PegHistoryFile['episodes'][number];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const DAY_MS = 86_400_000;
const unit = (n: number, word: string) => `${formatCount(n)} ${word}${n === 1 ? '' : 's'}`;

export function formatGap(gap: number): string {
  const pct = (Math.abs(gap) * 100).toFixed(2);
  return pct === '0.00' ? '0.00%' : `${gap < 0 ? '−' : '+'}${pct}%`;
}

export const priceText = (spot: number) => `1 stLINK = ${spot.toFixed(5)} LINK`;
export const linkAmount = (n: number) => (n < 100 ? n.toFixed(1) : formatCount(n));

export function utcStamp(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

const shortDay = (iso: string) => `${MONTHS[new Date(iso).getUTCMonth()]} ${new Date(iso).getUTCDate()}`;

export function activeSide(gap: number): Side | null {
  return gap < 0 ? 'discount' : gap > 0 ? 'premium' : null;
}

export interface RouteRow {
  label: string;
  value: string;
}

export function routeRows(peg: PegFile, side: Side, now: Date): RouteRow[] {
  const r = peg[side];
  const curve = r.depth === null || r.profit === null ? 'no size after fees' : `up to ${linkAmount(r.depth)} ${side === 'discount' ? 'LINK' : 'stLINK'} · +${r.profit.toFixed(2)} LINK`;
  const tradeable = r.tradeable > 0 ? `${linkAmount(r.tradeable)} LINK${r.tradeable_profit === null ? '' : ` · +${r.tradeable_profit.toFixed(2)} LINK`}` : 'none';
  if (side === 'discount') {
    const window = peg.discount.claim_window_open ? '' : ' · no claim window open';
    const payout = Date.parse(peg.discount.next_payout_after) > now.getTime() ? `next payout after ${utcStamp(peg.discount.next_payout_after)}` : 'payout possible in the next claim window';
    return [
      { label: 'Curve, under 1:1', value: curve },
      { label: 'Redeem at 1:1 now', value: `${linkAmount(r.instant)} LINK` },
      { label: 'Tradeable now', value: tradeable },
      { label: 'Withdrawal queue', value: `${linkAmount(r.queued_ahead)} stLINK ahead · ${payout}${window}` },
    ];
  }
  return [
    { label: 'Curve, over 1:1', value: curve },
    { label: 'Mint at 1:1 now', value: `${linkAmount(r.instant)} LINK` },
    { label: 'Tradeable now', value: tradeable },
    { label: 'Deposit queue', value: r.queued_ahead > 0 ? `${linkAmount(r.queued_ahead)} LINK ahead` : 'empty' },
  ];
}

export type PegRange = '7D' | '30D' | '1Y' | 'All';
export const PEG_RANGES: readonly PegRange[] = ['7D', '30D', '1Y', 'All'];

export function rangeRows(history: PegHistoryFile, range: PegRange, now: Date): Row[] {
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
  switch (range) {
    case '7D':
      return history.hours.filter((r) => r[0] >= since(7));
    case '30D':
      return history.hours.filter((r) => r[0] >= since(30));
    case '1Y':
      return history.days.filter((r) => r[0] >= since(365));
    case 'All':
      return history.days;
  }
}

export function markerLabel(m: Marker): string {
  return m.kind === 'stakelink_unbonding' ? `${formatCount(m.vaults)} stake.link vaults began unbonding` : `stake.link vaults staked ${formatCount(m.link ?? 0)} LINK`;
}

export interface GapChart {
  path: string;
  zeroY: number;
  bands: { y: number; line: number }[];
  ticks: { y: number; label: string }[];
  points: { x: number; y: number; row: Row }[];
  spans: { x0: number; x1: number; side: Side }[];
  pins: { x: number; label: string }[];
}

export interface GapChartOptions {
  width: number;
  height: number;
  pad: { top: number; right: number; bottom: number; left: number };
  thresholds: { private: number; public: number };
  episodes: readonly Episode[];
  markers: readonly Marker[];
}

/** Closes as a line around zero; the scale is symmetric so a discount and a premium of the same size look the same. */
export function gapChart(rows: readonly Row[], o: GapChartOptions): GapChart | null {
  if (rows.length === 0) return null;
  const t0 = Date.parse(rows[0]![0]);
  const t1 = Date.parse(rows.at(-1)![0]);
  const innerW = o.width - o.pad.left - o.pad.right;
  const innerH = o.height - o.pad.top - o.pad.bottom;
  const reach = Math.max(o.thresholds.public * 1.25, ...rows.flatMap((r) => [Math.abs(r[2] - 1), Math.abs(r[3] - 1)]));
  const x = (ms: number) => o.pad.left + (t1 === t0 ? innerW : ((ms - t0) / (t1 - t0)) * innerW);
  const y = (gap: number) => o.pad.top + ((reach - gap) / (2 * reach)) * innerH;
  const points = rows.map((row) => ({ x: x(Date.parse(row[0])), y: y(row[4] - 1), row }));
  const clamp = (ms: number) => Math.min(Math.max(ms, t0), t1);
  return {
    path: points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' '),
    zeroY: y(0),
    bands: [o.thresholds.public, o.thresholds.private, -o.thresholds.private, -o.thresholds.public].map((line) => ({ y: y(line), line })),
    ticks: [reach, 0, -reach].map((g) => ({ y: y(g), label: formatGap(g) })),
    points,
    spans: o.episodes
      .filter((e) => Date.parse(e.end ?? rows.at(-1)![0]) >= t0 && Date.parse(e.start) <= t1)
      .map((e) => ({ x0: x(clamp(Date.parse(e.start))), x1: x(clamp(Date.parse(e.end ?? rows.at(-1)![0]))), side: e.side })),
    pins: o.markers.filter((m) => Date.parse(m.hour) >= t0 && Date.parse(m.hour) <= t1).map((m) => ({ x: x(Date.parse(m.hour)), label: markerLabel(m) })),
  };
}

export function nearestPoint(chart: GapChart, px: number): number {
  let best = 0;
  for (const [i, p] of chart.points.entries()) if (Math.abs(p.x - px) < Math.abs(chart.points[best]!.x - px)) best = i;
  return best;
}

export function recordsView(history: PegHistoryFile, now: Date): RouteRow[] {
  const r = history.records;
  const rows: RouteRow[] = [];
  if (r.deepest_discount) rows.push({ label: 'Deepest discount', value: `${formatGap(r.deepest_discount.gap)} · ${utcStamp(r.deepest_discount.hour)}` });
  if (r.highest_premium) rows.push({ label: 'Highest premium', value: `${formatGap(r.highest_premium.gap)} · ${utcStamp(r.highest_premium.hour)}` });
  if (r.longest) rows.push({ label: 'Longest episode', value: `${unit(r.longest.hours, 'hour')} · ${r.longest.side} from ${shortDay(r.longest.start)}` });
  if (r.last_end && history.episodes.at(-1)?.end !== null) {
    const days = Math.floor((now.getTime() - Date.parse(r.last_end)) / DAY_MS);
    rows.push({ label: 'Since the last one', value: days === 0 ? 'today' : unit(days, 'day') });
  }
  return rows;
}

export interface EpisodeRow {
  side: Side;
  when: string;
  length: string;
  peak: string;
}

export function episodeRows(history: PegHistoryFile, limit = 10): EpisodeRow[] {
  return [...history.episodes]
    .reverse()
    .slice(0, limit)
    .map((e) => ({ side: e.side, when: shortDay(e.start), length: `${formatCount(e.hours)}h${e.end === null ? ', running' : ''}`, peak: formatGap(e.peak_gap) }));
}
