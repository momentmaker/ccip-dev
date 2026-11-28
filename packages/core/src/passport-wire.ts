import { addDays } from './time';

/** R20: two agreeing readings may be at most this many days apart. */
export const WIRE_WINDOW_DAYS = 7;
/** R35: tokens beyond this many on one day share the summary record. */
export const WIRE_TOKEN_POSTS = 10;

export type WireResult = 'flagged' | 'clear' | 'not readable';
export type WireVerdict = Exclude<WireResult, 'not readable'>;

export interface WirePending {
  result: WireVerdict;
  day: string;
  correction: boolean;
}

/** One flag-capable result as stored. `announced` is null until a baseline or a confirmation sets it. */
export interface WireSettled {
  announced: WireResult | null;
  pending: WirePending | null;
  result: WireResult | null;
  method: number | null;
  day: string | null;
}

/** `before` is the state ahead of `day`'s first evaluation, so a second evaluation that day replaces the first. */
export interface WireUnitState extends WireSettled {
  before: WireSettled | null;
}

export const WIRE_UNREAD: WireUnitState = { announced: null, pending: null, result: null, method: null, day: null, before: null };

/**
 * `read` is true only when every row the result rests on was read today. `baseline` marks a first successful reading
 * (R33, R25) and the day a new row's arrival confirms (KTD14). `chainValuesChanged` says whether the party addresses,
 * limit switch, remote token or remote pools behind the result differ from the stored reading (KTD13).
 */
export type WireOutcome =
  | { read: false }
  | { read: true; result: WireResult; method: number; baseline: boolean; chainValuesChanged: boolean; corrected: boolean };

export interface WireEvent {
  kind: 'raised' | 'cleared';
  day: string;
  correction: boolean;
}

export type WireLog = 're-classified';

export interface WireStep {
  state: WireUnitState;
  event: WireEvent | null;
  log: WireLog | null;
}

const settledOf = ({ announced, pending, result, method, day }: WireSettled): WireSettled => ({ announced, pending, result, method, day });

const withinWindow = (from: string, to: string) => to <= addDays(from, WIRE_WINDOW_DAYS);

function eventFor(was: WireResult | null, now: WireVerdict, day: string, correction: boolean): WireEvent | null {
  if (now === 'flagged' && was !== 'flagged') return { kind: 'raised', day, correction };
  if (now === 'clear' && was === 'flagged') return { kind: 'cleared', day, correction };
  return null;
}

/** Whether a pending result posts once it confirms: a flag raised or cleared does, an arrival at clear from nothing readable does not. */
export function postsOnConfirm(announced: WireResult | null, pending: WireVerdict): boolean {
  return eventFor(announced, pending, '', false) !== null;
}

function settle(base: WireSettled, outcome: WireOutcome, today: string): { settled: WireSettled; event: WireEvent | null; log: WireLog | null } {
  if (!outcome.read) {
    const pending = base.pending && withinWindow(base.pending.day, today) ? base.pending : null;
    return { settled: { ...base, pending, day: today }, event: null, log: null };
  }

  const { result, method } = outcome;
  const read = { result, method, day: today };

  if (outcome.baseline) return { settled: { ...read, announced: result, pending: null }, event: null, log: null };

  const reclassified = base.result !== null && base.method !== null && base.method !== method && base.result !== result && !outcome.chainValuesChanged;
  if (reclassified) {
    const announced = result === 'not readable' ? base.announced : result;
    return { settled: { ...read, announced, pending: null }, event: null, log: 're-classified' };
  }

  if (result === 'not readable' || result === base.announced) return { settled: { ...read, announced: base.announced, pending: null }, event: null, log: null };

  const p = base.pending;
  if (p && p.result === result && withinWindow(p.day, today)) {
    const event = eventFor(base.announced, result, today, p.correction || outcome.corrected);
    return { settled: { ...read, announced: result, pending: null }, event, log: null };
  }

  return { settled: { ...read, announced: base.announced, pending: { result, day: today, correction: outcome.corrected } }, event: null, log: null };
}

/**
 * One day's outcome through KTD12 and KTD13. Unlike `stepPeg`, a day without a reading keeps the pending result until
 * no agreeing reading could still confirm it inside the seven-day window.
 */
export function stepWireUnit(state: WireUnitState, outcome: WireOutcome, today: string): WireStep {
  const base = state.day === today && state.before ? state.before : settledOf(state);
  const { settled, event, log } = settle(base, outcome, today);
  return { state: { ...settled, before: base }, event, log };
}

export interface ArrivalReading {
  day: string;
  flags: readonly string[];
}

/** A row first seen after the watermark whose arrival has not confirmed yet. `readings` are its successful readings. */
export interface ArrivingRow {
  row: string;
  chain: string;
  groupId: string;
  firstSeen: string;
  readableByDesign: boolean;
  readings: readonly ArrivalReading[];
}

/** A row already announced, by launch baseline or an earlier arrival, with the number of flags it carries. */
export interface SettledRow {
  groupId: string;
  chain: string;
  flags: number;
}

export interface ArrivalChain {
  row: string;
  chain: string;
  readable: boolean;
  flags: string[];
}

export interface ArrivalItem {
  kind: 'new token' | 'new chain';
  groupId: string;
  chains: ArrivalChain[];
  otherChainFlags: number;
}

const sameFlags = (a: readonly string[], b: readonly string[]) => [...a].sort().join('\n') === [...b].sort().join('\n');

function confirmedChain(r: ArrivingRow, today: string): ArrivalChain | null {
  const unreadable: ArrivalChain = { row: r.row, chain: r.chain, readable: false, flags: [] };
  if (!r.readableByDesign) return today > r.firstSeen ? unreadable : null;
  if (r.readings.length === 0) return today >= addDays(r.firstSeen, WIRE_WINDOW_DAYS) ? unreadable : null;
  const readings = [...r.readings].sort((a, b) => a.day.localeCompare(b.day));
  const last = readings.at(-1)!;
  const prev = readings.at(-2);
  if (!prev || last.day !== today || prev.day >= today || !withinWindow(prev.day, today) || !sameFlags(prev.flags, last.flags)) return null;
  return { row: r.row, chain: r.chain, readable: true, flags: [...last.flags].sort() };
}

/**
 * KTD14 and KTD2: the arrivals that confirm today, one item per token. A row first seen on or before `since` was
 * baselined at launch and never arrives, and counts as an older row of its token.
 */
export function confirmArrivals(input: { today: string; since: string; arriving: readonly ArrivingRow[]; settled: readonly SettledRow[] }): ArrivalItem[] {
  const byGroup = new Map<string, ArrivalChain[]>();
  for (const r of input.arriving) {
    if (r.firstSeen <= input.since) continue;
    const chain = confirmedChain(r, input.today);
    if (chain) byGroup.set(r.groupId, [...(byGroup.get(r.groupId) ?? []), chain]);
  }
  return [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([groupId, chains]) => {
      const older = input.settled.some((s) => s.groupId === groupId) || input.arriving.some((r) => r.groupId === groupId && r.firstSeen <= input.since);
      const otherChainFlags = input.settled.filter((s) => s.groupId === groupId).reduce((sum, s) => sum + s.flags, 0);
      return {
        kind: older ? 'new chain' : 'new token',
        groupId,
        chains: chains.sort((a, b) => a.chain.localeCompare(b.chain) || a.row.localeCompare(b.row)),
        otherChainFlags,
      };
    });
}

export interface WireChange extends WireEvent {
  groupId: string;
  unit: string;
}

export interface PassportTokenRecord {
  id: string;
  day: string;
  kind: 'token';
  groupId: string;
  name: string;
  changes: WireChange[];
  arrivals: ArrivalItem[];
}

export interface PassportSummaryRecord {
  id: string;
  day: string;
  kind: 'summary';
  groupIds: string[];
  counts: { raised: number; cleared: number; newToken: number; newChain: number };
}

export type PassportPostRecord = PassportTokenRecord | PassportSummaryRecord;

const compareChange = (a: WireChange, b: WireChange) => a.unit.localeCompare(b.unit) || a.kind.localeCompare(b.kind);

const groupsOf = (r: PassportPostRecord): string[] => (r.kind === 'token' ? [r.groupId] : r.groupIds);

/**
 * KTD16, R34 and R35: one record per token for the first ten, flag changes ahead of arrivals and then by name, and
 * one summary record for the rest. Ids derive from the day, so a second evaluation that day replaces the records.
 * `kept` are the day's records already claimed or sent, which never change: their tokens keep their slots and are not
 * planned again, new token records fill only the slots left, and beside a kept summary a token that no longer fits
 * gets no record.
 */
export function planPassportPosts(input: {
  day: string;
  changes: readonly WireChange[];
  arrivals: readonly ArrivalItem[];
  names: Readonly<Record<string, string>>;
  kept: readonly PassportPostRecord[];
}): PassportPostRecord[] {
  const covered = new Set(input.kept.flatMap(groupsOf));
  const keptTokens = input.kept.filter((r): r is PassportTokenRecord => r.kind === 'token').sort((a, b) => a.id.localeCompare(b.id));
  const keptSummary = input.kept.find((r): r is PassportSummaryRecord => r.kind === 'summary');
  const groupIds = new Set([...input.changes.map((c) => c.groupId), ...input.arrivals.map((a) => a.groupId)].filter((g) => !covered.has(g)));
  const tokens: PassportTokenRecord[] = [...groupIds].map((groupId) => {
    const name = input.names[groupId];
    if (name === undefined) throw new Error(`planPassportPosts: no name for token group ${groupId}`);
    return {
      id: `${input.day}-${groupId}`,
      day: input.day,
      kind: 'token',
      groupId,
      name,
      changes: input.changes.filter((c) => c.groupId === groupId).sort(compareChange),
      arrivals: input.arrivals.filter((a) => a.groupId === groupId).sort((a, b) => a.kind.localeCompare(b.kind)),
    };
  });
  tokens.sort((a, b) => Number(b.changes.length > 0) - Number(a.changes.length > 0) || a.name.localeCompare(b.name) || a.groupId.localeCompare(b.groupId));

  const slots = Math.max(0, WIRE_TOKEN_POSTS - keptTokens.length);
  const posted = [...keptTokens, ...tokens.slice(0, slots)];
  const rest = tokens.slice(slots);
  if (keptSummary !== undefined) return [...posted, keptSummary];
  if (rest.length === 0) return posted;

  const changes = rest.flatMap((t) => t.changes);
  const arrivals = rest.flatMap((t) => t.arrivals);
  const summary: PassportSummaryRecord = {
    id: `${input.day}-summary`,
    day: input.day,
    kind: 'summary',
    groupIds: rest.map((t) => t.groupId),
    counts: {
      raised: changes.filter((c) => c.kind === 'raised').length,
      cleared: changes.filter((c) => c.kind === 'cleared').length,
      newToken: arrivals.filter((a) => a.kind === 'new token').length,
      newChain: arrivals.filter((a) => a.kind === 'new chain').length,
    },
  };
  return [...posted, summary];
}
