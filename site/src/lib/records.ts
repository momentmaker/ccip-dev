import type { DayTotals } from '@ccip-dev/core/public';
import { formatCount, formatDuration, formatUsd } from './format';
import { shortChainName } from './names';

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

export type MilestoneKind = 'messages' | 'value' | 'chains' | 'join';

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

export const FASTEST_MIN_MESSAGES = 100;
export const FEES_SINCE = '2026-10-05';
const KIND_ORDER: MilestoneKind[] = ['messages', 'value', 'chains', 'join'];
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
  { key: 'fees', title: 'Highest fees', note: `since ${FEES_SINCE}`, pick: (d) => d.fee_usd, better: (a, b) => a > b, display: (v) => `${formatUsd(v)} in fees` },
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

export function computeRecords(days: readonly DayStats[]): DayRecord[] {
  const sorted = [...days].sort(compareDay);
  return RULES.flatMap((rule) => {
    let best: { day: string; value: number } | null = null;
    for (const d of sorted) {
      const value = rule.pick(d);
      if (value === null) continue;
      if (best === null || rule.better(value, best.value)) best = { day: d.day, value };
    }
    return best ? [{ key: rule.key, title: rule.title, day: best.day, value: best.value, display: rule.display(best.value), note: rule.note }] : [];
  });
}

export function messageThresholds(max: number): number[] {
  const out: number[] = [];
  for (let power = 1_000; power <= max; power *= 10) for (const m of [1, 2, 5]) if (m * power <= max) out.push(m * power);
  return out;
}

export function valueThresholds(max: number): number[] {
  const out: number[] = [];
  for (let power = 1e9; power <= max; power *= 10) for (const m of [1, 2.5, 5]) if (m * power <= max) out.push(m * power);
  return out;
}

export function formatThresholdUsd(value: number): string {
  const [size, suffix] = value >= 1e12 ? [1e12, 'T'] : [1e9, 'B'];
  const n = value / size;
  return `$${Number.isInteger(n) ? n : n.toFixed(1)}${suffix}`;
}

type MilestoneDay = Pick<DayStats, 'day' | 'messages' | 'usd_value'>;

export function computeMilestones(
  days: readonly MilestoneDay[],
  chains: readonly { selector: string; name: string | null; display_name: string | null; first_day: string }[],
): Milestone[] {
  const sorted = [...days].sort(compareDay);
  const out: Milestone[] = [];
  const firstReach = (thresholds: number[], pick: (d: MilestoneDay) => number, kind: MilestoneKind, label: (t: number) => string) => {
    let running = 0;
    let next = 0;
    for (const d of sorted) {
      running += pick(d);
      while (next < thresholds.length && running >= thresholds[next]!) {
        out.push({ kind, day: d.day, label: label(thresholds[next]!), threshold: thresholds[next]! });
        next += 1;
      }
    }
  };
  const total = (pick: (d: MilestoneDay) => number) => sorted.reduce((sum, d) => sum + pick(d), 0);
  firstReach(messageThresholds(total((d) => d.messages)), (d) => d.messages, 'messages', (t) => `${formatCount(t)} messages`);
  firstReach(valueThresholds(total((d) => d.usd_value)), (d) => d.usd_value, 'value', (t) => `${formatThresholdUsd(t)} moved`);

  const joined = [...chains].sort((a, b) => (a.first_day < b.first_day ? -1 : a.first_day > b.first_day ? 1 : 0));
  for (let n = CHAIN_STEP; n <= joined.length; n += CHAIN_STEP) {
    out.push({ kind: 'chains', day: joined[n - 1]!.first_day, label: `${n} chains`, threshold: n });
  }
  for (const c of joined) out.push({ kind: 'join', day: c.first_day, label: `${shortChainName(c)} joins`, threshold: null });

  return out.sort(
    (a, b) => compareDay(a, b) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.threshold ?? 0) - (b.threshold ?? 0),
  );
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
