import {
  buildRows, buildTokenGroupIndex, chainRef, COIN_PRICE_DECIMALS, coingeckoKey, groupFallback, gunzipText, normalizeList,
  normalizeRegistryToken, rollupDay, tokenGroupEntry, type CoingeckoIdLookup,
} from '@ccip-dev/core';
import { fakeCcip, fakePrices, listMessage, NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import detailToken from '../../packages/core/test/fixtures/detail-token.json';
import { runFinalize } from '../src/jobs/finalize';
import { storeListMessages } from '../src/jobs/ingest';
import * as store from '../src/store';
import { fallbackLoader } from '../src/price-fallback';
import { harness, liveRow, readPublic, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-10-10T00:10:00.000Z';
const MESSAGES = [
      listMessage({ id: 'd10', sendTs: '2026-10-10T00:05:00.000Z' }),
      listMessage({ id: 'd9b', sendTs: '2026-10-09T20:00:00.000Z', status: 'SUCCESS', receiptTs: '2026-10-09T20:01:00.000Z' }),
      listMessage({ id: 'd9a', sendTs: '2026-10-09T08:00:00.000Z' }),
      listMessage({ id: 'd8', sendTs: '2026-10-08T15:00:00.000Z' }),
      listMessage({ id: 'd7', sendTs: '2026-10-07T23:00:00.000Z' }),
];
const api = () => fakeCcip({ messages: MESSAGES });

async function seedMeta(lastFinalize: string, lastArchived: string) {
  await store.setMeta(env.DB, 'live_start_day', '2026-10-08');
  await store.setMeta(env.DB, 'last_finalize_day', lastFinalize);
  await store.setMeta(env.DB, 'last_archived_day', lastArchived);
}

describe('runFinalize', () => {
  it('early run catches up every unfinalized day, inserts missing messages and updates status', async () => {
    await seedMeta('2026-10-07', '2026-10-07');
    await store.upsertListRows(env.DB, [liveRow({ id: 'd9b', sendTs: '2026-10-09T20:00:00.000Z' })], []);
    const ccip = api();
    await runFinalize(harness({ now: NOW, ccip }).c, 'early');

    const totals = await env.DB.prepare('SELECT day, messages FROM daily_totals ORDER BY day').all();
    expect(totals.results).toEqual([{ day: '2026-10-08', messages: 1 }, { day: '2026-10-09', messages: 2 }]);
    const d9b = await env.DB.prepare('SELECT status, receipt_ts FROM messages WHERE message_id = ?').bind('d9b').first();
    expect(d9b).toEqual({ status: 'SUCCESS', receipt_ts: '2026-10-09T20:01:00.000Z' });
    expect(await store.getMeta(env.DB, 'last_finalize_day')).toBe('2026-10-09');
    expect((await env.ARCHIVE.list({ prefix: 'messages/' })).objects).toHaveLength(0);
    expect((await readPublic('history.json')).days.map((d: { day: string }) => d.day)).toEqual(['2026-10-08', '2026-10-09']);
    expect((await readPublic('top/lane.json')).windows['7d'][0]).toMatchObject({ messages: 3 });
  });

  it('fills details for the finalized day before rolling it up', async () => {
    await seedMeta('2026-10-08', '2026-10-08');
    const detail = {
      ...detailToken,
      messageId: 'd9b',
      sendTimestamp: '2026-10-09T20:00:00.000Z',
      status: 'SUCCESS',
      receiptTimestamp: '2026-10-09T20:01:00.000Z',
    };
    const prices = fakePrices({
      latest: {
        'base:0x9818b6c09f5ecc843060927e8587c427c7c93583': { price: 1, decimals: 18 },
        'base:0x4200000000000000000000000000000000000006': { price: 2500, decimals: 18 },
      },
    });
    const ccip = fakeCcip({ messages: MESSAGES, details: { d9b: detail } });
    await runFinalize(harness({ now: NOW, ccip, prices }).c, 'early');

    const filled = await env.DB.prepare('SELECT detail_fetched_at, fee_usd, usd_value FROM messages WHERE message_id = ?')
      .bind('d9b')
      .first<{ detail_fetched_at: string | null; fee_usd: number | null; usd_value: number }>();
    expect(filled!.detail_fetched_at).toBe(NOW);
    expect(filled!.fee_usd).toBeCloseTo(0.26674278417559, 9);
    expect(filled!.usd_value).toBeCloseTo(24000.580226526876, 6);
    const total = await env.DB.prepare('SELECT usd_value FROM daily_totals WHERE day = ?').bind('2026-10-09').first<{ usd_value: number }>();
    expect(total!.usd_value).toBeCloseTo(24000.580226526876, 6);
  });

  it('late run archives each unarchived day once, one line per message', async () => {
    await seedMeta('2026-10-09', '2026-10-07');
    await runFinalize(harness({ now: NOW, ccip: api() }).c, 'late');
    const object = await env.ARCHIVE.get('messages/2026/10/09.jsonl.gz');
    const lines = (await gunzipText(await object!.arrayBuffer())).trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).messageId)).toEqual(['d9b', 'd9a']);
    expect(await env.ARCHIVE.get('messages/2026/10/08.jsonl.gz')).not.toBeNull();
    expect(await store.getMeta(env.DB, 'last_archived_day')).toBe('2026-10-09');
  });

  it('alerts when the archive line count differs from D1', async () => {
    await seedMeta('2026-10-09', '2026-10-08');
    await store.upsertListRows(env.DB, [liveRow({ id: 'ghost', sendTs: '2026-10-09T09:00:00.000Z' })], []);
    const { c, alerts } = harness({ now: NOW, ccip: api() });
    await runFinalize(c, 'late');
    expect(alerts.map((a) => a.signature)).toEqual(['archive-count:2026-10-09']);
  });

  it('does nothing when every day is already finalized', async () => {
    await seedMeta('2026-10-09', '2026-10-09');
    const ccip = api();
    await runFinalize(harness({ now: NOW, ccip }).c, 'early');
    expect(ccip.listCalls).toEqual([]);
  });

  it('produces the same daily_totals as the backfill computation for the same day', async () => {
    const day = '2026-10-09';
    const tokenKey = 'base:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const siblingKey = 'ethereum:0xcccccccccccccccccccccccccccccccccccccccc';
    const priced = listMessage({
      id: 'p1', sendTs: '2026-10-09T10:00:00.000Z', sender: '0x1111111111111111111111111111111111111111',
      status: 'SUCCESS', receiptTs: '2026-10-09T10:05:00.000Z',
      token: { address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', amount: '5000000' },
    });
    const other = listMessage({
      id: 'p2', sendTs: '2026-10-09T12:00:00.000Z', sender: '0x4444444444444444444444444444444444444444',
      status: 'SUCCESS', receiptTs: '2026-10-09T12:20:00.000Z',
    });
    const unpriced = listMessage({
      id: 'p3', sendTs: '2026-10-09T14:00:00.000Z', token: { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', amount: '1' },
    });
    const siblingPriced = listMessage({
      id: 'p4', sendTs: '2026-10-09T16:00:00.000Z', token: { address: '0xdddddddddddddddddddddddddddddddddddddddd', amount: '3000000' },
    });
    const coinToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const coinPriced = listMessage({ id: 'p5', sendTs: '2026-10-09T18:00:00.000Z', token: { address: coinToken, amount: '1000000' } });
    const registry = [
      { chainSelector: NETWORKS.base.chainSelector, address: '0xdddddddddddddddddddddddddddddddddddddddd', symbol: 'TKN', name: 'Token', decimals: 6, groupId: 'g' },
      { chainSelector: NETWORKS.ethereum.chainSelector, address: '0xcccccccccccccccccccccccccccccccccccccccc', symbol: 'TKN', name: 'Token', decimals: 18, groupId: 'g' },
      { chainSelector: NETWORKS.base.chainSelector, address: coinToken, symbol: 'CGT', name: 'Coin token', decimals: 6, groupId: null },
    ];
    const unique = [priced, other, unpriced, siblingPriced, coinPriced];
    const prices = new Map([
      [tokenKey, { price: 2, decimals: 6 }],
      [siblingKey, { price: 4, decimals: 18 }],
      [coingeckoKey('cgt'), { price: 5, decimals: COIN_PRICE_DECIMALS }],
    ]);
    const coingeckoIdOf: CoingeckoIdLookup = (chain, address) =>
      chain.selector === NETWORKS.base.chainSelector && address === coinToken ? 'cgt' : undefined;

    await store.setMeta(env.DB, 'live_start_day', day);
    await store.setMeta(env.DB, 'last_finalize_day', '2026-10-08');
    await store.upsertPrices(env.DB, prices, NOW);
    await seedRegistry([NETWORKS.base, NETWORKS.ethereum], registry);
    await store.replaceCoingeckoIds(env.DB, [{ chain: NETWORKS.base.chainSelector, address: coinToken, coinId: 'cgt' }], NOW);
    const ccip = fakeCcip({ messages: [coinPriced, siblingPriced, unpriced, priced, other, { ...priced }] });
    const { c } = harness({ now: NOW, ccip });
    await storeListMessages(c, [unpriced, priced, other, { ...priced }], fallbackLoader(c));
    await runFinalize(c, 'early');

    const chains = new Map([NETWORKS.base, NETWORKS.ethereum].map((n) => [n.chainSelector, chainRef(n)]));
    const groups = buildTokenGroupIndex(registry.map(normalizeRegistryToken).map((t) => tokenGroupEntry(t, chains.get(t.chain))));
    const lookup = (key: string) => prices.get(key);
    const fallback = groupFallback(groups, lookup, { coingeckoIdOf });
    const { rows, tokens } = buildRows(unique.map(normalizeList), lookup, () => ({ source: 'backfill' }), fallback);
    const expected = rollupDay(day, rows, tokens).totals;
    const stored = (await store.dailyHistory(env.DB)).find((t) => t.day === day);
    expect(expected).toMatchObject({ usd_value: 27, unpriced_messages: 1 });
    expect(stored).toEqual(expected);
  });
});
