import type { HistoryFile, ReserveFile, TodayFile, TopEntry, TopFile } from '@ccip-dev/core/public';
import type { HistoryRange, TopDim, TopOrder, Window } from '../../src/lib/card-paths';
import { rangeRows, rangeTotals } from '../../src/lib/charts';
import { addDays } from '../../src/lib/days';
import { formatCount, formatFeeTotal, formatLink, formatPct, formatUsd, formatUtcDay } from '../../src/lib/format';
import { chainName, laneLabel, senderLabel, tokenLabel, type ChainNames } from '../../src/lib/names';
import { topEntries } from '../../src/lib/top';
import { computeRecords } from '../../src/lib/records';

export interface CardSpec {
  eyebrow: string;
  big: string;
  label: string;
  date: string;
  extra: string[];
  spark: number[] | null;
  badge?: string | null;
}

export interface ReplayCardEntry {
  name: string;
  since: string;
  usd: number;
  messages: number;
  partners: number;
  coin: string | null;
}

const RANGE_LABEL: Record<HistoryRange, string> = { '30d': 'LAST 30 DAYS', '90d': 'LAST 90 DAYS', '1y': 'LAST YEAR', all: 'ALL TIME' };
const WINDOW_LABEL: Record<Window, string> = { '7d': 'LAST 7 DAYS', '30d': 'LAST 30 DAYS', all: 'ALL TIME' };
const DIM_LABEL: Record<TopDim, string> = { lane: 'TOP LANE', token: 'TOP TOKEN', sender: 'TOP SENDER', chain: 'TOP SOURCE CHAIN' };
const SPARK_POINTS = 120;

const chainCount = (n: number) => `${n} ${n === 1 ? 'chain' : 'chains'}`;

export const cardText = (s: string) => s.replaceAll(' → ', ' to ');

export function sparkPoints(values: readonly number[], n = SPARK_POINTS): number[] {
  if (values.length <= n) return [...values];
  return Array.from({ length: n }, (_, i) => {
    const from = Math.floor((i * values.length) / n);
    const to = Math.floor(((i + 1) * values.length) / n);
    const bucket = values.slice(from, Math.max(to, from + 1));
    return bucket.reduce((a, b) => a + b, 0) / bucket.length;
  });
}

export function defaultCard(): CardSpec {
  return { eyebrow: 'LIVE CHAINLINK CCIP STATS', big: 'ccip.dev', label: 'Every CCIP message, live', date: '', extra: [], spark: null };
}

export function replayChainCard(entry: ReplayCardEntry, slug: string): CardSpec {
  return {
    eyebrow: `${entry.name.toUpperCase()} ON CHAINLINK CCIP`,
    big: formatUsd(entry.usd),
    label: `moved · ${formatCount(entry.messages)} messages · ${chainCount(entry.partners)}`,
    date: `since ${formatUtcDay(entry.since)}`,
    extra: [`ccip.dev/replay/${slug}`],
    spark: null,
    badge: entry.coin,
  };
}

export function homeCard(today: TodayFile): CardSpec {
  return {
    eyebrow: 'CCIP TODAY · UTC',
    big: formatCount(today.totals.messages),
    label: `messages · ${formatUsd(today.totals.usd_value)} moved`,
    date: `${formatUtcDay(today.day)} · so far`,
    extra: [],
    spark: null,
  };
}

export function dayCard(history: HistoryFile, day: string): CardSpec | null {
  const row = history.days.find((d) => d.day === day);
  if (!row) return null;
  const previous = history.days.find((d) => d.day === addDays(day, -1));
  const change = previous && previous.messages > 0 ? `${formatPct(((row.messages - previous.messages) / previous.messages) * 100)} messages vs the day before` : null;
  return {
    eyebrow: 'CCIP DAY · UTC',
    big: formatCount(row.messages),
    label: `messages · ${formatUsd(row.usd_value)} moved`,
    date: formatUtcDay(day),
    extra: change ? [change] : [],
    spark: null,
  };
}

export function historyCard(history: HistoryFile, range: HistoryRange): CardSpec {
  const lastDay = history.days.at(-1)?.day ?? null;
  const rows = lastDay ? rangeRows(history.days, range, lastDay) : [];
  const totals = rangeTotals(rows);
  return {
    eyebrow: `CCIP · ${RANGE_LABEL[range]}`,
    big: formatCount(totals.messages),
    label: `messages · ${formatUsd(totals.usd_value)} moved`,
    date: range === 'all' ? `since ${history.since}` : lastDay ? `to ${formatUtcDay(lastDay)}` : '',
    extra: [],
    spark: sparkPoints(rows.map((r) => r.messages)),
  };
}

function entryLabel(e: TopEntry, dim: TopDim, names: ChainNames): string {
  if (dim === 'lane') return cardText(laneLabel(names, e.key));
  if (dim === 'chain') return chainName(names, e.key);
  if (dim === 'token') return tokenLabel(names, e.key, e.symbol).primary;
  return senderLabel(names, e.key, e.label).primary;
}

export function topCard(top: TopFile, dim: TopDim, window: Window, order: TopOrder, names: ChainNames): CardSpec {
  const entries = topEntries(top, window, order);
  const first = entries[0];
  const byFees = order === 'fees';
  const amount = (e: TopEntry) => byFees ? formatFeeTotal(e.fee_usd) : formatUsd(e.usd);
  return {
    eyebrow: `${DIM_LABEL[dim]}${byFees ? ' BY FEES' : ''} · ${WINDOW_LABEL[window]}`,
    big: first ? entryLabel(first, dim, names) : '—',
    label: first ? `${amount(first)}${byFees ? ' in fees' : ''} · ${formatCount(first.messages)} messages` : 'No data yet',
    date: window === 'all' ? `since ${top.since}` : '',
    extra: entries.slice(1, 3).map((e, i) => `#${i + 2} ${entryLabel(e, dim, names)} · ${amount(e)}`),
    spark: null,
  };
}

export function flowCard(laneTop: TopFile, window: Window, names: ChainNames): CardSpec {
  const first = laneTop.windows[window][0];
  return {
    eyebrow: `BIGGEST LANE · ${WINDOW_LABEL[window]}`,
    big: first ? cardText(laneLabel(names, first.key)) : '—',
    label: first ? `${formatUsd(first.usd)} moved` : 'No data yet',
    date: window === 'all' ? `since ${laneTop.since}` : '',
    extra: [],
    spark: null,
  };
}

export function reserveCard(reserve: ReserveFile): CardSpec {
  const change = reserve.cost_basis?.change_pct ?? null;
  const next = reserve.pace?.next_expected_deposit ?? null;
  return {
    eyebrow: 'CHAINLINK RESERVE',
    big: formatLink(reserve.latest?.link),
    label: change === null ? 'held by the Chainlink Reserve' : `${formatPct(change)} vs its cost basis`,
    date: reserve.latest ? formatUtcDay(reserve.latest.ts) : '',
    extra: next ? [`Next deposit expected ${formatUtcDay(next)}`] : [],
    spark: sparkPoints(reserve.series.map((s) => s.link)),
  };
}

export function replayCard(history: HistoryFile): CardSpec {
  const totals = rangeTotals(history.days);
  return {
    eyebrow: 'WATCH CCIP GROW',
    big: formatCount(totals.messages),
    label: `messages · ${formatUsd(totals.usd_value)} moved since ${history.since}`,
    date: '',
    extra: ['ccip.dev/replay'],
    spark: null,
  };
}

export function recordsCard(history: HistoryFile): CardSpec {
  const records = computeRecords(history.days);
  const busiest = records.find((r) => r.key === 'busiest');
  const biggest = records.find((r) => r.key === 'biggest');
  return {
    eyebrow: 'CCIP RECORDS',
    big: busiest?.display ?? '—',
    label: busiest ? `busiest day · ${formatUtcDay(busiest.day)}` : 'No data yet',
    date: '',
    extra: biggest ? [`Biggest day: ${biggest.display} · ${formatUtcDay(biggest.day)}`] : [],
    spark: null,
  };
}
