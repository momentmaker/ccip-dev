import type { PriceInfo } from '@ccip-dev/core';
import type { RunContext } from '../context';
import { publishStatus } from '../publish';
import * as store from '../store';

const DAY = 86_400_000;
export const PRICE_JUMP_FACTOR = 20;
const MAX_JUMPS_LISTED = 5;
const LAG_LIMIT_MINUTES = 10;

export async function runPrices(c: RunContext): Promise<void> {
  const now = c.deps.now();
  await checkIngestLag(c, now);
  await publishStatus(c, now);
  const keys = await store.keysSeenSince(c.env.DB, new Date(now.getTime() - 30 * DAY).toISOString());
  if (keys.length === 0) return;
  const fetched = await c.prices.latest(keys);
  const { accepted, jumps } = guardPriceJumps(fetched, await store.getPrices(c.env.DB, [...fetched.keys()]));
  await store.upsertPrices(c.env.DB, accepted, now.toISOString());
  await alertPriceJumps(c, 'Price refresh', jumps);
}

export interface PriceJump {
  key: string;
  from: number;
  to: number;
}

/** Splits fetched prices into those to accept and the jumps over PRICE_JUMP_FACTOR× from the stored price, which keep it. */
export function guardPriceJumps(
  fetched: Map<string, PriceInfo>,
  stored: Map<string, PriceInfo>,
): { accepted: Map<string, PriceInfo>; jumps: PriceJump[] } {
  const accepted = new Map<string, PriceInfo>();
  const jumps: PriceJump[] = [];
  for (const [key, info] of fetched) {
    const old = stored.get(key);
    if (old !== undefined && isJump(old.price, info.price)) jumps.push({ key, from: old.price, to: info.price });
    else accepted.set(key, info);
  }
  return { accepted, jumps };
}

export async function alertPriceJumps(c: RunContext, source: string, jumps: PriceJump[]): Promise<void> {
  if (jumps.length === 0) return;
  const listed = jumps.slice(0, MAX_JUMPS_LISTED).map((j) => `${j.key} ${j.from} → ${j.to}`);
  await c.alert('price-jump', `${source} rejected ${jumps.length} jump(s) over ${PRICE_JUMP_FACTOR}×: ${listed.join('; ')}`);
}

function isJump(oldPrice: number, newPrice: number): boolean {
  return newPrice > oldPrice * PRICE_JUMP_FACTOR || newPrice < oldPrice / PRICE_JUMP_FACTOR;
}

export async function checkIngestLag(c: RunContext, now: Date): Promise<void> {
  const last = await store.getMeta(c.env.DB, 'last_ingest_ok_at');
  if (last !== null) {
    const lagMinutes = (now.getTime() - Date.parse(last)) / 60_000;
    if (lagMinutes > LAG_LIMIT_MINUTES) {
      await c.alert('ingest-lag', `Ingest is ${Math.round(lagMinutes)} minutes behind (last success ${last})`);
    }
    return;
  }

  const watchSince = await store.getMeta(c.env.DB, 'lag_watch_since');
  if (watchSince === null) {
    await store.setMeta(c.env.DB, 'lag_watch_since', now.toISOString());
    return;
  }

  const lagMinutes = (now.getTime() - Date.parse(watchSince)) / 60_000;
  if (lagMinutes > LAG_LIMIT_MINUTES) {
    await c.alert('ingest-lag', `Ingest has not succeeded since ${watchSince}`);
  }
}
