import { describe, expect, it } from 'vitest';
import { COIN_PRICE_DECIMALS, coingeckoKey, createPricesClient, isCoingeckoKey } from '../src/prices';
import { fakeFetch, instantDeps, jsonResponse } from '../src/testing';

describe('createPricesClient', () => {
  it('fetches current prices in batches of 100 and drops entries without decimals', async () => {
    const keys = Array.from({ length: 150 }, (_, i) => `base:0x${i.toString(16).padStart(40, '0')}`);
    const f = fakeFetch((url) => {
      const requested = decodeURIComponent(new URL(url).pathname.replace('/prices/current/', '')).split(',');
      return jsonResponse({
        coins: Object.fromEntries(requested.map((k, i) => [k, i === 0 ? { price: 1 } : { price: 1, decimals: 18 }])),
      });
    });
    const result = await createPricesClient(instantDeps(f), { minIntervalMs: 0 }).latest(keys);
    expect(f.calls).toHaveLength(2);
    expect(result.size).toBe(148);
    expect(result.get(keys[1]!)).toEqual({ price: 1, decimals: 18 });
  });

  it('keeps the price of a coingecko: key, which DefiLlama gives without decimals because it names a coin, not a contract', async () => {
    const f = fakeFetch(() =>
      jsonResponse({ coins: { 'coingecko:dfx-finance': { price: 0.04, symbol: 'DFX' }, 'base:0xnodecimals': { price: 1 } } }),
    );
    const result = await createPricesClient(instantDeps(f), { minIntervalMs: 0 }).latest(['coingecko:dfx-finance', 'base:0xnodecimals']);
    expect(result).toEqual(new Map([['coingecko:dfx-finance', { price: 0.04, decimals: COIN_PRICE_DECIMALS }]]));
  });

  it('names the DefiLlama key of a CoinGecko coin id', () => {
    expect(coingeckoKey('dfx-finance')).toBe('coingecko:dfx-finance');
    expect([isCoingeckoKey('coingecko:dfx-finance'), isCoingeckoKey('ethereum:0xabc')]).toEqual([true, false]);
  });

  it('fetches daily history in windows of at most 500 days and maps points to the nearest UTC day', async () => {
    const f = fakeFetch((url) => {
      const start = Number(new URL(url).searchParams.get('start'));
      const prices =
        start === Date.parse('2025-01-01T00:00:00Z') / 1000
          ? [
              { timestamp: Date.parse('2024-12-31T23:57:44Z') / 1000, price: 7.55 },
              { timestamp: Date.parse('2025-01-02T00:03:00Z') / 1000, price: 7.62 },
            ]
          : [{ timestamp: Date.parse('2026-10-05T00:00:00Z') / 1000, price: 14.2 }];
      return jsonResponse({ coins: { 'ethereum:0xlink': { prices } } });
    });
    const history = await createPricesClient(instantDeps(f), { minIntervalMs: 0 }).dailyHistory(
      'ethereum:0xlink',
      '2025-01-01',
      '2026-10-05',
    );
    const spans = f.calls.map((c) => new URL(c.url).searchParams.get('span'));
    expect(spans).toEqual(['500', '143']);
    expect(new URL(f.calls[1]!.url).searchParams.get('start')).toBe(String(Date.parse('2026-05-16T00:00:00Z') / 1000));
    expect(Object.fromEntries(history)).toEqual({ '2025-01-01': 7.55, '2025-01-02': 7.62, '2026-10-05': 14.2 });
  });
});
