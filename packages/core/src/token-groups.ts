import { llamaKey } from './chain-map';
import type { NormalizedToken } from './normalize';
import type { ChainRef, PriceFallback, PriceLookup, TokenAmount } from './types';

/** One CCIP registry token, with its address normalized like message token addresses. */
export interface TokenGroupEntry {
  chainSelector: string;
  address: string;
  decimals: number;
  groupId: string | null;
  llamaKey: string | null;
}

/**
 * CCIP's registry groups the copies of one token across chains, and its token pools keep them 1:1, so a copy without a
 * price of its own can take a sibling's price.
 */
export interface TokenGroupIndex {
  byToken: ReadonlyMap<string, TokenGroupEntry>;
  /** Per group, only the members with a llama key, sorted by it so the sibling chosen never depends on registry order. */
  pricedByGroup: ReadonlyMap<string, readonly TokenGroupEntry[]>;
}

const tokenId = (chainSelector: string, address: string) => `${chainSelector}|${address}`;

/** `chain` is undefined when the token's chain is unknown, which leaves the token without a llama key. */
export function tokenGroupEntry(
  token: Pick<NormalizedToken, 'chain' | 'address' | 'decimals' | 'groupId'>,
  chain: Pick<ChainRef, 'family' | 'chainId'> | undefined,
): TokenGroupEntry {
  return {
    chainSelector: token.chain,
    address: token.address,
    decimals: token.decimals,
    groupId: token.groupId,
    llamaKey: chain ? llamaKey(chain, token.address) : null,
  };
}

export function buildTokenGroupIndex(entries: TokenGroupEntry[]): TokenGroupIndex {
  const byToken = new Map(entries.map((e) => [tokenId(e.chainSelector, e.address), e]));
  const pricedByGroup = new Map<string, TokenGroupEntry[]>();
  for (const e of byToken.values()) {
    if (e.groupId === null || e.llamaKey === null) continue;
    const members = pricedByGroup.get(e.groupId) ?? [];
    members.push(e);
    pricedByGroup.set(e.groupId, members);
  }
  for (const members of pricedByGroup.values()) members.sort(byLlamaKey);
  return { byToken, pricedByGroup };
}

const compare = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

function byLlamaKey(a: TokenGroupEntry, b: TokenGroupEntry): number {
  return compare(a.llamaKey ?? '', b.llamaKey ?? '') || compare(tokenId(a.chainSelector, a.address), tokenId(b.chainSelector, b.address));
}

/** The llama keys of a token's group siblings, in the order the fallback tries them. */
export function siblingKeys(index: TokenGroupIndex, chainSelector: string, address: string): string[] {
  const entry = index.byToken.get(tokenId(chainSelector, address));
  if (entry === undefined || entry.groupId === null) return [];
  return (index.pricedByGroup.get(entry.groupId) ?? []).flatMap((s) => (s !== entry && s.llamaKey !== null ? [s.llamaKey] : []));
}

/** Prices a token from its first priced sibling, keeping the token's own registry decimals. */
export function groupFallback(index: TokenGroupIndex, priceOf: PriceLookup): PriceFallback {
  return (chainSelector, address) => {
    const entry = index.byToken.get(tokenId(chainSelector, address));
    if (entry === undefined) return undefined;
    for (const key of siblingKeys(index, chainSelector, address)) {
      const sibling = priceOf(key);
      if (sibling) return { price: sibling.price, decimals: entry.decimals };
    }
    return undefined;
  };
}

/** The sibling keys, once each, that the fallback may need for the tokens that have no price of their own. */
export function fallbackKeys(index: TokenGroupIndex, tokens: TokenAmount[], priceOf: PriceLookup): string[] {
  const keys = new Set<string>();
  for (const t of tokens) {
    const own = llamaKey(t.chain, t.token);
    if (own !== null && priceOf(own)) continue;
    for (const key of siblingKeys(index, t.chain.selector, t.token)) keys.add(key);
  }
  return [...keys];
}
