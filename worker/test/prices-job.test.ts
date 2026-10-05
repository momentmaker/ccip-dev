import { fakePrices } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { runPrices } from '../src/jobs/prices';
import * as store from '../src/store';
import { harness, readPublic, resetStorage } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-10-08T12:00:00.000Z';

describe('runPrices', () => {
  it('refreshes only keys used in the last 30 days', async () => {
    await store.upsertPrices(env.DB, new Map([['base:0xold', { price: 1, decimals: 18 }]]), '2026-08-01T00:00:00.000Z');
    await store.upsertPrices(env.DB, new Map([['base:0xnew', { price: 1, decimals: 18 }]]), '2026-10-07T00:00:00.000Z');
    const prices = fakePrices({ latest: { 'base:0xnew': { price: 5, decimals: 18 } } });
    await runPrices(harness({ now: NOW, prices }).c);
    expect(prices.latestCalls).toEqual([['base:0xnew']]);
    expect((await store.getPrices(env.DB, ['base:0xnew'])).get('base:0xnew')).toEqual({ price: 5, decimals: 18 });
  });

  it('alerts when ingest is more than 10 minutes behind, and not otherwise', async () => {
    await store.setMeta(env.DB, 'last_ingest_ok_at', '2026-10-08T11:49:00.000Z');
    const late = harness({ now: NOW });
    await runPrices(late.c);
    expect(late.alerts.map((a) => a.signature)).toEqual(['ingest-lag']);

    await store.setMeta(env.DB, 'last_ingest_ok_at', '2026-10-08T11:51:00.000Z');
    const fine = harness({ now: NOW });
    await runPrices(fine.c);
    expect(fine.alerts).toEqual([]);
  });

  it('still checks lag when the price refresh fails', async () => {
    await store.setMeta(env.DB, 'last_ingest_ok_at', '2026-10-08T11:00:00.000Z');
    await store.upsertPrices(env.DB, new Map([['base:0xnew', { price: 1, decimals: 18 }]]), NOW);
    const prices = { ...fakePrices(), latest: async () => { throw new Error('llama down'); } };
    const { c, alerts } = harness({ now: NOW, prices });
    await expect(runPrices(c)).rejects.toThrow('llama down');
    expect(alerts.map((a) => a.signature)).toEqual(['ingest-lag']);
  });

  it('republishes status.json so the lag keeps rising while ingest is down', async () => {
    await store.setMeta(env.DB, 'last_ingest_ok_at', '2026-10-08T11:49:00.000Z');
    await runPrices(harness({ now: NOW }).c);
    expect(await readPublic('status.json')).toMatchObject({ lag_seconds: 660 });
  });
});
