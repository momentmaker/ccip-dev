import { z } from 'zod';
import { createThrottle, getJson, parseWith, type HttpDeps } from './http';
import { addDays, dayOf, dayStartIso, daysBetween } from './time';
import type { PriceInfo } from './types';

export const LLAMA_BASE = 'https://coins.llama.fi';
export const PRICE_BATCH = 100;
export const MAX_CHART_POINTS = 500;
const HALF_DAY_SECONDS = 43_200;

const CurrentResponse = z.object({
  coins: z.record(z.string(), z.object({ price: z.number(), decimals: z.number().int().nonnegative().optional() })),
});
const ChartResponse = z.object({
  coins: z.record(z.string(), z.object({ prices: z.array(z.object({ timestamp: z.number(), price: z.number() })) })),
});

export interface PricesClient {
  latest(keys: string[]): Promise<Map<string, PriceInfo>>;
  dailyHistory(key: string, fromDay: string, toDay: string): Promise<Map<string, number>>;
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
          if (coin.decimals !== undefined) out.set(key, { price: coin.price, decimals: coin.decimals });
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
  };
}
