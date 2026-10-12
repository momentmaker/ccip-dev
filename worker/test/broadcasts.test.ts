import type { Dim } from '@ccip-dev/core';
import { fakeFetch, NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Broadcast, BroadcastOutput } from '../src/broadcasts/outputs';
import { broadcastMode, telegramOutputs } from '../src/broadcasts/outputs';
import { broadcastHourly, RECORDS_SEED_KEY, RESERVE_SINCE_KEY, runBroadcasts } from '../src/broadcasts/run';
import type { ReserveBody } from '../src/publish';
import * as store from '../src/store';
import { harness, resetStorage, seedRegistry, watchedDb } from './helpers';

beforeEach(resetStorage);

const ETH = NETWORKS.ethereum.chainSelector;
const BASE = NETWORKS.base.chainSelector;
const NOW = '2026-10-11T00:07:00.000Z';
const DAY = '2026-10-10';
const DAILY_KEY = 'broadcast:daily:2026-10-10';
const totals = (day: string, fee: number) => ({ day, messages: 200, token_messages: 0, usd_value: 8e6, fee_usd: fee, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 });
const lane = (day: string): { day: string; dim: Dim; key: string; messages: number; usd_value: number; fee_usd: number } => ({ day, dim: 'lane', key: `${ETH}>${BASE}`, messages: 200, usd_value: 8e6, fee_usd: 4 });

/** Days from Oct 1 through `last`, each 200 messages, $8M and $4 in fees unless `fees` says otherwise. */
async function seedDays(last: string, fees: Record<string, number> = {}): Promise<void> {
  await seedRegistry([NETWORKS.ethereum, NETWORKS.base], []);
  await store.setMeta(env.DB, 'live_start_day', '2026-10-01');
  for (let d = 1; `2026-10-${String(d).padStart(2, '0')}` <= last; d++) {
    const day = `2026-10-${String(d).padStart(2, '0')}`;
    await store.replaceDaily(env.DB, totals(day, fees[day] ?? 4), [lane(day)], NOW);
  }
}

function recorder(name: string, result: 'sent' | 'failed' = 'sent') {
  const sent: Broadcast[] = [];
  const output: BroadcastOutput = {
    name,
    send: async (b) => {
      sent.push(b);
      return result;
    },
  };
  return { output, sent };
}

const card = (status = 200) =>
  fakeFetch((url) => (url.startsWith('https://ccip.dev/og/') ? new Response(new Uint8Array([137, 80, 78, 71]), { status, headers: { 'content-type': 'image/png' } }) : undefined));

async function finalizeRun(o: { now?: string; days: string[]; mode?: string; channel?: 'sent' | 'failed'; drafts?: 'sent' | 'failed'; fetch?: typeof fetch }) {
  const channel = recorder('telegram-channel', o.channel);
  const drafts = recorder('x-draft', o.drafts);
  const h = harness({ now: o.now ?? NOW, fetch: o.fetch ?? card(), env: { BROADCASTS: o.mode ?? 'on' } });
  await runBroadcasts(h.c, { kind: 'finalize', days: o.days }, { channel: [channel.output], drafts: [drafts.output] });
  return { channel: channel.sent, drafts: drafts.sent, alerts: h.alerts };
}

const keys = (sent: Broadcast[]) => sent.map((b) => b.key);

describe('runBroadcasts after finalize', () => {
  it("posts yesterday's daily once to the channel and as an X draft, with the card and both texts", async () => {
    // #given
    await seedDays(DAY);
    // #when
    const { channel, drafts } = await finalizeRun({ days: [DAY] });
    // #then
    expect({
      channel: keys(channel),
      drafts: keys(drafts),
      image: /^https:\/\/ccip\.dev\/og\/broadcast\/daily\/2026-10-10\.png\?v=\d+$/.test(channel[0]?.imageUrl ?? ''),
      x: drafts[0]?.xText.startsWith('#CCIP · Sat, Oct 10'),
      html: channel[0]?.telegramHtml.startsWith('<b>CCIP daily report · Sat, Oct 10, 2026</b>'),
      claim: (await store.getMeta(env.DB, DAILY_KEY))?.startsWith('sent:'),
    }).toEqual({ channel: [DAILY_KEY], drafts: [DAILY_KEY], image: true, x: true, html: true, claim: true });
  });

  it('reaches only the X draft in drafts mode', async () => {
    await seedDays(DAY);
    const { channel, drafts } = await finalizeRun({ days: [DAY], mode: 'drafts' });
    expect({ channel: keys(channel), drafts: keys(drafts) }).toEqual({ channel: [], drafts: [DAILY_KEY] });
  });

  it('sends, claims and seeds nothing when off', async () => {
    // #given
    await seedDays(DAY);
    const fetch = card();
    // #when
    const { channel, drafts } = await finalizeRun({ days: [DAY], mode: 'off', fetch });
    // #then
    expect({ sent: channel.length + drafts.length, fetches: fetch.calls.length, claim: await store.getMeta(env.DB, DAILY_KEY), seed: await store.getMeta(env.DB, RECORDS_SEED_KEY) }).toEqual({
      sent: 0, fetches: 0, claim: null, seed: null,
    });
  });

  it('does not post again on a re-run', async () => {
    await seedDays(DAY);
    await finalizeRun({ days: [DAY] });
    const again = await finalizeRun({ days: [DAY] });
    expect(again.channel.length + again.drafts.length).toBe(0);
  });

  it('releases the claim when every output fails, alerting once per output, so the next run posts', async () => {
    // #given
    await seedDays(DAY);
    // #when
    const failed = await finalizeRun({ days: [DAY], channel: 'failed', drafts: 'failed' });
    const claim = await store.getMeta(env.DB, DAILY_KEY);
    const retried = await finalizeRun({ days: [DAY] });
    // #then
    expect({ alerts: failed.alerts.map((a) => a.signature), claim, retried: keys(retried.channel) }).toEqual({
      alerts: [`broadcast-telegram-channel:${DAILY_KEY}`, `broadcast-x-draft:${DAILY_KEY}`],
      claim: null,
      retried: [DAILY_KEY],
    });
  });

  it('keeps the claim when one output succeeds, alerting for the one that failed', async () => {
    await seedDays(DAY);
    const { alerts } = await finalizeRun({ days: [DAY], channel: 'failed' });
    expect({ alerts: alerts.map((a) => a.signature), sent: (await store.getMeta(env.DB, DAILY_KEY))?.startsWith('sent:') }).toEqual({
      alerts: [`broadcast-telegram-channel:${DAILY_KEY}`],
      sent: true,
    });
  });

  it('posts nothing and alerts when the card answers 500, or does not answer in time', async () => {
    // #given
    await seedDays(DAY);
    const timeout = fakeFetch(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    // #when
    const broken = await finalizeRun({ days: [DAY], fetch: card(500) });
    const slow = await finalizeRun({ days: [DAY], fetch: timeout });
    // #then
    expect({
      sent: broken.channel.length + broken.drafts.length + slow.channel.length + slow.drafts.length,
      alerts: [...broken.alerts, ...slow.alerts].map((a) => a.signature),
      texts: [...broken.alerts, ...slow.alerts].map((a) => a.text.includes('/og/broadcast/daily/2026-10-10.png')),
      claim: await store.getMeta(env.DB, DAILY_KEY),
    }).toEqual({ sent: 0, alerts: [`broadcast-image:${DAILY_KEY}`, `broadcast-image:${DAILY_KEY}`], texts: [true, true], claim: null });
  });

  it('adds the weekly on a Monday, for the Monday–Sunday week that just ended', async () => {
    await seedDays('2026-10-11');
    const { channel } = await finalizeRun({ now: '2026-10-12T00:07:00.000Z', days: ['2026-10-11'] });
    expect(keys(channel)).toEqual(['broadcast:daily:2026-10-11', 'broadcast:weekly:2026-10-05']);
  });

  it('seeds the records it finds on its first run without posting them, then posts a later record', async () => {
    // #given the 10th beat the $4 fee days with $5, and later the 11th beats it with $6
    await seedDays(DAY, { [DAY]: 5 });
    // #when
    const first = await finalizeRun({ days: [DAY] });
    await store.replaceDaily(env.DB, totals('2026-10-11', 6), [lane('2026-10-11')], NOW);
    const second = await finalizeRun({ now: '2026-10-12T00:07:00.000Z', days: ['2026-10-11'] });
    // #then
    expect({
      first: keys(first.channel),
      seeded: (await store.getMeta(env.DB, 'broadcast:record:fees:2026-10-10'))?.startsWith('seeded:'),
      second: keys(second.channel),
    }).toEqual({
      first: [DAILY_KEY],
      seeded: true,
      second: ['broadcast:daily:2026-10-11', 'broadcast:weekly:2026-10-05', 'broadcast:record:fees:2026-10-11'],
    });
  });

  it('never posts a record for a day before live_start_day, or for a day a rewind finalizes again', async () => {
    // #given records were seeded already, and the 10th set a fees record
    await seedDays(DAY, { [DAY]: 5 });
    await store.setMeta(env.DB, RECORDS_SEED_KEY, 'seeded:2026-10-01T00:00:00.000Z');
    // #when the 10th is before the live start, and then a rewind finalizes it again on the 15th
    await store.setMeta(env.DB, 'live_start_day', '2026-10-11');
    const backfill = await finalizeRun({ days: [DAY] });
    await store.setMeta(env.DB, 'live_start_day', '2026-10-01');
    const rewind = await finalizeRun({ now: '2026-10-15T00:07:00.000Z', days: [DAY] });
    // #then
    expect({ backfill: keys(backfill.channel), rewind: keys(rewind.channel) }).toEqual({ backfill: [DAILY_KEY], rewind: [] });
  });
});

describe('broadcast claims', () => {
  const stamp = (minutesBefore: number) => new Date(Date.parse(NOW) - minutesBefore * 60_000).toISOString();

  it('does not re-send a key holding sent: two hours later', async () => {
    // #given
    await seedDays(DAY);
    await store.setMeta(env.DB, DAILY_KEY, `sent:${stamp(120)}`);
    // #when
    const { channel } = await finalizeRun({ days: [DAY] });
    // #then
    expect(keys(channel)).toEqual([]);
  });

  it('is blocked by a pending claim 30 minutes old', async () => {
    // #given
    await seedDays(DAY);
    await store.setMeta(env.DB, DAILY_KEY, `pending:${stamp(30)}`);
    // #when
    const { channel } = await finalizeRun({ days: [DAY] });
    // #then
    expect(keys(channel)).toEqual([]);
  });

  it('reclaims a pending claim 61 minutes old and sends', async () => {
    // #given
    await seedDays(DAY);
    await store.setMeta(env.DB, DAILY_KEY, `pending:${stamp(61)}`);
    // #when
    const { channel } = await finalizeRun({ days: [DAY] });
    // #then
    expect(keys(channel)).toEqual([DAILY_KEY]);
  });

  it('releases the claim before alerting, so an alert that throws cannot leave it pending', async () => {
    // #given
    await seedDays(DAY);
    const h = harness({ now: NOW, fetch: card(500), env: { BROADCASTS: 'on' } });
    const throwing = { ...h.c, alert: async () => { throw new Error('alerter down'); } };
    // #when
    await runBroadcasts(throwing, { kind: 'finalize', days: [DAY] }, { channel: [recorder('telegram-channel').output], drafts: [] }).catch(() => {});
    // #then
    expect(await store.getMeta(env.DB, DAILY_KEY)).toBeNull();
  });

  it('logs an output that throws instead of swallowing it, and counts it failed', async () => {
    // #given
    await seedDays(DAY);
    const h = harness({ now: NOW, fetch: card(), env: { BROADCASTS: 'on' } });
    const boom: BroadcastOutput = { name: 'telegram-channel', send: async () => { throw new TypeError('secret-token in url'); } };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // #when
    await runBroadcasts(h.c, { kind: 'finalize', days: [DAY] }, { channel: [boom], drafts: [] });
    const logged = log.mock.calls.map((a) => a.join(' '));
    log.mockRestore();
    // #then
    expect({ logged: logged.some((l) => l.includes('TypeError') && !l.includes('secret-token')), alerts: h.alerts.map((a) => a.signature), claim: await store.getMeta(env.DB, DAILY_KEY) }).toEqual({
      logged: true, alerts: [`broadcast-telegram-channel:${DAILY_KEY}`], claim: null,
    });
  });
});

describe('broadcast configuration', () => {
  const ENV = { TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_CHANNEL_ID: '@ccipdev', TELEGRAM_ALERT_CHAT_ID: '42' };
  const draftsOf = (extra: Record<string, string>) => telegramOutputs(harness({ now: NOW, env: { ...ENV, ...extra } }).c).drafts.length;
  const draftChat = async (extra: Record<string, string>) => {
    const sent: string[] = [];
    const f = fakeFetch((url, init) => {
      if (url.endsWith('/sendPhoto')) sent.push(JSON.parse(String(init?.body)).chat_id);
      return new Response('{"ok":true}');
    });
    const c = harness({ now: NOW, fetch: f, env: { ...ENV, ...extra } }).c;
    await telegramOutputs(c).drafts[0]?.send({ key: 'k', kind: 'daily', imageUrl: 'https://ccip.dev/x.png', facts: {} as never, xText: 't', telegramHtml: 't' });
    return sent;
  };

  it('sends drafts to TELEGRAM_DRAFTS_CHAT_ID when set', async () => {
    expect(await draftChat({ TELEGRAM_DRAFTS_CHAT_ID: '99' })).toEqual(['99']);
  });

  it('falls back to the alert chat when TELEGRAM_DRAFTS_CHAT_ID is empty', async () => {
    expect(await draftChat({ TELEGRAM_DRAFTS_CHAT_ID: '' })).toEqual(['42']);
    expect(draftsOf({ TELEGRAM_DRAFTS_CHAT_ID: '' })).toBe(1);
  });

  it('reads anything but drafts or on as off', () => {
    expect([broadcastMode({ BROADCASTS: 'On' }), broadcastMode({ BROADCASTS: 'garbage' }), broadcastMode({})]).toEqual(['off', 'off', 'off']);
  });
});

describe('broadcast isolation', () => {
  it('does not reject when D1 and the alerter both throw, in the hourly run', async () => {
    // #given every D1 statement throws and so does the alerter
    const { db } = watchedDb(/./, { fail: true });
    const h = harness({ now: NOW, db, env: { BROADCASTS: 'on', TELEGRAM_BOT_TOKEN: 'b', TELEGRAM_CHANNEL_ID: '@c' } });
    const c = { ...h.c, alert: async () => { throw new Error('alerter down'); } };
    const reserve = { transfers: [], weekly: [], cost_basis: {} } as unknown as ReserveBody;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // #when
    const run = broadcastHourly(c, reserve);
    // #then
    await expect(run).resolves.toBeUndefined();
    log.mockRestore();
  });
});

describe('runBroadcasts for the Reserve', () => {
  const TX1 = `0x${'01'.repeat(32)}`;
  const TX2 = `0x${'02'.repeat(32)}`;
  const view = (ts: string, tx: string, link: number, price: number | null) => ({
    ts, tx, direction: 'in' as const, counterparty: '0xd', link, price_usd: price, usd: price === null ? null : link * price,
    value_now_usd: link * 13, change_pct: null, deposit: true,
  });
  const body = (transfers: ReturnType<typeof view>[], caughtUp = true): ReserveBody => ({
    token: '0xlink', reserve: '0xreserve', latest: null, series: [], link_price_usd: 13,
    cost_basis: caughtUp ? { link_in: 0, link_out: 0, cost_usd: 0, value_usd: null, change_usd: null, change_pct: null, avg_deposit_price_usd: null, unpriced_transfers: 0 } : null,
    pace: null,
    weekly: [{ week: '2026-09-28', deposits: 1, link: 100_000, usd: 1.2e6 }, { week: '2026-10-05', deposits: 1, link: 82_480, usd: 1e6 }],
    performance: null, transfers, latest_transfer: null,
  });
  const FIRST = view('2026-10-01T15:35:00.000Z', TX1, 100_000, 12);
  const reserveRun = async (reserve: ReserveBody) => {
    const channel = recorder('telegram-channel');
    const h = harness({ now: '2026-10-08T17:00:00.000Z', fetch: card(), env: { BROADCASTS: 'on' } });
    await runBroadcasts(h.c, { kind: 'reserve', reserve }, { channel: [channel.output], drafts: [] });
    return keys(channel.sent);
  };

  it('seeds the Reserve watermark on its first run and posts nothing', async () => {
    expect({ sent: await reserveRun(body([FIRST])), since: await store.getMeta(env.DB, RESERVE_SINCE_KEY) }).toEqual({ sent: [], since: FIRST.ts });
  });

  it('posts a new priced deposit once', async () => {
    // #given
    await store.setMeta(env.DB, RESERVE_SINCE_KEY, FIRST.ts);
    const reserve = body([FIRST, view('2026-10-08T15:35:00.000Z', TX2, 82_480, 12.5)]);
    // #when
    const first = await reserveRun(reserve);
    const again = await reserveRun(reserve);
    // #then
    expect({ first, again }).toEqual({ first: [`broadcast:reserve:${TX2}`], again: [] });
  });

  it("waits for a deposit's price", async () => {
    // #given
    await store.setMeta(env.DB, RESERVE_SINCE_KEY, FIRST.ts);
    // #when
    const unpriced = await reserveRun(body([FIRST, view('2026-10-08T15:35:00.000Z', TX2, 82_480, null)]));
    const priced = await reserveRun(body([FIRST, view('2026-10-08T15:35:00.000Z', TX2, 82_480, 12.5)]));
    // #then
    expect({ unpriced, priced }).toEqual({ unpriced: [], priced: [`broadcast:reserve:${TX2}`] });
  });

  it('neither posts nor seeds before the Reserve scan has caught up', async () => {
    expect({ sent: await reserveRun(body([], false)), since: await store.getMeta(env.DB, RESERVE_SINCE_KEY) }).toEqual({ sent: [], since: null });
  });

  it('never posts or claims a deposit older than 3 days, and posts one inside the window', async () => {
    // #given the watermark is far in the past and mode is on
    await store.setMeta(env.DB, RESERVE_SINCE_KEY, '2026-09-01T00:00:00.000Z');
    const stale = view('2026-10-02T15:35:00.000Z', TX1, 100_000, 12);
    const fresh = view('2026-10-07T15:35:00.000Z', TX2, 82_480, 12.5);
    // #when
    const sent = await reserveRun(body([stale, fresh]));
    // #then
    expect({ sent, stale: await store.getMeta(env.DB, `broadcast:reserve:${TX1}`) }).toEqual({ sent: [`broadcast:reserve:${TX2}`], stale: null });
  });

  it('alerts and claims nothing when the copy cannot be written, without fetching the card', async () => {
    // #given a deposit so large that its undroppable headline overflows X
    await store.setMeta(env.DB, RESERVE_SINCE_KEY, FIRST.ts);
    const channel = recorder('telegram-channel');
    const fetch = card();
    const h = harness({ now: '2026-10-08T17:00:00.000Z', fetch, env: { BROADCASTS: 'on' } });
    // #when
    await runBroadcasts(h.c, { kind: 'reserve', reserve: body([FIRST, view('2026-10-08T15:35:00.000Z', TX2, 1e300, 12.5)]) }, { channel: [channel.output], drafts: [] });
    // #then
    expect({
      alerts: h.alerts.map((a) => a.signature),
      claim: await store.getMeta(env.DB, `broadcast:reserve:${TX2}`),
      sent: channel.sent.length,
      fetches: fetch.calls.length,
    }).toEqual({ alerts: [`broadcast-copy:broadcast:reserve:${TX2}`], claim: null, sent: 0, fetches: 0 });
  });
});
