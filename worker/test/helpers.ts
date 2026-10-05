import {
  firstCheckAt, normalizeList, normalizeRegistryToken, toMessageRow, type LabelIndex, type MessageRow, type NetworkInfo, type RegistryToken,
} from '@ccip-dev/core';
import {
  fakeCcip, fakeCoingecko, fakePrices, listMessage, type FakeCcip, type FakeCoingecko, type FakePrices, type ListMessageSpec,
} from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import type { Alert } from '../src/alerts';
import { createRunContext, type RunContext } from '../src/context';
import type { Deps } from '../src/deps';
import * as store from '../src/store';

const TABLES = [
  'messages', 'message_tokens', 'daily_totals', 'daily_breakdown', 'chains', 'tokens', 'arrivals',
  'reserve_snapshots', 'prices_latest', 'meta', 'coingecko_ids',
];

export async function resetStorage(): Promise<void> {
  await env.DB.batch(TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  for (const bucket of [env.PUBLIC, env.ARCHIVE]) {
    const listed = await bucket.list();
    await Promise.all(listed.objects.map((o) => bucket.delete(o.key)));
  }
}

export interface Harness {
  c: RunContext;
  alerts: { signature: string; text: string }[];
  setNow(iso: string): void;
}

export function harness(opts: {
  now: string;
  ccip?: FakeCcip | RunContext['ccip'];
  prices?: FakePrices | RunContext['prices'];
  coingecko?: FakeCoingecko | RunContext['coingecko'];
  labels?: LabelIndex;
  fetch?: typeof fetch;
  db?: D1Database;
}): Harness {
  let now = new Date(opts.now);
  const alerts: { signature: string; text: string }[] = [];
  const alert: Alert = async (signature, text) => {
    alerts.push({ signature, text });
  };
  const deps: Deps = {
    fetch: opts.fetch ?? ((async () => { throw new Error('unexpected network call in test'); }) as unknown as typeof fetch),
    sleep: async () => {},
    clock: () => 0,
    now: () => now,
  };
  const c = createRunContext(opts.db ? { ...env, DB: opts.db } : env, deps, {
    ccip: opts.ccip ?? fakeCcip(),
    prices: opts.prices ?? fakePrices(),
    coingecko: opts.coingecko ?? fakeCoingecko(),
    alert,
    labels: opts.labels ?? {},
  });
  return { c, alerts, setNow: (iso) => { now = new Date(iso); } };
}

export async function readPublic(name: string): Promise<Record<string, any>> {
  const object = await env.PUBLIC.get(`v1/${name}`);
  if (!object) throw new Error(`v1/${name} was not published`);
  return object.json();
}

/** env.DB, counting the statements whose SQL matches `pattern`; with `fail`, preparing one throws as an unavailable D1 would. */
export function watchedDb(pattern: RegExp, options: { fail?: boolean } = {}): { db: D1Database; prepared: () => number } {
  let prepared = 0;
  const db = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === 'prepare') {
        return (sql: string) => {
          if (pattern.test(sql)) {
            prepared += 1;
            if (options.fail) throw new Error('D1_ERROR: no such table: tokens');
          }
          return target.prepare(sql);
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { db, prepared: () => prepared };
}

/** Matches only the token-group query, store.tokenGroups. */
export const TOKEN_GROUPS_SQL = /FROM tokens t LEFT JOIN chains c/;

/** Matches only the query that reads the CoinGecko id mapping, store.coingeckoIds. */
export const COINGECKO_IDS_SQL = /SELECT chain, address, coin_id FROM coingecko_ids/;

/** Stores registry chains and tokens as the hourly snapshot does. */
export async function seedRegistry(chains: NetworkInfo[], tokens: RegistryToken[]): Promise<void> {
  const seenAt = '2026-10-01T00:00:00.000Z';
  await store.upsertChains(env.DB, chains, seenAt);
  await store.upsertTokens(env.DB, tokens.map(normalizeRegistryToken), seenAt);
}

export function liveRow(spec: ListMessageSpec, extras: Partial<MessageRow> = {}): MessageRow {
  const m = normalizeList(listMessage(spec));
  const valuation = { usdValue: 0, unpriced: false, tokenUsd: m.tokens.map(() => null) };
  return { ...toMessageRow(m, valuation, { source: 'live', nextCheckAt: firstCheckAt(m.sendTs) }), ...extras };
}
