import { fakePrices } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { PRICE_JUMP_FACTOR, runPrices } from '../src/jobs/prices';
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

  it('alerts when ingest has never succeeded (broken first deploy)', async () => {
    const first = harness({ now: NOW });
    await runPrices(first.c);
    expect(first.alerts).toEqual([]);
    expect(await store.getMeta(env.DB, 'lag_watch_since')).toBe(NOW);

    const later = harness({ now: '2026-10-08T12:11:00.000Z' });
    await runPrices(later.c);
    expect(later.alerts.map((a) => a.signature)).toEqual(['ingest-lag']);
  });

  describe('price jump guard', () => {
    const OLD = '2026-10-08T11:55:00.000Z';

    async function seedStored(): Promise<void> {
      await store.upsertPrices(env.DB, new Map([
        ['base:0xjump', { price: 2, decimals: 18 }],
        ['base:0xmove', { price: 2, decimals: 18 }],
        ['base:0xdrop', { price: 100, decimals: 18 }],
      ]), OLD);
    }

    it('keeps the old price of a key that jumps 25x, accepts a 3x move, and sends one alert', async () => {
      await seedStored();
      const prices = fakePrices({
        latest: {
          'base:0xjump': { price: 50, decimals: 18 },
          'base:0xmove': { price: 6, decimals: 18 },
          'base:0xdrop': { price: 1, decimals: 18 },
        },
      });
      const { c, alerts } = harness({ now: NOW, prices });
      await runPrices(c);

      const stored = await env.DB.prepare('SELECT llama_key, usd, ts FROM prices_latest ORDER BY llama_key').all();
      expect(stored.results).toEqual([
        { llama_key: 'base:0xdrop', usd: 100, ts: OLD },
        { llama_key: 'base:0xjump', usd: 2, ts: OLD },
        { llama_key: 'base:0xmove', usd: 6, ts: NOW },
      ]);
      expect(alerts).toEqual([
        {
          signature: 'price-jump',
          text: 'Price refresh rejected 2 jump(s) over 20×: base:0xdrop 100 → 1; base:0xjump 2 → 50',
        },
      ]);
      expect(PRICE_JUMP_FACTOR).toBe(20);
    });

    it('accepts keys with no stored price and sends no alert', async () => {
      await store.upsertPrices(env.DB, new Map([['base:0xnew', { price: 1, decimals: 18 }]]), OLD);
      const prices = fakePrices({ latest: { 'base:0xnew': { price: 1.5, decimals: 18 } } });
      const { c, alerts } = harness({ now: NOW, prices });
      await runPrices(c);
      expect(alerts).toEqual([]);
    });
  });
});
