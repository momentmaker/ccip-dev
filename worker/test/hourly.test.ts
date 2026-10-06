import { UpstreamHttpError, UpstreamSchemaError, type CoingeckoCoin } from '@ccip-dev/core';
import { fakeCcip, fakeCoingecko, NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { runHourly } from '../src/jobs/hourly';
import * as store from '../src/store';
import { harness, liveRow, readPublic, resetStorage, rpcFake } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-10-08T13:00:00.000Z';
const LINK = { chainSelector: NETWORKS.base.chainSelector, address: '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196', symbol: 'LINK', name: 'Chain\u0007link', decimals: 18, groupId: 'g1' };
const USDC = { chainSelector: NETWORKS.base.chainSelector, address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', name: 'USD Coin', decimals: 6, groupId: 'g2' };
const coingecko = (coins: CoingeckoCoin[]) =>
  fakeCoingecko({ platforms: [{ id: 'base', chain_identifier: 8453 }, { id: 'ethereum', chain_identifier: 1 }], coins });
const linkMapped = () => coingecko([{ id: 'chainlink', platforms: { base: LINK.address } }]);
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
    await runHourly(harness({ now: NOW, ccip, fetch: rpcFake({ balanceLink: 6_122_201n }) }).c);
    const rows = (await arrivals()).results;
    expect(rows.map((r) => r.kind)).toEqual(['chain', 'chain', 'lane', 'token']);
    expect(rows.every((r) => r.announced_at !== null)).toBe(true);
  });

  it('records a token that appears after the first run as unannounced', async () => {
    await runHourly(harness({ now: NOW, ccip: fakeCcip({ chains: [NETWORKS.base], tokens: [LINK] }), fetch: rpcFake({ balanceLink: 1n }) }).c);
    await runHourly(harness({ now: NOW, ccip: fakeCcip({ chains: [NETWORKS.base], tokens: [LINK, USDC] }), fetch: rpcFake({ balanceLink: 1n }) }).c);
    const usdc = (await arrivals()).results.find((r) => r.key.endsWith(USDC.address.toLowerCase()));
    expect(usdc).toMatchObject({ kind: 'token', announced_at: null });
  });

  it('snapshots the Reserve and publishes registry files with sanitized names', async () => {
    await runHourly(harness({ now: NOW, ccip: fakeCcip({ chains: [NETWORKS.base], tokens: [LINK] }), fetch: rpcFake({ balanceLink: 6_122_201n }) }).c);
    expect(await readPublic('reserve.json')).toMatchObject({ latest: { ts: NOW, link: 6122201 } });
    expect((await readPublic('tokens.json')).tokens[0]).toMatchObject({ symbol: 'LINK', name: 'Chainlink', first_seen: NOW });
    expect((await readPublic('chains.json')).chains[0]).toMatchObject({ name: 'ethereum-mainnet-base-1', first_seen: NOW });
  });

  it('alerts after three consecutive failed Reserve reads and resets on success', async () => {
    const ccip = fakeCcip({ chains: [NETWORKS.base], tokens: [LINK] });
    const signatures: string[] = [];
    for (let i = 0; i < 3; i++) {
      const h = harness({ now: NOW, ccip, coingecko: linkMapped(), fetch: rpcFake({ down: true }) });
      await runHourly(h.c);
      signatures.push(...h.alerts.map((a) => a.signature));
    }
    expect(signatures).toEqual(['reserve-read', 'reserve-scan']);
    await runHourly(harness({ now: NOW, ccip, fetch: rpcFake({ balanceLink: 1n }) }).c);
    expect(await store.getMeta(env.DB, 'reserve_failures')).toBe('0');
  });

  it('writes no registry rows when a token page fails, but still records the Reserve', async () => {
    const ccip = {
      ...fakeCcip({ chains: [NETWORKS.base, NETWORKS.bsc], tokens: [LINK] }),
      listTokens: async () => {
        throw new UpstreamSchemaError('/tokens', 'tokens.0.address', '{}');
      },
    };
    await expect(runHourly(harness({ now: NOW, ccip, fetch: rpcFake({ balanceLink: 5n }) }).c)).rejects.toBeInstanceOf(UpstreamSchemaError);
    expect((await arrivals()).results).toEqual([]);
    expect(await store.countRows(env.DB, 'chains')).toBe(0);
    expect(await store.countRows(env.DB, 'tokens')).toBe(0);
    expect((await store.reserveSeries(env.DB, '2026-01-01T00:00:00.000Z')).length).toBe(1);
  });
});

describe('runHourly CoinGecko ids', () => {
  const WETH = {
    chainSelector: NETWORKS.base.chainSelector, address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether',
    decimals: 18, groupId: 'g3',
  };
  const ccip = () => fakeCcip({ chains: [NETWORKS.base, NETWORKS.ethereum], tokens: [LINK, USDC, WETH] });
  const bothMapped = () =>
    coingecko([
      { id: 'chainlink', platforms: { base: LINK.address, ethereum: '0x514910771af9ca656af840dff83e8264ecf986ca' } },
      { id: 'usd-coin', platforms: { base: USDC.address.toLowerCase() } },
    ]);
  const allMapped = () =>
    coingecko([
      { id: 'chainlink', platforms: { base: LINK.address } },
      { id: 'usd-coin', platforms: { base: USDC.address } },
      { id: 'weth', platforms: { base: WETH.address } },
    ]);
  const down = () => fakeCoingecko({}, { fail: new UpstreamHttpError('GET /coins/list', 429) });
  const mapped = async () =>
    (await env.DB.prepare('SELECT chain, address, coin_id, updated_at FROM coingecko_ids ORDER BY address').all()).results;
  const row = (token: typeof LINK, coinId: string, updatedAt: string) => ({
    chain: token.chainSelector, address: token.address.toLowerCase(), coin_id: coinId, updated_at: updatedAt,
  });
  const runAt = async (now: string, client: ReturnType<typeof fakeCoingecko>) => {
    const h = harness({ now, ccip: ccip(), coingecko: client, fetch: rpcFake({ balanceLink: 7n }) });
    await runHourly(h.c);
    return h.alerts;
  };

  it('maps every registry token to its CoinGecko coin on its own platform', async () => {
    await runAt(NOW, bothMapped());
    expect(await mapped()).toEqual([row(USDC, 'usd-coin', NOW), row(LINK, 'chainlink', NOW)]);
  });

  it('refreshes the mapping at most once a UTC day after a refresh succeeds', async () => {
    await runAt(NOW, bothMapped());
    const later = coingecko([]);
    await runAt('2026-10-08T23:00:00.000Z', later);
    expect(later.calls).toBe(0);
    expect(await mapped()).toHaveLength(2);
  });

  it('updates a changed coin and deletes a token no longer mapped on the next day', async () => {
    await runAt(NOW, bothMapped());
    const nextDay = '2026-10-09T00:00:00.000Z';
    const renamed = coingecko([{ id: 'chainlink-v2', platforms: { base: LINK.address } }, { id: 'usd-coin', platforms: { base: USDC.address } }]);
    await runAt(nextDay, renamed);
    expect(await mapped()).toEqual([row(USDC, 'usd-coin', nextDay), row(LINK, 'chainlink-v2', nextDay)]);
  });

  it('retries every hour after a failure and applies the first refresh that succeeds', async () => {
    await runAt(NOW, bothMapped());
    const failing = down();
    await runAt('2026-10-09T00:00:00.000Z', failing);
    await runAt('2026-10-09T01:00:00.000Z', failing);
    await runAt('2026-10-09T02:00:00.000Z', bothMapped());
    expect(failing.calls).toBe(2);
    const retried = '2026-10-09T02:00:00.000Z';
    expect(await mapped()).toEqual([row(USDC, 'usd-coin', retried), row(LINK, 'chainlink', retried)]);
  });

  it('alerts at most once a UTC day while the refresh keeps failing', async () => {
    const failing = down();
    const alerts = [
      ...(await runAt('2026-10-09T00:00:00.000Z', failing)),
      ...(await runAt('2026-10-09T01:00:00.000Z', failing)),
      ...(await runAt('2026-10-10T00:00:00.000Z', failing)),
    ];
    expect(alerts.map((a) => a.signature)).toEqual(['coingecko-ids', 'coingecko-ids']);
  });

  it('keeps the mapping and finishes the rest of the hour when CoinGecko fails', async () => {
    await runAt(NOW, bothMapped());
    const alerts = await runAt('2026-10-09T05:00:00.000Z', down());
    expect(await mapped()).toEqual([row(USDC, 'usd-coin', NOW), row(LINK, 'chainlink', NOW)]);
    expect(alerts[0]!.text).toContain('the previous mapping stays');
    expect(await readPublic('reserve.json')).toMatchObject({ latest: { ts: '2026-10-09T05:00:00.000Z', link: 7 } });
  });

  it('says there is no mapping yet when the first refresh fails', async () => {
    const alerts = await runAt(NOW, down());
    expect(alerts.map((a) => a.text)).toEqual([expect.stringContaining('no mapping yet')]);
  });

  it('keeps the stored mapping, alerts and retries when a refresh would map fewer than half of it', async () => {
    await runAt(NOW, allMapped());
    const alerts = await runAt('2026-10-09T00:00:00.000Z', coingecko([{ id: 'chainlink', platforms: { base: LINK.address } }]));
    expect(await mapped()).toHaveLength(3);
    expect(alerts.map((a) => a.signature)).toEqual(['coingecko-ids']);
    expect(await store.getMeta(env.DB, 'coingecko_ids_day')).toBe('2026-10-08');
  });

  it('keeps the stored mapping and alerts when a refresh would map nothing', async () => {
    await runAt(NOW, bothMapped());
    const alerts = await runAt('2026-10-09T00:00:00.000Z', coingecko([]));
    expect(await mapped()).toHaveLength(2);
    expect(alerts.map((a) => a.signature)).toEqual(['coingecko-ids']);
  });
});
