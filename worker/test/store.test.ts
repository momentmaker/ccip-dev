import { chainRef, siblingKeys } from '@ccip-dev/core';
import { NETWORKS } from '@ccip-dev/core/testing';
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
