import type { ReplayFile } from '@ccip-dev/core/public';
import { addDays } from '../../lib/days';
import { formatCount } from '../../lib/format';
import { shortChainName } from '../../lib/names';
import type { Milestone } from '../../lib/records';
import type { DayFlags, Warp } from './warp';

export type EventKind = 'join' | 'milestone' | 'record' | 'lane';

export interface DayEvent {
  kind: EventKind;
  dayIndex: number;
  label: string;
  selectors: string[];
}

export interface Card {
  kind: 'join' | 'record' | 'lane';
  time: number;
  start: number;
  end: number;
  label: string;
  selectors: string[];
  count: number;
}

export interface Slam {
  start: number;
  label: string;
}

export const JOIN_BATCH_S = 1.0;
export const CARD_S = 1.6;
export const CARD_MIN_S = 1.0;
export const CARD_MAX_LAG_S = 1.0;
export const SLAM_S = 1.4;
export const SLAM_MAX_LAG_S = 0.8;
export const RECORD_SKIP_DAYS = 30;
export const MAX_RECORDS = 3;

type Chain = ReplayFile['chains'][number];
const indexOf = (days: readonly string[]) => new Map(days.map((d, i) => [d, i]));
const byDay = (a: { day: string }, b: { day: string }) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);

export function joinEvents(chains: readonly Chain[], days: readonly string[]): DayEvent[] {
  const at = indexOf(days);
  return chains
    .flatMap((c) => {
      const i = at.get(c.first_day);
      return i === undefined ? [] : [{ kind: 'join' as const, dayIndex: i, label: shortChainName(c), selectors: [c.selector] }];
    })
    .sort((a, b) => a.dayIndex - b.dayIndex || (a.selectors[0]! < b.selectors[0]! ? -1 : 1));
}

function isHeadline(m: Milestone): boolean {
  if (m.threshold === null) return false;
  if (m.kind === 'chains') return m.threshold % 25 === 0;
  if (m.kind !== 'messages' && m.kind !== 'value') return false;
  const power = Math.log10(m.threshold);
  return Math.abs(power - Math.round(power)) < 1e-9;
}

export function milestoneEvents(milestones: readonly Milestone[], days: readonly string[]): DayEvent[] {
  const at = indexOf(days);
  return milestones.flatMap((m) => {
    const i = at.get(m.day);
    return !isHeadline(m) || i === undefined ? [] : [{ kind: 'milestone' as const, dayIndex: i, label: m.label, selectors: [] }];
  });
}

interface Jump {
  day: string;
  messages: number;
  ratio: number;
}

function withoutAdjacentDays(jumps: readonly Jump[]): Jump[] {
  const kept: Jump[] = [];
  for (const j of [...jumps].sort((a, b) => b.messages - a.messages || byDay(a, b))) {
    if (!kept.some((k) => k.day === addDays(j.day, 1) || k.day === addDays(j.day, -1))) kept.push(j);
  }
  return kept;
}

export function recordEvents(history: readonly { day: string; messages: number }[], days: readonly string[]): DayEvent[] {
  const at = indexOf(days);
  let best = 0;
  const jumps: Jump[] = [];
  [...history].sort(byDay).forEach((d, i) => {
    if (d.messages <= best) return;
    if (i >= RECORD_SKIP_DAYS && best > 0) jumps.push({ day: d.day, messages: d.messages, ratio: d.messages / best });
    best = d.messages;
  });
  return withoutAdjacentDays(jumps)
    .sort((a, b) => b.ratio - a.ratio || byDay(a, b))
    .slice(0, MAX_RECORDS)
    .flatMap((j) => {
      const i = at.get(j.day);
      return i === undefined ? [] : [{ kind: 'record' as const, dayIndex: i, label: `Record day · ${formatCount(j.messages)} messages`, selectors: [] }];
    })
    .sort((a, b) => a.dayIndex - b.dayIndex);
}

export function laneOpenEvents(replay: Pick<ReplayFile, 'chains' | 'lanes' | 'days'>, focus: string, days: readonly string[]): DayEvent[] {
  const at = indexOf(days);
  const focusIndex = replay.chains.findIndex((c) => c.selector === focus);
  if (focusIndex < 0) return [];
  const seen = new Set<number>();
  const out: DayEvent[] = [];
  for (const d of [...replay.days].sort(byDay)) {
    const i = at.get(d.day);
    if (i === undefined) continue;
    for (const [lane] of d.lanes) {
      const ends = replay.lanes[lane];
      if (!ends || (ends[0] !== focusIndex && ends[1] !== focusIndex)) continue;
      const partner = ends[0] === focusIndex ? ends[1] : ends[0];
      if (partner === focusIndex || seen.has(partner)) continue;
      seen.add(partner);
      const c = replay.chains[partner]!;
      out.push({ kind: 'lane', dayIndex: i, label: shortChainName(c), selectors: [c.selector] });
    }
  }
  return out;
}

export function dayFlags(events: readonly DayEvent[], dayCount: number): DayFlags[] {
  const flags = Array.from({ length: dayCount }, () => ({ join: false, milestone: false, record: false }));
  for (const e of events) {
    const f = flags[e.dayIndex];
    if (!f) continue;
    if (e.kind === 'join' || e.kind === 'lane') f.join = true;
    if (e.kind === 'milestone') f.milestone = true;
    if (e.kind === 'record') f.record = true;
  }
  return flags;
}

function cardLabel(kind: Card['kind'], names: readonly string[], focusName: string | null): string {
  if (kind === 'record') return names[0]!;
  if (kind === 'lane') {
    return names.length === 1 ? `${names[0]} ↔ ${focusName}` : `+${names.length} lanes to ${focusName}: ${names.slice(0, 3).join(' · ')}`;
  }
  if (names.length === 1) return `${names[0]} joins`;
  if (names.length === 2) return `${names[0]} and ${names[1]} join`;
  return `+${names.length} chains: ${names.slice(0, 3).join(' · ')}`;
}

interface Group {
  kind: Card['kind'];
  time: number;
  start: number;
  end: number;
  names: string[];
  selectors: string[];
}

export function scheduleCards(events: readonly DayEvent[], warp: Warp, focusName: string | null): Card[] {
  const timed = (kinds: readonly EventKind[]) =>
    events
      .filter((e): e is DayEvent & { kind: Card['kind'] } => kinds.includes(e.kind))
      .map((e) => ({ e, time: warp.dayStart(e.dayIndex) }))
      .sort((a, b) => a.time - b.time);
  const fitsBeforeEnd = (start: number) => start + CARD_MIN_S <= warp.end + 1e-9;
  const groups: Group[] = [];
  for (const { e, time } of timed(['join', 'lane'])) {
    const prev = groups.at(-1);
    const sameKind = prev !== undefined && prev.kind === e.kind;
    const wouldStart = prev ? Math.max(time, prev.start + CARD_MIN_S) : time;
    if (prev && sameKind && (time - prev.time < JOIN_BATCH_S || wouldStart - time > CARD_MAX_LAG_S)) {
      prev.names.push(e.label);
      prev.selectors.push(...e.selectors);
      continue;
    }
    const prevEnd = prev ? Math.max(prev.start + CARD_MIN_S, Math.min(prev.end, time)) : time;
    const start = Math.max(time, prevEnd);
    if (!fitsBeforeEnd(start)) continue;
    if (prev) prev.end = prevEnd;
    groups.push({ kind: e.kind, time, start, end: Math.min(start + CARD_S, warp.end), names: [e.label], selectors: [...e.selectors] });
  }
  for (const { e, time } of timed(['record'])) {
    const candidates = [time, ...groups.map((g) => g.end).filter((end) => end > time && end <= time + CARD_MAX_LAG_S)].sort((a, b) => a - b);
    const start = candidates.find((s) => fitsBeforeEnd(s) && groups.every((g) => s + CARD_MIN_S <= g.start + 1e-9 || s >= g.end - 1e-9));
    if (start === undefined) continue;
    const nextStart = Math.min(...groups.filter((g) => g.start >= start - 1e-9).map((g) => g.start));
    groups.push({ kind: 'record', time, start, end: Math.min(start + CARD_S, nextStart, warp.end), names: [e.label], selectors: [] });
  }
  return groups
    .sort((a, b) => a.start - b.start)
    .map((g) => ({
      kind: g.kind,
      time: g.time,
      start: g.start,
      end: g.end,
      label: cardLabel(g.kind, g.names, focusName),
      selectors: g.selectors.slice(0, 3),
      count: g.names.length,
    }));
}

export function scheduleSlams(events: readonly DayEvent[], warp: Warp): Slam[] {
  const out: Slam[] = [];
  for (const e of events.filter((x) => x.kind === 'milestone').sort((a, b) => a.dayIndex - b.dayIndex)) {
    const prev = out.at(-1);
    const day = warp.dayStart(e.dayIndex);
    const start = Math.max(day, prev ? prev.start + SLAM_S : -Infinity);
    if (start - day <= SLAM_MAX_LAG_S && start + SLAM_S <= warp.end + 1e-9) out.push({ start, label: e.label });
  }
  return out;
}
