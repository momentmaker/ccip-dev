import { BASE_SENDER_1, NETWORKS, XBRIDGE_EVM, XBRIDGE_SOLANA, XSTOCKS_DAY, XSTOCKS_LABELS, XSTOCKS_TOTALS, xstocksBreakdown } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildMoments } from '../src/moments';
import { recordSenderArrivals } from '../src/senders';
import * as store from '../src/store';
import { harness, liveRow, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-10-14T00:07:00.000Z';
const CHAINS = [NETWORKS.ethereum, NETWORKS.base, NETWORKS.bsc, NETWORKS.solana, NETWORKS.ink, NETWORKS.xlayer, NETWORKS.hyperliquid];
const [ETH, BSC, SOL, INK, XLAYER, HYPER] = [NETWORKS.ethereum, NETWORKS.bsc, NETWORKS.solana, NETWORKS.ink, NETWORKS.xlayer, NETWORKS.hyperliquid].map((n) => n.chainSelector);
const context = () => harness({ now: NOW, labels: XSTOCKS_LABELS }).c;
const senderRows = async () => (await env.DB.prepare("SELECT key, first_seen FROM arrivals WHERE kind = 'sender' ORDER BY key").all()).results;

/** One message from `address` on `network` on `day`, so the store knows its first day. */
const firstMessage = (id: string, day: string, network: (typeof CHAINS)[number], address: string) => liveRow({ id, sendTs: `${day}T09:00:00.000Z`, src: network, sender: address });

beforeEach(async () => {
  // #given 2026-10-13's senders; xStocks's xBridge first sent on Oct 9, its Solana sender on Oct 13, the Base senders in July
  await seedRegistry(CHAINS, []);
  await store.replaceDaily(env.DB, XSTOCKS_TOTALS, xstocksBreakdown(), NOW);
  await store.upsertListRows(env.DB, [
    firstMessage('x-ink', '2026-10-09', NETWORKS.ink, XBRIDGE_EVM),
    firstMessage('x-sol', XSTOCKS_DAY, NETWORKS.solana, XBRIDGE_SOLANA),
    firstMessage('b1', '2026-07-01', NETWORKS.base, BASE_SENDER_1),
  ], []);
});

describe('recording new senders', () => {
  it('records xStocks, new this month, and not the Base senders that have sent since July', async () => {
    // #when the 23 smaller Base senders have no stored messages, so no known first day
    const keys = await recordSenderArrivals(context(), XSTOCKS_DAY, xstocksBreakdown());
    // #then
    expect({ keys, rows: await senderRows() }).toEqual({ keys: ['project:xstocks'], rows: [{ key: 'project:xstocks', first_seen: '2026-10-13T00:00:00.000Z' }] });
  });

  it('records a sender once', async () => {
    // #given
    await recordSenderArrivals(context(), XSTOCKS_DAY, xstocksBreakdown());
    // #when
    const again = await recordSenderArrivals(context(), XSTOCKS_DAY, xstocksBreakdown());
    // #then
    expect({ again, rows: (await senderRows()).length }).toEqual({ again: [], rows: 1 });
  });

  it('does not record a project again when one of its addresses was recorded before it was labeled', async () => {
    // #given the xBridge's EVM address was posted as a bare address in an earlier week
    await store.insertArrivals(env.DB, 'sender', [`address:${XBRIDGE_EVM}`], '2026-10-09T00:00:00.000Z', null);
    // #when
    const keys = await recordSenderArrivals(context(), XSTOCKS_DAY, xstocksBreakdown());
    // #then
    expect({ keys, rows: (await senderRows()).map((r) => r.key) }).toEqual({ keys: [], rows: [`address:${XBRIDGE_EVM}`] });
  });

  it('does not count a project new when any of its addresses sent before the last 30 days', async () => {
    // #given the xBridge sent from Ethereum in August
    await store.upsertListRows(env.DB, [firstMessage('x-old', '2026-08-01', NETWORKS.ethereum, XBRIDGE_EVM)], []);
    // #when
    const keys = await recordSenderArrivals(context(), XSTOCKS_DAY, xstocksBreakdown());
    // #then
    expect(keys).toEqual([]);
  });
});

describe('via-token senders', () => {
  const BASE = NETWORKS.base.chainSelector;
  const WALLET = '0x00000000000000000000000000000000000000d4';
  const TOKEN = '0x00000000000000000000000000000000000000c3';
  const gamma = { name: 'Gamma', x: 'gamma', url: null, kind: 'issuer' as const, source: null, addresses: [], tokens: [] };
  const viaToken = (messages: number) => [
    { day: XSTOCKS_DAY, dim: 'sender' as const, key: `${BASE}:${WALLET}`, messages: 400, usd_value: 0, fee_usd: null },
    { day: XSTOCKS_DAY, dim: 'via_token' as const, key: `${BASE}:${WALLET}|${BASE}:${TOKEN}`, messages, usd_value: 0, fee_usd: null },
  ];
  const withClaim = () => harness({ now: NOW, labels: XSTOCKS_LABELS, labelTokens: { [`ethereum-mainnet-base-1:${TOKEN}`]: 'gamma' }, projects: { gamma } }).c;

  it('records neither a project credited only via its token, which has no first day, nor the wallet whose sends moved to it', async () => {
    // #given a wallet new today bridged 400 of a token Gamma claims, ahead of xStocks's 319
    await store.upsertListRows(env.DB, [firstMessage('w', XSTOCKS_DAY, NETWORKS.base, WALLET)], []);
    // #when
    const keys = await recordSenderArrivals(withClaim(), XSTOCKS_DAY, [...xstocksBreakdown(), ...viaToken(400)]);
    // #then
    expect(keys).toEqual(['project:xstocks']);
  });

  it('publishes no x handle for a recorded project whose day came only via its token', async () => {
    // #given Gamma was recorded as new on a day when all its messages came via its token
    await store.replaceDaily(env.DB, XSTOCKS_TOTALS, [...xstocksBreakdown(), ...viaToken(400)], NOW);
    await store.insertArrivals(env.DB, 'sender', ['project:gamma'], `${XSTOCKS_DAY}T00:00:00.000Z`, null);
    // #when
    const { arrivals } = await buildMoments(withClaim(), { lastDay: XSTOCKS_DAY, days: [] });
    // #then
    expect(arrivals.senders!.map((a) => [a.key, a.x])).toEqual([['project:gamma', null]]);
  });

  it("counts an address's total since its first day before any move, while its messages are net", async () => {
    // #given the wallet sent 400, 100 of them a claimed token, and was recorded as new
    await store.upsertListRows(env.DB, [firstMessage('w', XSTOCKS_DAY, NETWORKS.base, WALLET)], []);
    await store.replaceDaily(env.DB, XSTOCKS_TOTALS, [...xstocksBreakdown(), ...viaToken(100)], NOW);
    await store.insertArrivals(env.DB, 'sender', [`address:${WALLET}`], `${XSTOCKS_DAY}T00:00:00.000Z`, null);
    // #when
    const { arrivals } = await buildMoments(withClaim(), { lastDay: XSTOCKS_DAY, days: [] });
    // #then
    expect(arrivals.senders!.map((a) => [a.key, a.messages, a.total_messages])).toEqual([[`address:${WALLET}`, 300, 400]]);
  });
});

describe('moments.json new senders', () => {
  it('lists each new sender of the last 30 days with its day, first day, rank, messages and chains', async () => {
    // #given
    await recordSenderArrivals(context(), XSTOCKS_DAY, xstocksBreakdown());
    // #when
    const moments = await buildMoments(context(), { lastDay: XSTOCKS_DAY, days: [] });
    // #then
    expect(moments.arrivals.senders).toEqual([{
      key: 'project:xstocks', label: 'xStocks', x: 'xStocksFi', kind: 'protocol', inferred: false,
      day: XSTOCKS_DAY, first_day: '2026-10-09', rank: 1, messages: 319, total_messages: 319, chains: [SOL, INK, XLAYER, BSC, ETH, HYPER],
    }]);
  });

  it('leaves out a sender that arrived more than 30 days before', async () => {
    // #given
    await store.insertArrivals(env.DB, 'sender', ['address:0xold'], '2026-09-01T00:00:00.000Z', null);
    // #when
    const moments = await buildMoments(context(), { lastDay: XSTOCKS_DAY, days: [] });
    // #then
    expect(moments.arrivals.senders).toEqual([]);
  });
});
