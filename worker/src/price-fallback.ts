import {
  buildTokenGroupIndex, coingeckoKeys, fallbackKeys, groupFallback, lacksOwnPrice, type CoingeckoIdLookup, type PriceFallback,
  type PriceInfo, type TokenAmount, type TokenGroupIndex,
} from '@ccip-dev/core';
import type { RunContext } from './context';
import * as store from './store';

/**
 * What a run's price fallback reads from D1, each the first time a token needs it and at most once. When either cannot be
 * read, the run carries on without that step and alerts, so ingest and publishing never stop over it.
 */
export interface FallbackLoader {
  groups(): Promise<TokenGroupIndex>;
  coingeckoIds(): Promise<CoingeckoIdLookup>;
}

export function fallbackLoader(c: RunContext): FallbackLoader {
  let groups: Promise<TokenGroupIndex> | undefined;
  let coingeckoIds: Promise<CoingeckoIdLookup> | undefined;
  return {
    groups: () => (groups ??= loadTokenGroups(c)),
    coingeckoIds: () => (coingeckoIds ??= loadCoingeckoIds(c)),
  };
}

async function loadTokenGroups(c: RunContext): Promise<TokenGroupIndex> {
  try {
    return await store.tokenGroups(c.env.DB);
  } catch (err) {
    await c.alert('token-groups', `Token groups could not be read, so tokens without a price stay unpriced this run: ${detail(err)}`);
    return buildTokenGroupIndex([]);
  }
}

async function loadCoingeckoIds(c: RunContext): Promise<CoingeckoIdLookup> {
  try {
    return await store.coingeckoIds(c.env.DB);
  } catch (err) {
    await c.alert(
      'coingecko-ids-read',
      `CoinGecko ids could not be read, so tokens their group cannot price stay unpriced this run: ${detail(err)}`,
    );
    return () => undefined;
  }
}

const detail = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The fallback for tokens without a price of their own, after adding to `prices`, through `loadPrices`, their group
 * siblings' prices and then the `coingecko:` prices of the tokens still unpriced. Undefined when every token has its own
 * price; the CoinGecko ids are read only when some token is still unpriced after its group.
 */
export async function priceFallback(
  loader: FallbackLoader,
  tokens: TokenAmount[],
  prices: Map<string, PriceInfo>,
  loadPrices: (keys: string[]) => Promise<Map<string, PriceInfo>>,
): Promise<PriceFallback | undefined> {
  const lookup = (key: string) => prices.get(key);
  const add = async (keys: string[]) => {
    for (const [key, info] of await loadPrices(keys.filter((k) => !prices.has(k)))) prices.set(key, info);
  };
  const unpriced = tokens.filter((t) => lacksOwnPrice(t, lookup));
  if (unpriced.length === 0) return undefined;
  const index = await loader.groups();
  await add(fallbackKeys(index, unpriced, lookup));
  const fromGroup = groupFallback(index, lookup);
  if (unpriced.every((t) => fromGroup(t.chain, t.token) !== undefined)) return fromGroup;
  const coingeckoIdOf = await loader.coingeckoIds();
  await add(coingeckoKeys(index, unpriced, lookup, coingeckoIdOf));
  return groupFallback(index, lookup, { coingeckoIdOf });
}
