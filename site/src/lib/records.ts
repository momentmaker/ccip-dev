import type { DayTotals, LargestFee } from '@ccip-dev/core/public';
import { formatCount, formatDuration, formatLink, formatUsd, linkShareText } from './format';
import { laneLabel, shortChainName, type ChainNames } from './names';

export type DayStats = Pick<DayTotals, 'day' | 'messages' | 'usd_value' | 'unique_senders' | 'fee_usd' | 'median_delivery_s'>;
export type RecordKey = 'busiest' | 'biggest' | 'senders' | 'fees' | 'fastest';

export interface DayRecord {
  key: RecordKey;
  title: string;
  day: string;
  value: number;
  display: string;
  note: string | null;
}

export type MilestoneKind = 'messages' | 'value' | 'fees' | 'fee_day' | 'chains' | 'join';

export interface Milestone {
  kind: MilestoneKind;
  day: string;
  label: string;
  threshold: number | null;
}

export interface RecordBreak {
  key: 'busiest' | 'biggest' | 'senders';
  text: string;
}

/** The first CCIP mainnet message's day; fee figures name their first day until fee data reaches back to it. */
export const FEE_DATA_START = '2023-07-06';

export const LINK_SHARE_MIN_MESSAGES = 100;
export const EXPLORER_MESSAGE_URL = 'https://ccip.chain.link/msg/';

export type FeeDayStats = DayStats & Pick<DayTotals, 'fee_link_usd' | 'fee_link_amount'>;
export type FeeRecordKey = 'most_fees' | 'largest_fee' | 'link_paid' | 'link_share';

export interface FeeRecord {
  key: FeeRecordKey;
  title: string;
  day: string;
  display: string;
  sub: string | null;
  explorerUrl: string | null;
}

export const FASTEST_MIN_MESSAGES = 100;
const KIND_ORDER: MilestoneKind[] = ['messages', 'value', 'fees', 'fee_day', 'chains', 'join'];
const CHAIN_STEP = 25;

interface RecordRule {
  key: RecordKey;
  title: string;
  note: string | null;
  pick: (d: DayStats) => number | null;
  better: (a: number, b: number) => boolean;
  display: (v: number) => string;
}

const RULES: RecordRule[] = [
  { key: 'busiest', title: 'Busiest day', note: null, pick: (d) => d.messages, better: (a, b) => a > b, display: (v) => `${formatCount(v)} messages` },
  { key: 'biggest', title: 'Biggest day', note: null, pick: (d) => d.usd_value, better: (a, b) => a > b, display: (v) => `${formatUsd(v)} moved` },
  { key: 'senders', title: 'Most senders', note: null, pick: (d) => d.unique_senders, better: (a, b) => a > b, display: (v) => `${formatCount(v)} senders` },
  { key: 'fees', title: 'Highest fees', note: null, pick: (d) => d.fee_usd, better: (a, b) => a > b, display: (v) => `${formatUsd(v)} in fees` },
  {
    key: 'fastest',
    title: 'Fastest delivery',
    note: `days with ${FASTEST_MIN_MESSAGES}+ messages`,
    pick: (d) => (d.messages >= FASTEST_MIN_MESSAGES ? d.median_delivery_s : null),
    better: (a, b) => a < b,
    display: (v) => `${formatDuration(v)} median`,
  },
];

const compareDay = (a: { day: string }, b: { day: string }) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);

/** The first day with fee data. Fees reach further back as the fee backfill loads, so this comes from the data. */
export function feesSince(days: readonly { day: string; fee_usd: number | null }[]): string | null {
  let first: string | null = null;
  for (const d of days) if (d.fee_usd !== null && (first === null || d.day < first)) first = d.day;
  return first;
}

export function feesNote(days: readonly { day: string }[], since: string | null): string | null {
  if (since === null || days.length === 0) return null;
  const firstShown = days.reduce((min, d) => (d.day < min ? d.day : min), days[0]!.day);
  return since > firstShown ? `since ${since}` : null;
}

export function feeChartRows<T extends { day: string }>(rows: T[], since: string | null): { rows: T[]; from: string | null } {
  if (since === null || rows.length === 0 || since <= rows[0]!.day) return { rows, from: null };
  return { rows: rows.filter((r) => r.day >= since), from: since };
}

/** The best day by `pick`, ties going to the earliest; `sorted` is in day order. */
function bestDay<T extends { day: string }>(
  sorted: readonly T[],
  pick: (d: T) => number | null | undefined,
  better: (a: number, b: number) => boolean = (a, b) => a > b,
): { day: string; value: number } | null {
  let best: { day: string; value: number } | null = null;
  for (const d of sorted) {
    const value = pick(d);
    if (value === null || value === undefined) continue;
    if (best === null || better(value, best.value)) best = { day: d.day, value };
  }
  return best;
}

export function computeRecords(days: readonly DayStats[]): DayRecord[] {
  const sorted = [...days].sort(compareDay);
  return RULES.flatMap((rule) => {
    const best = bestDay(sorted, rule.pick, rule.better);
    return best
      ? [{ key: rule.key, title: rule.title, day: best.day, value: best.value, display: rule.display(best.value), note: rule.key === 'fees' ? feesNote(sorted, feesSince(sorted)) : rule.note }]
      : [];
  });
}

export function computeFeeRecords(days: readonly FeeDayStats[], largest: readonly LargestFee[], names: ChainNames): FeeRecord[] {
  const sorted = [...days].sort(compareDay);
  const out: FeeRecord[] = [];
  const most = bestDay(sorted, (d) => d.fee_usd);
  if (most) out.push({ key: 'most_fees', title: 'Most fees in a day', day: most.day, display: formatUsd(most.value), sub: feesNote(sorted, feesSince(sorted)), explorerUrl: null });
  const top = largest[0];
  if (top) {
    out.push({
      key: 'largest_fee',
      title: 'Largest single fee',
      day: top.day,
      display: formatUsd(top.fee_usd),
      sub: `${laneLabel(names, `${top.src}>${top.dst}`)}${top.symbol ? ` · ${top.symbol}` : ''}`,
      explorerUrl: `${EXPLORER_MESSAGE_URL}${top.message_id}`,
    });
  }
  const link = bestDay(sorted, (d) => d.fee_link_usd);
  if (link) {
    const amount = sorted.find((d) => d.day === link.day)?.fee_link_amount;
    out.push({ key: 'link_paid', title: 'Most paid in LINK in a day', day: link.day, display: formatUsd(link.value), sub: amount == null ? null : formatLink(amount), explorerUrl: null });
  }
  const share = bestDay(sorted, (d) => (d.messages >= LINK_SHARE_MIN_MESSAGES && d.fee_usd && d.fee_link_usd !== null ? (d.fee_link_usd / d.fee_usd) * 100 : null));
  if (share) {
    out.push({ key: 'link_share', title: 'Highest LINK share in a day', day: share.day, display: linkShareText(share.value), sub: `days with ${LINK_SHARE_MIN_MESSAGES}+ messages`, explorerUrl: null });
  }
  return out;
}

export function messageThresholds(max: number): number[] {
  const out: number[] = [];
  for (let power = 1_000; power <= max; power *= 10) for (const m of [1, 2, 5]) if (m * power <= max) out.push(m * power);
  return out;
}

function steppedThresholds(max: number, from: number): number[] {
  const out: number[] = [];
  for (let power = from; power <= max; power *= 10) for (const m of [1, 2.5, 5]) if (m * power <= max) out.push(m * power);
  return out;
}

export function valueThresholds(max: number): number[] {
  return steppedThresholds(max, 1e9);
}

/** All-time fee totals step from $1M (from = 1e6), a day's fees from $10K (from = 1e4). */
export function feeThresholds(max: number, from: number): number[] {
  return steppedThresholds(max, from);
}

export function formatThresholdUsd(value: number): string {
  const [size, suffix] = value >= 1e12 ? [1e12, 'T'] : value >= 1e9 ? [1e9, 'B'] : value >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  const n = value / size;
  return `$${Number.isInteger(n) ? n : n.toFixed(1)}${suffix}`;
}

type MilestoneDay = Pick<DayStats, 'day' | 'messages' | 'usd_value'>;

function runningMilestones<T extends { day: string }>(
  sorted: readonly T[],
  thresholds: readonly number[],
  pick: (d: T) => number,
  kind: MilestoneKind,
  label: (t: number) => string,
): Milestone[] {
  const out: Milestone[] = [];
  let running = 0;
  let next = 0;
  for (const d of sorted) {
    running += pick(d);
    while (next < thresholds.length && running >= thresholds[next]!) {
      out.push({ kind, day: d.day, label: label(thresholds[next]!), threshold: thresholds[next]! });
      next += 1;
    }
  }
  return out;
}

export function sortMilestones(list: readonly Milestone[]): Milestone[] {
  return [...list].sort(
    (a, b) => compareDay(a, b) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.threshold ?? 0) - (b.threshold ?? 0),
  );
}

export function computeMilestones(
  days: readonly MilestoneDay[],
  chains: readonly { selector: string; name: string | null; display_name: string | null; first_day: string }[],
): Milestone[] {
  const sorted = [...days].sort(compareDay);
  const total = (pick: (d: MilestoneDay) => number) => sorted.reduce((sum, d) => sum + pick(d), 0);
  const out: Milestone[] = [
    ...runningMilestones(sorted, messageThresholds(total((d) => d.messages)), (d) => d.messages, 'messages', (t) => `${formatCount(t)} messages`),
    ...runningMilestones(sorted, valueThresholds(total((d) => d.usd_value)), (d) => d.usd_value, 'value', (t) => `${formatThresholdUsd(t)} moved`),
  ];
  const joined = [...chains].sort((a, b) => (a.first_day < b.first_day ? -1 : a.first_day > b.first_day ? 1 : 0));
  for (let n = CHAIN_STEP; n <= joined.length; n += CHAIN_STEP) {
    out.push({ kind: 'chains', day: joined[n - 1]!.first_day, label: `${n} chains`, threshold: n });
  }
  for (const c of joined) out.push({ kind: 'join', day: c.first_day, label: `${shortChainName(c)} joins`, threshold: null });
  return sortMilestones(out);
}

/** Empty until fee data starts at 2023-07-06: partial coverage would date a "first" too late, and the date would move as the backfill loads. */
export function computeFeeMilestones(days: readonly Pick<DayStats, 'day' | 'fee_usd'>[]): Milestone[] {
  if (feesSince(days) !== FEE_DATA_START) return [];
  const sorted = [...days].sort(compareDay);
  const fee = (d: Pick<DayStats, 'fee_usd'>) => d.fee_usd ?? 0;
  const total = sorted.reduce((sum, d) => sum + fee(d), 0);
  const maxDay = sorted.reduce((max, d) => Math.max(max, fee(d)), 0);
  const firstDays = feeThresholds(maxDay, 1e4).map(
    (t): Milestone => ({ kind: 'fee_day', day: sorted.find((d) => fee(d) >= t)!.day, label: `First ${formatThresholdUsd(t)} fee day`, threshold: t }),
  );
  return sortMilestones([...runningMilestones(sorted, feeThresholds(total, 1e6), fee, 'fees', (t) => `${formatThresholdUsd(t)} in fees`), ...firstDays]);
}

export function liveRecordBreaks(
  today: { day: string; messages: number; usd_value: number; unique_senders: number },
  records: readonly DayRecord[],
): RecordBreak[] {
  const best = (key: RecordKey) => records.find((r) => r.key === key && r.day !== today.day)?.value;
  const out: RecordBreak[] = [];
  const busiest = best('busiest');
  if (busiest !== undefined && today.messages > busiest) {
    out.push({ key: 'busiest', text: `New record: busiest day ever — ${formatCount(today.messages)} messages and counting` });
  }
  const biggest = best('biggest');
  if (biggest !== undefined && today.usd_value > biggest) {
    out.push({ key: 'biggest', text: `New record: biggest day ever — ${formatUsd(today.usd_value)} and counting` });
  }
  const senders = best('senders');
  if (senders !== undefined && today.unique_senders > senders) {
    out.push({ key: 'senders', text: `New record: most senders in a day — ${formatCount(today.unique_senders)} and counting` });
  }
  return out;
}
