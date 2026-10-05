import { UpstreamHttpError, UpstreamSchemaError, type CoingeckoCoin } from '@ccip-dev/core';
import { fakeCcip, fakeCoingecko, fakeFetch, jsonResponse, NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { runHourly } from '../src/jobs/hourly';
import * as store from '../src/store';
import { harness, liveRow, readPublic, resetStorage } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-10-08T13:00:00.000Z';
const LINK = { chainSelector: NETWORKS.base.chainSelector, address: '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196', symbol: 'LINK', name: 'Chain\u0007link', decimals: 18, groupId: 'g1' };
const USDC = { chainSelector: NETWORKS.base.chainSelector, address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', name: 'USD Coin', decimals: 6, groupId: 'g2' };
const rpcOk = (link: bigint) => fakeFetch(() => jsonResponse({ jsonrpc: '2.0', id: 1, result: `0x${(link * 10n ** 18n).toString(16)}` }));
const rpcDown = () => fakeFetch(() => jsonResponse({}, 503));
const arrivals = () => env.DB.prepare('SELECT kind, key, announced_at FROM arrivals ORDER BY kind, key').all<{ kind: string; key: string; announced_at: string | null }>();

describe('upsertChains', () => {
  it('stores the chain name as display_name when the upstream displayName is null', async () => {
    await store.upsertChains(env.DB, [NETWORKS.sui], NOW);
    const row = await env.DB.prepare('SELECT display_name FROM chains WHERE selector = ?').bind(NETWORKS.sui.chainSelector).first<{ display_name: string }>();
    expect(row?.display_name).toBe('sui-mainnet');
  });
});

describe('runHourly', () => {
  it('seeds a baseline on the first run so existing chains, tokens and lanes are never announced', async () => {
    await store.upsertListRows(env.DB, [liveRow({ id: 'm', sendTs: '2026-10-08T12:00:00.000Z' })], []);
    const ccip = fakeCcip({ chains: [NETWORKS.base, NETWORKS.bsc], tokens: [LINK] });
    await runHourly(harness({ now: NOW, ccip, fetch: rpcOk(6_122_201n) }).c);
    const rows = (await arrivals()).results;
    expect(rows.map((r) => r.kind)).toEqual(['chain', 'chain', 'lane', 'token']);
    expect(rows.every((r) => r.announced_at !== null)).toBe(true);
  });

  it('records a token that appears after the first run as unannounced', async () => {
    await runHourly(harness({ now: NOW, ccip: fakeCcip({ chains: [NETWORKS.base], tokens: [LINK] }), fetch: rpcOk(1n) }).c);
    await runHourly(harness({ now: NOW, ccip: fakeCcip({ chains: [NETWORKS.base], tokens: [LINK, USDC] }), fetch: rpcOk(1n) }).c);
    const usdc = (await arrivals()).results.find((r) => r.key.endsWith(USDC.address.toLowerCase()));
    expect(usdc).toMatchObject({ kind: 'token', announced_at: null });
  });

  it('snapshots the Reserve and publishes registry files with sanitized names', async () => {
    await runHourly(harness({ now: NOW, ccip: fakeCcip({ chains: [NETWORKS.base], tokens: [LINK] }), fetch: rpcOk(6_122_201n) }).c);
    expect(await readPublic('reserve.json')).toMatchObject({ latest: { ts: NOW, link: 6122201 } });
    expect((await readPublic('tokens.json')).tokens[0]).toMatchObject({ symbol: 'LINK', name: 'Chainlink', first_seen: NOW });
    expect((await readPublic('chains.json')).chains[0]).toMatchObject({ name: 'ethereum-mainnet-base-1', first_seen: NOW });
  });

  it('alerts after three consecutive failed Reserve reads and resets on success', async () => {
    const ccip = fakeCcip({ chains: [NETWORKS.base], tokens: [LINK] });
    const signatures: string[] = [];
    for (let i = 0; i < 3; i++) {
      const h = harness({ now: NOW, ccip, fetch: rpcDown() });
      await runHourly(h.c);
      signatures.push(...h.alerts.map((a) => a.signature));
    }
    expect(signatures).toEqual(['reserve-read']);
    await runHourly(harness({ now: NOW, ccip, fetch: rpcOk(1n) }).c);
    expect(await store.getMeta(env.DB, 'reserve_failures')).toBe('0');
  });

  it('writes no registry rows when a token page fails, but still records the Reserve', async () => {
    const ccip = {
      ...fakeCcip({ chains: [NETWORKS.base, NETWORKS.bsc], tokens: [LINK] }),
      listTokens: async () => {
        throw new UpstreamSchemaError('/tokens', 'tokens.0.address', '{}');
      },
    };
    await expect(runHourly(harness({ now: NOW, ccip, fetch: rpcOk(5n) }).c)).rejects.toBeInstanceOf(UpstreamSchemaError);
    expect((await arrivals()).results).toEqual([]);
    expect(await store.countRows(env.DB, 'chains')).toBe(0);
    expect(await store.countRows(env.DB, 'tokens')).toBe(0);
    expect((await store.reserveSeries(env.DB, '2026-01-01T00:00:00.000Z')).length).toBe(1);
  });
});

describe('runHourly CoinGecko ids', () => {
  const ccip = () => fakeCcip({ chains: [NETWORKS.base, NETWORKS.ethereum], tokens: [LINK, USDC] });
  const coingecko = (coins: CoingeckoCoin[]) =>
    fakeCoingecko({ platforms: [{ id: 'base', chain_identifier: 8453 }, { id: 'ethereum', chain_identifier: 1 }], coins });
  const bothMapped = () =>
    coingecko([
      { id: 'chainlink', platforms: { base: LINK.address, ethereum: '0x514910771af9ca656af840dff83e8264ecf986ca' } },
      { id: 'usd-coin', platforms: { base: USDC.address.toLowerCase() } },
    ]);
  const mapped = async () =>
    (await env.DB.prepare('SELECT chain, address, coin_id, updated_at FROM coingecko_ids ORDER BY address').all()).results;
  const row = (token: typeof LINK, coinId: string, updatedAt: string) => ({
    chain: token.chainSelector, address: token.address.toLowerCase(), coin_id: coinId, updated_at: updatedAt,
  });

  it('maps every registry token to its CoinGecko coin on its own platform', async () => {
    await runHourly(harness({ now: NOW, ccip: ccip(), coingecko: bothMapped(), fetch: rpcOk(1n) }).c);
    expect(await mapped()).toEqual([row(USDC, 'usd-coin', NOW), row(LINK, 'chainlink', NOW)]);
  });

  it('refreshes the mapping at most once a UTC day', async () => {
    await runHourly(harness({ now: NOW, ccip: ccip(), coingecko: bothMapped(), fetch: rpcOk(1n) }).c);
    const later = coingecko([]);
    await runHourly(harness({ now: '2026-10-08T23:00:00.000Z', ccip: ccip(), coingecko: later, fetch: rpcOk(1n) }).c);
    expect(later.calls).toBe(0);
    expect(await mapped()).toHaveLength(2);
  });

  it('updates a changed coin and deletes a token no longer mapped on the next day', async () => {
    await runHourly(harness({ now: NOW, ccip: ccip(), coingecko: bothMapped(), fetch: rpcOk(1n) }).c);
    const nextDay = '2026-10-09T00:00:00.000Z';
    const renamed = coingecko([{ id: 'chainlink-v2', platforms: { base: LINK.address } }]);
    await runHourly(harness({ now: nextDay, ccip: ccip(), coingecko: renamed, fetch: rpcOk(1n) }).c);
    expect(await mapped()).toEqual([row(LINK, 'chainlink-v2', nextDay)]);
  });

  it('keeps the mapping, alerts once and finishes the rest of the hour when CoinGecko fails', async () => {
    await runHourly(harness({ now: NOW, ccip: ccip(), coingecko: bothMapped(), fetch: rpcOk(1n) }).c);
    const down = fakeCoingecko({}, { fail: new UpstreamHttpError('GET /coins/list', 429) });
    const h = harness({ now: '2026-10-09T00:00:00.000Z', ccip: ccip(), coingecko: down, fetch: rpcOk(7n) });
    await runHourly(h.c);
    h.setNow('2026-10-09T05:00:00.000Z');
    await runHourly(h.c);
    expect(await mapped()).toEqual([row(USDC, 'usd-coin', NOW), row(LINK, 'chainlink', NOW)]);
    expect(h.alerts.map((a) => a.signature)).toEqual(['coingecko-ids']);
    expect(down.calls).toBe(1);
    expect(await readPublic('reserve.json')).toMatchObject({ latest: { ts: '2026-10-09T05:00:00.000Z', link: 7 } });
  });
});
