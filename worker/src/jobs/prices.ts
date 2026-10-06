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
  const stored = await store.getPrices(c.env.DB, [...fetched.keys()]);
  const jumps: string[] = [];
  for (const [key, info] of fetched) {
    const old = stored.get(key);
    if (old !== undefined && isJump(old.price, info.price)) {
      fetched.delete(key);
      jumps.push(`${key} ${old.price} → ${info.price}`);
    }
  }
  await store.upsertPrices(c.env.DB, fetched, now.toISOString());
  if (jumps.length > 0) {
    await c.alert(
      'price-jump',
      `Price refresh rejected ${jumps.length} jump(s) over ${PRICE_JUMP_FACTOR}×: ${jumps.slice(0, MAX_JUMPS_LISTED).join('; ')}`,
    );
  }
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
