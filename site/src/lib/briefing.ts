import type { DayTotals, LargestFee, MomentsFile, MomentsWeek, Poll } from '@ccip-dev/core/public';
import { formatCount, formatPct, formatUsd, growthMultiple } from './format';
import { chainName, laneLabel, type ChainNames } from './names';
import { computeFeeRecords, computeRecords } from './records';

export type RankMove = { kind: 'up' | 'down'; by: number } | { kind: 'new' } | { kind: 'same' };

export function rankMove(rank: number, previous: number | null): RankMove {
  if (previous === null) return { kind: 'new' };
  if (previous > rank) return { kind: 'up', by: previous - rank };
  if (previous < rank) return { kind: 'down', by: rank - previous };
  return { kind: 'same' };
}

export function moveText(move: RankMove): string {
  if (move.kind === 'new') return 'NEW';
  if (move.kind === 'same') return '—';
  return `${move.kind === 'up' ? '▲' : '▼'}${move.by}`;
}

export function moveLabel(move: RankMove): string {
  if (move.kind === 'new') return 'new to the top 10';
  if (move.kind === 'same') return 'same place as the week before';
  return `${move.kind} ${move.by} on the week before`;
}

/** The last complete week moments.json covers. */
export function latestWeek(moments: Pick<MomentsFile, 'weeks'> | null): MomentsWeek | null {
  if (!moments || moments.weeks.length === 0) return null;
  return [...moments.weeks].sort((a, b) => (a.week < b.week ? -1 : 1)).at(-1)!;
}

/** "+16%", "12×" from tenfold, or "new" with nothing the week before. */
export function weekChange(now: number, before: number | null): string {
  if (before === null || before <= 0) return 'new';
  const multiple = growthMultiple(now, before);
  return multiple !== null ? `${multiple}×` : formatPct(((now - before) / before) * 100, 0);
}

export interface ArrivalRow {
  kind: 'chain' | 'lane' | 'token';
  day: string;
  selectors: string[];
  label: string;
  sub: string | null;
}

const KIND_ORDER: ArrivalRow['kind'][] = ['chain', 'lane', 'token'];

/** What is new on the network, newest first: chains, lanes (a pair opened both ways reads as one), and tokens with a symbol. */
export function arrivalRows(arrivals: MomentsFile['arrivals'], names: ChainNames, limit = 6): ArrivalRow[] {
  const rows: ArrivalRow[] = [];
  for (const c of arrivals.chains) rows.push({ kind: 'chain', day: c.day, selectors: [c.selector], label: chainName(names, c.selector), sub: `chain #${c.number}` });
  const lanes = new Map(arrivals.lanes.map((l) => [l.key, l]));
  const done = new Set<string>();
  for (const l of arrivals.lanes) {
    if (done.has(l.key)) continue;
    const [src, dst] = l.key.split('>');
    if (!src || !dst) continue;
    const back = lanes.get(`${dst}>${src}`);
    done.add(l.key);
    if (back) done.add(back.key);
    rows.push({ kind: 'lane', day: l.day, selectors: [src, dst], label: back ? `${chainName(names, src)} ⇄ ${chainName(names, dst)}` : laneLabel(names, l.key), sub: null });
  }
  const tokens = new Set<string>();
  for (const t of arrivals.tokens) {
    const chain = t.key.split(':')[0] ?? '';
    const id = `${t.symbol}@${chain}`;
    if (!t.symbol || tokens.has(id)) continue;
    tokens.add(id);
    rows.push({ kind: 'token', day: t.day, selectors: chain ? [chain] : [], label: t.symbol, sub: chain ? `on ${chainName(names, chain)}` : null });
  }
  return rows.sort((a, b) => (a.day !== b.day ? (a.day < b.day ? 1 : -1) : KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))).slice(0, limit);
}

/** The week's open poll and the last one with an answer. */
export function pollCards(polls: readonly Poll[]): { open: Poll | null; last: Poll | null } {
  const sorted = [...polls].sort((a, b) => (a.week < b.week ? -1 : 1));
  return {
    open: sorted.filter((p) => p.answer === null).at(-1) ?? null,
    last: sorted.filter((p) => p.outcome !== null).at(-1) ?? null,
  };
}

export interface Medal {
  key: string;
  value: string;
  title: string;
  sub: string;
  day: string;
}

/** The Hall of Records: messages, value, fees and senders in a day, and the largest single fee. */
export function recordMedals(days: readonly DayTotals[], largest: readonly LargestFee[], names: ChainNames): Medal[] {
  const records = computeRecords(days);
  const fees = computeFeeRecords(days, largest, names);
  const day = (key: string) => records.find((r) => r.key === key);
  const out: Medal[] = [];
  const busiest = day('busiest');
  if (busiest) out.push({ key: 'busiest', value: formatCount(busiest.value), title: 'Messages', sub: 'in one day', day: busiest.day });
  const biggest = day('biggest');
  if (biggest) out.push({ key: 'biggest', value: formatUsd(biggest.value), title: 'Moved', sub: 'in one day', day: biggest.day });
  const most = fees.find((r) => r.key === 'most_fees');
  if (most) out.push({ key: 'most_fees', value: most.display, title: 'In fees', sub: 'in one day', day: most.day });
  const top = largest[0];
  if (top) out.push({ key: 'largest_fee', value: formatUsd(top.fee_usd), title: 'One fee', sub: laneLabel(names, `${top.src}>${top.dst}`), day: top.day });
  const senders = day('senders');
  if (senders) out.push({ key: 'senders', value: formatCount(senders.value), title: 'Senders', sub: 'in one day', day: senders.day });
  return out;
}

/** The most recently set of the medals, which the hall shows larger. */
export function newestMedal(medals: readonly Medal[]): string | null {
  let best: Medal | null = null;
  for (const m of medals) if (best === null || m.day > best.day) best = m;
  return best?.key ?? null;
}
