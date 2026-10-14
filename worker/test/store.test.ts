import { chainRef, NO_TOKEN_GROUPS, rollupDay, siblingKeys } from '@ccip-dev/core';
import { BASE_SENDER_1, BASE_SENDER_2, NETWORKS, XBRIDGE_EVM, XBRIDGE_SOLANA, XSTOCKS_DAY, XSTOCKS_TOTALS, xstocksBreakdown } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as store from '../src/store';
import { liveRow, resetStorage, seedRegistry, watchedDb } from './helpers';

beforeEach(resetStorage);

describe('meta', () => {
  it('sets, reads and deletes values', async () => {
    await store.setMeta(env.DB, 'k', 'v1');
    await store.setMeta(env.DB, 'k', 'v2');
    expect(await store.getMeta(env.DB, 'k')).toBe('v2');
    await store.setMeta(env.DB, 'k', null);
    expect(await store.getMeta(env.DB, 'k')).toBeNull();
  });
});

describe('messages', () => {
  it('finds known ids across more than one parameter chunk', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => liveRow({ id: `id${i}`, sendTs: '2026-10-08T10:00:00.000Z' }));
    await store.upsertListRows(env.DB, rows, []);
    const asked = [...rows.map((r) => r.message_id), ...Array.from({ length: 30 }, (_, i) => `unknown${i}`)];
    expect((await store.knownIds(env.DB, asked)).size).toBe(120);
  });

  it('updates only status, receipt and manual-execution fields on conflict', async () => {
    await store.upsertListRows(env.DB, [liveRow({ id: 'a', sendTs: '2026-10-08T10:00:00.000Z' }, { usd_value: 99, fee_usd: 1 })], []);
    await store.upsertListRows(
      env.DB,
      [liveRow({ id: 'a', sendTs: '2026-10-08T10:00:00.000Z', status: 'SUCCESS', receiptTs: '2026-10-08T10:02:00.000Z' })],
      [],
    );
    const row = await env.DB.prepare('SELECT status, receipt_ts, usd_value, fee_usd FROM messages WHERE message_id = ?').bind('a').first();
    expect(row).toEqual({ status: 'SUCCESS', receipt_ts: '2026-10-08T10:02:00.000Z', usd_value: 99, fee_usd: 1 });
  });

  it('does not revert UNRESOLVED to a pending status, but accepts a final one', async () => {
    await store.upsertListRows(env.DB, [liveRow({ id: 'u', sendTs: '2026-10-01T10:00:00.000Z' }, { status: 'UNRESOLVED' })], []);
    await store.upsertListRows(env.DB, [liveRow({ id: 'u', sendTs: '2026-10-01T10:00:00.000Z', status: 'SENT' })], []);
    const status = () => env.DB.prepare('SELECT status FROM messages WHERE message_id = ?').bind('u').first<{ status: string }>();
    expect((await status())?.status).toBe('UNRESOLVED');
    await store.upsertListRows(env.DB, [liveRow({ id: 'u', sendTs: '2026-10-01T10:00:00.000Z', status: 'SUCCESS' })], []);
    expect((await status())?.status).toBe('SUCCESS');
  });

  describe('a terminal status against a later list snapshot', () => {
    const SEND_TS = '2026-10-08T10:00:00.000Z';
    const RECEIPT_TS = '2026-10-08T10:02:00.000Z';
    const stored = () =>
      env.DB.prepare('SELECT status, receipt_ts, ready_for_manual_exec FROM messages WHERE message_id = ?')
        .bind('t')
        .first<{ status: string; receipt_ts: string | null; ready_for_manual_exec: number }>();
    const upsert = (status: string, extras: { receiptTs?: string; readyForManualExecution?: boolean } = {}) =>
      store.upsertListRows(env.DB, [liveRow({ id: 't', sendTs: SEND_TS, status, ...extras })], []);

    it('keeps SUCCESS, with its receipt and manual-execution flag, when a pending status arrives', async () => {
      await upsert('SUCCESS', { receiptTs: RECEIPT_TS });
      await upsert('SENT', { readyForManualExecution: true });
      expect(await stored()).toEqual({ status: 'SUCCESS', receipt_ts: RECEIPT_TS, ready_for_manual_exec: 0 });
    });

    it('keeps SUCCESS when a stale FAILED arrives', async () => {
      await upsert('SUCCESS', { receiptTs: RECEIPT_TS });
      await upsert('FAILED', { readyForManualExecution: true });
      expect(await stored()).toEqual({ status: 'SUCCESS', receipt_ts: RECEIPT_TS, ready_for_manual_exec: 0 });
    });

    it('keeps FAILED, with its manual-execution flag, when a pending status arrives', async () => {
      await upsert('FAILED', { readyForManualExecution: true });
      await upsert('SENT');
      expect(await stored()).toMatchObject({ status: 'FAILED', ready_for_manual_exec: 1 });
    });

    it('accepts SUCCESS over a pending status', async () => {
      await upsert('SENT');
      await upsert('SUCCESS', { receiptTs: RECEIPT_TS });
      expect(await stored()).toEqual({ status: 'SUCCESS', receipt_ts: RECEIPT_TS, ready_for_manual_exec: 0 });
    });

    it('accepts SUCCESS over FAILED once the message is executed manually', async () => {
      await upsert('FAILED', { readyForManualExecution: true });
      await upsert('SUCCESS', { receiptTs: RECEIPT_TS });
      expect(await stored()).toEqual({ status: 'SUCCESS', receipt_ts: RECEIPT_TS, ready_for_manual_exec: 0 });
    });

    it('accepts a FAILED snapshot over FAILED, so the manual-execution flag follows the API', async () => {
      await upsert('FAILED');
      await upsert('FAILED', { readyForManualExecution: true });
      expect(await stored()).toMatchObject({ status: 'FAILED', ready_for_manual_exec: 1 });
    });
  });

  it('returns the newest live message id', async () => {
    await store.upsertListRows(
      env.DB,
      [liveRow({ id: 'old', sendTs: '2026-10-08T09:00:00.000Z' }), liveRow({ id: 'new', sendTs: '2026-10-08T11:00:00.000Z' })],
      [],
    );
    expect(await store.newestLiveId(env.DB)).toBe('new');
  });
});

describe('claims', () => {
  const KEY = 'alert:a';

  it('claims an absent key, refuses a live claim, and takes over one at or before the stale cut-off', async () => {
    const outcomes = [
      await store.claimMeta(env.DB, KEY, '2026-10-08T10:00:00.000Z', '2026-10-08T09:00:00.000Z'),
      await store.claimMeta(env.DB, KEY, '2026-10-08T10:30:00.000Z', '2026-10-08T09:30:00.000Z'),
      await store.claimMeta(env.DB, KEY, '2026-10-08T11:00:00.000Z', '2026-10-08T10:00:00.000Z'),
    ];
    expect({ outcomes, held: await store.getMeta(env.DB, KEY) }).toEqual({ outcomes: [true, false, true], held: '2026-10-08T11:00:00.000Z' });
  });

  it('releases its own claim', async () => {
    await store.claimMeta(env.DB, KEY, '2026-10-08T10:00:00.000Z', '2026-10-08T09:00:00.000Z');
    await store.releaseMeta(env.DB, KEY, '2026-10-08T10:00:00.000Z');
    expect(await store.getMeta(env.DB, KEY)).toBeNull();
  });

  it('leaves a newer claim alone when releasing an older one', async () => {
    await store.claimMeta(env.DB, KEY, '2026-10-08T10:00:00.000Z', '2026-10-08T09:00:00.000Z');
    await store.claimMeta(env.DB, KEY, '2026-10-08T11:00:00.000Z', '2026-10-08T10:00:00.000Z');
    await store.releaseMeta(env.DB, KEY, '2026-10-08T10:00:00.000Z');
    expect(await store.getMeta(env.DB, KEY)).toBe('2026-10-08T11:00:00.000Z');
  });
});

describe('replaceDaily', () => {
  it('logs that the day may be partly replaced when the write fails', async () => {
    const { db } = watchedDb(/INSERT INTO daily_breakdown/, { fail: true });
    const totals = { day: '2026-10-09', messages: 1, token_messages: 0, usd_value: 0, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const outcome = await store.replaceDaily(db, totals, [], '2026-10-10T00:10:00.000Z').then(() => null, (err: unknown) => String(err));
    const errors = logged.mock.calls.map((args) => String(args[0]));
    logged.mockRestore();
    expect({ outcome, errors }).toEqual({
      outcome: 'Error: D1_ERROR: no such table: tokens',
      errors: [
        'replaceDaily for 2026-10-09 failed, so its daily_totals and daily_breakdown rows may be partly replaced until the day is finalized again: D1_ERROR: no such table: tokens',
      ],
    });
  });
});

describe('prices', () => {
  it('stores prices, keeps seen_at on refresh and lists keys seen recently', async () => {
    await store.upsertPrices(env.DB, new Map([['base:0xa', { price: 1, decimals: 18 }]]), '2026-09-01T00:00:00.000Z');
    await store.upsertPrices(env.DB, new Map([['base:0xb', { price: 2, decimals: 6 }]]), '2026-10-08T00:00:00.000Z');
    await store.upsertPrices(env.DB, new Map([['base:0xa', { price: 3, decimals: 18 }]]), '2026-10-08T00:00:00.000Z');
    expect(await store.getPrices(env.DB, ['base:0xa', 'base:0xb', 'base:0xc'])).toEqual(
      new Map([['base:0xa', { price: 3, decimals: 18 }], ['base:0xb', { price: 2, decimals: 6 }]]),
    );
    expect(await store.keysSeenSince(env.DB, '2026-09-10T00:00:00.000Z')).toEqual(['base:0xb']);
    await store.touchPrices(env.DB, ['base:0xa'], '2026-10-08T00:00:00.000Z');
    expect((await store.keysSeenSince(env.DB, '2026-09-10T00:00:00.000Z')).sort()).toEqual(['base:0xa', 'base:0xb']);
  });
});

describe('tokenGroups', () => {
  it('indexes every registry token, so the fallback knows its decimals, and groups those with a group and a llama key', async () => {
    const token = (chainSelector: string, address: string, groupId: string | null) => ({
      chainSelector, address, symbol: 'TKN', name: 'Token', decimals: 18, groupId,
    });
    await seedRegistry([NETWORKS.base, NETWORKS.ethereum], [
      token(NETWORKS.base.chainSelector, '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD', 'g'),
      token(NETWORKS.ethereum.chainSelector, '0xcccccccccccccccccccccccccccccccccccccccc', 'g'),
      token('999', '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'g'),
      token(NETWORKS.bsc.chainSelector, '0xffffffffffffffffffffffffffffffffffffffff', null),
    ]);
    const groups = await store.tokenGroups(env.DB);
    expect(siblingKeys(groups, NETWORKS.base.chainSelector, '0xdddddddddddddddddddddddddddddddddddddddd')).toEqual([
      'ethereum:0xcccccccccccccccccccccccccccccccccccccccc',
    ]);
    expect(groups.byToken.size).toBe(4);
  });
});

describe('coingeckoIds', () => {
  const ids = (...entries: [string, string][]) =>
    entries.map(([address, coinId]) => ({ chain: NETWORKS.base.chainSelector, address, coinId }));
  const chainOf = chainRef(NETWORKS.base);

  it('reads the stored mapping by chain selector and address', async () => {
    await store.replaceCoingeckoIds(env.DB, ids(['0xaaaa', 'coin-a']), '2026-10-08T00:00:00.000Z');
    const coinIdOf = await store.coingeckoIds(env.DB);
    expect([coinIdOf(chainOf, '0xaaaa'), coinIdOf(chainOf, '0xbbbb'), coinIdOf({ ...chainOf, selector: '1' }, '0xaaaa')]).toEqual([
      'coin-a', undefined, undefined,
    ]);
  });

  it('replaces the mapping: upserts the new ids and deletes the rows no longer mapped', async () => {
    await store.replaceCoingeckoIds(env.DB, ids(['0xaaaa', 'coin-a'], ['0xbbbb', 'coin-b']), '2026-10-08T00:00:00.000Z');
    await store.replaceCoingeckoIds(env.DB, ids(['0xaaaa', 'coin-a2'], ['0xcccc', 'coin-c']), '2026-10-09T00:00:00.000Z');
    const rows = await env.DB.prepare('SELECT address, coin_id, updated_at FROM coingecko_ids ORDER BY address').all();
    expect(rows.results).toEqual([
      { address: '0xaaaa', coin_id: 'coin-a2', updated_at: '2026-10-09T00:00:00.000Z' },
      { address: '0xcccc', coin_id: 'coin-c', updated_at: '2026-10-09T00:00:00.000Z' },
    ]);
  });
});

describe('linkFeeTokens', () => {
  it.each([
    ['Arbitrum', '4949039107694359620', '0xf97f4df75117a78c1a5a0dbb814af92458539fb4'],
    ['Avalanche', '6433500567565415381', '0x5947bb275c521040051d82396192181b413227a3'],
    ['Nexon Henesys', '12657445206920369324', '0x76a443768a5e3b8d1aed0105fc250877841deb40'],
  ])('counts LINK on %s, which the token registry leaves out', async (_, chain, address) => {
    // #given an empty token registry

    // #when
    const tokens = await store.linkFeeTokens(env.DB);

    // #then
    expect(tokens.has(`${chain}:${address}`)).toBe(true);
  });

  it("gives each LINK token its decimals: the registry's, or the unlisted table's", async () => {
    // #given Ethereum LINK and Solana LINK (9 decimals) in one registry group
    await seedRegistry([NETWORKS.ethereum, NETWORKS.solana], [
      { chainSelector: NETWORKS.ethereum.chainSelector, address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK', name: 'Chainlink', decimals: 18, groupId: 'link' },
      { chainSelector: NETWORKS.solana.chainSelector, address: 'LinkhB3afbBKb2EQQu7s7umdZceV3wcvAUJhQAfQ23L', symbol: 'LINK', name: 'Chainlink', decimals: 9, groupId: 'link' },
    ]);

    // #when
    const tokens = await store.linkFeeTokens(env.DB);

    // #then
    expect([
      tokens.get(`${NETWORKS.solana.chainSelector}:LinkhB3afbBKb2EQQu7s7umdZceV3wcvAUJhQAfQ23L`),
      tokens.get('4949039107694359620:0xf97f4df75117a78c1a5a0dbb814af92458539fb4'),
    ]).toEqual([9, 18]);
  });
});

describe('migration 0005', () => {
  it('adds the fee group columns to daily_totals', async () => {
    // #when
    const { results } = await env.DB.prepare('PRAGMA table_info(daily_totals)').all<{ name: string }>();
    // #then
    expect(results.map((c) => c.name)).toEqual(expect.arrayContaining(['fee_native_usd', 'fee_stable_usd', 'fee_link_amount']));
  });

  it('indexes the priced message fees', async () => {
    // #when
    const index = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_messages_fee_usd'").first<{ sql: string }>();
    // #then
    expect(index?.sql).toBe('CREATE INDEX idx_messages_fee_usd ON messages (fee_usd) WHERE fee_usd IS NOT NULL');
  });
});

describe('topBetween', () => {
  const DAY = '2026-10-07';
  const totals = { day: DAY, messages: 6, token_messages: 0, usd_value: 600, fee_usd: 9, unique_senders: 3, median_delivery_s: null, unpriced_messages: 0 };
  const lane = (key: string, usd_value: number, fee_usd: number | null) => ({ day: DAY, dim: 'lane' as const, key, messages: 2, usd_value, fee_usd });

  beforeEach(async () => {
    // #given lane a moved the most value, lane b paid the most fees, and lane c has no fee data
    await store.replaceDaily(env.DB, totals, [lane('a', 500, 1), lane('b', 80, 8), lane('c', 20, null)], '2026-10-08T00:10:00.000Z');
  });

  it('ranks by value as before', async () => {
    // #when
    const rows = await store.topBetween(env.DB, 'lane', null, DAY, 10, 'value');
    // #then
    expect(rows.map((r) => r.key)).toEqual(['a', 'b', 'c']);
  });

  it('ranks by fees and leaves out keys with no fee data', async () => {
    // #when
    const rows = await store.topBetween(env.DB, 'lane', null, DAY, 10, 'fees');
    // #then
    expect(rows).toEqual([
      { key: 'b', messages: 2, usd_value: 80, fee_usd: 8 },
      { key: 'a', messages: 2, usd_value: 500, fee_usd: 1 },
    ]);
  });

  it('breaks a tie in fees by value', async () => {
    // #given lane d paid as much as lane b and moved more value
    await store.replaceDaily(env.DB, totals, [lane('b', 80, 8), lane('d', 90, 8)], '2026-10-08T00:10:00.000Z');
    // #when
    const rows = await store.topBetween(env.DB, 'lane', null, DAY, 10, 'fees');
    // #then
    expect(rows.map((r) => r.key)).toEqual(['d', 'b']);
  });
});

describe('dailyLeaders', () => {
  const D9 = '2026-10-09';
  const D10 = '2026-10-10';
  const totals = (day: string) => ({ day, messages: 1, token_messages: 0, usd_value: 1, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 });
  const lane = (day: string, key: string, messages: number, usd_value: number, fee_usd: number | null) => ({ day, dim: 'lane' as const, key, messages, usd_value, fee_usd });

  beforeEach(async () => {
    // #given on the 9th lane a and c tie on value, and on the 10th lanes a and b tie on everything
    await store.replaceDaily(env.DB, totals(D9), [lane(D9, 'a', 10, 100, 1), lane(D9, 'b', 20, 50, 5), lane(D9, 'c', 5, 100, null)], '2026-10-11T00:07:00.000Z');
    await store.replaceDaily(env.DB, totals(D10), [lane(D10, 'a', 1, 10, 2), lane(D10, 'b', 1, 10, 2)], '2026-10-11T00:07:00.000Z');
  });

  it('picks each day’s first lane by value, by messages and by fees, breaking full ties by key', async () => {
    // #when
    const pick = async (order: store.TopOrder) => (await store.dailyLeaders(env.DB, 'lane', order, D9, D10)).map((r) => `${r.day}:${r.key}`);
    // #then
    expect({ value: await pick('value'), messages: await pick('messages'), fees: await pick('fees') }).toEqual({
      value: [`${D9}:a`, `${D10}:a`],
      messages: [`${D9}:b`, `${D10}:a`],
      fees: [`${D9}:b`, `${D10}:a`],
    });
  });

  it('keeps to the days asked for', async () => {
    expect((await store.dailyLeaders(env.DB, 'lane', 'value', D10, D10)).map((r) => r.day)).toEqual([D10]);
  });

  it('ranks a window by messages', async () => {
    expect((await store.topBetween(env.DB, 'lane', D9, D10, 10, 'messages')).map((r) => r.key)).toEqual(['b', 'a', 'c']);
  });
});

describe('sender identity queries', () => {
  const NOW = '2026-10-14T00:07:00.000Z';
  const DAY = XSTOCKS_DAY;
  const ETH = NETWORKS.ethereum.chainSelector;
  const BASE = NETWORKS.base.chainSelector;
  const SOL = NETWORKS.solana.chainSelector;
  const LABELED = [XBRIDGE_EVM, XBRIDGE_SOLANA];
  const sender = (day: string, key: string, messages: number, usd_value: number, fee_usd: number | null) => ({ day, dim: 'sender' as const, key, messages, usd_value, fee_usd });

  beforeEach(async () => {
    // #given 2026-10-13's sender rows: xStocks on six chains, then 25 unlabeled Base senders
    await store.replaceDaily(env.DB, XSTOCKS_TOTALS, xstocksBreakdown(), NOW);
  });

  it('sums every row of a labeled address with no limit, so all six of xStocks’s chains are there to merge', async () => {
    // #when
    const rows = await store.senderTotalsOf(env.DB, DAY, DAY, LABELED);
    // #then
    expect({ keys: rows.length, messages: rows.reduce((sum, r) => sum + r.messages, 0) }).toEqual({ keys: 6, messages: 319 });
  });

  it('ranks only addresses outside the labeled list', async () => {
    // #when
    const rows = await store.topUnlabeledSenders(env.DB, DAY, DAY, LABELED, 2, 'messages');
    // #then
    expect(rows.map((r) => r.key)).toEqual([`${BASE}:${BASE_SENDER_1}`, `${BASE}:${BASE_SENDER_2}`]);
  });

  it('ranks an unlabeled address by its sum across chains and returns each of its chains’ rows', async () => {
    // #given the second Base sender also sent 30 from Ethereum: 98 in all, ahead of the first one's 76
    await store.replaceDaily(env.DB, XSTOCKS_TOTALS, [...xstocksBreakdown(), sender(DAY, `${ETH}:${BASE_SENDER_2}`, 30, 0, 7.5)], NOW);
    // #when
    const rows = await store.topUnlabeledSenders(env.DB, DAY, DAY, LABELED, 1, 'messages');
    // #then
    expect(rows).toEqual([
      { key: `${BASE}:${BASE_SENDER_2}`, messages: 68, usd_value: 0, fee_usd: 17 },
      { key: `${ETH}:${BASE_SENDER_2}`, messages: 30, usd_value: 0, fee_usd: 7.5 },
    ]);
  });

  it('ranks by fees only the addresses with fee data', async () => {
    // #given an address with the most messages of the day but no fee data
    const QUIET = '0x00000000000000000000000000000000000000ff';
    await store.replaceDaily(env.DB, XSTOCKS_TOTALS, [...xstocksBreakdown(), sender(DAY, `${BASE}:${QUIET}`, 900, 0, null)], NOW);
    // #when
    const [first] = await store.topUnlabeledSenders(env.DB, DAY, DAY, LABELED, 1, 'fees');
    // #then
    expect(first?.key).toBe(`${BASE}:${BASE_SENDER_1}`);
  });

  it('tells a Solana address from one that differs only in letter case', async () => {
    // #given an unlabeled Solana sender whose address is xStocks's lowercased
    const lower = XBRIDGE_SOLANA.toLowerCase();
    await store.replaceDaily(env.DB, XSTOCKS_TOTALS, [...xstocksBreakdown(), sender(DAY, `${SOL}:${lower}`, 500, 0, 1)], NOW);
    // #when
    const labeled = await store.senderTotalsOf(env.DB, DAY, DAY, LABELED);
    const [top] = await store.topUnlabeledSenders(env.DB, DAY, DAY, LABELED, 1, 'messages');
    // #then
    expect({ labeled: labeled.some((r) => r.key === `${SOL}:${lower}`), top: top?.key }).toEqual({ labeled: false, top: `${SOL}:${lower}` });
  });

  it("gives each day its busiest unlabeled address with every chain it sent from, and the labeled rows per day", async () => {
    // #given on Oct 12 the second Base sender also sent from Ethereum
    await store.replaceDaily(env.DB, { ...XSTOCKS_TOTALS, day: '2026-10-12' }, [
      sender('2026-10-12', `${BASE}:${BASE_SENDER_2}`, 10, 0, 1), sender('2026-10-12', `${ETH}:${BASE_SENDER_2}`, 10, 0, 1),
      sender('2026-10-12', `${BASE}:${BASE_SENDER_1}`, 15, 0, 1), sender('2026-10-12', `${SOL}:${XBRIDGE_SOLANA}`, 40, 0, 1),
    ], NOW);
    // #when
    const unlabeled = await store.dailyTopUnlabeledSenders(env.DB, '2026-10-12', DAY, LABELED);
    const labeled = await store.senderDaysOf(env.DB, '2026-10-12', DAY, LABELED);
    // #then
    expect({
      unlabeled: unlabeled.map((r) => `${r.day} ${r.key}`),
      labeled: labeled.filter((r) => r.day === '2026-10-12').map((r) => r.key),
    }).toEqual({
      unlabeled: [`2026-10-12 ${BASE}:${BASE_SENDER_2}`, `2026-10-12 ${ETH}:${BASE_SENDER_2}`, `${DAY} ${BASE}:${BASE_SENDER_1}`],
      labeled: [`${SOL}:${XBRIDGE_SOLANA}`],
    });
  });

  it("totals a window's messages, value and fees, and each day's messages, from daily_totals", async () => {
    // #when
    const totals = await store.totalsBetween(env.DB, '2026-10-07', DAY);
    const byDay = await store.messagesByDay(env.DB, '2026-10-07', DAY);
    // #then
    expect({ totals, byDay: [...byDay] }).toEqual({ totals: { messages: 1_569, usd_value: 250_000, fee_usd: 392.25 }, byDay: [[DAY, 1_569]] });
  });

  it('totals an empty window as zero messages and value, and no fees', async () => {
    // #when
    const totals = await store.totalsBetween(env.DB, '2026-01-01', '2026-01-07');
    // #then
    expect(totals).toEqual({ messages: 0, usd_value: 0, fee_usd: null });
  });

  it('reads the labeled rows through a daily_breakdown index', async () => {
    // #when
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${store.SENDER_TOTALS_OF_SQL}`).bind('2026-10-07', DAY, JSON.stringify(LABELED)).all<{ detail: string }>();
    // #then
    expect(plan.results.map((r) => r.detail).join(' | ')).toMatch(/SEARCH daily_breakdown USING (COVERING )?INDEX/);
  });
});

describe('senderLanes', () => {
  it('reads the labeled senders through the messages_sender index', async () => {
    // #when
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${store.SENDER_LANES_SQL}`).bind('2026-10-07', '2026-10-13', JSON.stringify(['1:0xa'])).all<{ detail: string }>();
    // #then
    expect(plan.results.map((r) => r.detail).join(' | ')).toMatch(/SEARCH m USING (COVERING )?INDEX messages_sender/);
  });
});

describe('senderChains', () => {
  it("maps each selector to its CCIP name and family", async () => {
    // #given
    await seedRegistry([NETWORKS.ethereum, NETWORKS.solana], []);
    // #when
    const chains = await store.senderChains(env.DB);
    // #then
    expect([...chains]).toEqual(
      expect.arrayContaining([
        [NETWORKS.ethereum.chainSelector, { name: 'ethereum-mainnet', family: 'EVM' }],
        [NETWORKS.solana.chainSelector, { name: 'solana-mainnet', family: 'SVM' }],
      ]),
    );
  });
});

describe('migration 0006', () => {
  const DAY = '2026-10-07';
  const NOW = '2026-10-08T00:07:00.000Z';

  async function rollUpFiveMessages(): Promise<ReturnType<typeof rollupDay>> {
    // 3 messages without tokens and 2 with one
    await store.upsertListRows(env.DB, [0, 0, 0, 1, 1].map((tokens, i) => liveRow({ id: `m${i}`, sendTs: `${DAY}T10:0${i}:00.000Z` }, { token_count: tokens })), []);
    return rollupDay(DAY, await store.messagesForDay(env.DB, DAY), [], NO_TOKEN_GROUPS);
  }

  it("backfills each day's data messages as its messages without tokens", async () => {
    // #given a day rolled up before the column existed
    const { totals, breakdown } = await rollUpFiveMessages();
    await store.replaceDaily(env.DB, { ...totals, data_messages: null }, breakdown, NOW);
    const backfill = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0006'))!.queries.find((q) => q.includes('UPDATE daily_totals'))!;
    // #when
    await env.DB.prepare(backfill).run();
    // #then
    expect((await store.dailyHistory(env.DB))[0]?.data_messages).toBe(3);
  });

  it('stores the rollup’s data messages and reads them back with the history', async () => {
    // #given
    const { totals, breakdown } = await rollUpFiveMessages();
    // #when
    await store.replaceDaily(env.DB, totals, breakdown, NOW);
    // #then
    expect((await store.dailyHistory(env.DB)).map((d) => [d.day, d.messages, d.token_messages, d.data_messages])).toEqual([[DAY, 5, 2, 3]]);
  });
});

describe('migration 0007', () => {
  it('accepts sender arrivals and still refuses an unknown kind', async () => {
    // #when
    await store.insertArrivals(env.DB, 'sender', ['project:xstocks'], '2026-10-13T00:00:00.000Z', null);
    const refused = await env.DB.prepare("INSERT INTO arrivals VALUES ('robot', 'k', 'x', NULL)").run().then(() => false, () => true);
    // #then
    expect({ count: await store.countArrivals(env.DB, 'sender'), refused }).toEqual({ count: 1, refused: true });
  });

  it('keeps every existing arrival and its announced_at through the rebuild', async () => {
    // #given arrivals as migration 0001 shaped it, holding a row of each old kind
    await env.DB.batch([
      env.DB.prepare('DROP TABLE arrivals'),
      env.DB.prepare("CREATE TABLE arrivals (kind TEXT NOT NULL CHECK (kind IN ('chain', 'token', 'lane')), key TEXT NOT NULL, first_seen TEXT NOT NULL, announced_at TEXT, PRIMARY KEY (kind, key))"),
      env.DB.prepare("INSERT INTO arrivals VALUES ('chain', 'c', '2026-10-01T00:00:00.000Z', '2026-10-01T01:00:00.000Z'), ('token', 't', '2026-10-02T00:00:00.000Z', NULL), ('lane', 'l', '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z')"),
    ]);
    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0007'));
    // #when
    await env.DB.batch(migration!.queries.map((q) => env.DB.prepare(q)));
    // #then
    const rows = await env.DB.prepare('SELECT * FROM arrivals ORDER BY kind').all();
    expect(rows.results).toEqual([
      { kind: 'chain', key: 'c', first_seen: '2026-10-01T00:00:00.000Z', announced_at: '2026-10-01T01:00:00.000Z' },
      { kind: 'lane', key: 'l', first_seen: '2026-10-03T00:00:00.000Z', announced_at: '2026-10-03T00:00:00.000Z' },
      { kind: 'token', key: 't', first_seen: '2026-10-02T00:00:00.000Z', announced_at: null },
    ]);
  });

  it("finds an address's first day on any chain through the messages_sender index", async () => {
    // #when
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${store.FIRST_SENDER_DAYS_SQL}`).bind('["0xa"]').all<{ detail: string }>();
    // #then
    expect(plan.results.map((r) => r.detail).join(' | ')).toContain('messages_sender');
  });
});
