import type { Dim } from '@ccip-dev/core';
import { fakeFetch, jsonResponse, NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Broadcast, BroadcastOutput } from '../src/broadcasts/outputs';
import { broadcastMode, broadcastOutputs, selectOutputs, telegramOutputs } from '../src/broadcasts/outputs';
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

const PNG = [137, 80, 78, 71];
const card = (status = 200) =>
  fakeFetch((url) => (url.startsWith('https://ccip.dev/og/') ? new Response(new Uint8Array(PNG), { status, headers: { 'content-type': 'image/png' } }) : undefined));

async function finalizeRun(o: { now?: string; days: string[]; mode?: string; channel?: 'sent' | 'failed'; drafts?: 'sent' | 'failed'; fetch?: typeof fetch }) {
  const channel = recorder('telegram-channel', o.channel);
  const drafts = recorder('x-draft', o.drafts);
  const preview = recorder('telegram-preview');
  const h = harness({ now: o.now ?? NOW, fetch: o.fetch ?? card(), env: { BROADCASTS: o.mode ?? 'on', MOMENTS: 'off' } });
  await runBroadcasts(h.c, { kind: 'finalize', days: o.days }, { channel: [channel.output], drafts: [drafts.output], preview: [preview.output] });
  return { channel: channel.sent, drafts: drafts.sent, preview: preview.sent, alerts: h.alerts };
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
      image: [...(channel[0]?.image ?? [])],
      x: drafts[0]?.xText.startsWith('#CCIP · Sat, Oct 10'),
      html: channel[0]?.telegramHtml.startsWith('<b>CCIP daily report · Sat, Oct 10, 2026</b>'),
      claim: (await store.getMeta(env.DB, DAILY_KEY))?.startsWith('sent:'),
    }).toEqual({ channel: [DAILY_KEY], drafts: [DAILY_KEY], image: PNG, x: true, html: true, claim: true });
  });

  it('reaches only the owner in drafts mode: the X draft and the channel preview, not the channel', async () => {
    await seedDays(DAY);
    const { channel, drafts, preview } = await finalizeRun({ days: [DAY], mode: 'drafts' });
    expect({ channel: keys(channel), drafts: keys(drafts), preview: keys(preview) }).toEqual({ channel: [], drafts: [DAILY_KEY], preview: [DAILY_KEY] });
  });

  it('sends no preview in on mode', async () => {
    await seedDays(DAY);
    const { channel, drafts, preview } = await finalizeRun({ days: [DAY], mode: 'on' });
    expect({ channel: keys(channel), drafts: keys(drafts), preview: keys(preview) }).toEqual({ channel: [DAILY_KEY], drafts: [DAILY_KEY], preview: [] });
  });

  it('marks the broadcast sent when an output mark fails once, and alerts but still closes the broadcast when it fails twice', async () => {
    // #given the send succeeds, but writing `sent:` fails
    await seedDays(DAY);
    const failingMarks = (fails: number) => {
      let failed = 0;
      return new Proxy(env.DB, {
        get(target, prop) {
          if (prop !== 'prepare') {
            const v: unknown = Reflect.get(target, prop, target);
            return typeof v === 'function' ? v.bind(target) : v;
          }
          return (sql: string) => {
            const stmt = target.prepare(sql);
            return new Proxy(stmt, {
              get(s, p) {
                if (p !== 'bind') {
                  const v: unknown = Reflect.get(s, p, s);
                  return typeof v === 'function' ? v.bind(s) : v;
                }
                return (...args: unknown[]) => {
                  if (String(args[1]).startsWith('sent:') && failed < fails) {
                    failed++;
                    throw new Error('D1_ERROR: busy');
                  }
                  return s.bind(...args);
                };
              },
            });
          };
        },
      });
    };
    const run = async (fails: number) => {
      await resetStorage();
      await seedDays(DAY);
      const h = harness({ now: NOW, fetch: card(), db: failingMarks(fails), env: { BROADCASTS: 'on' } });
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      await runBroadcasts(h.c, { kind: 'finalize', days: [DAY] }, { channel: [recorder('telegram-channel').output], drafts: [], preview: [] });
      log.mockRestore();
      return { alerts: h.alerts.map((a) => a.signature), claim: (await store.getMeta(env.DB, DAILY_KEY))?.split(':')[0] };
    };
    // #when
    const once = await run(1);
    const twice = await run(2);
    // #then
    expect({ once, twice }).toEqual({
      once: { alerts: [], claim: 'sent' },
      twice: { alerts: [`broadcast-mark:${DAILY_KEY}#telegram-channel`], claim: 'sent' },
    });
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

  it('marks the broadcast and every output sent when all outputs succeed', async () => {
    // #given
    await seedDays(DAY);
    // #when
    await finalizeRun({ days: [DAY] });
    // #then
    const sentKeys = await Promise.all([DAILY_KEY, `${DAILY_KEY}#telegram-channel`, `${DAILY_KEY}#x-draft`].map(async (k) => (await store.getMeta(env.DB, k))?.startsWith('sent:')));
    expect(sentKeys).toEqual([true, true, true]);
  });

  it('releases the broadcast but keeps the draft sent when the channel fails, alerting for the channel', async () => {
    // #given
    await seedDays(DAY);
    // #when
    const { alerts } = await finalizeRun({ days: [DAY], channel: 'failed' });
    // #then
    expect({
      alerts: alerts.map((a) => a.signature),
      broadcast: await store.getMeta(env.DB, DAILY_KEY),
      draft: (await store.getMeta(env.DB, `${DAILY_KEY}#x-draft`))?.startsWith('sent:'),
      channel: await store.getMeta(env.DB, `${DAILY_KEY}#telegram-channel`),
    }).toEqual({ alerts: [`broadcast-telegram-channel:${DAILY_KEY}`], broadcast: null, draft: true, channel: null });
  });

  it('sends only the missing channel on the next run, then marks the broadcast sent', async () => {
    // #given the channel failed the first time and the draft went out
    await seedDays(DAY);
    await finalizeRun({ days: [DAY], channel: 'failed' });
    // #when
    const retry = await finalizeRun({ days: [DAY] });
    // #then
    const marked = await Promise.all([DAILY_KEY, `${DAILY_KEY}#telegram-channel`, `${DAILY_KEY}#x-draft`].map(async (k) => (await store.getMeta(env.DB, k))?.startsWith('sent:')));
    expect({ channel: keys(retry.channel), drafts: keys(retry.drafts), alerts: retry.alerts, marked }).toEqual({ channel: [DAILY_KEY], drafts: [], alerts: [], marked: [true, true, true] });
  });

  it('keeps the channel sent and retries only the X draft when the draft fails', async () => {
    // #given the channel sent and the draft failed
    await seedDays(DAY);
    const first = await finalizeRun({ days: [DAY], drafts: 'failed' });
    const afterFirst = { broadcast: await store.getMeta(env.DB, DAILY_KEY), channel: (await store.getMeta(env.DB, `${DAILY_KEY}#telegram-channel`))?.startsWith('sent:') };
    // #when
    const retry = await finalizeRun({ days: [DAY] });
    // #then
    expect({ alerts: first.alerts.map((a) => a.signature), afterFirst, channel: keys(retry.channel), drafts: keys(retry.drafts), done: (await store.getMeta(env.DB, DAILY_KEY))?.startsWith('sent:') }).toEqual({
      alerts: [`broadcast-x-draft:${DAILY_KEY}`],
      afterFirst: { broadcast: null, channel: true },
      channel: [],
      drafts: [DAILY_KEY],
      done: true,
    });
  });

  it('posts only to the channel after drafts mode sent the X draft and the preview failed', async () => {
    // #given
    await seedDays(DAY);
    await finalizeRun({ days: [DAY], mode: 'drafts' });
    await store.setMeta(env.DB, DAILY_KEY, null);
    await store.setMeta(env.DB, `${DAILY_KEY}#telegram-preview`, null);
    // #when
    const { channel, drafts } = await finalizeRun({ days: [DAY], mode: 'on' });
    // #then
    expect({ channel: keys(channel), drafts: keys(drafts) }).toEqual({ channel: [DAILY_KEY], drafts: [] });
  });

  it('treats a 200 PNG with an empty body as a card problem and uploads nothing', async () => {
    // #given
    await seedDays(DAY);
    const empty = fakeFetch((url) => (url.startsWith('https://ccip.dev/og/') ? new Response(new Uint8Array(0), { headers: { 'content-type': 'image/png' } }) : undefined));
    // #when
    const { channel, drafts, alerts } = await finalizeRun({ days: [DAY], fetch: empty });
    // #then
    expect({ sent: channel.length + drafts.length, alerts: alerts.map((a) => a.signature), claim: await store.getMeta(env.DB, DAILY_KEY) }).toEqual({ sent: 0, alerts: [`broadcast-image:${DAILY_KEY}`], claim: null });
  });

  it('sends nothing and fetches no card when every output was already sent, marking the broadcast sent', async () => {
    // #given
    await seedDays(DAY);
    await store.setMeta(env.DB, `${DAILY_KEY}#telegram-channel`, `sent:${NOW}`);
    await store.setMeta(env.DB, `${DAILY_KEY}#x-draft`, `sent:${NOW}`);
    const fetch = card();
    // #when
    const { channel, drafts } = await finalizeRun({ days: [DAY], fetch });
    // #then
    expect({ sent: channel.length + drafts.length, fetches: fetch.calls.length, broadcast: (await store.getMeta(env.DB, DAILY_KEY))?.startsWith('sent:') }).toEqual({ sent: 0, fetches: 0, broadcast: true });
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
    await runBroadcasts(throwing, { kind: 'finalize', days: [DAY] }, { channel: [recorder('telegram-channel').output], drafts: [], preview: [] }).catch(() => {});
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
    await runBroadcasts(h.c, { kind: 'finalize', days: [DAY] }, { channel: [boom], drafts: [], preview: [] });
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
      if (url.endsWith('/sendPhoto')) sent.push(String((init?.body as FormData).get('chat_id')));
      return new Response('{"ok":true}');
    });
    const c = harness({ now: NOW, fetch: f, env: { ...ENV, ...extra } }).c;
    await telegramOutputs(c).drafts[0]?.send({ key: 'k', kind: 'daily', image: new Uint8Array(PNG), facts: {} as never, xText: 't', telegramHtml: 't' });
    return sent;
  };

  it('sends drafts to TELEGRAM_DRAFTS_CHAT_ID when set', async () => {
    expect(await draftChat({ TELEGRAM_DRAFTS_CHAT_ID: '99' })).toEqual(['99']);
  });

  it('falls back to the alert chat when TELEGRAM_DRAFTS_CHAT_ID is empty', async () => {
    expect(await draftChat({ TELEGRAM_DRAFTS_CHAT_ID: '' })).toEqual(['42']);
    expect(draftsOf({ TELEGRAM_DRAFTS_CHAT_ID: '' })).toBe(1);
  });

  it('sends the channel preview to the drafts chat with the Telegram caption as HTML', async () => {
    // #given
    const bodies: { chat_id: unknown; photo: number[]; caption: unknown; parse_mode: unknown }[] = [];
    const f = fakeFetch(async (url, init) => {
      if (url.endsWith('/sendPhoto')) {
        const form = init?.body as FormData;
        bodies.push({ chat_id: form.get('chat_id'), photo: [...new Uint8Array(await (form.get('photo') as Blob).arrayBuffer())], caption: form.get('caption'), parse_mode: form.get('parse_mode') });
      }
      return new Response('{"ok":true}');
    });
    const c = harness({ now: NOW, fetch: f, env: { ...ENV, TELEGRAM_DRAFTS_CHAT_ID: '99' } }).c;
    // #when
    const preview = telegramOutputs(c).preview;
    await preview[0]?.send({ key: 'k', kind: 'daily', image: new Uint8Array(PNG), facts: {} as never, xText: 'x', telegramHtml: '<b>t</b>' });
    // #then
    expect({ names: preview.map((o) => o.name), bodies }).toEqual({ names: ['telegram-preview'], bodies: [{ chat_id: '99', photo: PNG, caption: '<b>t</b>', parse_mode: 'HTML' }] });
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
    await runBroadcasts(h.c, { kind: 'reserve', reserve }, { channel: [channel.output], drafts: [], preview: [] });
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
    await runBroadcasts(h.c, { kind: 'reserve', reserve: body([FIRST, view('2026-10-08T15:35:00.000Z', TX2, 1e300, 12.5)]) }, { channel: [channel.output], drafts: [], preview: [] });
    // #then
    expect({
      alerts: h.alerts.map((a) => a.signature),
      claim: await store.getMeta(env.DB, `broadcast:reserve:${TX2}`),
      sent: channel.sent.length,
      fetches: fetch.calls.length,
    }).toEqual({ alerts: [`broadcast-copy:broadcast:reserve:${TX2}`], claim: null, sent: 0, fetches: 0 });
  });
});

describe('X posting output', () => {
  const X_KEYS = { X_API_KEY: 'k-key', X_API_SECRET: 'k-secret', X_ACCESS_TOKEN: 't-token', X_ACCESS_SECRET: 't-secret' };
  const ENV = { TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_CHANNEL_ID: '@ccipdev', TELEGRAM_ALERT_CHAT_ID: '42' };
  const BROADCAST: Broadcast = { key: 'broadcast:daily:2026-10-10', kind: 'daily', image: new Uint8Array(PNG), facts: {} as never, xText: '#CCIP daily', telegramHtml: '<b>t</b>' };
  const xPostOf = (extra: Record<string, string>, f?: typeof fetch) => broadcastOutputs(harness({ now: NOW, fetch: f, env: { ...ENV, ...extra } }).c).xPost ?? [];

  it('is present only when all four keys are set and X_POSTS is not off', () => {
    // #when
    const names = (extra: Record<string, string>) => xPostOf(extra).map((o) => o.name);
    const { X_ACCESS_SECRET: _omitted, ...threeKeys } = X_KEYS;
    // #then
    expect({
      all: names(X_KEYS),
      switchedOn: names({ ...X_KEYS, X_POSTS: 'on' }),
      off: names({ ...X_KEYS, X_POSTS: 'off' }),
      missingOne: names(threeKeys),
      none: names({}),
    }).toEqual({ all: ['x-post'], switchedOn: ['x-post'], off: [], missingOne: [], none: [] });
  });

  it('uploads the card, then posts the X text with that media id, and logs the public post id', async () => {
    // #given
    const f = fakeFetch(
      (url) => (url.endsWith('/2/media/upload') ? jsonResponse({ data: { id: 'media-1' } }) : undefined),
      (url) => (url.endsWith('/2/tweets') ? jsonResponse({ data: { id: 'post-9' } }, 201) : undefined),
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    // #when
    const result = await xPostOf(X_KEYS, f)[0]?.send(BROADCAST);
    const logged = log.mock.calls.map((a) => a.join(' '));
    log.mockRestore();
    // #then
    expect({
      result,
      urls: f.calls.map((c) => c.url),
      posted: JSON.parse(String(f.calls[1]?.init?.body)),
      bytes: [...new Uint8Array(await ((f.calls[0]?.init?.body as FormData).get('media') as Blob).arrayBuffer())],
      logged: logged.some((l) => l.includes('post-9') && l.includes(BROADCAST.key)),
    }).toEqual({
      result: 'sent',
      urls: ['https://api.x.com/2/media/upload', 'https://api.x.com/2/tweets'],
      posted: { text: '#CCIP daily', media: { media_ids: ['media-1'] } },
      bytes: PNG,
      logged: true,
    });
  });

  it('fails without posting when the upload fails, logging the problem and no key', async () => {
    // #given
    const f = fakeFetch(() => jsonResponse({ detail: 'Unauthorized' }, 401));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // #when
    const result = await xPostOf(X_KEYS, f)[0]?.send(BROADCAST);
    const logged = log.mock.calls.map((a) => a.join(' ')).join('\n');
    log.mockRestore();
    // #then
    expect({ result, calls: f.calls.length, logged: logged.includes('401') && logged.includes('Unauthorized'), leaked: Object.values(X_KEYS).some((v) => logged.includes(v)) }).toEqual({
      result: 'failed', calls: 1, logged: true, leaked: false,
    });
  });

  const uploadThen = (post: () => Response | Promise<Response>) =>
    fakeFetch(
      (url) => (url.endsWith('/2/media/upload') ? jsonResponse({ data: { id: 'media-1' } }) : undefined),
      (url) => (url.endsWith('/2/tweets') ? post() : undefined),
    );

  it('fails when the post is refused for another reason after a good upload', async () => {
    // #given
    const f = uploadThen(() => jsonResponse({ detail: 'Forbidden' }, 403));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // #when
    const result = await xPostOf(X_KEYS, f)[0]?.send(BROADCAST);
    log.mockRestore();
    // #then
    expect(result).toBe('failed');
  });

  it('counts a duplicate-content refusal as sent, since the broadcast is already on X', async () => {
    // #given
    const f = uploadThen(() => jsonResponse({ detail: 'You are not allowed to create a Tweet with duplicate content.' }, 403));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    // #when
    const result = await xPostOf(X_KEYS, f)[0]?.send(BROADCAST);
    const logged = log.mock.calls.map((a) => a.join(' ')).join('\n');
    log.mockRestore();
    // #then
    expect({ result, logged: logged.includes(`X already has ${BROADCAST.key} (duplicate content); counting it as sent`), leaked: Object.values(X_KEYS).some((v) => logged.includes(v)) }).toEqual({
      result: 'sent', logged: true, leaked: false,
    });
  });

  it('counts a 2xx post whose id cannot be read as sent', async () => {
    // #given
    const f = uploadThen(() => new Response('not json', { status: 201 }));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    // #when
    const result = await xPostOf(X_KEYS, f)[0]?.send(BROADCAST);
    err.mockRestore();
    log.mockRestore();
    // #then
    expect(result).toBe('sent');
  });

  it('refuses a broadcast with no X text, as a poll has none, without calling X', async () => {
    // #given
    const f = fakeFetch();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // #when
    const result = await xPostOf(X_KEYS, f)[0]?.send({ ...BROADCAST, xText: '  \n' });
    const logged = log.mock.calls.length;
    log.mockRestore();
    // #then
    expect({ result, calls: f.calls.length, logged }).toEqual({ result: 'failed', calls: 0, logged: 1 });
  });

  it.each([
    ['times out', () => { throw new DOMException('timed out', 'TimeoutError'); }],
    ['answers 503', () => jsonResponse({}, 503)],
  ])('stops calling X for the rest of the run once it %s', async (_name, post) => {
    // #given two broadcasts sent through one output set
    const f = uploadThen(post as () => Response);
    const [output] = xPostOf(X_KEYS, f);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // #when
    const first = await output?.send(BROADCAST);
    const callsAfterFirst = f.calls.length;
    const second = await output?.send({ ...BROADCAST, key: 'broadcast:weekly:2026-10-05' });
    log.mockRestore();
    // #then
    expect({ first, second, secondCalls: f.calls.length - callsAfterFirst }).toEqual({ first: 'failed', second: 'failed', secondCalls: 0 });
  });

  it('keeps calling X after a refusal that is not an outage', async () => {
    // #given
    const f = uploadThen(() => jsonResponse({ detail: 'Forbidden' }, 403));
    const [output] = xPostOf(X_KEYS, f);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // #when
    await output?.send(BROADCAST);
    await output?.send({ ...BROADCAST, key: 'broadcast:weekly:2026-10-05' });
    log.mockRestore();
    // #then
    expect(f.calls.length).toBe(4);
  });

  it('starts a new run with a closed circuit', async () => {
    // #given the circuit tripped in one run
    const f = uploadThen(() => jsonResponse({}, 503));
    const harnessC = harness({ now: NOW, fetch: f, env: { ...ENV, ...X_KEYS } }).c;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await broadcastOutputs(harnessC).xPost?.[0]?.send(BROADCAST);
    const before = f.calls.length;
    // #when the next run builds its outputs
    await broadcastOutputs(harnessC).xPost?.[0]?.send(BROADCAST);
    log.mockRestore();
    // #then
    expect(f.calls.length - before).toBe(2);
  });

  it('replaces the X draft with the post in on mode, and leaves drafts mode alone', () => {
    // #given
    const out = (name: string): BroadcastOutput => ({ name, send: async () => 'sent' });
    const set = { channel: [out('telegram-channel')], drafts: [out('x-draft')], preview: [out('telegram-preview')], xPost: [out('x-post')] };
    // #then
    expect({
      on: selectOutputs(set, 'on').map((o) => o.name),
      onWithoutX: selectOutputs({ ...set, xPost: [] }, 'on').map((o) => o.name),
      xPostMissing: selectOutputs({ channel: set.channel, drafts: set.drafts, preview: set.preview }, 'on').map((o) => o.name),
      drafts: selectOutputs(set, 'drafts').map((o) => o.name),
    }).toEqual({ on: ['telegram-channel', 'x-post'], onWithoutX: ['telegram-channel', 'x-draft'], xPostMissing: ['telegram-channel', 'x-draft'], drafts: ['x-draft', 'telegram-preview'] });
  });

  it('keeps telegramOutputs free of X posting', () => {
    expect(telegramOutputs(harness({ now: NOW, env: { ...ENV, ...X_KEYS } }).c).xPost ?? []).toEqual([]);
  });
});

describe('X posting through a broadcast run', () => {
  const ENV = {
    BROADCASTS: 'on', TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_CHANNEL_ID: '@ccipdev', TELEGRAM_ALERT_CHAT_ID: '42',
    X_API_KEY: 'k-key', X_API_SECRET: 'k-secret', X_ACCESS_TOKEN: 't-token', X_ACCESS_SECRET: 't-secret',
  };
  const X_POST_KEY = `${DAILY_KEY}#x-post`;

  /** The card, the Telegram API and X; `telegram` decides what sendPhoto answers per chat. */
  function world(telegram: (chat: string) => boolean = () => true) {
    const chats: string[] = [];
    const f = fakeFetch(
      (url) => (url.startsWith('https://ccip.dev/og/') ? new Response(new Uint8Array(PNG), { headers: { 'content-type': 'image/png' } }) : undefined),
      (url, init) => {
        if (!url.endsWith('/sendPhoto')) return undefined;
        const chat = String((init?.body as FormData).get('chat_id'));
        chats.push(chat);
        return telegram(chat) ? new Response('{"ok":true}') : new Response('{"ok":false}', { status: 500 });
      },
      (url) => (url.endsWith('/2/media/upload') ? jsonResponse({ data: { id: 'media-1' } }) : undefined),
      (url) => (url.endsWith('/2/tweets') ? jsonResponse({ data: { id: 'post-9' } }, 201) : undefined),
    );
    const xCalls = () => f.calls.map((c) => c.url).filter((u) => u.startsWith('https://api.x.com/'));
    return { f, chats, xCalls };
  }
  const run = async (f: typeof fetch) => {
    const h = harness({ now: NOW, fetch: f, env: ENV });
    await runBroadcasts(h.c, { kind: 'finalize', days: [DAY] });
    return h;
  };

  it('uploads and posts to X in on mode, and sends the owner no X draft', async () => {
    // #given
    await seedDays(DAY);
    const w = world();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    // #when
    await run(w.f);
    log.mockRestore();
    // #then
    expect({ x: w.xCalls(), chats: w.chats, marks: [await store.getMeta(env.DB, X_POST_KEY), await store.getMeta(env.DB, DAILY_KEY)].map((m) => m?.split(':')[0]) }).toEqual({
      x: ['https://api.x.com/2/media/upload', 'https://api.x.com/2/tweets'],
      chats: ['@ccipdev'],
      marks: ['sent', 'sent'],
    });
  });

  it('makes no X call for a broadcast that is already sent', async () => {
    // #given
    await seedDays(DAY);
    await store.setMeta(env.DB, DAILY_KEY, 'sent:2026-10-11T00:07:00.000Z');
    const w = world();
    // #when
    await run(w.f);
    // #then
    expect({ x: w.xCalls(), all: w.f.calls.length }).toEqual({ x: [], all: 0 });
  });

  it('does not post to X again on the next run when only the channel failed the first time', async () => {
    // #given the first run: X posts, the channel fails
    await seedDays(DAY);
    const first = world((chat) => chat !== '@ccipdev');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(first.f);
    // #when the next run finds the channel up
    const second = world();
    await run(second.f);
    log.mockRestore();
    err.mockRestore();
    // #then
    expect({ firstX: first.xCalls().length, secondX: second.xCalls().length, secondChats: second.chats, closed: (await store.getMeta(env.DB, DAILY_KEY))?.split(':')[0] }).toEqual({
      firstX: 2, secondX: 0, secondChats: ['@ccipdev'], closed: 'sent',
    });
  });
});
