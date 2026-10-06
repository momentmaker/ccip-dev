import { addDays, dayOf, normalizeAddress, LINK_PRICE_KEY, LINK_RESERVE, LINK_TOKEN, linkFeeMatcher, linkFeeUsd, reserveStats, rollupDay, toUnits, type DailyBreakdown, type Dim, type PricedTransfer } from '@ccip-dev/core';
import type { RunContext } from './context';
import { lookupLabel } from './labels';
import * as store from './store';

export const SCHEMA_VERSION = 1;
export const ATTRIBUTION = 'Data: Chainlink CCIP API, DefiLlama';
export const TTL = { live: 30, today: 30, status: 30, history: 300, top: 300, reserve: 300, chains: 3600, tokens: 3600 } as const;

const LIVE_WINDOW_MINUTES = 15;

const RETRY_DELAYS_MS = [1000, 2000];

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function retryPut<T>(put: () => Promise<T>, sleep: (ms: number) => Promise<void> = realSleep): Promise<T> {
  for (const delay of RETRY_DELAYS_MS) {
    try {
      return await put();
    } catch {
      await sleep(delay);
    }
  }
  return put();
}

export async function putJson(
  bucket: R2Bucket,
  name: string,
  body: Record<string, unknown>,
  maxAgeSeconds: number,
  now: Date,
): Promise<void> {
  const doc = { schema_version: SCHEMA_VERSION, updated_at: now.toISOString(), attribution: ATTRIBUTION, ...body };
  await retryPut(() =>
    bucket.put(`v1/${name}`, JSON.stringify(doc), {
      httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: `public, max-age=${maxAgeSeconds}` },
    }),
  );
}

export function usd(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function feeLinkShare(feeLinkUsd: number | null, feeUsd: number | null): number | null {
  return feeLinkUsd === null || feeUsd === null || feeUsd === 0 ? null : Math.round((feeLinkUsd / feeUsd) * 10_000) / 100;
}

export function topOf(breakdown: DailyBreakdown[], dim: Dim, limit: number): DailyBreakdown[] {
  return breakdown
    .filter((b) => b.dim === dim)
    .sort((a, b) => b.usd_value - a.usd_value || b.messages - a.messages)
    .slice(0, limit);
}

export function senderLabel(c: RunContext, names: Map<string, string>, senderKey: string): string | null {
  const split = senderKey.indexOf(':');
  return lookupLabel(c.labels, names.get(senderKey.slice(0, split)), senderKey.slice(split + 1))?.name ?? null;
}

export async function publishLiveFiles(c: RunContext): Promise<void> {
  const now = c.deps.now();
  const names = await store.chainNames(c.env.DB);
  const since = new Date(now.getTime() - LIVE_WINDOW_MINUTES * 60_000).toISOString();
  const rows = await store.liveSince(c.env.DB, since);
  const today = await rollupToday(c, now);
  const symbols = await store.tokenSymbols(c.env.DB, [
    ...rows.flatMap((r) => (r.symbol === null && r.chain !== null && r.token !== null ? [{ chain: r.chain, address: r.token }] : [])),
    ...topOf(today.breakdown, 'token', TOP_LIMIT).map((b) => splitTokenKey(b.key)),
  ]);
  await publishLive(c, now, names, rows, symbols);
  await publishToday(c, now, names, today, symbols);
  await publishStatus(c, now);
}

const TOP_LIMIT = 10;

function splitTokenKey(key: string): { chain: string; address: string } {
  const split = key.indexOf(':');
  return { chain: key.slice(0, split), address: key.slice(split + 1) };
}

function symbolOf(symbols: Map<string, string>, key: string): string | null {
  const { chain, address } = splitTokenKey(key);
  return symbols.get(`${chain}:${normalizeAddress(address)}`) ?? null;
}

async function rollupToday(c: RunContext, now: Date) {
  const day = dayOf(now);
  const messages = await store.messagesForDay(c.env.DB, day);
  return { day, messages, ...rollupDay(day, messages, await store.tokensForDay(c.env.DB, day)) };
}

async function publishLive(
  c: RunContext,
  now: Date,
  names: Map<string, string>,
  rows: store.LiveRow[],
  symbols: Map<string, string>,
): Promise<void> {
  await putJson(
    c.env.PUBLIC,
    'live.json',
    {
      window_minutes: LIVE_WINDOW_MINUTES,
      messages: rows.map((r) => ({
        id: r.message_id,
        send_ts: r.send_ts,
        status: r.status,
        src: r.src_chain,
        dst: r.dst_chain,
        token: r.symbol ?? (r.chain !== null && r.token !== null ? symbolOf(symbols, `${r.chain}:${r.token}`) : null),
        usd: usd(r.usd_value),
        sender_label: senderLabel(c, names, `${r.src_chain}:${r.sender}`),
      })),
    },
    TTL.live,
    now,
  );
}

async function publishToday(
  c: RunContext,
  now: Date,
  names: Map<string, string>,
  { day, messages, totals, breakdown }: Awaited<ReturnType<typeof rollupToday>>,
  symbols: Map<string, string>,
): Promise<void> {
  const feeLink = linkFeeUsd(messages, day, linkFeeMatcher(await store.linkFeeTokens(c.env.DB)));
  const top = (dim: Dim) =>
    topOf(breakdown, dim, TOP_LIMIT).map((b) => ({
      key: b.key,
      messages: b.messages,
      usd: usd(b.usd_value),
      ...(dim === 'token' ? { symbol: symbolOf(symbols, b.key) } : {}),
      ...(dim === 'sender' ? { label: senderLabel(c, names, b.key) } : {}),
    }));
  await putJson(
    c.env.PUBLIC,
    'today.json',
    {
      day,
      totals: {
        ...totals,
        usd_value: usd(totals.usd_value),
        fee_usd: usd(totals.fee_usd),
        fee_link_usd: usd(feeLink),
        fee_link_share_pct: feeLinkShare(feeLink, totals.fee_usd),
      },
      top: { lane: top('lane'), token: top('token'), sender: top('sender') },
      arrivals: await store.recentArrivals(c.env.DB, 10),
    },
    TTL.today,
    now,
  );
}

export async function publishStatus(c: RunContext, now: Date): Promise<void> {
  const db = c.env.DB;
  const [lastIngest, lastFinalize, coverageFrom] = await Promise.all([
    store.getMeta(db, 'last_ingest_ok_at'),
    store.getMeta(db, 'last_finalize_day'),
    store.getMeta(db, 'coverage_from'),
  ]);
  await putJson(
    c.env.PUBLIC,
    'status.json',
    {
      last_ingest_ok_at: lastIngest,
      lag_seconds: lastIngest ? Math.round((now.getTime() - Date.parse(lastIngest)) / 1000) : null,
      last_finalize_day: lastFinalize,
      coverage_from: coverageFrom,
    },
    TTL.status,
    now,
  );
}

const DAY_MS = 86_400_000;

function linkUnits(raw: string): number {
  return Math.round(toUnits(raw, 18) * 100) / 100;
}

async function latestLinkPrice(c: RunContext): Promise<number | null> {
  try {
    return (await c.prices.latest([LINK_PRICE_KEY])).get(LINK_PRICE_KEY)?.price ?? null;
  } catch (err) {
    console.warn(`LINK price read failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function pricedTransfer(r: store.ReserveTransferRow): PricedTransfer {
  return { ts: r.ts, tx: r.tx_hash, direction: r.direction, counterparty: r.counterparty, amount: r.amount, linkUsd: r.link_usd };
}

export async function publishRegistryFiles(c: RunContext): Promise<void> {
  const now = c.deps.now();
  const db = c.env.DB;
  const series = await store.reserveSeries(db, new Date(now.getTime() - 90 * DAY_MS).toISOString());
  const latest = series.at(-1);
  const linkPriceUsd = await latestLinkPrice(c);
  const caughtUp = (await store.getMeta(db, 'reserve_scan_caught_up')) === '1';
  const stats = caughtUp ? reserveStats({ transfers: (await store.reserveTransfers(db)).map(pricedTransfer), linkPriceUsd, now }) : null;
  await putJson(
    c.env.PUBLIC,
    'reserve.json',
    {
      token: LINK_TOKEN,
      reserve: LINK_RESERVE,
      latest: latest ? { ts: latest.ts, link: linkUnits(latest.link_balance) } : null,
      series: series.map((s) => ({ ts: s.ts, link: linkUnits(s.link_balance) })),
      link_price_usd: linkPriceUsd === null ? null : Math.round(linkPriceUsd * 10_000) / 10_000,
      cost_basis: stats?.cost_basis ?? null,
      pace: stats?.pace ?? null,
      weekly: stats?.weekly ?? [],
      performance: stats?.performance ?? null,
      transfers: stats?.transfers ?? [],
      latest_transfer: stats?.latest_transfer ?? null,
    },
    TTL.reserve,
    now,
  );
  await putJson(c.env.PUBLIC, 'chains.json', { chains: await store.registryChains(db) }, TTL.chains, now);
  await putJson(c.env.PUBLIC, 'tokens.json', { tokens: await store.registryTokens(db) }, TTL.tokens, now);
}

const DIMS: Dim[] = ['src_chain', 'dst_chain', 'lane', 'token', 'sender'];

export async function publishHistoryFiles(c: RunContext): Promise<void> {
  const now = c.deps.now();
  const db = c.env.DB;
  const history = await store.dailyHistory(db);
  const feeLink = await store.feeLinkByDay(db);
  const since = (await store.getMeta(db, 'coverage_from')) ?? history[0]?.day ?? null;
  await putJson(
    c.env.PUBLIC,
    'history.json',
    { since, days: history.map((d) => ({ ...d, usd_value: usd(d.usd_value), fee_usd: usd(d.fee_usd), fee_link_usd: usd(feeLink.get(d.day) ?? null) })) },
    TTL.history,
    now,
  );

  const today = dayOf(now);
  const lastDay = addDays(today, -1);
  const names = await store.chainNames(db);
  for (const dim of DIMS) {
    const windows = {
      '7d': await store.topBetween(db, dim, addDays(today, -7), lastDay, 100),
      '30d': await store.topBetween(db, dim, addDays(today, -30), lastDay, 100),
      all: await store.topBetween(db, dim, null, lastDay, 100),
    };
    const symbols =
      dim === 'token'
        ? await store.tokenSymbols(db, Object.values(windows).flatMap((rows) => rows.map((r) => splitTokenKey(r.key))))
        : new Map<string, string>();
    const entries = (rows: typeof windows['all']) =>
      rows.map((r) => ({
        key: r.key,
        messages: r.messages,
        usd: usd(r.usd_value),
        fee_usd: usd(r.fee_usd),
        ...(dim === 'token' ? { symbol: symbolOf(symbols, r.key) } : {}),
        ...(dim === 'sender' ? { label: senderLabel(c, names, r.key) } : {}),
      }));
    await putJson(
      c.env.PUBLIC,
      `top/${dim}.json`,
      { dim, since, windows: { '7d': entries(windows['7d']), '30d': entries(windows['30d']), all: entries(windows.all) } },
      TTL.top,
      now,
    );
  }
}
