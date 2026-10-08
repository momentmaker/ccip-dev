import {
  DetailMessage, issuePath, normalizeDetail, priceKeys, scheduleNextCheck, toMessageRow, toTokenRows, valueFee, valueTokens,
  type NormalizedMessage, type PriceFallback, type PriceInfo, type PriceLookup,
} from '@ccip-dev/core';
import type { RunContext } from '../context';
import * as store from '../store';
import { fallbackLoader, priceFallback, type FallbackLoader } from '../price-fallback';
import { alertPriceOutliers } from '../price-outliers';
import { alertPriceJumps, guardPriceJumps } from './prices';

const MINUTE = 60_000;
const MAX_PRICE_AGE_MINUTES = 15;

export async function runDetails(
  c: RunContext,
  scope: { limit: number } | { day: string },
  options: { deadline?: number; fallback?: FallbackLoader } = {},
): Promise<void> {
  const ids =
    'day' in scope
      ? await store.liveNeedingDetail(c.env.DB, scope.day)
      : await store.dueForDetail(c.env.DB, c.deps.now().toISOString(), scope.limit);
  const loader = options.fallback ?? fallbackLoader(c);
  const outliers: string[] = [];
  for (const id of ids) {
    if (options.deadline !== undefined && c.deps.now().getTime() > options.deadline) {
      console.warn(`detail fill stopped at its deadline; ${ids.length - ids.indexOf(id)} message(s) left for the per-minute job`);
      break;
    }
    outliers.push(...(await fillOne(c, id, loader)));
  }
  await alertPriceOutliers(c, outliers);
}

/** Returns the token amounts valued above MAX_TRANSFER_USD, which were stored unpriced. */
async function fillOne(c: RunContext, id: string, loader: FallbackLoader): Promise<string[]> {
  const db = c.env.DB;
  const now = c.deps.now();
  const later = (minutes: number) => new Date(now.getTime() + minutes * MINUTE).toISOString();

  let raw: unknown;
  try {
    raw = await c.ccip.getMessageRaw(id);
  } catch (err) {
    console.warn(`detail fetch failed for ${id}: ${err instanceof Error ? err.message : String(err)}`);
    await store.pushBack(db, id, later(10), now.toISOString());
    return [];
  }

  const parsed = DetailMessage.safeParse(raw);
  if (!parsed.success) {
    const path = issuePath(parsed.error);
    await c.env.ARCHIVE.put(`unparsed/${id}.json`, JSON.stringify(raw));
    await store.pushBack(db, id, later(60), now.toISOString());
    await c.alert(`detail-schema:${path}`, `Detail response for ${id} failed validation at ${path}; raw saved to unparsed/${id}.json`);
    return [];
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

  const { lookup, fallback } = await ensurePrices(c, message, loader);
  const valuation = valueTokens(message.tokens, lookup, fallback);
  const next = scheduleNextCheck(message.status, message.readyForManualExec, message.sendTs, now);
  const row = toMessageRow({ ...message, status: next.status }, valuation, {
    source: 'live',
    feeUsd: valueFee(message.fee, message.src, lookup),
    detailFetchedAt: now.toISOString(),
    nextCheckAt: next.nextCheckAt,
  });
  await store.applyDetail(db, row, toTokenRows(message, valuation));
  return valuation.outliers;
}

/**
 * Prices a message's own keys, then the group siblings of its tokens that are still unpriced, then the `coingecko:` keys
 * of those its group cannot price. All are stored and marked seen like any other key, so the prices job keeps them fresh.
 */
export async function ensurePrices(
  c: RunContext,
  message: NormalizedMessage,
  loader: FallbackLoader,
): Promise<{ lookup: PriceLookup; fallback: PriceFallback | undefined }> {
  const prices = await ensureKeys(c, priceKeys(message));
  const fallback = await priceFallback(loader, message.tokens, prices, (keys) => ensureKeys(c, keys));
  return { lookup: (key) => prices.get(key), fallback };
}

async function ensureKeys(c: RunContext, keys: string[]): Promise<Map<string, PriceInfo>> {
  const db = c.env.DB;
  const nowIso = c.deps.now().toISOString();
  const freshSince = new Date(c.deps.now().getTime() - MAX_PRICE_AGE_MINUTES * MINUTE).toISOString();
  const prices = await store.getPrices(db, keys, freshSince);
  const missing = keys.filter((k) => !prices.has(k));
  if (missing.length > 0) {
    try {
      const fetched = await c.prices.latest(missing);
      const stored = await store.getPrices(db, [...fetched.keys()]);
      const { accepted, jumps } = guardPriceJumps(fetched, stored);
      await store.upsertPrices(db, accepted, nowIso);
      for (const [key, info] of accepted) prices.set(key, info);
      for (const { key } of jumps) prices.set(key, stored.get(key)!);
      await alertPriceJumps(c, 'Detail price fetch', jumps);
    } catch (err) {
      await c.alert('prices-fetch', `Price fetch failed; ${missing.length} key(s) stay unpriced: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await store.touchPrices(db, keys, nowIso);
  return prices;
}
