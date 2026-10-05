import type { RunContext } from '../context';
import { publishStatus } from '../publish';
import * as store from '../store';

const DAY = 86_400_000;
const LAG_LIMIT_MINUTES = 10;

export async function runPrices(c: RunContext): Promise<void> {
  const now = c.deps.now();
  await checkIngestLag(c, now);
  await publishStatus(c, now);
  const keys = await store.keysSeenSince(c.env.DB, new Date(now.getTime() - 30 * DAY).toISOString());
  if (keys.length > 0) await store.upsertPrices(c.env.DB, await c.prices.latest(keys), now.toISOString());
}

export async function checkIngestLag(c: RunContext, now: Date): Promise<void> {
  const last = await store.getMeta(c.env.DB, 'last_ingest_ok_at');
  if (last === null) return;
  const lagMinutes = (now.getTime() - Date.parse(last)) / 60_000;
  if (lagMinutes > LAG_LIMIT_MINUTES) {
    await c.alert('ingest-lag', `Ingest is ${Math.round(lagMinutes)} minutes behind (last success ${last})`);
  }
}
