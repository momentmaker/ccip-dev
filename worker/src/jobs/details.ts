import {
  DetailMessage, issuePath, normalizeDetail, priceKeys, scheduleNextCheck, toMessageRow, toTokenRows, valueFee, valueTokens,
  type PriceInfo,
} from '@ccip-dev/core';
import type { RunContext } from '../context';
import * as store from '../store';

const MINUTE = 60_000;

export async function runDetails(c: RunContext, scope: { limit: number } | { day: string }): Promise<void> {
  const ids =
    'day' in scope
      ? await store.liveMissingDetail(c.env.DB, scope.day)
      : await store.dueForDetail(c.env.DB, c.deps.now().toISOString(), scope.limit);
  for (const id of ids) await fillOne(c, id);
}

async function fillOne(c: RunContext, id: string): Promise<void> {
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

  const prices = await ensurePrices(c, priceKeys(message));
  const lookup = (key: string) => prices.get(key);
  const valuation = valueTokens(message.tokens, lookup);
  const next = scheduleNextCheck(message.status, message.readyForManualExec, message.sendTs, now);
  const row = toMessageRow({ ...message, status: next.status }, valuation, {
    source: 'live',
    feeUsd: valueFee(message.fee, message.src, lookup),
    detailFetchedAt: now.toISOString(),
    nextCheckAt: next.nextCheckAt,
  });
  await store.applyDetail(db, row, toTokenRows(message, valuation));
}

export async function ensurePrices(c: RunContext, keys: string[]): Promise<Map<string, PriceInfo>> {
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
