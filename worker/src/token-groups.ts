import {
  buildTokenGroupIndex, fallbackKeys, groupFallback, lacksOwnPrice, type PriceFallback, type PriceInfo, type TokenAmount,
  type TokenGroupIndex,
} from '@ccip-dev/core';
import type { RunContext } from './context';
import * as store from './store';

export type TokenGroupsLoader = () => Promise<TokenGroupIndex>;

/**
 * A run's CCIP token groups, read from D1 the first time a token needs the price fallback and at most once. When they
 * cannot be read, the run carries on without the fallback and alerts, so ingest and publishing never stop over it.
 */
export function tokenGroupsLoader(c: RunContext): TokenGroupsLoader {
  let loading: Promise<TokenGroupIndex> | undefined;
  return () => (loading ??= loadTokenGroups(c));
}

async function loadTokenGroups(c: RunContext): Promise<TokenGroupIndex> {
  try {
    return await store.tokenGroups(c.env.DB);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await c.alert('token-groups', `Token groups could not be read, so tokens without a price stay unpriced this run: ${detail}`);
    return buildTokenGroupIndex([]);
  }
}

/**
 * The group fallback for tokens without a price of their own, after adding their siblings' prices to `prices` through
 * `loadPrices`. Undefined when every token has its own price, in which case the groups are not read.
 */
export async function siblingFallback(
  groups: TokenGroupsLoader,
  tokens: TokenAmount[],
  prices: Map<string, PriceInfo>,
  loadPrices: (keys: string[]) => Promise<Map<string, PriceInfo>>,
): Promise<PriceFallback | undefined> {
  const lookup = (key: string) => prices.get(key);
  const unpriced = tokens.filter((t) => lacksOwnPrice(t, lookup));
  if (unpriced.length === 0) return undefined;
  const index = await groups();
  const siblings = fallbackKeys(index, unpriced, lookup).filter((key) => !prices.has(key));
  for (const [key, info] of await loadPrices(siblings)) prices.set(key, info);
  return groupFallback(index, lookup);
}
