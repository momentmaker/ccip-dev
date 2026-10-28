import type { MomentsFile } from '@ccip-dev/core/public';
import { feeThresholds, formatThresholdUsd, messageThresholds, valueThresholds, type MilestoneMetric } from './records';

const DAY_MS = 86_400_000;
/** Below two hours into the UTC day, a pace is mostly noise. */
export const MIN_PACE_FRACTION = 2 / 24;
const PACE_DAYS = 7;

export interface CountedDay {
  day: string;
  messages: number;
  usd_value: number;
  fee_usd: number | null;
}

export interface AllTimeTotals {
  messages: number;
  usd: number;
  fees: number;
}

export interface AllTimeBase extends AllTimeTotals {
  /** The last day history.json holds; the live days after it are added on top. */
  through: string | null;
}

export interface Landed {
  /** updated_at of the live.json the message first appeared in. The Worker writes live.json and today.json in one run with one timestamp, so any today.json at or after it counts the message. */
  seenIn: string;
  usd: number;
}

/** The sum of the landed messages today.json does not count yet. */
export function landedSince(landed: ReadonlyMap<string, Landed>, todayUpdatedAt: string): { messages: number; usd: number } {
  let messages = 0;
  let usd = 0;
  for (const m of landed.values()) {
    if (m.seenIn <= todayUpdatedAt) continue;
    messages += 1;
    usd += m.usd;
  }
  return { messages, usd };
}

export const metricTotal = (t: AllTimeTotals, metric: MilestoneMetric): number => (metric === 'messages' ? t.messages : metric === 'value' ? t.usd : t.fees);

export function allTimeBase(days: readonly CountedDay[]): AllTimeBase {
  let through: string | null = null;
  const totals = { messages: 0, usd: 0, fees: 0 };
  for (const d of days) {
    totals.messages += d.messages;
    totals.usd += d.usd_value;
    totals.fees += d.fee_usd ?? 0;
    if (through === null || d.day > through) through = d.day;
  }
  return { ...totals, through };
}

/**
 * All-time totals as of now: history.json, then the live days it does not hold yet (today, and yesterday between midnight
 * and the next site build), then the messages that landed in the sky since today.json was last read.
 */
export function liveAllTime(base: AllTimeBase, live: readonly (CountedDay | null)[], extra: { messages: number; usd: number } = { messages: 0, usd: 0 }): AllTimeTotals {
  const out = { messages: base.messages + extra.messages, usd: base.usd + extra.usd, fees: base.fees };
  const seen = new Set<string>();
  for (const d of live) {
    if (d === null || seen.has(d.day) || (base.through !== null && d.day <= base.through)) continue;
    seen.add(d.day);
    out.messages += d.messages;
    out.usd += d.usd_value;
    out.fees += d.fee_usd ?? 0;
  }
  return out;
}

const LADDER_START: Record<MilestoneMetric, number> = { messages: 1_000, value: 1e9, fees: 1e6 };

function ladder(metric: MilestoneMetric, max: number): number[] {
  if (metric === 'messages') return messageThresholds(max);
  if (metric === 'value') return valueThresholds(max);
  return feeThresholds(max, LADDER_START.fees);
}

/** The milestones the Records page counts, as a total climbs: the last one at or below it and the next one above. */
export function milestoneBounds(metric: MilestoneMetric, total: number): { previous: number; next: number } {
  const rungs = ladder(metric, Math.max(total, LADDER_START[metric]) * 10);
  const next = rungs.find((t) => t > total) ?? LADDER_START[metric];
  const previous = [...rungs].reverse().find((t) => t <= total) ?? 0;
  return { previous, next };
}

export interface MilestoneGoal {
  metric: MilestoneMetric;
  total: number;
  previous: number;
  next: number;
  /** The way from the previous milestone to the next, 0 to 1. */
  progress: number;
  perDay: number | null;
  daysLeft: number | null;
}

export function milestoneGoal(metric: MilestoneMetric, total: number, perDay: number | null): MilestoneGoal {
  const { previous, next } = milestoneBounds(metric, total);
  const progress = next > previous ? Math.min(1, Math.max(0, (total - previous) / (next - previous))) : 0;
  const daysLeft = perDay !== null && perDay > 0 ? (next - total) / perDay : null;
  return { metric, total, previous, next, progress, perDay, daysLeft };
}

/** Each metric's daily pace: moments.json's countdown pace where it has one, else the average of history's last 7 days. */
export function dailyPaces(moments: Pick<MomentsFile, 'countdowns'> | null, days: readonly CountedDay[]): Record<MilestoneMetric, number | null> {
  const recent = [...days].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-PACE_DAYS);
  const average = (pick: (d: CountedDay) => number) => (recent.length === 0 ? null : recent.reduce((s, d) => s + pick(d), 0) / recent.length);
  const fromMoments = (metric: MilestoneMetric) => moments?.countdowns.find((c) => c.metric === metric)?.per_day ?? null;
  return {
    messages: fromMoments('messages') ?? average((d) => d.messages),
    value: fromMoments('value') ?? average((d) => d.usd_value),
    fees: fromMoments('fees') ?? average((d) => d.fee_usd ?? 0),
  };
}

/** The goal to show in the hero: the one closest in time, the value milestone winning a tie. */
export function nearestGoal(goals: readonly MilestoneGoal[]): MilestoneGoal | null {
  let best: MilestoneGoal | null = null;
  for (const g of goals) {
    if (g.daysLeft === null) continue;
    if (best === null || g.daysLeft < best.daysLeft! || (g.daysLeft === best.daysLeft && g.metric === 'value')) best = g;
  }
  return best ?? goals.find((g) => g.metric === 'value') ?? null;
}

/** The milestone a total crossed today: above what the finalized days reached, at or below the live total. */
export function crossedToday(metric: MilestoneMetric, before: number, now: number): number | null {
  if (now <= before) return null;
  const { previous } = milestoneBounds(metric, now);
  return previous > before ? previous : null;
}

/** "~25 min", "~6 h", or the day, for a milestone ETA. */
export function etaText(daysLeft: number, nowMs: number, formatDay: (iso: string) => string): string {
  const minutes = daysLeft * 1440;
  if (minutes < 90) return `~${Math.max(1, Math.round(minutes))} min`;
  if (minutes < 36 * 60) return `~${Math.round(minutes / 60)} h`;
  return `~${formatDay(new Date(nowMs + daysLeft * DAY_MS).toISOString())}`;
}

/** How far through its UTC day `nowMs` is, 0 to 1. */
export function dayFraction(day: string, nowMs: number): number {
  return Math.min(1, Math.max(0, (nowMs - Date.parse(`${day}T00:00:00Z`)) / DAY_MS));
}

/** Where today is heading at its pace so far; null in the first two hours, when the pace is mostly noise. */
export function pacedTotal(soFar: number, fraction: number): number | null {
  return fraction >= MIN_PACE_FRACTION ? soFar / fraction : null;
}

/** A milestone as the cards name it: "2M" messages, "$25B" moved, "$2.5M" in fees. */
export function milestoneText(metric: MilestoneMetric, value: number): string {
  if (metric !== 'messages') return formatThresholdUsd(value);
  return value >= 1e6 ? `${value / 1e6}M` : value >= 1e3 ? `${value / 1e3}K` : String(value);
}
