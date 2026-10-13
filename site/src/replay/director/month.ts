import { recordValueText } from '@ccip-dev/core/broadcasts';
import { formatCount, formatFeeTotal, formatShare, formatUsd, formatUsdDown } from '@ccip-dev/core/format';
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

/**
 * The month's replay and its show input, or null when the month is not one the page can play (see isPlayableMonth). Its
 * last day must be in both files: the edge cache can serve a fresh replay.json beside a history.json a day behind.
 */
export function monthCut(data: MonthData, month: string): { replay: ReplayFile; month: MonthInput } | null {
  const first = data.replay.since ?? data.replay.days[0]?.day ?? null;
  const replayLast = data.replay.days.at(-1)?.day ?? null;
  const historyLast = data.history.at(-1)?.day ?? null;
  const lastDay = replayLast === null || historyLast === null ? null : replayLast < historyLast ? replayLast : historyLast;
  if (!isPlayableMonth(month, { first, lastDay })) return null;
  return {
    replay: monthReplay(data.replay, month),
    month: { month, chains: data.replay.chains, summary: monthSummary(month, { days: data.history, largest: data.largest, replay: data.replay }) },
  };
}

/** What kind of high each record is, after its number as the caption writes it (recordValueText). */
const RECORD_SUFFIX: Record<RecordKind, string> = {
  messages: 'messages',
  value: 'moved',
  fees: 'in fees',
  largest_fee: 'single fee',
  link_share: 'paid in LINK',
};

/** How many records or new chains a row names before "+N more": a longer row would be cut mid-word at the size floor. */
const ROW_ITEMS_SHOWN = 3;

function cappedList(items: readonly string[]): string {
  const shown = items.slice(0, ROW_ITEMS_SHOWN).join(' · ');
  return items.length > ROW_ITEMS_SHOWN ? `${shown} · +${items.length - ROW_ITEMS_SHOWN} more` : shown;
}

/**
 * The end card's rows: the month's totals always, then fees, records, new chains and the busiest lane when it has them.
 * The value moved is rounded down, as the counter above it stops.
 */
export function monthCardRows(s: MonthSummary): string[] {
  const rows = [`${formatCount(s.messages)} messages · ${formatUsdDown(s.usd)} moved`];
  if (s.fees !== null) rows.push(`${formatFeeTotal(s.fees)} in fees${s.linkSharePct === null ? '' : ` · ${formatShare(s.linkSharePct)} paid in LINK`}`);
  if (s.records.length > 0) rows.push(`Records: ${cappedList(s.records.map((r) => `${recordValueText(r.kind, r.value)} ${RECORD_SUFFIX[r.kind]}`))}`);
  if (s.joined.length > 0) rows.push(`New on CCIP: ${cappedList(s.joined.map((c) => c.name))}`);
  if (s.busiestLane) rows.push(`Busiest lane: ${s.busiestLane.src.name} → ${s.busiestLane.dst.name} · ${formatUsd(s.busiestLane.usd)}`);
  return rows;
}
