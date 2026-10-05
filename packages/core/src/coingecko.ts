import { z } from 'zod';
import { createThrottle, getJson, parseWith, type HttpDeps } from './http';
import { normalizeAddress } from './normalize';
import type { ChainRef } from './types';

/**
 * CoinGecko's keyless API, used only for coin ids: which coin a token contract is. Prices never come from CoinGecko,
 * whose terms restrict storing them; a coin id is priced through DefiLlama's `coingecko:<id>` key.
 */
export const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

/** CCIP's chain id for Solana mainnet, its genesis hash. CoinGecko lists Solana tokens under the `solana` platform. */
const SOLANA_MAINNET_CHAIN_ID = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const SOLANA_PLATFORM = 'solana';

export const CoingeckoPlatform = z.object({ id: z.string(), chain_identifier: z.number().nullish() });
export type CoingeckoPlatform = z.output<typeof CoingeckoPlatform>;

export const CoingeckoCoin = z.object({ id: z.string(), platforms: z.record(z.string(), z.string().nullish()) });
export type CoingeckoCoin = z.output<typeof CoingeckoCoin>;

export interface CoingeckoLists {
  platforms: CoingeckoPlatform[];
  coins: CoingeckoCoin[];
}

export interface CoingeckoClient {
  /** Every asset platform with its EVM chain id, and every coin with its contract address per platform. */
  lists(): Promise<CoingeckoLists>;
}

/** A token's CoinGecko coin id, by its chain and normalized address. */
export type CoingeckoIdLookup = (chain: ChainRef, address: string) => string | undefined;

export function createCoingeckoClient(
  deps: HttpDeps,
  options: { baseUrl?: string; minIntervalMs?: number; maxRetries?: number } = {},
): CoingeckoClient {
  const base = options.baseUrl ?? COINGECKO_BASE;
  // Keyless CoinGecko allows only a few requests a minute.
  const throttle = createThrottle(deps, options.minIntervalMs ?? 5_000);
  const maxRetries = options.maxRetries ?? 2;
  const get = async <S extends z.ZodType>(path: string, endpoint: string, schema: S): Promise<z.output<S>> =>
    parseWith(schema, await getJson(deps, `${base}${path}`, { endpoint, maxRetries, throttle }), endpoint);

  return {
    async lists() {
      const platforms = await get('/asset_platforms', 'GET /asset_platforms', z.array(CoingeckoPlatform));
      const coins = await get('/coins/list?include_platform=true', 'GET /coins/list', z.array(CoingeckoCoin));
      return { platforms, coins };
    },
  };
}

/** A token's CoinGecko coin id, from its chain's family and chain id and its address. */
export type CoingeckoIdIndex = (chain: Pick<ChainRef, 'family' | 'chainId'>, address: string) => string | undefined;

const contractId = (platform: string, address: string) => `${platform}|${normalizeAddress(address)}`;

/**
 * Matches a token to a coin on the token's own platform only: an EVM chain's platform by its chain id, and Solana's by
 * name. The same address on another platform is another contract, so it never matches. An address that several coins
 * list on one platform, or a chain id that several platforms claim, matches nothing.
 */
export function buildCoingeckoIdIndex({ platforms, coins }: CoingeckoLists): CoingeckoIdIndex {
  const platformByChainId = uniqueOrNull(
    platforms.flatMap((p) => (typeof p.chain_identifier === 'number' ? [[String(p.chain_identifier), p.id] as const] : [])),
  );
  const coinByContract = uniqueOrNull(
    coins.flatMap((coin) =>
      Object.entries(coin.platforms).flatMap(([platform, address]) => {
        const trimmed = address?.trim() ?? '';
        return trimmed === '' ? [] : [[contractId(platform, trimmed), coin.id] as const];
      }),
    ),
  );
  const platformOf = (chain: Pick<ChainRef, 'family' | 'chainId'>) => {
    if (chain.family === 'EVM') return platformByChainId.get(chain.chainId);
    return chain.family === 'SVM' && chain.chainId === SOLANA_MAINNET_CHAIN_ID ? SOLANA_PLATFORM : undefined;
  };

  return (chain, address) => {
    const platform = platformOf(chain);
    return platform ? (coinByContract.get(contractId(platform, address)) ?? undefined) : undefined;
  };
}

/** Maps each key to its value, or to null when the pairs give the key different values. */
function uniqueOrNull(pairs: (readonly [string, string])[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const [key, value] of pairs) {
    const seen = out.get(key);
    out.set(key, seen === undefined || seen === value ? value : null);
  }
  return out;
}
