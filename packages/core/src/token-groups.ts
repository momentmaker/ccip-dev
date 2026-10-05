import { llamaKey } from './chain-map';
import type { CoingeckoIdLookup } from './coingecko';
import type { NormalizedToken } from './normalize';
import { coingeckoKey } from './prices';
import type { ChainRef, PriceFallback, PriceInfo, PriceLookup, TokenAmount } from './types';

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
  /** Per group, only the members with a llama key, in the order the fallback tries them (see `bySiblingPreference`). */
  pricedByGroup: ReadonlyMap<string, readonly TokenGroupEntry[]>;
}

/**
 * Siblings on these chains are tried first, in this order: their DefiLlama prices come from the deepest markets, while a
 * thin copy on a small chain can be priced far off its peg.
 */
const PREFERRED_SLUGS = ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avax', 'solana'];

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
  for (const members of pricedByGroup.values()) members.sort(bySiblingPreference);
  return { byToken, pricedByGroup };
}

const compare = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

function preferenceRank(key: string): number {
  const rank = PREFERRED_SLUGS.indexOf(key.slice(0, key.indexOf(':')));
  return rank === -1 ? PREFERRED_SLUGS.length : rank;
}

/** Preferred chains first, then by llama key, so the sibling chosen never depends on registry order. */
function bySiblingPreference(a: TokenGroupEntry, b: TokenGroupEntry): number {
  const [ka, kb] = [a.llamaKey ?? '', b.llamaKey ?? ''];
  return (
    preferenceRank(ka) - preferenceRank(kb) ||
    compare(ka, kb) ||
    compare(tokenId(a.chainSelector, a.address), tokenId(b.chainSelector, b.address))
  );
}

/** The llama keys of a token's group siblings, in the order the fallback tries them. */
export function siblingKeys(index: TokenGroupIndex, chainSelector: string, address: string): string[] {
  const entry = index.byToken.get(tokenId(chainSelector, address));
  if (entry === undefined || entry.groupId === null) return [];
  return (index.pricedByGroup.get(entry.groupId) ?? []).flatMap((s) => (s !== entry && s.llamaKey !== null ? [s.llamaKey] : []));
}

/** The fallback's last step: a token's CoinGecko coin, priced through DefiLlama's `coingecko:<id>` key. */
export interface CoingeckoFallback {
  coingeckoIdOf?: CoingeckoIdLookup;
  /** DefiLlama's decimals for a llama key on a day it has no price; the backfill knows them from the current price. */
  decimalsOf?: (llamaKey: string) => number | undefined;
}

/**
 * Prices a token that has no price of its own from its first priced group sibling, then from its CoinGecko coin. Either
 * way the amount is scaled by the token's own decimals: its registry decimals, else DefiLlama's for its own key.
 */
export function groupFallback(index: TokenGroupIndex, priceOf: PriceLookup, coingecko: CoingeckoFallback = {}): PriceFallback {
  return (chain, address) => {
    const price = siblingPrice(index, priceOf, chain, address) ?? coinPrice(priceOf, coingecko.coingeckoIdOf, chain, address);
    if (price === undefined) return undefined;
    const decimals = tokenDecimals(index, chain, address, coingecko.decimalsOf);
    return decimals === undefined ? undefined : { price: price.price, decimals };
  };
}

function siblingPrice(index: TokenGroupIndex, priceOf: PriceLookup, chain: ChainRef, address: string): PriceInfo | undefined {
  for (const key of siblingKeys(index, chain.selector, address)) {
    const price = priceOf(key);
    if (price) return price;
  }
  return undefined;
}

function coinPrice(
  priceOf: PriceLookup,
  coingeckoIdOf: CoingeckoIdLookup | undefined,
  chain: ChainRef,
  address: string,
): PriceInfo | undefined {
  const coinId = coingeckoIdOf?.(chain, address);
  return coinId === undefined ? undefined : priceOf(coingeckoKey(coinId));
}

function tokenDecimals(
  index: TokenGroupIndex,
  chain: ChainRef,
  address: string,
  decimalsOf: CoingeckoFallback['decimalsOf'],
): number | undefined {
  const registered = index.byToken.get(tokenId(chain.selector, address));
  if (registered !== undefined) return registered.decimals;
  const own = llamaKey(chain, address);
  return own === null ? undefined : decimalsOf?.(own);
}

/** True when the token has no llama key, or no price for it: only such a token needs the fallback. */
export function lacksOwnPrice(token: TokenAmount, priceOf: PriceLookup): boolean {
  const own = llamaKey(token.chain, token.token);
  return own === null || priceOf(own) === undefined;
}

/** The sibling keys, once each, that the fallback may need for the tokens that have no price of their own. */
export function fallbackKeys(index: TokenGroupIndex, tokens: TokenAmount[], priceOf: PriceLookup): string[] {
  const keys = new Set<string>();
  for (const t of tokens.filter((token) => lacksOwnPrice(token, priceOf))) {
    for (const key of siblingKeys(index, t.chain.selector, t.token)) keys.add(key);
  }
  return [...keys];
}

/** The `coingecko:` keys, once each, of the tokens that neither their own key nor a group sibling prices. */
export function coingeckoKeys(
  index: TokenGroupIndex,
  tokens: TokenAmount[],
  priceOf: PriceLookup,
  coingeckoIdOf: CoingeckoIdLookup,
): string[] {
  const fromGroup = groupFallback(index, priceOf);
  const keys = new Set<string>();
  for (const t of tokens) {
    if (!lacksOwnPrice(t, priceOf) || fromGroup(t.chain, t.token) !== undefined) continue;
    const coinId = coingeckoIdOf(t.chain, t.token);
    if (coinId !== undefined) keys.add(coingeckoKey(coinId));
  }
  return [...keys];
}
