import type { TopEntry } from '@ccip-dev/core/public';
import type { TopDim } from './card-paths';
import { keyChains, laneLabel, senderLabel, tokenLabel, type ChainNames } from './names';

export interface TopRow {
  rank: number;
  primary: string;
  secondary: string | null;
  verified: boolean;
  chains: string[];
  messages: number;
  usd: number | null;
  fee: number | null;
  sharePct: number | null;
}

export function topRows(entries: readonly TopEntry[], dim: TopDim, names: ChainNames): TopRow[] {
  const total = entries.reduce((sum, e) => sum + (e.usd ?? 0), 0);
  return entries.map((e, i) => {
    const label =
      dim === 'lane'
        ? { primary: laneLabel(names, e.key), secondary: null, verified: false }
        : dim === 'token'
          ? { ...tokenLabel(names, e.key, e.symbol), verified: false }
          : senderLabel(names, e.key, e.label);
    return {
      rank: i + 1,
      ...label,
      chains: keyChains(e.key),
      messages: e.messages,
      usd: e.usd,
      fee: e.fee_usd ?? null,
      sharePct: total > 0 && e.usd !== null ? (e.usd / total) * 100 : null,
    };
  });
}
