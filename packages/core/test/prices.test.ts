import { describe, expect, it } from 'vitest';
import { COIN_PRICE_DECIMALS, coingeckoKey, createPricesClient, isCoingeckoKey } from '../src/prices';
import { sanitize } from '../src/normalize';
import { fakeFetch, fakePrices, instantDeps, jsonResponse } from '../src/testing';

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
    expect(result).toEqual(new Map([['coingecko:dfx-finance', { price: 0.04, decimals: COIN_PRICE_DECIMALS, symbol: 'DFX' }]]));
  });

  it('parses and sanitizes the symbol DefiLlama returns, and omits it when absent', async () => {
    const f = fakeFetch(() =>
      jsonResponse({
        coins: {
          'ethereum:0xsyrup': { price: 1.1, decimals: 6, symbol: `syrup\u0000USDC${'x'.repeat(40)}` },
          'ethereum:0xnone': { price: 2, decimals: 18 },
        },
      }),
    );
    const result = await createPricesClient(instantDeps(f), { minIntervalMs: 0 }).latest(['ethereum:0xsyrup', 'ethereum:0xnone']);
    expect(result.get('ethereum:0xsyrup')?.symbol).toBe(sanitize(`syrup\u0000USDC${'x'.repeat(40)}`, 32));
    expect(result.get('ethereum:0xsyrup')?.symbol?.length).toBeLessThanOrEqual(32);
    expect(result.get('ethereum:0xsyrup')?.symbol).not.toContain('\u0000');
    expect(result.get('ethereum:0xnone')).toEqual({ price: 2, decimals: 18 });
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

  it('prices each requested time from batchHistorical, matching the nearest point within 600 seconds', async () => {
    const key = 'ethereum:0x514910771AF9Ca656af840dff83E8264EcF986CA';
    const f = fakeFetch((url) => {
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/batchHistorical');
      expect(parsed.searchParams.get('searchWidth')).toBe('600');
      expect(JSON.parse(parsed.searchParams.get('coins')!)).toEqual({ [key]: [1000, 5000, 9000] });
      return jsonResponse({ coins: { [key]: { prices: [
        { timestamp: 1030, price: 11.5, confidence: 0.99 },
        { timestamp: 5700, price: 12, confidence: 0.99 },
        { timestamp: 8990, price: 13.25, confidence: 0.99 },
      ] } } });
    });
    const result = await createPricesClient(instantDeps(f), { minIntervalMs: 0 }).historicalAt(key, [1000, 5000, 9000, 1000]);
    expect(result).toEqual(new Map([[1000, 11.5], [9000, 13.25]]));
  });

  it('asks for at most 100 times per request', async () => {
    const key = 'ethereum:0x514910771AF9Ca656af840dff83E8264EcF986CA';
    const f = fakeFetch(() => jsonResponse({ coins: {} }));
    const times = Array.from({ length: 150 }, (_, i) => 1000 + i);
    const result = await createPricesClient(instantDeps(f), { minIntervalMs: 0 }).historicalAt(key, times);
    expect(f.calls).toHaveLength(2);
    expect(result.size).toBe(0);
  });
});

describe('fakePrices.historicalAt', () => {
  it('returns configured points for the requested times and records the call', async () => {
    const prices = fakePrices({ historical: { k: { 10: 1.5 } } });
    await expect(prices.historicalAt('k', [10, 20])).resolves.toEqual(new Map([[10, 1.5]]));
    expect(prices.historicalCalls).toEqual([{ key: 'k', timestamps: [10, 20] }]);
  });

  it('throws the configured failure', async () => {
    await expect(fakePrices({ failHistorical: new Error('llama down') }).historicalAt('k', [1])).rejects.toThrow('llama down');
  });
});
