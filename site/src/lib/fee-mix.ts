import type { DayTotals, ReserveFile } from '@ccip-dev/core/public';
import { addDays, weekStart } from '@ccip-dev/core/time';
import { linkShare } from './charts';
import { feesNote } from './records';

export type MixRange = '90d' | '1y' | 'all';
export const MIX_RANGES: readonly MixRange[] = ['90d', '1y', 'all'];
export const RANGE_WEEKS: Record<MixRange, number | null> = { '90d': 13, '1y': 52, all: null };
const WINDOW_DAYS = 30;

export type FeeMixKey = 'link' | 'native' | 'stable' | 'other';

/** The fee groups' labels and colors, shared by Reserve's weekly mix and the day pages' mix bar. */
export const FEE_MIX_SERIES: readonly { key: FeeMixKey; label: string; className: string }[] = [
  { key: 'link', label: 'LINK', className: 'series-link' },
  { key: 'native', label: 'Gas tokens', className: 'series-native' },
  { key: 'stable', label: 'Stablecoins', className: 'series-stable' },
  { key: 'other', label: 'Other', className: 'series-other' },
];

export interface DayMixPart {
  key: FeeMixKey;
  label: string;
  className: string;
  usd: number;
  pct: number;
}

export interface FeeWeek {
  week: string;
  fee_usd: number;
  mix: { link: number; native: number; stable: number; other: number } | null;
}

export interface MixWeek {
  week: string;
  link: number;
  native: number;
  stable: number;
  other: number;
}

export interface BesideWeek {
  week: string;
  fees_usd: number;
  deposits_usd: number;
}

export interface LinkDemandTiles {
  allTimeLink: number | null;
  linkSince: string | null;
  last30Link: number | null;
  last30Note: string | null;
  last30SharePct: number | null;
}

const byDay = (a: { day: string }, b: { day: string }) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);
const hasMix = (d: DayTotals) => d.fee_link_usd !== null && d.fee_native_usd != null && d.fee_stable_usd != null;

/** Complete weeks only: all seven days are in history and carry fees. A week's mix needs every day's group columns. */
export function weeklyFees(days: readonly DayTotals[]): FeeWeek[] {
  const byWeek = new Map<string, DayTotals[]>();
  for (const d of days) {
    const week = weekStart(d.day);
    const list = byWeek.get(week) ?? [];
    list.push(d);
    byWeek.set(week, list);
  }
  return [...byWeek.entries()]
    .filter(([, list]) => new Set(list.map((d) => d.day)).size === 7 && list.every((d) => d.fee_usd !== null))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([week, list]) => {
      const sum = (pick: (d: DayTotals) => number) => list.reduce((total, d) => total + pick(d), 0);
      const fee = sum((d) => d.fee_usd!);
      if (!list.every(hasMix)) return { week, fee_usd: fee, mix: null };
      const link = sum((d) => d.fee_link_usd!);
      const native = sum((d) => d.fee_native_usd!);
      const stable = sum((d) => d.fee_stable_usd!);
      // history.json rounds each value to cents, so the groups can exceed the fees by a cent a day.
      return { week, fee_usd: fee, mix: { link, native, stable, other: Math.max(0, fee - link - native - stable) } };
    });
}

export function mixWeeks(weeks: readonly FeeWeek[]): MixWeek[] {
  return weeks.flatMap((w) => (w.mix ? [{ week: w.week, ...w.mix }] : []));
}

/** Shares are of the four groups' sum, so they total 100% even when the rounded groups exceed the fees. */
export function dayFeeMix(d: DayTotals): DayMixPart[] | null {
  if (!d.fee_usd || d.fee_link_usd === null || d.fee_native_usd == null || d.fee_stable_usd == null) return null;
  const usd: Record<FeeMixKey, number> = {
    link: d.fee_link_usd,
    native: d.fee_native_usd,
    stable: d.fee_stable_usd,
    other: Math.max(0, d.fee_usd - d.fee_link_usd - d.fee_native_usd - d.fee_stable_usd),
  };
  const total = usd.link + usd.native + usd.stable + usd.other;
  return FEE_MIX_SERIES.map((s) => ({ ...s, usd: usd[s.key], pct: (usd[s.key] * 100) / total }));
}

export function feesBesideDeposits(weeks: readonly FeeWeek[], deposits: ReserveFile['weekly']): BesideWeek[] {
  const fees = new Map(weeks.map((w) => [w.week, w.fee_usd]));
  return deposits.filter((d) => fees.has(d.week)).map((d) => ({ week: d.week, fees_usd: fees.get(d.week)!, deposits_usd: d.usd }));
}

export function weeksInRange<T extends { week: string }>(weeks: readonly T[], range: MixRange): T[] {
  const n = RANGE_WEEKS[range];
  const last = weeks.at(-1)?.week;
  if (n === null || last === undefined) return [...weeks];
  const from = addDays(last, -7 * (n - 1));
  return weeks.filter((w) => w.week >= from);
}

/** The first mix week, when the mix starts later than history's first full week, as the fees note does for fees. */
export function mixCoverageNote(days: readonly DayTotals[], weeks: readonly FeeWeek[]): string | null {
  const first = [...days].sort(byDay)[0]?.day;
  const firstMix = weeks.find((w) => w.mix !== null)?.week;
  if (first === undefined || firstMix === undefined) return null;
  return firstMix > weekStart(addDays(first, 6)) ? firstMix : null;
}

export function linkDemandTiles(days: readonly DayTotals[]): LinkDemandTiles {
  const sorted = [...days].sort(byDay);
  const withLink = sorted.filter((d) => d.fee_link_amount != null);
  const linkSince = withLink[0]?.day ?? null;
  const window = sorted.slice(-WINDOW_DAYS);
  const windowLink = window.filter((d) => d.fee_link_amount != null);
  const last = window.at(-1);
  return {
    allTimeLink: withLink.length === 0 ? null : withLink.reduce((sum, d) => sum + d.fee_link_amount!, 0),
    linkSince,
    last30Link: windowLink.length === 0 ? null : windowLink.reduce((sum, d) => sum + d.fee_link_amount!, 0),
    last30Note: feesNote(window, linkSince),
    last30SharePct: last ? linkShare(window, last.day, true) : null,
  };
}
