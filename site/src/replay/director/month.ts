import { formatCount, formatFee, formatFeeTotal, formatShare, formatUsd, formatUsdDown, linkShareText } from '@ccip-dev/core/format';
import { isPlayableMonth, monthBounds, monthSummary, type MonthSummary } from '@ccip-dev/core/month';
import type { DayTotals, LargestFee, ReplayFile } from '@ccip-dev/core/public';
import type { RecordKind } from '@ccip-dev/core/records';
import { daysBetween } from '../../lib/days';

export interface MonthInput {
  month: string;
  /** Every chain in replay.json: the chain-count milestones count them all, not just the month's. */
  chains: ReplayFile['chains'];
  summary: MonthSummary;
}

/**
 * replay.json cut to one month: every day of the month (empty when nothing moved), and only the lanes that moved in it and
 * their chains, re-indexed in their original order.
 */
export function monthReplay(replay: ReplayFile, month: string): ReplayFile {
  const { first, last } = monthBounds(month);
  const inMonth = new Map(replay.days.filter((d) => d.day >= first && d.day <= last).map((d) => [d.day, d.lanes]));
  const laneIds = [...new Set([...inMonth.values()].flatMap((lanes) => lanes.map(([lane]) => lane)))].sort((a, b) => a - b);
  const chainIds = [...new Set(laneIds.flatMap((lane) => replay.lanes[lane] ?? []))].sort((a, b) => a - b);
  const chainAt = new Map(chainIds.map((c, i) => [c, i]));
  const laneAt = new Map(laneIds.map((l, i) => [l, i]));
  return {
    ...replay,
    since: first,
    chains: chainIds.map((c) => replay.chains[c]!),
    lanes: laneIds.map((lane) => {
      const [src, dst] = replay.lanes[lane]!;
      return [chainAt.get(src)!, chainAt.get(dst)!];
    }),
    days: daysBetween(first, last).map((day) => ({
      day,
      lanes: (inMonth.get(day) ?? []).map(([lane, messages, usd]): [number, number, number] => [laneAt.get(lane)!, messages, usd]),
    })),
  };
}

export interface MonthData {
  replay: ReplayFile;
  history: readonly DayTotals[];
  largest: readonly LargestFee[];
}

/** The month's replay and its show input, or null when the month is not one the page can play (see isPlayableMonth). */
export function monthCut(data: MonthData, month: string): { replay: ReplayFile; month: MonthInput } | null {
  const first = data.replay.since ?? data.replay.days[0]?.day ?? null;
  const lastDay = data.replay.days.at(-1)?.day ?? null;
  if (!isPlayableMonth(month, { first, lastDay })) return null;
  return {
    replay: monthReplay(data.replay, month),
    month: { month, chains: data.replay.chains, summary: monthSummary(month, { days: data.history, largest: data.largest, replay: data.replay }) },
  };
}

/** A record's value, short: the end card's "Records:" row says what kind of high each one is. */
const RECORD_TEXT: Record<RecordKind, (value: number) => string> = {
  messages: (v) => `${formatCount(v)} messages`,
  value: (v) => `${formatUsd(v)} moved`,
  fees: (v) => `${formatFeeTotal(v)} in fees`,
  largest_fee: (v) => `${formatFee(v)} single fee`,
  link_share: (v) => `${formatShare(v)} paid in LINK`,
};

/**
 * The end card's rows: the month's totals always, then fees, records, new chains and the busiest lane when it has them.
 * The value moved is rounded down, as the counter above it stops.
 */
export function monthCardRows(s: MonthSummary): string[] {
  const rows = [`${formatCount(s.messages)} messages · ${formatUsdDown(s.usd)} moved`];
  if (s.fees !== null) rows.push(`${formatFeeTotal(s.fees)} in fees${s.linkSharePct === null ? '' : ` · ${linkShareText(s.linkSharePct)}`}`);
  if (s.records.length > 0) rows.push(`Records: ${s.records.map((r) => RECORD_TEXT[r.kind](r.value)).join(' · ')}`);
  if (s.joined.length > 0) rows.push(`New on CCIP: ${s.joined.map((c) => c.name).join(' · ')}`);
  if (s.busiestLane) rows.push(`Busiest lane: ${s.busiestLane.src.name} → ${s.busiestLane.dst.name} · ${formatUsd(s.busiestLane.usd)}`);
  return rows;
}
