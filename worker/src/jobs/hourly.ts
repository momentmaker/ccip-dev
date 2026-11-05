import {
  addDays, buildCoingeckoIdIndex, dayOf, listAllTokens, normalizeRegistryToken, readLinkBalance,
} from '@ccip-dev/core';
import { broadcastHourly } from '../broadcasts/run';
import type { RunContext } from '../context';
import { retagCre } from '../cre-retag';
import { publishRegistryFiles, refreshDayLeaders } from '../publish';
import { balanceRpcUrls } from '../rpc';
import * as store from '../store';
import { rollForwardMonths } from '../monthly-rollup';
import { backfillViaToken } from '../via-token-backfill';
import { catchUpPublish } from './finalize';
import { runReserveTransfers } from './reserve';

const RESERVE_ALERT_AFTER = 3;

export async function runHourly(c: RunContext): Promise<void> {
  await recordReserve(c);
  await runReserveTransfers(c);
  let registryError: unknown = null;
  try {
    await snapshotRegistry(c);
  } catch (err) {
    registryError = err;
  }
  const reserve = await publishRegistryFiles(c);
  await refreshDayLeadersOrAlert(c);
  await rollForwardMonthsOrAlert(c);
  await catchUpPublish(c);
  await broadcastHourly(c, reserve);
  await refreshCoingeckoIds(c);
  await backfillViaTokenHistory(c);
  await retagCreOrAlert(c);
  if (registryError !== null) throw registryError;
}

/** A failed refresh leaves the stored days as they are (day-leaders.json still serves them) and is retried next hour. */
async function refreshDayLeadersOrAlert(c: RunContext): Promise<void> {
  try {
    await refreshDayLeaders(c);
  } catch (err) {
    await c.alert('day-leaders-refresh', `The stored day leaders were not refreshed, and are retried next hour: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Until a month is rolled, all-time readers take its daily rows, so a failed roll only waits for the next hour. */
async function rollForwardMonthsOrAlert(c: RunContext): Promise<void> {
  try {
    await rollForwardMonths(c);
  } catch (err) {
    await c.alert('monthly-rollup', `Rolling up the completed months failed, and is retried next hour: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** History only: a failure is retried from the cursor next hour, and never holds up the rest of the hour. */
async function backfillViaTokenHistory(c: RunContext): Promise<void> {
  try {
    await backfillViaToken(c);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await c.alert('via-token-backfill', `The via_token history backfill failed and is retried next hour from its cursor: ${detail}`);
  }
}

/** A failed re-tag keeps its place in meta and is retried next hour. */
async function retagCreOrAlert(c: RunContext): Promise<void> {
  try {
    await retagCre(c);
  } catch (err) {
    await c.alert('cre-retag', `CRE re-tagging stopped and is retried next hour: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function recordReserve(c: RunContext): Promise<void> {
  const db = c.env.DB;
  try {
    const balance = await readLinkBalance(c.deps, balanceRpcUrls(c.env));
    await store.insertReserve(db, c.deps.now().toISOString(), balance.toString());
    await store.setMeta(db, 'reserve_failures', '0');
  } catch (err) {
    const failures = Number((await store.getMeta(db, 'reserve_failures')) ?? '0') + 1;
    await store.setMeta(db, 'reserve_failures', String(failures));
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Reserve read failed (${failures} in a row): ${message}`);
    if (failures >= RESERVE_ALERT_AFTER) {
      await c.alert('reserve-read', `Reserve balance read failed ${failures} hours in a row: ${message}`);
    }
  }
}

async function snapshotRegistry(c: RunContext): Promise<void> {
  const db = c.env.DB;
  const now = c.deps.now();
  const nowIso = now.toISOString();

  const chains = await c.ccip.listChains();
  const tokens = (await listAllTokens(c.ccip)).map(normalizeRegistryToken);

  const baseline = (await store.countRows(db, 'chains')) === 0 || (await store.countRows(db, 'tokens')) === 0;
  const announcedAt = baseline ? nowIso : null;

  await store.upsertChains(db, chains, nowIso);
  await store.insertArrivals(db, 'chain', chains.map((ch) => ch.chainSelector), nowIso, announcedAt);
  await store.upsertTokens(db, tokens, nowIso);
  await store.insertArrivals(db, 'token', tokens.map((t) => `${t.chain}:${t.address}`), nowIso, announcedAt);

  const laneBaseline = (await store.countArrivals(db, 'lane')) === 0;
  await store.insertLaneArrivals(db, addDays(dayOf(now), -2), laneBaseline);
}

/**
 * Maps the registry tokens to CoinGecko coin ids for the price fallback, once a UTC day after a refresh succeeds. Keyless
 * CoinGecko often refuses Cloudflare's shared IPs, so a failed refresh is retried every hour and alerts once a day. A
 * refresh that would leave no rows, or fewer than half the stored ones, counts as failed and is not applied.
 */
async function refreshCoingeckoIds(c: RunContext): Promise<void> {
  const db = c.env.DB;
  const now = c.deps.now();
  const today = dayOf(now);
  if ((await store.getMeta(db, 'coingecko_ids_day')) === today) return;
  let stored = 0;
  try {
    stored = await store.countCoingeckoIds(db);
    const ids = await mapRegistryTokens(c);
    if (ids.length === 0 || ids.length < stored / 2) {
      throw new Error(`the refresh mapped ${ids.length} registry tokens against ${stored} stored, so it was not applied`);
    }
    await store.replaceCoingeckoIds(db, ids, now.toISOString());
    await store.setMeta(db, 'coingecko_ids_day', today);
  } catch (err) {
    if ((await store.getMeta(db, 'coingecko_ids_alerted_day')) === today) return;
    const kept =
      stored > 0 ? 'the previous mapping stays' : 'there is no mapping yet, so live tokens their group cannot price stay unpriced';
    const detail = err instanceof Error ? err.message : String(err);
    await c.alert('coingecko-ids', `CoinGecko ids could not be refreshed and are retried hourly; ${kept}: ${detail}`);
    await store.setMeta(db, 'coingecko_ids_alerted_day', today);
  }
}

async function mapRegistryTokens(c: RunContext): Promise<{ chain: string; address: string; coinId: string }[]> {
  const coinIdOf = buildCoingeckoIdIndex(await c.coingecko.lists());
  return (await store.registryTokenChains(c.env.DB)).flatMap((token) => {
    const coinId = coinIdOf(token, token.address);
    return coinId === undefined ? [] : [{ chain: token.selector, address: token.address, coinId }];
  });
}
