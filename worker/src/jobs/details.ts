import {
  DetailMessage, fallbackKeys, groupFallback, issuePath, normalizeDetail, priceKeys, scheduleNextCheck, toMessageRow, toTokenRows,
  valueFee, valueTokens, type NormalizedMessage, type PriceInfo, type TokenGroupIndex,
} from '@ccip-dev/core';
import type { RunContext } from '../context';
import * as store from '../store';

const MINUTE = 60_000;

export async function runDetails(
  c: RunContext,
  scope: { limit: number } | { day: string },
  options: { deadline?: number; groups?: TokenGroupIndex } = {},
): Promise<void> {
  const ids =
    'day' in scope
      ? await store.liveMissingDetail(c.env.DB, scope.day)
      : await store.dueForDetail(c.env.DB, c.deps.now().toISOString(), scope.limit);
  if (ids.length === 0) return;
  const groups = options.groups ?? (await store.tokenGroups(c.env.DB));
  for (const id of ids) {
    if (options.deadline !== undefined && c.deps.now().getTime() > options.deadline) {
      console.warn(`detail fill stopped at its deadline; ${ids.length - ids.indexOf(id)} message(s) left for the per-minute job`);
      return;
    }
    await fillOne(c, id, groups);
  }
}

async function fillOne(c: RunContext, id: string, groups: TokenGroupIndex): Promise<void> {
  const db = c.env.DB;
  const now = c.deps.now();
  const later = (minutes: number) => new Date(now.getTime() + minutes * MINUTE).toISOString();

  let raw: unknown;
  try {
    raw = await c.ccip.getMessageRaw(id);
  } catch (err) {
    console.warn(`detail fetch failed for ${id}: ${err instanceof Error ? err.message : String(err)}`);
    await store.pushBack(db, id, later(10), now.toISOString());
    return;
  }

  const parsed = DetailMessage.safeParse(raw);
  if (!parsed.success) {
    const path = issuePath(parsed.error);
    await c.env.ARCHIVE.put(`unparsed/${id}.json`, JSON.stringify(raw));
    await store.pushBack(db, id, later(60), now.toISOString());
    await c.alert(`detail-schema:${path}`, `Detail response for ${id} failed validation at ${path}; raw saved to unparsed/${id}.json`);
    return;
  }

  const { message, version, feeShapeUnknown } = normalizeDetail(parsed.data);
  if (feeShapeUnknown) {
    await c.env.ARCHIVE.put(`unparsed/${id}.json`, JSON.stringify(raw));
    const label = version ?? 'unknown';
    const alertedKey = `alerted-fee-version:${label}`;
    if ((await store.getMeta(db, alertedKey)) === null) {
      await c.alert(`fee-version:${label}`, `Unknown fee format for CCIP version ${label} (message ${id})`);
      await store.setMeta(db, alertedKey, now.toISOString());
    }
  }

  const prices = await ensurePrices(c, message, groups);
  const lookup = (key: string) => prices.get(key);
  const valuation = valueTokens(message.tokens, lookup, groupFallback(groups, lookup));
  const next = scheduleNextCheck(message.status, message.readyForManualExec, message.sendTs, now);
  const row = toMessageRow({ ...message, status: next.status }, valuation, {
    source: 'live',
    feeUsd: valueFee(message.fee, message.src, lookup),
    detailFetchedAt: now.toISOString(),
    nextCheckAt: next.nextCheckAt,
  });
  await store.applyDetail(db, row, toTokenRows(message, valuation));
}

/**
 * Prices a message's own keys, then the group siblings of its tokens that are still unpriced. Siblings are stored and
 * marked seen like any other key, so the prices job keeps them fresh.
 */
export async function ensurePrices(c: RunContext, message: NormalizedMessage, groups: TokenGroupIndex): Promise<Map<string, PriceInfo>> {
  const prices = await ensureKeys(c, priceKeys(message));
  const siblings = fallbackKeys(groups, message.tokens, (key) => prices.get(key)).filter((key) => !prices.has(key));
  for (const [key, info] of await ensureKeys(c, siblings)) prices.set(key, info);
  return prices;
}

async function ensureKeys(c: RunContext, keys: string[]): Promise<Map<string, PriceInfo>> {
  const db = c.env.DB;
  const nowIso = c.deps.now().toISOString();
  const prices = await store.getPrices(db, keys);
  const missing = keys.filter((k) => !prices.has(k));
  if (missing.length > 0) {
    try {
      const fetched = await c.prices.latest(missing);
      await store.upsertPrices(db, fetched, nowIso);
      for (const [key, info] of fetched) prices.set(key, info);
    } catch (err) {
      await c.alert('prices-fetch', `Price fetch failed; ${missing.length} key(s) stay unpriced: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await store.touchPrices(db, keys, nowIso);
  return prices;
}
