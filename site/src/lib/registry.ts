import type { Chain, Token } from '@ccip-dev/core/public';
import { addDays } from './days';
import { chainName, shortAddress, shortChainName, type ChainNames } from './names';

export const NEW_DAYS = 14;

export function isNew(firstSeen: string | null, buildDate: string): boolean {
  return firstSeen !== null && firstSeen.slice(0, 10) >= addDays(buildDate, -(NEW_DAYS - 1));
}

const newestFirst = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? 1 : -1);

export interface ChainRow {
  selector: string;
  name: string;
  family: string | null;
  firstSeen: string | null;
  isNew: boolean;
}

export function chainRows(chains: readonly Chain[], buildDate: string): ChainRow[] {
  return [...chains]
    .sort((a, b) => newestFirst(a.first_seen, b.first_seen) || a.name.localeCompare(b.name))
    .map((c) => ({ selector: c.selector, name: shortChainName(c), family: c.family, firstSeen: c.first_seen, isNew: isNew(c.first_seen, buildDate) }));
}

export interface TokenRow {
  symbol: string;
  name: string | null;
  chain: string;
  chainSelector: string;
  address: string;
  firstSeen: string | null;
  isNew: boolean;
}

export function tokenRows(tokens: readonly Token[], names: ChainNames, buildDate: string): TokenRow[] {
  return [...tokens]
    .sort((a, b) => newestFirst(a.first_seen, b.first_seen) || (a.symbol ?? '').localeCompare(b.symbol ?? ''))
    .map((t) => ({
      symbol: t.symbol || shortAddress(t.address),
      name: t.name,
      chain: chainName(names, t.chain),
      chainSelector: t.chain,
      address: t.address,
      firstSeen: t.first_seen,
      isNew: isNew(t.first_seen, buildDate),
    }));
}
