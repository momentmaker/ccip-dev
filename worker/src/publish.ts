import { dayOf, rollupDay, type DailyBreakdown, type Dim } from '@ccip-dev/core';
import type { RunContext } from './context';
import { lookupLabel } from './labels';
import * as store from './store';

export const SCHEMA_VERSION = 1;
export const ATTRIBUTION = 'Data: Chainlink CCIP API, DefiLlama';
export const TTL = { live: 30, today: 30, status: 30, history: 300, top: 300, reserve: 300, chains: 3600, tokens: 3600 } as const;

const LIVE_WINDOW_MINUTES = 15;

export async function putJson(
  bucket: R2Bucket,
  name: string,
  body: Record<string, unknown>,
  maxAgeSeconds: number,
  now: Date,
): Promise<void> {
  const doc = { schema_version: SCHEMA_VERSION, updated_at: now.toISOString(), attribution: ATTRIBUTION, ...body };
  await bucket.put(`v1/${name}`, JSON.stringify(doc), {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: `public, max-age=${maxAgeSeconds}` },
  });
}

export function usd(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
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
  await publishLive(c, now, names);
  await publishToday(c, now, names);
  await publishStatus(c, now);
}

async function publishLive(c: RunContext, now: Date, names: Map<string, string>): Promise<void> {
  const since = new Date(now.getTime() - LIVE_WINDOW_MINUTES * 60_000).toISOString();
  const rows = await store.liveSince(c.env.DB, since);
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
        token: r.symbol,
        usd: usd(r.usd_value),
        sender_label: senderLabel(c, names, `${r.src_chain}:${r.sender}`),
      })),
    },
    TTL.live,
    now,
  );
}

async function publishToday(c: RunContext, now: Date, names: Map<string, string>): Promise<void> {
  const day = dayOf(now);
  const { totals, breakdown } = rollupDay(day, await store.messagesForDay(c.env.DB, day), await store.tokensForDay(c.env.DB, day));
  const top = (dim: Dim) =>
    topOf(breakdown, dim, 10).map((b) => ({
      key: b.key,
      messages: b.messages,
      usd: usd(b.usd_value),
      ...(dim === 'sender' ? { label: senderLabel(c, names, b.key) } : {}),
    }));
  await putJson(
    c.env.PUBLIC,
    'today.json',
    {
      day,
      totals: { ...totals, usd_value: usd(totals.usd_value), fee_usd: usd(totals.fee_usd) },
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
