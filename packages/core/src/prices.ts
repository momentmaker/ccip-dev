import { z } from 'zod';
import { createThrottle, getJson, parseWith, type HttpDeps } from './http';
import { sanitize } from './normalize';
import { addDays, dayOf, dayStartIso, daysBetween } from './time';
import type { PriceInfo } from './types';

export const LLAMA_BASE = 'https://coins.llama.fi';
export const PRICE_BATCH = 100;
export const PRICE_SEARCH_WIDTH_SECONDS = 600;
export const MAX_CHART_POINTS = 500;
const MAX_SYMBOL_LENGTH = 32;
const HALF_DAY_SECONDS = 43_200;
const COINGECKO_PREFIX = 'coingecko:';

/**
 * A `coingecko:` key names a coin rather than a token contract, so DefiLlama prices it without decimals. Its price carries
 * this placeholder: the fallback values the coin with each token's own decimals, and any path that scaled an amount by
 * the placeholder instead would throw in `toUnits` rather than silently divide by 10^0.
 */
export const COIN_PRICE_DECIMALS = -1;

/** DefiLlama's key for a CoinGecko coin id. */
export function coingeckoKey(coinId: string): string {
  return `${COINGECKO_PREFIX}${coinId}`;
}

export function isCoingeckoKey(key: string): boolean {
  return key.startsWith(COINGECKO_PREFIX);
}

const CurrentResponse = z.object({
  coins: z.record(
    z.string(),
    z.object({ price: z.number(), decimals: z.number().int().nonnegative().optional(), symbol: z.string().optional() }),
  ),
});
const ChartResponse = z.object({
  coins: z.record(z.string(), z.object({ prices: z.array(z.object({ timestamp: z.number(), price: z.number() })) })),
});

export interface PricesClient {
  latest(keys: string[]): Promise<Map<string, PriceInfo>>;
  dailyHistory(key: string, fromDay: string, toDay: string): Promise<Map<string, number>>;
  historicalAt(key: string, timestamps: number[]): Promise<Map<number, number>>;
}

export function createPricesClient(
  deps: HttpDeps,
  options: { baseUrl?: string; minIntervalMs?: number; maxRetries?: number } = {},
): PricesClient {
  const base = options.baseUrl ?? LLAMA_BASE;
  const throttle = createThrottle(deps, options.minIntervalMs ?? 250);
  const maxRetries = options.maxRetries ?? 3;

  return {
    async latest(keys) {
      const out = new Map<string, PriceInfo>();
      for (let i = 0; i < keys.length; i += PRICE_BATCH) {
        const batch = keys.slice(i, i + PRICE_BATCH);
        const json = await getJson(deps, `${base}/prices/current/${batch.join(',')}`, {
          endpoint: 'GET /prices/current', maxRetries, throttle,
        });
        for (const [key, coin] of Object.entries(parseWith(CurrentResponse, json, 'GET /prices/current').coins)) {
          const symbol = coin.symbol === undefined ? '' : sanitize(coin.symbol, MAX_SYMBOL_LENGTH);
          const named = symbol === '' ? {} : { symbol };
          if (coin.decimals !== undefined) out.set(key, { price: coin.price, decimals: coin.decimals, ...named });
          else if (isCoingeckoKey(key)) out.set(key, { price: coin.price, decimals: COIN_PRICE_DECIMALS, ...named });
        }
      }
      return out;
    },

    async dailyHistory(key, fromDay, toDay) {
      const out = new Map<string, number>();
      for (let start = fromDay; start <= toDay; start = addDays(start, MAX_CHART_POINTS)) {
        const lastDay = [addDays(start, MAX_CHART_POINTS - 1), toDay].sort()[0]!;
        const span = daysBetween(start, lastDay).length;
        const startSec = Date.parse(dayStartIso(start)) / 1000;
        const json = await getJson(deps, `${base}/chart/${key}?start=${startSec}&span=${span}&period=1d`, {
          endpoint: 'GET /chart', maxRetries, throttle,
        });
        const series = parseWith(ChartResponse, json, 'GET /chart').coins[key]?.prices ?? [];
        // DefiLlama stamps daily points a few minutes either side of midnight, so round to the nearest day.
        for (const point of series) out.set(dayOf(new Date((point.timestamp + HALF_DAY_SECONDS) * 1000)), point.price);
      }
      return out;
    },

    async historicalAt(key, timestamps) {
      const out = new Map<number, number>();
      const wanted = [...new Set(timestamps)];
      for (let i = 0; i < wanted.length; i += PRICE_BATCH) {
        const batch = wanted.slice(i, i + PRICE_BATCH);
        const coins = encodeURIComponent(JSON.stringify({ [key]: batch }));
        const json = await getJson(deps, `${base}/batchHistorical?coins=${coins}&searchWidth=${PRICE_SEARCH_WIDTH_SECONDS}`, {
          endpoint: 'GET /batchHistorical', maxRetries, throttle,
        });
        const points = parseWith(ChartResponse, json, 'GET /batchHistorical').coins[key]?.prices ?? [];
        for (const ts of batch) {
          let nearest: { timestamp: number; price: number } | undefined;
          for (const point of points) {
            if (nearest === undefined || Math.abs(point.timestamp - ts) < Math.abs(nearest.timestamp - ts)) nearest = point;
          }
          if (nearest !== undefined && Math.abs(nearest.timestamp - ts) <= PRICE_SEARCH_WIDTH_SECONDS) out.set(ts, nearest.price);
        }
      }
      return out;
    },
  };
}
