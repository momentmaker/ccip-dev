import type { Dim } from '@ccip-dev/core';
import { fakeFetch, NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Broadcast, BroadcastOutput } from '../src/broadcasts/outputs';
import { RECORDS_SEED_KEY, RESERVE_SINCE_KEY, runBroadcasts } from '../src/broadcasts/run';
import type { ReserveBody } from '../src/publish';
import * as store from '../src/store';
import { harness, resetStorage, seedRegistry } from './helpers';

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
});
