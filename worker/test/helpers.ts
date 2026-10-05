import {
  firstCheckAt, normalizeList, normalizeRegistryToken, toMessageRow, type LabelIndex, type MessageRow, type NetworkInfo, type RegistryToken,
} from '@ccip-dev/core';
import { fakeCcip, fakePrices, listMessage, type FakeCcip, type FakePrices, type ListMessageSpec } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import type { Alert } from '../src/alerts';
import { createRunContext, type RunContext } from '../src/context';
import type { Deps } from '../src/deps';
import * as store from '../src/store';

const TABLES = [
  'messages', 'message_tokens', 'daily_totals', 'daily_breakdown', 'chains', 'tokens', 'arrivals',
  'reserve_snapshots', 'prices_latest', 'meta',
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
  labels?: LabelIndex;
  fetch?: typeof fetch;
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
  const c = createRunContext(env, deps, {
    ccip: opts.ccip ?? fakeCcip(),
    prices: opts.prices ?? fakePrices(),
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
