import { formatCount, formatPct, formatShare } from '@ccip-dev/core/format';
import { shortAddress } from '@ccip-dev/core/names';
import type { DayTotals, ReplayFile, TopFile } from '@ccip-dev/core/public';

export const CRE_DAYS = 90;

export const hasCreReplay = (replay: Pick<ReplayFile, 'cre'> | null): boolean => (replay?.cre?.length ?? 0) > 0;

export interface CrePoint {
  day: string;
  messages: number;
  sharePct: number;
}

export interface CreLeader {
  name: string;
  slug: string | null;
  messages: number;
}

export function creSeries(days: readonly DayTotals[], n = CRE_DAYS): CrePoint[] {
  return days.slice(-n).map((d) => {
    const messages = d.cre_messages ?? 0;
    return { day: d.day, messages, sharePct: d.messages > 0 ? (messages / d.messages) * 100 : 0 };
  });
}

/** The home CRE band's series and its last day (history.json's last finalized day), or null to hide the band: no CRE message in the series. */
export function creBand(days: readonly DayTotals[], n = CRE_DAYS): { series: CrePoint[]; latest: CrePoint } | null {
  const series = creSeries(days, n);
  const latest = series.at(-1);
  return latest !== undefined && series.some((p) => p.messages > 0) ? { series, latest } : null;
}

export const creTotal = (days: readonly DayTotals[]): number => days.reduce((n, d) => n + (d.cre_messages ?? 0), 0);

export function creLeaders(top: TopFile | null, projects: ReadonlySet<string>, limit = 5): CreLeader[] {
  return (top?.identities?.['30d'] ?? []).slice(0, limit).map((e) => {
    const slug = e.key.startsWith('project:') ? e.key.slice('project:'.length) : null;
    return { name: e.label ?? shortAddress(e.key.replace(/^address:/, '')), slug: slug !== null && projects.has(slug) ? slug : null, messages: e.messages };
  });
}

const STAT_DAYS = 30;
const MAX_TICK_STEPS = 3;
const BAR_RADIUS = 3;
const PEAK_EDGE = 0.15;

export interface CreStats {
  total: number;
  prior: number;
  changePct: number | null;
  perDay: number;
  sharePct: number;
  line: string;
}

const sumOf = (days: readonly DayTotals[], key: 'cre_messages' | 'messages'): number => days.reduce((n, d) => n + (d[key] ?? 0), 0);

/** The last 30 days of CRE messages against the 30 before, as the stat line above the chart. */
export function creStats(days: readonly DayTotals[]): CreStats {
  const recent = days.slice(-STAT_DAYS);
  const total = sumOf(recent, 'cre_messages');
  const prior = sumOf(days.slice(-2 * STAT_DAYS, -STAT_DAYS), 'cre_messages');
  const all = sumOf(recent, 'messages');
  const changePct = prior > 0 ? ((total - prior) / prior) * 100 : null;
  const perDay = Math.round(total / STAT_DAYS);
  const sharePct = all > 0 ? (total / all) * 100 : 0;
  const parts = [
    `Last ${STAT_DAYS} days: ${formatCount(total)} ${total === 1 ? 'message' : 'messages'}`,
    ...(changePct === null ? [] : [`${changePct < 0 ? '▼' : '▲'} ${formatPct(changePct, 0).replace(/^[+−]/, '')} vs the ${STAT_DAYS} before`]),
    `~${formatCount(perDay)} a day`,
    `${formatShare(sharePct)} of all CCIP`,
  ];
  return { total, prior, changePct, perDay, sharePct, line: parts.join(' · ') };
}

const MON_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const WEEKDAY_MON_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const MONTH = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' });
const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' });
const utcDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

export interface CreBar {
  day: string;
  messages: number;
  x: number;
  width: number;
  height: number;
  /** A bar with its top corners rounded, anchored to the baseline; empty for a zero day. */
  path: string;
  tip: string;
  columnX: number;
  columnWidth: number;
}

export interface CreTick {
  value: number;
  y: number;
}

export interface CreMonthLabel {
  label: string;
  x: number;
}

export interface CrePeak {
  index: number;
  x: number;
  y: number;
  label: string;
  anchor: 'start' | 'middle' | 'end';
}

export interface CreChart {
  bars: CreBar[];
  ticks: CreTick[];
  months: CreMonthLabel[];
  peak: CrePeak | null;
  max: number;
}

export interface CreBarsOptions {
  width: number;
  height: number;
  gap: number;
  /** The least distance between two month labels, in chart units. */
  monthGap: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The smallest 1, 2 or 5 times a power of ten that covers `max` in at most MAX_TICK_STEPS steps. */
function tickStep(max: number): number {
  for (let power = 1; ; power *= 10) {
    for (const base of [1, 2, 5]) {
      if (Math.ceil(max / (base * power)) <= MAX_TICK_STEPS) return base * power;
    }
  }
}

export const creTip = (p: Pick<CrePoint, 'day' | 'messages' | 'sharePct'>): string =>
  `${WEEKDAY_MON_DAY.format(utcDate(p.day))} · ${formatCount(p.messages)} CRE ${p.messages === 1 ? 'message' : 'messages'} · ${formatShare(p.sharePct)} of CCIP`;

function barPath(x: number, width: number, height: number, baseline: number): string {
  if (height <= 0) return '';
  const r = Math.min(BAR_RADIUS, width / 2, height);
  const top = round2(baseline - height);
  const [left, right] = [round2(x), round2(x + width)];
  return `M${left} ${baseline}V${round2(top + r)}A${r} ${r} 0 0 1 ${round2(left + r)} ${top}H${round2(right - r)}A${r} ${r} 0 0 1 ${right} ${round2(top + r)}V${baseline}Z`;
}

/** Geometry for the daily bars in a `width` × `height` plot: bars, y ticks from 0, month labels and the peak. */
export function creBars(series: readonly CrePoint[], { width, height, gap, monthGap }: CreBarsOptions): CreChart {
  const step = tickStep(Math.max(...series.map((p) => p.messages), 1));
  const peakMessages = Math.max(...series.map((p) => p.messages), 0);
  const max = Math.ceil(Math.max(peakMessages, 1) / step) * step;
  const slot = width / Math.max(series.length, 1);
  const bars = series.map((p, i) => {
    const barHeight = round2((p.messages / max) * height);
    const x = round2(i * slot + gap / 2);
    const barWidth = round2(Math.max(slot - gap, 1));
    return { day: p.day, messages: p.messages, x, width: barWidth, height: barHeight, path: barPath(x, barWidth, barHeight, height), tip: creTip(p), columnX: round2(i * slot), columnWidth: round2(slot) };
  });
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => ({ value: i * step, y: round2(height - ((i * step) / max) * height) }));

  const months: CreMonthLabel[] = [];
  series.forEach((p, i) => {
    if (!p.day.endsWith('-01')) return;
    const x = round2(i * slot);
    const previous = months.at(-1);
    if (previous === undefined || x - previous.x >= monthGap) months.push({ label: MONTH.format(utcDate(p.day)), x });
  });

  const peakIndex = series.findIndex((p) => p.messages === peakMessages);
  const peakPoint = series[peakIndex];
  const peakBar = bars[peakIndex];
  const peak =
    peakPoint === undefined || peakBar === undefined || peakMessages === 0
      ? null
      : {
          index: peakIndex,
          x: round2(peakBar.x + peakBar.width / 2),
          y: round2(height - peakBar.height),
          label: `${formatCount(peakMessages)} · ${MON_DAY.format(utcDate(peakPoint.day))}`,
          anchor: (peakBar.x + peakBar.width / 2 < width * PEAK_EDGE ? 'start' : peakBar.x + peakBar.width / 2 > width * (1 - PEAK_EDGE) ? 'end' : 'middle') as CrePeak['anchor'],
        };
  return { bars, ticks, months, peak, max };
}

/** Message totals per calendar month across the window, oldest first, for the chart's text alternative. */
export function creMonthTotals(series: readonly CrePoint[]): { month: string; messages: number }[] {
  const totals = new Map<string, number>();
  for (const p of series) {
    const month = MONTH_YEAR.format(utcDate(p.day));
    totals.set(month, (totals.get(month) ?? 0) + p.messages);
  }
  return [...totals].map(([month, messages]) => ({ month, messages }));
}

export function creSummary(series: readonly CrePoint[]): string {
  const total = series.reduce((n, p) => n + p.messages, 0);
  const peak = series.reduce<CrePoint | null>((best, p) => (best === null || p.messages > best.messages ? p : best), null);
  const latest = series.at(-1);
  const parts = [`${formatCount(total)} in total`];
  if (peak !== null && peak.messages > 0) parts.push(`peak ${formatCount(peak.messages)} on ${MON_DAY.format(utcDate(peak.day))}`);
  if (latest !== undefined) parts.push(`${formatCount(latest.messages)} on ${MON_DAY.format(utcDate(latest.day))}`);
  return `CRE-sent CCIP messages per day over the last ${series.length} days: ${parts.join(', ')}`;
}
