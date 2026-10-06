import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ATTRIBUTION, publishHistoryFiles, publishLiveFiles, publishRegistryFiles, putJson, retryPut } from '../src/publish';
import { LINK_PRICE_KEY } from '@ccip-dev/core';
import { fakePrices, NETWORKS } from '@ccip-dev/core/testing';
import * as store from '../src/store';
import { harness, liveRow, readPublic, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const BASE = '15971525489660198786';
const SENDER = '0x7af7632562b6063e52788607ad56f7a60f57ce09';

async function seed() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO chains VALUES (?, 'ethereum-mainnet-base-1', 'Base Mainnet', 'EVM', '8453', 'x', 'x')").bind(BASE),
    env.DB.prepare("INSERT INTO tokens VALUES (?, '0xtok', 'USDC', 'USD Coin', 6, NULL, 'x', 'x')").bind(BASE),
  ]);
  await store.upsertListRows(
    env.DB,
    [
      liveRow({ id: 'recent', sendTs: '2026-10-08T11:55:00.000Z', sender: '0x7AF7632562B6063E52788607AD56F7A60F57CE09' }, { usd_value: 1234.567, token_count: 1 }),
      liveRow({ id: 'older', sendTs: '2026-10-08T11:30:00.000Z' }, { usd_value: 10 }),
      liveRow({ id: 'yesterday', sendTs: '2026-10-07T23:59:59.000Z' }, { usd_value: 5 }),
    ],
    [{ message_id: 'recent', idx: 0, chain: BASE, token: '0xtok', amount: '1', usd_value: 1234.567 }],
  );
  await store.setMeta(env.DB, 'last_ingest_ok_at', '2026-10-08T11:59:30.000Z');
  await store.setMeta(env.DB, 'last_finalize_day', '2026-10-07');
}

describe('putJson', () => {
  it('writes under v1/ with the envelope and a public max-age', async () => {
    await putJson(env.PUBLIC, 'x.json', { a: 1 }, 30, new Date('2026-10-08T12:00:00.000Z'));
    const object = await env.PUBLIC.get('v1/x.json');
    expect(object?.httpMetadata?.cacheControl).toBe('public, max-age=30');
    expect(await object?.json()).toEqual({ schema_version: 1, updated_at: '2026-10-08T12:00:00.000Z', attribution: ATTRIBUTION, a: 1 });
  });
});

describe('retryPut', () => {
  it('succeeds when the put fails once and then works', async () => {
    const put = vi.fn().mockRejectedValueOnce(new Error('10043')).mockResolvedValue('ok');
    await expect(retryPut(put, async () => {})).resolves.toBe('ok');
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('throws the last error after three failed attempts', async () => {
    const put = vi.fn().mockRejectedValueOnce(new Error('first')).mockRejectedValueOnce(new Error('second')).mockRejectedValue(new Error('third'));
    await expect(retryPut(put, async () => {})).rejects.toThrow('third');
    expect(put).toHaveBeenCalledTimes(3);
  });

  it('waits 1000 ms and then 2000 ms between attempts', async () => {
    const sleep = vi.fn(async () => {});
    await retryPut(vi.fn().mockRejectedValue(new Error('down')), sleep).catch(() => {});
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });
});

describe('publishLiveFiles', () => {
  it('publishes the last 15 minutes with token symbols and verified sender labels', async () => {
    await seed();
    const { c } = harness({
      now: '2026-10-08T12:00:00.000Z',
      labels: { [`ethereum-mainnet-base-1:${SENDER}`]: { name: 'Maple Finance', kind: 'protocol' } },
    });
    await publishLiveFiles(c);
    const live = await readPublic('live.json');
    expect(live.messages).toEqual([
      { id: 'recent', send_ts: '2026-10-08T11:55:00.000Z', status: 'SENT', src: BASE, dst: '11344663589394136015', token: 'USDC', usd: 1234.57, sender_label: 'Maple Finance' },
    ]);
  });

  it('publishes today totals and top lists, excluding other days', async () => {
    await seed();
    const { c } = harness({ now: '2026-10-08T12:00:00.000Z' });
    await publishLiveFiles(c);
    const today = await readPublic('today.json');
    expect(today.day).toBe('2026-10-08');
    expect(today.totals).toMatchObject({ messages: 2, usd_value: 1244.57 });
    expect(today.top.token).toEqual([{ key: `${BASE}:0xtok`, messages: 1, usd: 1234.57 }]);
    expect(today.top.sender[0]).toMatchObject({ key: `${BASE}:${SENDER}`, label: null });
  });

  it('lists new arrivals but not baseline rows seeded at first sight', async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO arrivals VALUES ('chain', 'baseline-chain', '2026-10-08T10:00:00.000Z', '2026-10-08T10:00:00.000Z')"),
      env.DB.prepare("INSERT INTO arrivals VALUES ('token', 'new-token', '2026-10-08T09:00:00.000Z', NULL)"),
      env.DB.prepare("INSERT INTO arrivals VALUES ('lane', 'announced-lane', '2026-10-08T08:00:00.000Z', '2026-10-08T08:30:00.000Z')"),
    ]);
    const { c } = harness({ now: '2026-10-08T12:00:00.000Z' });
    await publishLiveFiles(c);
    const today = await readPublic('today.json');
    expect(today.arrivals).toEqual([
      { kind: 'token', key: 'new-token', first_seen: '2026-10-08T09:00:00.000Z' },
      { kind: 'lane', key: 'announced-lane', first_seen: '2026-10-08T08:00:00.000Z' },
    ]);
  });

  it('publishes ingest lag and finalize progress', async () => {
    await seed();
    const { c } = harness({ now: '2026-10-08T12:00:00.000Z' });
    await publishLiveFiles(c);
    expect(await readPublic('status.json')).toMatchObject({
      last_ingest_ok_at: '2026-10-08T11:59:30.000Z',
      lag_seconds: 30,
      last_finalize_day: '2026-10-07',
      coverage_from: null,
    });
  });
});

describe('reserve.json statistics', () => {
  const NOW_RESERVE = '2026-10-06T16:00:00.000Z';
  const D = '0x5680681ed3767b96914ce741a308155c7fb9171d';
  const linkRaw = (n: bigint) => (n * 10n ** 18n).toString();

  async function seedReserve(): Promise<void> {
    await store.insertReserve(env.DB, '2026-10-06T16:00:00.000Z', linkRaw(150_000n));
    await store.insertReserveTransfers(env.DB, [
      { txHash: '0xe1', logIndex: 0, blockNumber: 1, ts: '2026-09-15T15:35:00.000Z', direction: 'in', counterparty: D, amount: linkRaw(100_000n) },
      { txHash: '0xe2', logIndex: 0, blockNumber: 2, ts: '2026-09-30T15:35:00.000Z', direction: 'in', counterparty: D, amount: linkRaw(50_000n) },
    ]);
    await store.setReserveTransferPrices(env.DB, [
      { txHash: '0xe1', logIndex: 0, linkUsd: 10 },
      { txHash: '0xe2', logIndex: 0, linkUsd: 20 },
    ]);
  }

  it('publishes cost basis, pace, weeks and transfers once the scan has caught up, keeping the existing fields', async () => {
    await seedReserve();
    await store.setMeta(env.DB, 'reserve_scan_caught_up', '1');
    const prices = fakePrices({ latest: { [LINK_PRICE_KEY]: { price: 14.05836, decimals: 18 } } });
    await publishRegistryFiles(harness({ now: NOW_RESERVE, prices }).c);
    const doc = await readPublic('reserve.json');
    expect(doc).toMatchObject({
      schema_version: 1,
      latest: { ts: '2026-10-06T16:00:00.000Z', link: 150_000 },
      link_price_usd: 14.0584,
      cost_basis: { link_in: 150_000, link_out: 0, cost_usd: 2_000_000, value_usd: 2_108_754, unpriced_transfers: 0 },
      pace: { deposits: 2, last_deposit: { tx: '0xe2', link: 50_000, price_usd: 20, usd: 1_000_000 } },
      performance: { best: { tx: '0xe1', price_usd: 10 }, worst: { tx: '0xe2', price_usd: 20 }, above: 1, below: 1 },
    });
    expect(doc.weekly.map((w: { week: string }) => w.week)).toEqual(['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']);
    expect(doc.transfers).toHaveLength(2);
    expect(doc.latest_transfer).toEqual(doc.transfers[1]);
    expect(Array.isArray(doc.series)).toBe(true);
  });

  it('publishes empty statistics before the scan has caught up', async () => {
    await seedReserve();
    const prices = fakePrices({ latest: { [LINK_PRICE_KEY]: { price: 14, decimals: 18 } } });
    await publishRegistryFiles(harness({ now: NOW_RESERVE, prices }).c);
    expect(await readPublic('reserve.json')).toMatchObject({
      link_price_usd: 14, cost_basis: null, pace: null, weekly: [], performance: null, transfers: [], latest_transfer: null,
    });
  });

  it('publishes the cost basis without now-values when the LINK price is unavailable', async () => {
    await seedReserve();
    await store.setMeta(env.DB, 'reserve_scan_caught_up', '1');
    const prices = { ...fakePrices(), latest: async () => { throw new Error('llama down'); } };
    await publishRegistryFiles(harness({ now: NOW_RESERVE, prices }).c);
    expect(await readPublic('reserve.json')).toMatchObject({
      link_price_usd: null,
      cost_basis: { cost_usd: 2_000_000, value_usd: null, change_usd: null, change_pct: null },
    });
  });
});

describe('today.json fees paid in LINK', () => {
  const NOW = '2026-10-08T12:00:00.000Z';

  it('publishes the LINK fee total and its share of all fees', async () => {
    const linkBase = '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196';
    await seedRegistry([NETWORKS.base], [
      { chainSelector: NETWORKS.base.chainSelector, address: linkBase, symbol: 'LINK', name: 'Chainlink', decimals: 18, groupId: 'link' },
    ]);
    await env.DB.prepare(`INSERT INTO tokens (chain, address, symbol, name, decimals, group_id, first_seen, last_seen) VALUES (?, ?, 'LINK', 'Chainlink', 18, 'link', ?, ?)`)
      .bind('5009297550715157269', '0x514910771AF9Ca656af840dff83E8264EcF986CA', NOW, NOW).run();
    const today = NOW.slice(0, 10);
    await store.upsertListRows(env.DB, [
      liveRow({ id: 't1', sendTs: `${today}T00:01:00.000Z`, src: NETWORKS.base }, { fee_token: linkBase, fee_amount: '1', fee_usd: 2 }),
      liveRow({ id: 't2', sendTs: `${today}T00:02:00.000Z`, src: NETWORKS.base }, { fee_token: '0x4200000000000000000000000000000000000006', fee_amount: '1', fee_usd: 3 }),
    ], []);
    await publishLiveFiles(harness({ now: NOW }).c);
    expect((await readPublic('today.json')).totals).toMatchObject({ fee_usd: 5, fee_link_usd: 2, fee_link_share_pct: 40 });
  });
});

describe('history.json for a day without fee data', () => {
  it('shows null fees for a day whose daily_totals row has no fee data', async () => {
    await store.replaceDaily(
      env.DB,
      { day: '2026-09-01', messages: 3, token_messages: 2, usd_value: 100, fee_usd: null, unique_senders: 2, median_delivery_s: 60, unpriced_messages: 0 },
      [],
      '2026-10-08T12:00:00.000Z',
    );
    await publishHistoryFiles(harness({ now: '2026-10-08T12:00:00.000Z' }).c);
    const history = await readPublic('history.json');
    expect(history.days.find((d: { day: string }) => d.day === '2026-09-01')).toMatchObject({ fee_usd: null, fee_link_usd: null });
  });
});
