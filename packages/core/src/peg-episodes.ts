import { barRow, pegDays, type PegBar, type PegBarRow } from './peg';
import { linkUnits } from './staking';

export type PegSide = 'discount' | 'premium';

/** Fractions of 1 LINK: 0.003 is a 0.3% gap. */
export interface PegThresholds {
  private: number;
  public: number;
}

export const DEFAULT_PEG_THRESHOLDS: PegThresholds = { private: 0.003, public: 0.0075 };
export const PEG_TIERS = [0.01, 0.02, 0.05] as const;

export interface PegSample {
  at: string;
  gap: number;
}

export interface PegOpen {
  side: PegSide;
  openedAt: string;
  peakGap: number;
  peakAt: string;
  /** How many of PEG_TIERS have been announced. */
  tier: number;
  public: boolean;
}

export interface PegMachine {
  open: PegOpen | null;
  prev: PegSample | null;
}

export type PegEvent =
  | { kind: 'opened'; episode: PegOpen }
  | { kind: 'went_public'; episode: PegOpen }
  | { kind: 'tier'; episode: PegOpen; tier: number }
  | { kind: 'closed'; episode: PegOpen; closedAt: string };

export const pegSide = (gap: number): PegSide => (gap < 0 ? 'discount' : 'premium');

const farther = (a: PegSample, b: PegSample) => (Math.abs(b.gap) > Math.abs(a.gap) ? b : a);

/**
 * One sample through the episode rules. `confirm` samples in a row decide every change: 2 for the 5-minute checks, so one
 * trade's spike neither opens nor closes an episode, and 1 for hourly bars. A closing step can open the other side at once.
 */
export function stepPeg(machine: PegMachine, cur: PegSample, t: PegThresholds, confirm: 1 | 2): { machine: PegMachine; events: PegEvent[] } {
  const window: PegSample[] = confirm === 1 ? [cur] : machine.prev ? [machine.prev, cur] : [];
  const full = window.length === confirm;
  const events: PegEvent[] = [];
  let open = machine.open ? { ...machine.open } : null;

  if (open) {
    const side = open.side;
    if (pegSide(cur.gap) === side && Math.abs(cur.gap) > Math.abs(open.peakGap)) open = { ...open, peakGap: cur.gap, peakAt: cur.at };
    if (full && window.every((s) => Math.abs(s.gap) < t.private / 2 || pegSide(s.gap) !== side)) {
      events.push({ kind: 'closed', episode: open, closedAt: cur.at });
      open = null;
    }
  }

  const first = window[0];
  if (open === null && full && first && window.every((s) => Math.abs(s.gap) >= t.private && pegSide(s.gap) === pegSide(first.gap))) {
    const peak = window.reduce(farther);
    open = { side: pegSide(first.gap), openedAt: first.at, peakGap: peak.gap, peakAt: peak.at, tier: 0, public: false };
    events.push({ kind: 'opened', episode: { ...open } });
  }

  if (open) {
    const side = open.side;
    const beyond = (line: number) => full && window.every((s) => pegSide(s.gap) === side && Math.abs(s.gap) >= line);
    if (!open.public && beyond(t.public)) {
      open = { ...open, public: true };
      events.push({ kind: 'went_public', episode: { ...open } });
    }
    const tier = PEG_TIERS.reduce((reached, line, i) => (beyond(line) ? i + 1 : reached), 0);
    if (tier > open.tier) {
      open = { ...open, tier };
      events.push({ kind: 'tier', episode: { ...open }, tier: PEG_TIERS[tier - 1]! });
    }
  }

  return { machine: { open, prev: cur }, events };
}

export interface PegHistoryEpisode {
  side: PegSide;
  start: string;
  end: string | null;
  peak_gap: number;
  peak_at: string;
  hours: number;
}

const HOUR_MS = 3_600_000;

function historyEpisode(o: PegOpen, end: string | null, measuredTo: string): PegHistoryEpisode {
  return { side: o.side, start: o.openedAt, end, peak_gap: o.peakGap, peak_at: o.peakAt, hours: Math.round((Date.parse(measuredTo) - Date.parse(o.openedAt)) / HOUR_MS) };
}

/** Episodes on hourly closes, one bar confirming, so history before launch has them too. `bars` in hour order. */
export function pegEpisodesFromBars(bars: readonly PegBar[], t: PegThresholds): PegHistoryEpisode[] {
  const out: PegHistoryEpisode[] = [];
  let machine: PegMachine = { open: null, prev: null };
  for (const b of bars) {
    const step = stepPeg(machine, { at: b.hour, gap: b.close - 1 }, t, 1);
    for (const e of step.events) if (e.kind === 'closed') out.push(historyEpisode(e.episode, e.closedAt, e.closedAt));
    machine = step.machine;
  }
  const last = bars.at(-1);
  if (machine.open && last) out.push(historyEpisode(machine.open, null, last.hour));
  return out;
}

export interface PegExtreme {
  gap: number;
  hour: string;
}

export interface PegRecords {
  deepest_discount: PegExtreme | null;
  highest_premium: PegExtreme | null;
  longest: PegHistoryEpisode | null;
  last_end: string | null;
}

/** Extremes come from the bars' lows and highs, so a wick inside an hour counts. */
export function pegRecords(bars: readonly PegBar[], episodes: readonly PegHistoryEpisode[]): PegRecords {
  let deepest: PegExtreme | null = null;
  let highest: PegExtreme | null = null;
  for (const b of bars) {
    if (b.low < 1 && (deepest === null || b.low - 1 < deepest.gap)) deepest = { gap: b.low - 1, hour: b.hour };
    if (b.high > 1 && (highest === null || b.high - 1 > highest.gap)) highest = { gap: b.high - 1, hour: b.hour };
  }
  const longest = episodes.reduce<PegHistoryEpisode | null>((a, e) => (a === null || e.hours > a.hours ? e : a), null);
  const ended = episodes.filter((e) => e.end !== null);
  return { deepest_discount: deepest, highest_premium: highest, longest, last_end: ended.at(-1)?.end ?? null };
}

export type PegMarkerKind = 'stakelink_unbonding' | 'stakelink_deposit';

export interface PegMarker {
  hour: string;
  kind: PegMarkerKind;
  vaults: number;
  link: number | null;
}

export const PEG_HOURS_DAYS = 90;

export interface PegHistoryBody {
  hours: PegBarRow[];
  days: PegBarRow[];
  markers: PegMarker[];
  episodes: PegHistoryEpisode[];
  records: PegRecords;
}

export function pegHistoryBody(input: { bars: readonly PegBar[]; markers: readonly PegMarker[]; thresholds: PegThresholds; now: Date }): PegHistoryBody {
  const since = new Date(input.now.getTime() - PEG_HOURS_DAYS * 86_400_000).toISOString();
  const episodes = pegEpisodesFromBars(input.bars, input.thresholds);
  return {
    hours: input.bars.filter((b) => b.hour >= since).map(barRow),
    days: pegDays(input.bars).map(barRow),
    markers: input.markers.filter((m) => input.bars.length > 0 && m.hour >= input.bars[0]!.hour),
    episodes,
    records: pegRecords(input.bars, episodes),
  };
}

export interface PegMarkerEvent {
  blockNumber: number;
  ts: string;
  kind: 'staked' | 'unbonding';
  amount: string | null;
  holder: string | null;
}

/** The chart pins an hour when this many stake.link vaults began unbonding in it, or they staked this much LINK. */
export const PEG_MARKER_MIN_VAULTS = 10;
export const PEG_MARKER_MIN_LINK = 10_000;

/** Every hour's stake.link vault activity; the publish keeps the notable hours. Sums add across runs, so nothing is filtered here. */
export function pegMarkerHours(events: readonly PegMarkerEvent[]): PegMarker[] {
  const byKey = new Map<string, PegMarker>();
  for (const e of events) {
    if (e.holder !== 'stakelink') continue;
    const hour = `${e.ts.slice(0, 13)}:00:00.000Z`;
    const kind: PegMarkerKind = e.kind === 'unbonding' ? 'stakelink_unbonding' : 'stakelink_deposit';
    const m = byKey.get(`${hour}|${kind}`) ?? { hour, kind, vaults: 0, link: kind === 'stakelink_deposit' ? 0 : null };
    m.vaults += 1;
    if (m.link !== null && e.amount !== null) m.link += linkUnits(e.amount);
    byKey.set(`${hour}|${kind}`, m);
  }
  return [...byKey.values()].sort((a, b) => a.hour.localeCompare(b.hour) || a.kind.localeCompare(b.kind));
}
