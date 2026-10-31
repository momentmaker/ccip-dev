import { formatCount, formatFee, formatFeeTotal, formatShare, formatUsd } from './format';
import type { DayTotals, LargestFee, ReserveFile, TransferView } from './public';
import { MILESTONE_METRICS, RECORD_KINDS, type MilestoneMetric, type RecordKind, type RecordSet } from './records';
import { depositStreak, isDeposit, nextMilestone } from './reserve-pace';
import { addDays, isDay, weekStart } from './time';

export type BroadcastTarget =
  | { kind: 'daily'; day: string }
  | { kind: 'weekly'; monday: string }
  | { kind: 'record'; record: RecordKind; day: string }
  | { kind: 'milestone'; metric: MilestoneMetric; threshold: number }
  | { kind: 'reserve'; tx: string }
  | { kind: 'welcome'; selector: string }
  | { kind: 'newcomer'; key: string }
  | { kind: 'countdown'; metric: MilestoneMetric; threshold: number }
  | { kind: 'poll'; monday: string }
  | { kind: 'movers'; monday: string }
  | { kind: 'spotlight'; monday: string }
  | { kind: 'project'; monday: string }
  | { kind: 'roundup'; monday: string }
  | { kind: 'staking'; monday: string }
  | { kind: 'operator'; address: string; at: number };

/** The moments the daily budget counts, in the order they take its places. The poll is not among them: it always posts. */
export const BUDGETED_MOMENTS = ['welcome', 'newcomer', 'countdown', 'movers', 'spotlight', 'project', 'roundup'] as const;
export type BudgetedMoment = (typeof BUDGETED_MOMENTS)[number];
export type MomentTarget = Extract<BroadcastTarget, { kind: BudgetedMoment | 'poll' }>;

/** The month in review, posted as a video: it has no card, so it is not a BroadcastTarget and has no card path. */
export interface MonthlyTarget {
  kind: 'monthly';
  month: string;
}

/** Everything the Worker posts: a broadcast with a card, or the monthly video. */
export type PostTarget = BroadcastTarget | MonthlyTarget;

export function broadcastKey(t: PostTarget): string {
  switch (t.kind) {
    case 'monthly':
      return `broadcast:monthly:${t.month}`;
    case 'daily':
      return `broadcast:daily:${t.day}`;
    case 'weekly':
      return `broadcast:weekly:${t.monday}`;
    case 'record':
      return `broadcast:record:${t.record}:${t.day}`;
    case 'milestone':
      return `broadcast:milestone:${t.metric}:${t.threshold}`;
    case 'reserve':
      return `broadcast:reserve:${t.tx}`;
    case 'welcome':
      return `broadcast:welcome:${t.selector}`;
    case 'newcomer':
      return `broadcast:newcomer:${t.key}`;
    case 'countdown':
      return `broadcast:countdown:${t.metric}:${t.threshold}`;
    case 'poll':
    case 'movers':
    case 'spotlight':
    case 'project':
    case 'roundup':
    case 'staking':
      return `broadcast:${t.kind}:${t.monday}`;
    case 'operator':
      return `broadcast:operator:${t.address}:${t.at}`;
  }
}

/** The card's path under /og/, without ".png". */
export function broadcastCardPath(t: BroadcastTarget): string {
  switch (t.kind) {
    case 'daily':
      return `broadcast/daily/${t.day}`;
    case 'weekly':
      return `broadcast/weekly/${t.monday}`;
    case 'record':
      return `broadcast/record/${t.record}/${t.day}`;
    case 'milestone':
      return `broadcast/milestone/${t.metric}/${t.threshold}`;
    case 'reserve':
      return `broadcast/reserve/${t.tx}`;
    case 'welcome':
      return `broadcast/welcome/${t.selector}`;
    case 'newcomer':
      return `broadcast/newcomer/${t.key.replace(':', '/')}`;
    case 'countdown':
      return `broadcast/countdown/${t.metric}/${t.threshold}`;
    case 'poll':
    case 'movers':
    case 'spotlight':
    case 'project':
    case 'roundup':
    case 'staking':
      return `broadcast/${t.kind}/${t.monday}`;
    case 'operator':
      return `broadcast/operator/${t.address}/${t.at}`;
  }
}

const TX_RE = /^0x[0-9a-f]{64}$/;
const THRESHOLD_RE = /^[1-9]\d{0,15}$/;
const SELECTOR_RE = /^[1-9]\d{0,19}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** EVM and base58 addresses; an address of another shape gets no newcomer card. */
const NEWCOMER_ADDRESS_RE = /^[0-9A-Za-z]{1,128}$/;
const EVM_ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const UNIX_RE = /^[1-9]\d{8,10}$/;
const WEEKLY_MOMENTS = ['poll', 'movers', 'spotlight', 'project', 'roundup'] as const;
const oneOf = <T extends string>(list: readonly T[], value: string | undefined): value is T => value !== undefined && (list as readonly string[]).includes(value);

/** `parts` is a card path split on "/", starting with "broadcast". */
export function parseBroadcastPath(parts: readonly string[]): BroadcastTarget | null {
  const [head, kind, a, b, ...rest] = parts;
  if (head !== 'broadcast' || rest.length > 0 || a === undefined) return null;
  if (kind === 'daily' && b === undefined && isDay(a)) return { kind: 'daily', day: a };
  if (kind === 'weekly' && b === undefined && isDay(a) && weekStart(a) === a) return { kind: 'weekly', monday: a };
  if (kind === 'record' && oneOf(RECORD_KINDS, a) && b !== undefined && isDay(b)) return { kind: 'record', record: a, day: b };
  if (kind === 'milestone' && oneOf(MILESTONE_METRICS, a) && b !== undefined && THRESHOLD_RE.test(b)) return { kind: 'milestone', metric: a, threshold: Number(b) };
  if (kind === 'reserve' && b === undefined && TX_RE.test(a)) return { kind: 'reserve', tx: a };
  if (kind === 'welcome' && b === undefined && SELECTOR_RE.test(a)) return { kind: 'welcome', selector: a };
  if (kind === 'countdown' && oneOf(MILESTONE_METRICS, a) && b !== undefined && THRESHOLD_RE.test(b)) return { kind: 'countdown', metric: a, threshold: Number(b) };
  if (kind === 'newcomer' && b !== undefined && ((a === 'project' && SLUG_RE.test(b)) || (a === 'address' && NEWCOMER_ADDRESS_RE.test(b)))) return { kind: 'newcomer', key: `${a}:${b}` };
  if (oneOf(WEEKLY_MOMENTS, kind) && b === undefined && isDay(a) && weekStart(a) === a) return { kind, monday: a };
  if (kind === 'staking' && b === undefined && isDay(a) && weekStart(a) === a) return { kind: 'staking', monday: a };
  if (kind === 'operator' && EVM_ADDRESS_RE.test(a) && b !== undefined && UNIX_RE.test(b)) return { kind: 'operator', address: a, at: Number(b) };
  return null;
}

/** A newcomer can post only when its card path parses back to it. */
export function newcomerPathOk(key: string): boolean {
  return parseBroadcastPath(broadcastCardPath({ kind: 'newcomer', key }).split('/')) !== null;
}

export interface Delta {
  value: number | null;
  pct: number | null;
}

export interface DayTotalsFacts {
  day: string;
  messages: Delta;
  value: Delta;
  fees: Delta;
  linkSharePct: number | null;
  linkUsd: number | null;
  linkAmount: number | null;
}

export interface WeekTotalsFacts extends Omit<DayTotalsFacts, 'day'> {
  monday: string;
  sunday: string;
  /** Monday first; a day without fees counts 0. */
  feesByDay: number[];
}

type Figure = (d: DayTotals) => number | null;

const present = (rows: readonly DayTotals[], pick: Figure) => rows.flatMap((d) => {
  const v = pick(d);
  return v === null ? [] : [v];
});
const sumOf = (rows: readonly DayTotals[], pick: Figure) => {
  const values = present(rows, pick);
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
};
const meanOf = (rows: readonly DayTotals[], pick: Figure) => {
  const values = present(rows, pick);
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
};
const pctChange = (value: number | null, base: number | null) => (value === null || base === null || base === 0 ? null : ((value - base) / base) * 100);
const linkShare = (link: number | null, fees: number | null) => (link === null || fees === null || fees === 0 ? null : (link / fees) * 100);
const MESSAGES: Figure = (d) => d.messages;
const VALUE: Figure = (d) => d.usd_value;
const FEES: Figure = (d) => d.fee_usd;
const LINK_USD: Figure = (d) => d.fee_link_usd;
const LINK_AMOUNT: Figure = (d) => d.fee_link_amount ?? null;

/** A day's totals, each against the mean of the 7 days before it that have the figure. */
export function dayTotalsFacts(days: readonly DayTotals[], day: string): DayTotalsFacts | null {
  const row = days.find((d) => d.day === day);
  if (!row) return null;
  const prior = days.filter((d) => d.day >= addDays(day, -7) && d.day < day);
  const delta = (pick: Figure): Delta => ({ value: pick(row), pct: pctChange(pick(row), meanOf(prior, pick)) });
  return {
    day,
    messages: delta(MESSAGES),
    value: delta(VALUE),
    fees: delta(FEES),
    linkSharePct: linkShare(row.fee_link_usd, row.fee_usd),
    linkUsd: row.fee_link_usd,
    linkAmount: row.fee_link_amount ?? null,
  };
}

/** A Monday–Sunday week's totals against the week before. */
export function weekTotalsFacts(days: readonly DayTotals[], monday: string): WeekTotalsFacts | null {
  const sunday = addDays(monday, 6);
  const week = days.filter((d) => d.day >= monday && d.day <= sunday);
  if (week.length === 0) return null;
  const before = days.filter((d) => d.day >= addDays(monday, -7) && d.day < monday);
  const delta = (pick: Figure): Delta => ({ value: sumOf(week, pick), pct: pctChange(sumOf(week, pick), sumOf(before, pick)) });
  return {
    monday,
    sunday,
    messages: delta(MESSAGES),
    value: delta(VALUE),
    fees: delta(FEES),
    linkSharePct: linkShare(sumOf(week, LINK_USD), sumOf(week, FEES)),
    linkUsd: sumOf(week, LINK_USD),
    linkAmount: sumOf(week, LINK_AMOUNT),
    feesByDay: Array.from({ length: 7 }, (_, i) => week.find((d) => d.day === addDays(monday, i))?.fee_usd ?? 0),
  };
}

export function recordValueText(kind: RecordKind, value: number): string {
  switch (kind) {
    case 'messages':
      return formatCount(value);
    case 'value':
      return formatUsd(value);
    case 'fees':
      return formatFeeTotal(value);
    case 'largest_fee':
      return formatFee(value);
    case 'link_share':
      return formatShare(value);
  }
}

interface LeaderLike {
  key: string;
  messages: number;
  usd: number | null;
  fee_usd: number | null;
}

export interface RecordDriver {
  lane: string;
  messages: number;
  usd: number | null;
  feeUsd: number | null;
  symbol: string | null;
}

/** What drove a record: the day's top lane by fees for fees, its busiest lane for messages and value, the fee's own route for the largest fee. */
export function recordDriver(
  record: RecordSet,
  leaders: { lane: LeaderLike | null; fee_lane: LeaderLike | null } | null,
  largest: readonly LargestFee[],
): RecordDriver | null {
  if (record.kind === 'largest_fee') {
    const fee = largest.find((f) => f.day === record.day && f.fee_usd === record.value);
    return fee ? { lane: `${fee.src}>${fee.dst}`, messages: 1, usd: null, feeUsd: fee.fee_usd, symbol: fee.symbol } : null;
  }
  const lane = record.kind === 'fees' ? leaders?.fee_lane : record.kind === 'link_share' ? null : leaders?.lane;
  return lane ? { lane: lane.key, messages: lane.messages, usd: lane.usd, feeUsd: lane.fee_usd, symbol: null } : null;
}

export type TotalMetric = 'messages' | 'value' | 'fees' | 'link_amount';

export const RECORD_TOTAL: Record<RecordKind, TotalMetric> = { messages: 'messages', value: 'value', fees: 'fees', largest_fee: 'fees', link_share: 'link_amount' };

const TOTAL_PICKS: Record<TotalMetric, Figure> = { messages: MESSAGES, value: VALUE, fees: FEES, link_amount: LINK_AMOUNT };

export function allTimeTotal(metric: TotalMetric, days: readonly DayTotals[], day: string): number {
  return sumOf(days.filter((d) => d.day <= day), TOTAL_PICKS[metric]) ?? 0;
}

/** A file published before the deposit flag existed falls back to the same rule on the rounded amount. */
export function isDepositTransfer(t: TransferView): boolean {
  return t.deposit ?? isDeposit(t);
}

export const RESERVE_WEEKS_SHOWN = 11;
const AVERAGE_WEEKS = 4;
const round2 = (v: number) => Math.round(v * 100) / 100;

export interface ReserveDepositFacts {
  tx: string;
  ts: string;
  link: number;
  usdAtDeposit: number | null;
  usdNow: number | null;
  changePct: number | null;
  balanceLink: number;
  depositCount: number;
  streak: number;
  avgWeeklyLink: number | null;
  avgWeeklyUsd: number | null;
  /** How many weeks the averages cover: up to 4, fewer for a young Reserve. */
  averageWeeks: number;
  nextMilestone: { link: number; eta: string } | null;
  weeks: { week: string; link: number }[];
}

/** One deposit, as of its own time: the balance after it, the streak ending at it, the 4 weeks before its week and the milestone from then. */
export function reserveDepositFacts(reserve: Pick<ReserveFile, 'transfers' | 'weekly'>, tx: string): ReserveDepositFacts | null {
  const sorted = [...reserve.transfers].sort((a, b) => a.ts.localeCompare(b.ts));
  const at = sorted.findIndex((t) => t.tx === tx && isDepositTransfer(t));
  const deposit = sorted[at];
  if (at < 0 || deposit === undefined) return null;
  const upTo = sorted.slice(0, at + 1);
  const balance = round2(upTo.reduce((sum, t) => sum + (t.direction === 'in' ? t.link : -t.link), 0));
  const deposits = upTo.filter(isDepositTransfer);
  const week = weekStart(deposit.ts);
  const before = reserve.weekly.filter((w) => w.week < week).slice(-AVERAGE_WEEKS);
  const average = (pick: (w: ReserveFile['weekly'][number]) => number) =>
    before.length === 0 ? null : round2(before.reduce((sum, w) => sum + pick(w), 0) / before.length);
  const avgWeeklyLink = average((w) => w.link);
  return {
    tx,
    ts: deposit.ts,
    link: deposit.link,
    usdAtDeposit: deposit.usd,
    usdNow: deposit.value_now_usd,
    changePct: deposit.change_pct,
    balanceLink: balance,
    depositCount: deposits.length,
    streak: depositStreak(deposits.map((d) => d.ts)),
    avgWeeklyLink,
    avgWeeklyUsd: average((w) => w.usd),
    averageWeeks: before.length,
    nextMilestone: nextMilestone(balance, avgWeeklyLink, new Date(deposit.ts)),
    weeks: reserve.weekly.filter((w) => w.week <= week).slice(-RESERVE_WEEKS_SHOWN).map((w) => ({ week: w.week, link: w.link })),
  };
}
