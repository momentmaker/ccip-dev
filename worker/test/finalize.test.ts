import {
  buildRows, buildTokenGroupIndex, chainRef, COIN_PRICE_DECIMALS, coingeckoKey, groupFallback, gunzipText, normalizeList,
  normalizeRegistryToken, rollupDay, tokenGroupEntry, UpstreamHttpError, type CoingeckoIdLookup,
} from '@ccip-dev/core';
import { fakeCcip, fakePrices, listMessage, NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import detailMultiToken from '../../packages/core/test/fixtures/detail-multi-token.json';
import detailToken from '../../packages/core/test/fixtures/detail-token.json';
import { runDetails } from '../src/jobs/details';
import { runFinalize } from '../src/jobs/finalize';
import { storeListMessages } from '../src/jobs/ingest';
import * as store from '../src/store';
import { fallbackLoader } from '../src/price-fallback';
import { harness, liveRow, readPublic, resetStorage, seedRegistry, watchedDb } from './helpers';

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

/** Everything a finalize run leaves behind: D1 rows, pointers, archives, published history and alerts. */
async function finalizeOutput(alerts: { signature: string; text: string }[]) {
  const rows = async (sql: string) => (await env.DB.prepare(sql).all()).results;
  const archiveIds = async (key: string) =>
    (await gunzipText(await (await env.ARCHIVE.get(key))!.arrayBuffer())).trim().split('\n').map((l) => JSON.parse(l).messageId as string);
  const archived = (await env.ARCHIVE.list({ prefix: 'messages/' })).objects.map((o) => o.key);
  return {
    totals: await rows(
      'SELECT day, messages, token_messages, usd_value, fee_usd, unique_senders, median_delivery_s, unpriced_messages, fee_link_usd FROM daily_totals ORDER BY day',
    ),
    breakdown: await rows('SELECT day, dim, key, messages, usd_value, fee_usd FROM daily_breakdown ORDER BY day, dim, key'),
    messages: await rows(
      'SELECT message_id, status, receipt_ts, usd_value, detail_fetched_at, next_check_at FROM messages ORDER BY message_id',
    ),
    tokens: await rows('SELECT message_id, idx, token, amount, usd_value FROM message_tokens ORDER BY message_id, idx'),
    meta: await rows("SELECT key, value FROM meta WHERE key IN ('last_finalize_day', 'last_archived_day') ORDER BY key"),
    archives: Object.fromEntries(await Promise.all(archived.map(async (key) => [key, await archiveIds(key)]))),
    history: (await readPublic('history.json')).days,
    topLanes: (await readPublic('top/lane.json')).windows,
    alerts,
  };
}

async function seedMeta(lastFinalize: string, lastArchived: string) {
  await store.setMeta(env.DB, 'live_start_day', '2026-10-08');
  await store.setMeta(env.DB, 'last_finalize_day', lastFinalize);
  await store.setMeta(env.DB, 'last_archived_day', lastArchived);
}

describe('daily USD anomaly alert', () => {
  async function seedTrailingDays(): Promise<void> {
    await seedMeta('2026-10-08', '2026-10-08');
    for (const day of ['01', '02', '03', '04', '05', '06', '07', '08']) {
      await store.replaceDaily(
        env.DB,
        { day: `2026-10-${day}`, messages: 1, token_messages: 1, usd_value: 1000, fee_usd: null, unique_senders: 1, median_delivery_s: 1, unpriced_messages: 0 },
        [],
        NOW,
      );
    }
  }

  async function finalizeDayWith(usdValue: number) {
    await seedTrailingDays();
    await store.upsertListRows(env.DB, [liveRow({ id: 'd9a', sendTs: '2026-10-09T08:00:00.000Z' }, { usd_value: usdValue })], []);
    const h = harness({ now: NOW, ccip: api() });
    await runFinalize(h.c, 'early');
    return h.alerts;
  }

  it('alerts when a day is more than 10x the trailing median', async () => {
    const alerts = await finalizeDayWith(11_000);
    expect(alerts.map((a) => a.signature)).toEqual(['daily-usd-anomaly:2026-10-09']);
    expect(alerts[0]!.text).toContain('11000');
    expect(alerts[0]!.text).toContain('1000');
  });

  it('stays quiet at 9x the trailing median', async () => {
    expect(await finalizeDayWith(9_000)).toEqual([]);
  });

  it('stays quiet with fewer than 7 trailing days', async () => {
    await store.setMeta(env.DB, 'live_start_day', '2026-10-08');
    await store.upsertListRows(env.DB, [liveRow({ id: 'd9a', sendTs: '2026-10-09T08:00:00.000Z' }, { usd_value: 1e9 })], []);
    expect(await store.trailingUsdMedian(env.DB, '2026-10-09', 30)).toBeNull();
    const h = harness({ now: NOW, ccip: api() });
    await store.setMeta(env.DB, 'last_finalize_day', '2026-10-08');
    await runFinalize(h.c, 'early');
    expect(h.alerts).toEqual([]);
  });
});

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

  describe('live messages detailed earlier', () => {
    const sendTs = '2026-10-09T20:00:00.000Z';
    const detail = { ...detailToken, messageId: 'd9b', sendTimestamp: sendTs, status: 'SUCCESS', receiptTimestamp: '2026-10-09T20:01:00.000Z' };
    const detailedRow = (unpriced: boolean) =>
      liveRow(
        { id: 'd9b', sendTs, status: 'SUCCESS', receiptTs: '2026-10-09T20:01:00.000Z' },
        { unpriced: unpriced ? 1 : 0, usd_value: unpriced ? 0 : 24000.580226526876, detail_fetched_at: '2026-10-09T20:02:00.000Z', next_check_at: null },
      );
    const priceKeys = {
      'base:0x9818b6c09f5ecc843060927e8587c427c7c93583': { price: 1, decimals: 18 },
      'base:0x4200000000000000000000000000000000000006': { price: 2500, decimals: 18 },
    };
    const trackedCcip = () => {
      const ccip = fakeCcip({ messages: MESSAGES.filter((m) => m.messageId === 'd9b'), details: { d9b: detail } });
      const detailCalls: string[] = [];
      const getMessageRaw = ccip.getMessageRaw.bind(ccip);
      ccip.getMessageRaw = async (id) => {
        detailCalls.push(id);
        return getMessageRaw(id);
      };
      return { ccip, detailCalls };
    };
    const messageRow = (id: string) =>
      env.DB.prepare('SELECT unpriced, usd_value, next_check_at FROM messages WHERE message_id = ?')
        .bind(id)
        .first<{ unpriced: number; usd_value: number; next_check_at: string | null }>();
    const dayTotals = () =>
      env.DB.prepare('SELECT unpriced_messages, usd_value FROM daily_totals WHERE day = ?')
        .bind('2026-10-09')
        .first<{ unpriced_messages: number; usd_value: number }>();

    it('re-values a message that was stored unpriced once its price is available', async () => {
      await seedMeta('2026-10-08', '2026-10-08');
      await store.upsertListRows(env.DB, [detailedRow(true)], []);
      await store.upsertPrices(env.DB, new Map(Object.entries(priceKeys)), NOW);
      const { ccip } = trackedCcip();
      await runFinalize(harness({ now: NOW, ccip, prices: fakePrices({ latest: priceKeys }) }).c, 'early');

      const row = await messageRow('d9b');
      expect(row).toMatchObject({ unpriced: 0, next_check_at: null });
      expect(row!.usd_value).toBeCloseTo(24000.580226526876, 6);
      const totals = await dayTotals();
      expect(totals!.unpriced_messages).toBe(0);
      expect(totals!.usd_value).toBeCloseTo(24000.580226526876, 6);
    });

    it('does not re-fetch a message that is detailed and priced', async () => {
      await seedMeta('2026-10-08', '2026-10-08');
      await store.upsertListRows(env.DB, [detailedRow(false)], []);
      const { ccip, detailCalls } = trackedCcip();
      await runFinalize(harness({ now: NOW, ccip }).c, 'early');
      expect(detailCalls).toEqual([]);
    });

    it('keeps a message that is still unpriceable unpriced and counts it', async () => {
      await seedMeta('2026-10-08', '2026-10-08');
      await store.upsertListRows(env.DB, [detailedRow(true)], []);
      const { ccip, detailCalls } = trackedCcip();
      await runFinalize(harness({ now: NOW, ccip }).c, 'early');

      expect(detailCalls).toEqual(['d9b']);
      expect(await messageRow('d9b')).toMatchObject({ unpriced: 1, next_check_at: null });
      expect((await dayTotals())!.unpriced_messages).toBe(1);
    });
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

  /** Recorded from the finalize that collected every day in one walk, before days were collected and finalized one at a time. */
  const TWO_DAY_OUTPUT = {
    totals: [
      { day: '2026-10-08', messages: 3, token_messages: 1, usd_value: 2, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0, fee_link_usd: null },
      { day: '2026-10-09', messages: 2, token_messages: 1, usd_value: 24000.580226526876, fee_usd: 0.2667427841755925, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: 0 },
    ],
    breakdown: [
      { day: '2026-10-08', dim: 'dst_chain', key: '11344663589394136015', messages: 3, usd_value: 2, fee_usd: null },
      { day: '2026-10-08', dim: 'lane', key: '15971525489660198786>11344663589394136015', messages: 3, usd_value: 2, fee_usd: null },
      { day: '2026-10-08', dim: 'sender', key: '15971525489660198786:0x1111111111111111111111111111111111111111', messages: 3, usd_value: 2, fee_usd: null },
      { day: '2026-10-08', dim: 'src_chain', key: '15971525489660198786', messages: 3, usd_value: 2, fee_usd: null },
      { day: '2026-10-08', dim: 'token', key: '15971525489660198786:0x9818b6c09f5ecc843060927e8587c427c7c93583', messages: 1, usd_value: 2, fee_usd: null },
      { day: '2026-10-09', dim: 'dst_chain', key: '11344663589394136015', messages: 2, usd_value: 24000.580226526876, fee_usd: 0.2667427841755925 },
      { day: '2026-10-09', dim: 'lane', key: '15971525489660198786>11344663589394136015', messages: 2, usd_value: 24000.580226526876, fee_usd: 0.2667427841755925 },
      { day: '2026-10-09', dim: 'sender', key: '15971525489660198786:0x1111111111111111111111111111111111111111', messages: 2, usd_value: 24000.580226526876, fee_usd: 0.2667427841755925 },
      { day: '2026-10-09', dim: 'src_chain', key: '15971525489660198786', messages: 2, usd_value: 24000.580226526876, fee_usd: 0.2667427841755925 },
      { day: '2026-10-09', dim: 'token', key: '15971525489660198786:0x9818b6c09f5ecc843060927e8587c427c7c93583', messages: 1, usd_value: 24000.580226526876, fee_usd: null },
    ],
    messages: [
      { message_id: 'd8', status: 'SENT', receipt_ts: null, usd_value: 0, detail_fetched_at: null, next_check_at: '2026-10-10T06:10:00.000Z' },
      { message_id: 'd9a', status: 'SENT', receipt_ts: null, usd_value: 0, detail_fetched_at: null, next_check_at: '2026-10-10T06:10:00.000Z' },
      { message_id: 'd9b', status: 'SUCCESS', receipt_ts: '2026-10-09T20:01:00.000Z', usd_value: 24000.580226526876, detail_fetched_at: '2026-10-10T00:10:00.000Z', next_check_at: null },
      { message_id: 'ghost', status: 'SENT', receipt_ts: null, usd_value: 0, detail_fetched_at: null, next_check_at: '2026-10-10T06:10:00.000Z' },
      { message_id: 'p8', status: 'SENT', receipt_ts: null, usd_value: 2, detail_fetched_at: null, next_check_at: '2026-10-10T06:10:00.000Z' },
    ],
    tokens: [
      { message_id: 'd9b', idx: 0, token: '0x9818b6c09f5ecc843060927e8587c427c7c93583', amount: '24000580226526875891506', usd_value: 24000.580226526876 },
      { message_id: 'p8', idx: 0, token: '0x9818b6c09f5ecc843060927e8587c427c7c93583', amount: '2000000000000000000', usd_value: 2 },
    ],
    meta: [
      { key: 'last_archived_day', value: '2026-10-09' },
      { key: 'last_finalize_day', value: '2026-10-09' },
    ],
    archives: {
      'messages/2026/10/08.jsonl.gz': ['d8', 'p8'],
      'messages/2026/10/09.jsonl.gz': ['d9b', 'd9a'],
    },
    history: [
      { day: '2026-10-08', messages: 3, token_messages: 1, usd_value: 2, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0, fee_link_usd: null },
      { day: '2026-10-09', messages: 2, token_messages: 1, usd_value: 24000.58, fee_usd: 0.27, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: 0 },
    ],
    topLanes: {
      '7d': [{ key: '15971525489660198786>11344663589394136015', messages: 5, usd: 24002.58, fee_usd: 0.27 }],
      '30d': [{ key: '15971525489660198786>11344663589394136015', messages: 5, usd: 24002.58, fee_usd: 0.27 }],
      all: [{ key: '15971525489660198786>11344663589394136015', messages: 5, usd: 24002.58, fee_usd: 0.27 }],
    },
    alerts: [
      { signature: 'archive-count:2026-10-08', text: 'Archive for 2026-10-08 has 2 messages but D1 has 3' },
    ],
  };

  it('finalizes a two-day catch-up, early then late, to the same rows, archives, history and alerts as before', async () => {
    await seedMeta('2026-10-07', '2026-10-07');
    const tokenAddress = '0x9818b6c09f5ecc843060927e8587c427c7c93583';
    const priced = listMessage({ id: 'p8', sendTs: '2026-10-08T09:00:00.000Z', token: { address: tokenAddress, amount: '2000000000000000000' } });
    const detail = { ...detailToken, messageId: 'd9b', sendTimestamp: '2026-10-09T20:00:00.000Z', status: 'SUCCESS', receiptTimestamp: '2026-10-09T20:01:00.000Z' };
    const latest = { [`base:${tokenAddress}`]: { price: 1, decimals: 18 }, 'base:0x4200000000000000000000000000000000000006': { price: 2500, decimals: 18 } };
    await store.upsertPrices(env.DB, new Map(Object.entries(latest)), '2026-10-09T23:00:00.000Z');
    await store.upsertListRows(
      env.DB,
      [liveRow({ id: 'd9a', sendTs: '2026-10-09T08:00:00.000Z' }), liveRow({ id: 'ghost', sendTs: '2026-10-08T12:00:00.000Z' })],
      [],
    );
    const ccip = () => fakeCcip({ messages: [...MESSAGES.slice(0, 4), priced, MESSAGES[4]!], details: { d9b: detail } });
    const early = harness({ now: NOW, ccip: ccip(), prices: fakePrices({ latest }) });
    await runFinalize(early.c, 'early');
    const late = harness({ now: '2026-10-10T06:00:00.000Z', ccip: ccip(), prices: fakePrices({ latest }) });
    await runFinalize(late.c, 'late');
    expect(await finalizeOutput([...early.alerts, ...late.alerts])).toEqual(TWO_DAY_OUTPUT);
  });

  describe('a long catch-up', () => {
    const finalizedDays = async () => (await env.DB.prepare('SELECT day FROM daily_totals ORDER BY day').all<{ day: string }>()).results.map((r) => r.day);

    it('finalizes at most three days a run, oldest first, and leaves the rest for the next run', async () => {
      await store.setMeta(env.DB, 'live_start_day', '2026-10-04');
      await store.setMeta(env.DB, 'last_finalize_day', '2026-10-04');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await runFinalize(harness({ now: NOW, ccip: api() }).c, 'early');
      const warnings = warn.mock.calls.map((args) => String(args[0])).filter((w) => w.startsWith('finalize'));
      warn.mockRestore();
      expect({
        finalized: await finalizedDays(),
        pointer: await store.getMeta(env.DB, 'last_finalize_day'),
        published: (await readPublic('history.json')).days.map((d: { day: string }) => d.day),
        warnings,
      }).toEqual({
        finalized: ['2026-10-05', '2026-10-06', '2026-10-07'],
        pointer: '2026-10-07',
        published: ['2026-10-05', '2026-10-06', '2026-10-07'],
        warnings: ['finalize took the oldest 3 of 5 days; the rest wait for the next run'],
      });
    });

    it('in the late run, archives the oldest three unarchived days and leaves yesterday\'s re-finalize for later', async () => {
      await store.setMeta(env.DB, 'live_start_day', '2026-10-04');
      await store.setMeta(env.DB, 'last_finalize_day', '2026-10-09');
      await store.setMeta(env.DB, 'last_archived_day', '2026-10-04');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await runFinalize(harness({ now: '2026-10-10T06:00:00.000Z', ccip: api() }).c, 'late');
      warn.mockRestore();
      expect({
        finalized: await finalizedDays(),
        archived: (await env.ARCHIVE.list({ prefix: 'messages/' })).objects.map((o) => o.key),
        pointer: await store.getMeta(env.DB, 'last_archived_day'),
      }).toEqual({
        finalized: ['2026-10-05', '2026-10-06', '2026-10-07'],
        archived: ['messages/2026/10/05.jsonl.gz', 'messages/2026/10/06.jsonl.gz', 'messages/2026/10/07.jsonl.gz'],
        pointer: '2026-10-07',
      });
    });

    it('collects each day just before finalizing it, so only one day of list pages is held at a time', async () => {
      await seedMeta('2026-10-07', '2026-10-07');
      const ccip = api();
      const listMessages = ccip.listMessages.bind(ccip);
      const finalizedAtEachWalk: string[][] = [];
      ccip.listMessages = async (opts) => {
        if (!opts.cursor) finalizedAtEachWalk.push(await finalizedDays());
        return listMessages(opts);
      };
      await runFinalize(harness({ now: NOW, ccip }).c, 'early');
      expect(finalizedAtEachWalk).toEqual([[], ['2026-10-08']]);
    });
  });

  describe('when one day fails', () => {
    /** MESSAGES, except that the `failing`th walk (a list call without a cursor) fails, as an API outage during that day's walk would. */
    function apiFailingWalk(failing: number) {
      const ccip = api();
      const listMessages = ccip.listMessages.bind(ccip);
      let walks = 0;
      ccip.listMessages = async (opts) => {
        if (!opts.cursor && ++walks === failing) throw new Error('CCIP list down');
        return listMessages(opts);
      };
      return ccip;
    }

    async function runWithWalkFailing(failing: number, mode: 'early' | 'late', now = NOW) {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const outcome = await runFinalize(harness({ now, ccip: apiFailingWalk(failing) }).c, mode).then(
        () => null,
        (err: unknown) => String(err),
      );
      const errors = logged.mock.calls.map((args) => String(args[0]));
      logged.mockRestore();
      return { outcome, errors };
    }

    const finalized = async () => ({
      totals: (await env.DB.prepare('SELECT day FROM daily_totals ORDER BY day').all()).results,
      pointer: await store.getMeta(env.DB, 'last_finalize_day'),
      published: (await readPublic('history.json')).days.map((d: { day: string }) => d.day),
    });

    it('logs it, finalizes the days after it and publishes them, then fails the run naming the day', async () => {
      await seedMeta('2026-10-07', '2026-10-07');
      const { outcome, errors } = await runWithWalkFailing(1, 'early');
      expect({ outcome, errors: errors.filter((e) => e.startsWith('finalize')), ...(await finalized()) }).toEqual({
        outcome: 'Error: finalize failed for 1 day(s); the first: 2026-10-08: CCIP list down',
        errors: ['finalize of 2026-10-08 failed: CCIP list down'],
        totals: [{ day: '2026-10-09' }],
        pointer: '2026-10-07',
        published: ['2026-10-09'],
      });
    });

    it('when it is the newest day, advances last_finalize_day through the days before it', async () => {
      await seedMeta('2026-10-07', '2026-10-07');
      const { outcome } = await runWithWalkFailing(2, 'early');
      expect({ outcome, ...(await finalized()) }).toEqual({
        outcome: 'Error: finalize failed for 1 day(s); the first: 2026-10-09: CCIP list down',
        totals: [{ day: '2026-10-08' }],
        pointer: '2026-10-08',
        published: ['2026-10-08'],
      });
    });

    it('keeps last_finalize_day before the failed day, so the next run retries it', async () => {
      await seedMeta('2026-10-07', '2026-10-07');
      await runWithWalkFailing(1, 'early');
      expect(await store.getMeta(env.DB, 'last_finalize_day')).toBe('2026-10-07');

      await runFinalize(harness({ now: NOW, ccip: api() }).c, 'early');
      expect(await store.getMeta(env.DB, 'last_finalize_day')).toBe('2026-10-09');
      expect((await env.DB.prepare('SELECT day FROM daily_totals ORDER BY day').all()).results).toEqual([
        { day: '2026-10-08' }, { day: '2026-10-09' },
      ]);
    });

    it('archives the later days but keeps last_archived_day before the failed day', async () => {
      await seedMeta('2026-10-09', '2026-10-07');
      await runWithWalkFailing(1, 'late');
      expect({
        archived: (await env.ARCHIVE.list({ prefix: 'messages/' })).objects.map((o) => o.key),
        pointer: await store.getMeta(env.DB, 'last_archived_day'),
      }).toEqual({ archived: ['messages/2026/10/09.jsonl.gz'], pointer: '2026-10-07' });
    });

    it('logs the day failures before rethrowing a history publish failure that would mask them', async () => {
      await seedMeta('2026-10-07', '2026-10-07');
      const { db } = watchedDb(/FROM daily_totals ORDER BY day/, { fail: true });
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const outcome = await runFinalize(harness({ now: NOW, ccip: apiFailingWalk(2), db }).c, 'early').then(
        () => null,
        (err: unknown) => String(err),
      );
      const errors = logged.mock.calls.map((args) => String(args[0]));
      logged.mockRestore();
      expect({ outcome, errors: errors.filter((e) => e.startsWith('history')) }).toEqual({
        outcome: 'Error: D1_ERROR: no such table: tokens',
        errors: ['history publish failed after finalize failed for 1 day(s); the first: 2026-10-09: CCIP list down'],
      });
    });

    it('publishes nothing when no day was finalized', async () => {
      await seedMeta('2026-10-07', '2026-10-07');
      const { outcome } = await runWithWalkFailing(1, 'early', '2026-10-09T00:10:00.000Z');
      expect(outcome).toContain('2026-10-08');
      expect(await env.PUBLIC.get('v1/history.json')).toBeNull();
    });
  });

  describe('when a detail fill fails', () => {
    /** d8's detail is invalid, so its fill writes to an archive whose unparsed/ prefix is down. */
    const archiveDownForUnparsed = () =>
      new Proxy(env.ARCHIVE, {
        get(target, prop) {
          if (prop === 'put') {
            return (key: string, ...rest: unknown[]) => {
              if (key.startsWith('unparsed/')) throw new Error('R2 unavailable');
              return (target.put as (...args: unknown[]) => unknown)(key, ...rest);
            };
          }
          const value: unknown = Reflect.get(target, prop, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

    /** Runs finalize with an archive whose unparsed/ prefix is down, so an invalid detail makes its fill fail. */
    async function runWithFillFailing(mode: 'early' | 'late', now: string, ccip: ReturnType<typeof fakeCcip>) {
      const { c, alerts } = harness({ now, ccip });
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const outcome = await runFinalize({ ...c, env: { ...c.env, ARCHIVE: archiveDownForUnparsed() } }, mode).then(
        () => null,
        (err: unknown) => String(err),
      );
      logged.mockRestore();
      return { outcome, alerts };
    }
    const dayRows = async () => (await env.DB.prepare('SELECT day, messages FROM daily_totals ORDER BY day').all()).results;

    it('holds the day, and its pointer, while the hourly retries can still fill it (yesterday)', async () => {
      await seedMeta('2026-10-08', '2026-10-08');
      const ccip = fakeCcip({ messages: MESSAGES, details: { d9a: { messageId: 'd9a', status: 5 } } });
      const { outcome, alerts } = await runWithFillFailing('early', NOW, ccip);
      expect({ outcome, totals: await dayRows(), pointer: await store.getMeta(env.DB, 'last_finalize_day'), alerts }).toEqual({
        outcome: 'Error: finalize failed for 1 day(s); the first: 2026-10-09: 1 detail fill(s) failed; the first: d9a: R2 unavailable',
        totals: [],
        pointer: '2026-10-08',
        alerts: [],
      });
    });

    it('rolls up a day 72 hours or more past its start with list values, advances, and alerts', async () => {
      await seedMeta('2026-10-07', '2026-10-07');
      const ccip = fakeCcip({ messages: MESSAGES, details: { d8: { messageId: 'd8', status: 5 } } });
      const { outcome, alerts } = await runWithFillFailing('early', '2026-10-11T00:10:00.000Z', ccip);
      expect({ outcome, totals: await dayRows(), pointer: await store.getMeta(env.DB, 'last_finalize_day'), alerts }).toEqual({
        outcome: null,
        totals: [{ day: '2026-10-08', messages: 1 }, { day: '2026-10-09', messages: 2 }, { day: '2026-10-10', messages: 1 }],
        pointer: '2026-10-10',
        alerts: [{ signature: 'detail-fill:2026-10-08', text: '2026-10-08 was rolled up without 1 message detail(s) that failed to fill; the first: d8: R2 unavailable' }],
      });
    });

    it('keeps last_archived_day, and writes no archive, for a held day in the late run', async () => {
      await seedMeta('2026-10-09', '2026-10-08');
      const ccip = fakeCcip({ messages: MESSAGES, details: { d9a: { messageId: 'd9a', status: 5 } } });
      const { outcome } = await runWithFillFailing('late', '2026-10-10T06:00:00.000Z', ccip);
      expect({
        outcome,
        archived: (await env.ARCHIVE.list({ prefix: 'messages/' })).objects.map((o) => o.key),
        pointer: await store.getMeta(env.DB, 'last_archived_day'),
      }).toEqual({
        outcome: 'Error: finalize failed for 1 day(s); the first: 2026-10-09: 1 detail fill(s) failed; the first: d9a: R2 unavailable',
        archived: [],
        pointer: '2026-10-08',
      });
    });

    it('finalizes the held day from the fill the hourly retry stored, with its fee and every token', async () => {
      await seedMeta('2026-10-08', '2026-10-08');
      const tokenA = '0x9818b6c09f5ecc843060927e8587c427c7c93583';
      const listed = listMessage({
        id: 'd9m', sendTs: '2026-10-09T20:00:00.000Z', status: 'SUCCESS', receiptTs: '2026-10-09T20:01:00.000Z',
        token: { address: tokenA, amount: '24000580226526875891506' },
      });
      await runWithFillFailing('early', NOW, fakeCcip({ messages: [listed], details: { d9m: { messageId: 'd9m', status: 5 } } }));
      expect(await store.getMeta(env.DB, 'last_finalize_day')).toBe('2026-10-08');

      const detail = {
        ...detailMultiToken, messageId: 'd9m', sendTimestamp: '2026-10-09T20:00:00.000Z', status: 'SUCCESS', receiptTimestamp: '2026-10-09T20:01:00.000Z',
      };
      const prices = fakePrices({
        latest: {
          [`base:${tokenA}`]: { price: 1, decimals: 18 },
          'base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { price: 1, decimals: 6 },
          'base:0x4200000000000000000000000000000000000006': { price: 2500, decimals: 18 },
        },
      });
      await runDetails(harness({ now: '2026-10-10T01:20:00.000Z', ccip: fakeCcip({ details: { d9m: detail } }), prices }).c, { limit: 10 });
      expect((await env.DB.prepare('SELECT detail_fetched_at FROM messages WHERE message_id = ?').bind('d9m').first())).toEqual({
        detail_fetched_at: '2026-10-10T01:20:00.000Z',
      });

      const brokenApi = fakeCcip({ messages: [listed], details: { d9m: new UpstreamHttpError('GET /messages/{id}', 503) } });
      await runFinalize(harness({ now: '2026-10-11T00:10:00.000Z', ccip: brokenApi }).c, 'early');
      const totals = await env.DB.prepare('SELECT token_messages, usd_value, fee_usd FROM daily_totals WHERE day = ?').bind('2026-10-09').first();
      const tokens = await env.DB.prepare('SELECT COUNT(*) AS n FROM message_tokens WHERE message_id = ?').bind('d9m').first<{ n: number }>();
      expect({ pointer: await store.getMeta(env.DB, 'last_finalize_day'), totals, tokens: tokens!.n }).toEqual({
        pointer: '2026-10-10',
        totals: { token_messages: 1, usd_value: expect.closeTo(24003.080226526876, 6), fee_usd: expect.closeTo(0.2667427841755925, 9) },
        tokens: 2,
      });
    });
  });

  describe('when a detail request fails', () => {
    const apiError = () => new UpstreamHttpError('GET /messages/{id}', 503);

    it('holds the day while hourly retries can still fill it (yesterday)', async () => {
      await seedMeta('2026-10-08', '2026-10-08');
      const outcome = await runFinalize(harness({ now: NOW, ccip: fakeCcip({ messages: MESSAGES, details: { d9a: apiError() } }) }).c, 'early')
        .then(() => null, (err: unknown) => String(err));
      expect({ outcome, pointer: await store.getMeta(env.DB, 'last_finalize_day') }).toEqual({
        outcome: 'Error: finalize failed for 1 day(s); the first: 2026-10-09: 1 detail fill(s) failed; the first: d9a: GET /messages/{id} returned HTTP 503',
        pointer: '2026-10-08',
      });
    });

    it('rolls up a day 72 hours or more past its start, and alerts', async () => {
      await seedMeta('2026-10-07', '2026-10-07');
      const { c, alerts } = harness({ now: '2026-10-11T00:10:00.000Z', ccip: fakeCcip({ messages: MESSAGES, details: { d8: apiError() } }) });
      await runFinalize(c, 'early');
      expect({ pointer: await store.getMeta(env.DB, 'last_finalize_day'), alerts }).toEqual({
        pointer: '2026-10-10',
        alerts: [{
          signature: 'detail-fill:2026-10-08',
          text: '2026-10-08 was rolled up without 1 message detail(s) that failed to fill; the first: d8: GET /messages/{id} returned HTTP 503',
        }],
      });
    });
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

describe('fees paid in LINK', () => {
  it('stores the USD value of the day\'s fees paid in LINK and publishes it in history.json', async () => {
    const day = '2026-10-09';
    const linkEth = '0x514910771AF9Ca656af840dff83E8264EcF986CA';
    const linkBase = '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196';
    await seedRegistry([NETWORKS.ethereum, NETWORKS.base], [
      { chainSelector: NETWORKS.ethereum.chainSelector, address: linkEth, symbol: 'LINK', name: 'Chainlink', decimals: 18, groupId: 'link' },
      { chainSelector: NETWORKS.base.chainSelector, address: linkBase, symbol: 'LINK', name: 'Chainlink', decimals: 18, groupId: 'link' },
    ]);
    await store.setMeta(env.DB, 'live_start_day', day);
    await store.setMeta(env.DB, 'last_finalize_day', '2026-10-08');
    await store.upsertListRows(env.DB, [
      liveRow({ id: 'f1', sendTs: `${day}T10:00:00.000Z`, src: NETWORKS.base }, { fee_token: linkBase, fee_amount: '1', fee_usd: 2, detail_fetched_at: `${day}T10:01:00.000Z`, next_check_at: null }),
      liveRow({ id: 'f2', sendTs: `${day}T11:00:00.000Z`, src: NETWORKS.base }, { fee_token: '0x4200000000000000000000000000000000000006', fee_amount: '1', fee_usd: 3, detail_fetched_at: `${day}T11:01:00.000Z`, next_check_at: null }),
    ], []);
    const { c } = harness({ now: '2026-10-10T00:10:00.000Z', ccip: fakeCcip({ messages: [] }) });
    await runFinalize(c, 'early');
    const stored = await env.DB.prepare('SELECT fee_link_usd FROM daily_totals WHERE day = ?').bind(day).first<{ fee_link_usd: number | null }>();
    expect(stored?.fee_link_usd).toBe(2);
    const history = await readPublic('history.json');
    expect(history.days.find((d: { day: string }) => d.day === day)).toMatchObject({ fee_usd: 5, fee_link_usd: 2 });
  });
});
