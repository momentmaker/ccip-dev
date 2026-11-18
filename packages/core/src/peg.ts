import { z } from 'zod';
import { getJson, parseWith, type HttpDeps } from './http';
import { LINK_TOKEN } from './reserve';

/** Curve's stLINK/LINK-ng stableswap pool: coins(0) is LINK, coins(1) is stLINK. */
export const PEG_POOL = '0x7e13876b92f1a62c599c231f783f682e96b91761';
/** stake.link's StakingPool, which is also the rebasing stLINK token. */
export const STLINK_TOKEN = '0xb8b295df2cd735b15be5eb419517aa626fc43cd5';
/** The first hour Curve's price API holds for the pool. */
export const PEG_HISTORY_START = '2025-04-19T00:00:00.000Z';
/** The OHLC endpoint answers HTTP 400 past roughly 250 bars, so a request asks for at most 9 days of hours. */
export const PEG_PAGE_S = 9 * 86_400;
const OHLC_ENDPOINT = 'GET prices.curve.finance/v1/ohlc';

export interface PegBar {
  hour: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** [hour, open, high, low, close], as published. */
export type PegBarRow = [string, number, number, number, number];

const OhlcResponse = z.object({
  data: z.array(z.object({ time: z.number().int(), open: z.number(), high: z.number(), low: z.number(), close: z.number() })),
});

export function pegBarsUrl(fromS: number, toS: number): string {
  const query = new URLSearchParams({
    main_token: STLINK_TOKEN,
    reference_token: LINK_TOKEN.toLowerCase(),
    agg_number: '1',
    agg_units: 'hour',
    start: String(fromS),
    end: String(toS),
  });
  return `https://prices.curve.finance/v1/ohlc/ethereum/${PEG_POOL}?${query}`;
}

const BAR_SANE = { min: 0.5, max: 1.5 } as const;

/** Hours without swaps repeat the last price. A price outside the sane band is a gap or a bogus wick in Curve's data, not a price, so the bar is dropped. */
export async function fetchPegBars(deps: HttpDeps, fromS: number, toS: number): Promise<PegBar[]> {
  if (toS - fromS > PEG_PAGE_S) throw new Error(`A Curve OHLC page of ${toS - fromS}s is over the ${PEG_PAGE_S}s one request holds`);
  const json = await getJson(deps, pegBarsUrl(fromS, toS), { endpoint: OHLC_ENDPOINT, maxRetries: 2 });
  return parseWith(OhlcResponse, json, OHLC_ENDPOINT)
    .data.filter((b) => [b.open, b.high, b.low, b.close].every((v) => Number.isFinite(v) && v >= BAR_SANE.min && v <= BAR_SANE.max))
    .map((b) => ({ hour: new Date(b.time * 1000).toISOString(), open: b.open, high: b.high, low: b.low, close: b.close }));
}

export const barRow = (b: PegBar): PegBarRow => [b.hour, b.open, b.high, b.low, b.close];

/** `bars` in hour order. */
export function pegDays(bars: readonly PegBar[]): PegBar[] {
  const days: PegBar[] = [];
  for (const b of bars) {
    const day = `${b.hour.slice(0, 10)}T00:00:00.000Z`;
    const last = days.at(-1);
    if (last?.hour === day) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
    } else {
      days.push({ hour: day, open: b.open, high: b.high, low: b.low, close: b.close });
    }
  }
  return days;
}
