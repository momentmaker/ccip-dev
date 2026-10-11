import type { Env } from '../src/env';
import {
  firstCheckAt, LINK_RESERVE, RESERVE_FIRST_BLOCK, normalizeList, normalizeRegistryToken, toMessageRow, type LabelIndex, type MessageRow, type NetworkInfo, type RegistryToken,
} from '@ccip-dev/core';
import {
  fakeCcip, fakeCoingecko, fakeFetch, fakePrices, jsonResponse, listMessage, type FakeCcip, type FakeFetch, type FakeCoingecko, type FakePrices, type ListMessageSpec,
} from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import type { Alert } from '../src/alerts';
import { createRunContext, type RunContext } from '../src/context';
import type { Deps } from '../src/deps';
import * as store from '../src/store';

const TABLES = [
  'messages', 'message_tokens', 'daily_totals', 'daily_breakdown', 'chains', 'tokens', 'arrivals',
  'reserve_snapshots', 'prices_latest', 'meta', 'coingecko_ids', 'reserve_transfers',
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
  env?: Partial<Env>;
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
  const c = createRunContext({ ...env, ...(opts.db ? { DB: opts.db } : {}), ...opts.env }, deps, {
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
  const valuation = { usdValue: 0, unpriced: false, tokenUsd: m.tokens.map(() => null), outliers: [] };
  return { ...toMessageRow(m, valuation, { source: 'live', nextCheckAt: firstCheckAt(m.sendTs) }), ...extras };
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const topicOf = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;

/** A LINK Transfer log as eth_getLogs returns it, with blockTimestamp. */
export function transferLog(o: { block: number; index: number; tx: string; direction: 'in' | 'out'; counterparty: string; link: bigint; ts: string }) {
  const [from, to] = o.direction === 'in' ? [o.counterparty, LINK_RESERVE] : [LINK_RESERVE, o.counterparty];
  return {
    blockNumber: `0x${o.block.toString(16)}`,
    logIndex: `0x${o.index.toString(16)}`,
    transactionHash: o.tx,
    topics: [TRANSFER_TOPIC, topicOf(from), topicOf(to)],
    data: `0x${(o.link * 10n ** 18n).toString(16).padStart(64, '0')}`,
    blockTimestamp: `0x${(Date.parse(o.ts) / 1000).toString(16)}`,
  };
}

export interface RpcFakeOptions {
  /** eth_blockNumber; the default puts the confirmed head at RESERVE_FIRST_BLOCK. */
  head?: number;
  /** eth_call at 'latest', in LINK. */
  balanceLink?: bigint;
  /** eth_call at a block number, in raw units. Defaults to 0. */
  balanceAt?: (block: number) => bigint;
  /** Logs for one eth_getLogs call. */
  logs?: (call: { fromBlock: number; toBlock: number; direction: 'in' | 'out' }) => unknown[];
  down?: boolean;
}

/** An Ethereum JSON-RPC endpoint that answers by method. */
export function rpcFake(opts: RpcFakeOptions = {}): FakeFetch {
  return fakeFetch((_url, init) => {
    if (opts.down) return jsonResponse({}, 503);
    const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: any[] };
    const ok = (result: unknown) => jsonResponse({ jsonrpc: '2.0', id: 1, result });
    if (method === 'eth_blockNumber') return ok(`0x${(opts.head ?? RESERVE_FIRST_BLOCK + 12).toString(16)}`);
    if (method === 'eth_call') {
      const tag = params[1] as string;
      const raw = tag === 'latest' ? (opts.balanceLink ?? 0n) * 10n ** 18n : (opts.balanceAt?.(Number(BigInt(tag))) ?? 0n);
      return ok(`0x${raw.toString(16)}`);
    }
    if (method === 'eth_getLogs') {
      const filter = params[0] as { fromBlock: string; toBlock: string; topics: (string | null)[] };
      const direction = filter.topics[1] === null ? 'in' : 'out';
      return ok(opts.logs?.({ fromBlock: Number(BigInt(filter.fromBlock)), toBlock: Number(BigInt(filter.toBlock)), direction }) ?? []);
    }
    return jsonResponse({ jsonrpc: '2.0', id: 1, error: { message: `unexpected ${method}` } });
  });
}
