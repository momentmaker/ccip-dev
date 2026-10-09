import type { CostFile, TopEntry, TopFile } from '@ccip-dev/core/public';
import type { TopDim, TopOrder, Window } from './card-paths';
import { chainName, keyChains, laneLabel, senderLabel, tokenLabel, type ChainNames } from './names';

export type TopFileName = 'top/lane.json' | 'top/token.json' | 'top/sender.json' | 'top/src_chain.json';

/** The Chains tab ranks source chains, so it reads the src_chain file. */
export const TOP_FILE: Record<TopDim, TopFileName> = {
  lane: 'top/lane.json',
  token: 'top/token.json',
  sender: 'top/sender.json',
  chain: 'top/src_chain.json',
};

export interface TopRow {
  rank: number;
  primary: string;
  secondary: string | null;
  verified: boolean;
  chains: string[];
  messages: number;
  usd: number | null;
  fee: number | null;
  typicalFee: number | null;
  sharePct: number | null;
}

export interface TopRowOptions {
  order?: TopOrder;
  typicalFees?: ReadonlyMap<string, number>;
}

export function topHref(dim: TopDim, window: Window, order: TopOrder): string {
  return `/top/${dim}/${window}/${order === 'fees' ? 'fees/' : ''}`;
}

/** A file published before the fee rankings has no by_fees, so its fees pages show their empty state. */
export function topEntries(top: TopFile, window: Window, order: TopOrder): TopEntry[] {
  return order === 'fees' ? (top.by_fees?.[window] ?? []) : top.windows[window];
}

/** Each listed route's typical fee by lane key (`src>dst`, as daily_breakdown keys lanes); empty before the first cost.json. */
export function typicalFeeMap(cost: CostFile | null): Map<string, number> {
  return new Map((cost?.lanes ?? []).map((l) => [`${l.src}>${l.dst}`, l.median_usd]));
}

function rowLabel(e: TopEntry, dim: TopDim, names: ChainNames): { primary: string; secondary: string | null; verified: boolean } {
  if (dim === 'lane') return { primary: laneLabel(names, e.key), secondary: null, verified: false };
  if (dim === 'chain') return { primary: chainName(names, e.key), secondary: null, verified: false };
  if (dim === 'token') return { ...tokenLabel(names, e.key, e.symbol), verified: false };
  return senderLabel(names, e.key, e.label);
}

export function topRows(entries: readonly TopEntry[], dim: TopDim, names: ChainNames, opts: TopRowOptions = {}): TopRow[] {
  const measure = (e: TopEntry) => (opts.order === 'fees' ? (e.fee_usd ?? null) : e.usd);
  const total = entries.reduce((sum, e) => sum + (measure(e) ?? 0), 0);
  return entries.map((e, i) => {
    const m = measure(e);
    return {
      rank: i + 1,
      ...rowLabel(e, dim, names),
      chains: dim === 'chain' ? [e.key] : keyChains(e.key),
      messages: e.messages,
      usd: e.usd,
      fee: e.fee_usd ?? null,
      typicalFee: opts.typicalFees?.get(e.key) ?? null,
      sharePct: total > 0 && m !== null ? (m / total) * 100 : null,
    };
  });
}
