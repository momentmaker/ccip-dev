import { describe, expect, it } from 'vitest';
import { buildCoingeckoIdIndex, createCoingeckoClient, type CoingeckoLists } from '../src/coingecko';
import { UpstreamSchemaError } from '../src/http';
import { fakeFetch, instantDeps, jsonResponse } from '../src/testing';
import type { ChainRef } from '../src/types';

const ethereum: ChainRef = { selector: '5009297550715157269', name: 'ethereum-mainnet', chainId: '1', family: 'EVM' };
const bsc: ChainRef = { selector: '11344663589394136015', name: 'binance_smart_chain-mainnet', chainId: '56', family: 'EVM' };
const unlisted: ChainRef = { selector: '1', name: 'unlisted-mainnet', chainId: '777777', family: 'EVM' };
const aptos: ChainRef = { selector: '4741433654826277614', name: 'aptos-mainnet', chainId: '1', family: 'APTOS' };
const solana: ChainRef = {
  selector: '124615329519749607', name: 'solana-mainnet', chainId: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', family: 'SVM',
};

const LINK_ETH = '0x514910771af9ca656af840dff83e8264ecf986ca';
const LINK_BSC = '0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd';
const LINK_SOL = 'LinkhB3afbBKb2EQQu7s7umdZceV3wcvAUJhQAfQ23L';
const SHARED = '0x1111111111111111111111111111111111111111';

const lists: CoingeckoLists = {
  platforms: [
    { id: 'ethereum', chain_identifier: 1 },
    { id: 'binance-smart-chain', chain_identifier: 56 },
    { id: 'solana', chain_identifier: null },
    { id: 'aptos', chain_identifier: null },
  ],
  coins: [
    { id: 'chainlink', platforms: { ethereum: '0x514910771AF9Ca656af840dff83E8264EcF986CA', solana: LINK_SOL, aptos: LINK_ETH } },
    { id: 'bsc-only', platforms: { 'binance-smart-chain': LINK_BSC } },
    { id: 'twin-a', platforms: { ethereum: SHARED } },
    { id: 'twin-b', platforms: { ethereum: SHARED } },
    { id: 'blank', platforms: { ethereum: '', 'binance-smart-chain': '  ' } },
  ],
};

describe('buildCoingeckoIdIndex', () => {
  const coinIdOf = buildCoingeckoIdIndex(lists);

  it('matches an EVM token on the platform of its chain id, whatever the case of the listed address', () => {
    expect(coinIdOf(ethereum, LINK_ETH)).toBe('chainlink');
  });

  it('does not match an address listed only on another platform', () => {
    expect(coinIdOf(ethereum, LINK_BSC)).toBeUndefined();
    expect(coinIdOf(bsc, LINK_ETH)).toBeUndefined();
  });

  it('matches no coin when several coins list the same address on the platform', () => {
    expect(coinIdOf(ethereum, SHARED)).toBeUndefined();
  });

  it('matches a Solana token on the solana platform by its exact-case address only', () => {
    expect(coinIdOf(solana, LINK_SOL)).toBe('chainlink');
    expect(coinIdOf(solana, LINK_SOL.toLowerCase())).toBeUndefined();
  });

  it('matches nothing on a chain CoinGecko has no platform for, or for a non-EVM chain sharing an EVM chain id', () => {
    expect(coinIdOf(unlisted, LINK_ETH)).toBeUndefined();
    expect(coinIdOf(aptos, LINK_ETH)).toBeUndefined();
  });

  it('ignores blank addresses', () => {
    expect(coinIdOf(ethereum, '')).toBeUndefined();
    expect(coinIdOf(bsc, '')).toBeUndefined();
  });

  it('matches no platform when two platforms claim the same chain id', () => {
    const platforms = [...lists.platforms, { id: 'ethereum-old', chain_identifier: 1 }];
    const twice = buildCoingeckoIdIndex({ platforms, coins: lists.coins });
    expect(twice(ethereum, LINK_ETH)).toBeUndefined();
  });
});

describe('createCoingeckoClient', () => {
  const platformsBody = [{ id: 'ethereum', chain_identifier: 1, name: 'Ethereum', shortname: 'Ethereum', image: {} }];
  const coinsBody = [{ id: 'chainlink', symbol: 'link', name: 'Chainlink', platforms: { ethereum: LINK_ETH } }];
  const routes = (url: string) =>
    url.includes('/asset_platforms') ? jsonResponse(platformsBody) : url.includes('/coins/list') ? jsonResponse(coinsBody) : undefined;

  it('fetches the platform and coin lists keyless, with platforms included, keeping only the id fields', async () => {
    const f = fakeFetch(routes);
    const result = await createCoingeckoClient(instantDeps(f), { minIntervalMs: 0 }).lists();
    expect(f.calls.map((c) => c.url)).toEqual([
      'https://api.coingecko.com/api/v3/asset_platforms',
      'https://api.coingecko.com/api/v3/coins/list?include_platform=true',
    ]);
    expect(f.calls.every((c) => (c.init?.headers as Record<string, string>)['user-agent'] === 'curl/8.7.1')).toBe(true);
    expect(result).toEqual({
      platforms: [{ id: 'ethereum', chain_identifier: 1 }],
      coins: [{ id: 'chainlink', platforms: { ethereum: LINK_ETH } }],
    });
  });

  it('waits between the two requests, since keyless CoinGecko allows only a few a minute', async () => {
    const slept: number[] = [];
    const deps = { fetch: fakeFetch(routes), sleep: async (ms: number) => { slept.push(ms); }, clock: () => 0 };
    await createCoingeckoClient(deps).lists();
    expect(slept).toEqual([5_000]);
  });

  it('rejects a coin list whose shape changed', async () => {
    const f = fakeFetch((url) => (url.includes('/coins/list') ? jsonResponse([{ id: 'chainlink' }]) : routes(url)));
    await expect(createCoingeckoClient(instantDeps(f), { minIntervalMs: 0 }).lists()).rejects.toBeInstanceOf(UpstreamSchemaError);
  });
});

describe('createCoingeckoClient dailyHistory', () => {
  const DAY_MS = 86_400_000;
  const midnight = Date.UTC(2026, 8, 6);
  const body = (prices: [number, number][]) => jsonResponse({ prices, market_caps: [], total_volumes: [] });

  it('asks for a year of daily USD prices keyless', async () => {
    const f = fakeFetch(() => body([]));
    await createCoingeckoClient(instantDeps(f), { minIntervalMs: 0 }).dailyHistory('mova-2');
    expect(f.calls.map((c) => c.url)).toEqual([
      'https://api.coingecko.com/api/v3/coins/mova-2/market_chart?vs_currency=usd&days=365&interval=daily',
    ]);
    expect((f.calls[0]!.init?.headers as Record<string, string>)['user-agent']).toBe('curl/8.7.1');
  });

  it('keys each price by its UTC day', async () => {
    const f = fakeFetch(() => body([[midnight, 0.11], [midnight + DAY_MS, 0.12]]));
    const history = await createCoingeckoClient(instantDeps(f), { minIntervalMs: 0 }).dailyHistory('mova-2');
    expect([...history]).toEqual([['2026-09-06', 0.11], ['2026-09-07', 0.12]]);
  });

  it('keeps the point nearest 00:00 UTC when a day has several', async () => {
    const f = fakeFetch(() => body([[midnight + 3_600_000, 0.2], [midnight + 60_000, 0.1], [midnight + 20 * 3_600_000, 0.3]]));
    const history = await createCoingeckoClient(instantDeps(f), { minIntervalMs: 0 }).dailyHistory('mova-2');
    expect([...history]).toEqual([['2026-09-06', 0.1]]);
  });

  it('retries a 429, honouring Retry-After', async () => {
    const slept: number[] = [];
    let calls = 0;
    const fetchFn = fakeFetch(() => (++calls === 1 ? jsonResponse({}, 429, { 'retry-after': '7' }) : body([[midnight, 0.11]])));
    const deps = { fetch: fetchFn, sleep: async (ms: number) => { slept.push(ms); }, clock: () => 0 };
    const history = await createCoingeckoClient(deps, { minIntervalMs: 0 }).dailyHistory('mova-2');
    expect(slept).toEqual([7_000]);
    expect(history.get('2026-09-06')).toBe(0.11);
  });

  it('gives up on a 429 after several attempts', async () => {
    const f = fakeFetch(() => jsonResponse({}, 429));
    await expect(createCoingeckoClient(instantDeps(f), { minIntervalMs: 0 }).dailyHistory('mova-2')).rejects.toThrow(/429/);
    expect(f.calls.length).toBeGreaterThan(3);
  });

  it('rejects a response without a prices series', async () => {
    const f = fakeFetch(() => jsonResponse({ error: 'nope' }));
    await expect(createCoingeckoClient(instantDeps(f), { minIntervalMs: 0 }).dailyHistory('mova-2')).rejects.toBeInstanceOf(UpstreamSchemaError);
  });
});
