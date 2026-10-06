import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ATTRIBUTION, publishLiveFiles, putJson, retryPut } from '../src/publish';
import * as store from '../src/store';
import { harness, liveRow, readPublic, resetStorage } from './helpers';

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
