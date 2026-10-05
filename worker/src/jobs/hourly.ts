import { addDays, dayOf, DEFAULT_RPC_URLS, normalizeRegistryToken, readLinkBalance, type NormalizedToken } from '@ccip-dev/core';
import type { RunContext } from '../context';
import type { Env } from '../env';
import { publishRegistryFiles } from '../publish';
import * as store from '../store';

const TOKEN_PAGE = 500;
const MAX_TOKEN_PAGES = 50;
const RESERVE_ALERT_AFTER = 3;

export async function runHourly(c: RunContext): Promise<void> {
  await recordReserve(c);
  await snapshotRegistry(c);
  await publishRegistryFiles(c);
}

export function rpcUrls(env: Env): string[] {
  const urls = [env.RPC_ETHEREUM ?? '', ...(env.RPC_FALLBACKS ?? '').split(',')].map((u) => u.trim()).filter((u) => u.length > 0);
  return urls.length > 0 ? urls : DEFAULT_RPC_URLS;
}

async function recordReserve(c: RunContext): Promise<void> {
  const db = c.env.DB;
  try {
    const balance = await readLinkBalance(c.deps, rpcUrls(c.env));
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
  const tokens = await listAllTokens(c);

  const baseline = (await store.countRows(db, 'chains')) === 0 || (await store.countRows(db, 'tokens')) === 0;
  const announcedAt = baseline ? nowIso : null;

  await store.upsertChains(db, chains, nowIso);
  await store.insertArrivals(db, 'chain', chains.map((ch) => ch.chainSelector), nowIso, announcedAt);
  await store.upsertTokens(db, tokens, nowIso);
  await store.insertArrivals(db, 'token', tokens.map((t) => `${t.chain}:${t.address}`), nowIso, announcedAt);

  const laneBaseline = (await store.countArrivals(db, 'lane')) === 0;
  await store.insertLaneArrivals(db, addDays(dayOf(now), -2), laneBaseline);
}

async function listAllTokens(c: RunContext): Promise<NormalizedToken[]> {
  const tokens: NormalizedToken[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_TOKEN_PAGES; page++) {
    const result = await c.ccip.listTokens({ limit: TOKEN_PAGE, cursor });
    tokens.push(...result.tokens.map(normalizeRegistryToken));
    if (result.cursor === null) return tokens;
    cursor = result.cursor;
  }
  throw new Error(`token registry did not end within ${MAX_TOKEN_PAGES} pages`);
}
