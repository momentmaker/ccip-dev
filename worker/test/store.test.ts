import { siblingKeys } from '@ccip-dev/core';
import { NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import * as store from '../src/store';
import { liveRow, resetStorage, seedRegistry } from './helpers';

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

  it('returns the newest live message id', async () => {
    await store.upsertListRows(
      env.DB,
      [liveRow({ id: 'old', sendTs: '2026-10-08T09:00:00.000Z' }), liveRow({ id: 'new', sendTs: '2026-10-08T11:00:00.000Z' })],
      [],
    );
    expect(await store.newestLiveId(env.DB)).toBe('new');
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
  it('indexes grouped registry tokens with llama keys from their chains', async () => {
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
    expect(groups.byToken.size).toBe(3);
  });
});
