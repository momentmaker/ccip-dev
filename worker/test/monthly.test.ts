import type { MonthSummary } from '@ccip-dev/core/month';
import { NETWORKS, fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { composeMonthlyCopy } from '../src/broadcasts/monthly-copy';
import type { Broadcast, BroadcastOutput, OutputSet } from '../src/broadcasts/outputs';
import { broadcastHourly, runBroadcasts } from '../src/broadcasts/run';
import type { Env } from '../src/env';
import type { ReserveBody } from '../src/publish';
import * as store from '../src/store';
import { harness, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const ETH = NETWORKS.ethereum.chainSelector;
const BASE = NETWORKS.base.chainSelector;
const KEY = 'broadcast:monthly:2026-09';
const VIDEO_KEY = 'videos/monthly/2026-09.mp4';
const SUMMARY_KEY = 'videos/monthly/2026-09.json';
const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]);
const ON = { BROADCASTS: 'on', MOMENTS: 'on' };
/** The summary the month page drew its end card from, for the rows seedSeptember writes: no record, no new chain. */
const SEPTEMBER: MonthSummary = {
  month: '2026-09',
  label: 'September 2026',
  messages: 6_000,
  usd: 240e6,
  fees: 120,
  linkSharePct: null,
  records: [],
  joined: [],
  busiestLane: { key: `${ETH}>${BASE}`, src: { selector: ETH, name: 'Ethereum' }, dst: { selector: BASE, name: 'Base' }, usd: 240e6 },
};
const SUMMARY = JSON.stringify({ month: '2026-09', summary: SEPTEMBER });

/** Aug 31 through September, every day 200 messages and $8M on Ethereum → Base, with $4 in fees: no chain joins in September. */
async function seedSeptember(): Promise<void> {
  await seedRegistry([NETWORKS.ethereum, NETWORKS.base], []);
  for (let d = 0; d <= 30; d++) {
    const day = d === 0 ? '2026-08-31' : `2026-09-${String(d).padStart(2, '0')}`;
    await store.replaceDaily(
      env.DB,
      { day, messages: 200, token_messages: 0, usd_value: 8e6, fee_usd: 4, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 },
      [{ day, dim: 'lane', key: `${ETH}>${BASE}`, messages: 200, usd_value: 8e6, fee_usd: 4 }],
      '2026-10-01T00:07:00.000Z',
    );
  }
}

/** What the workflow uploads: the summary first, then the video. */
async function seedVideo(summary: string | null = SUMMARY): Promise<void> {
  if (summary !== null) await env.ARCHIVE.put(SUMMARY_KEY, summary);
  await env.ARCHIVE.put(VIDEO_KEY, MP4);
}

function recorder(name: string, results: ('sent' | 'failed')[] = ['sent']) {
  const sent: Broadcast[] = [];
  const output: BroadcastOutput = {
    name,
    send: async (b) => {
      sent.push(b);
      return results[Math.min(sent.length - 1, results.length - 1)]!;
    },
  };
  return { output, sent };
}

function outputSet(o: { channel?: ('sent' | 'failed')[]; x?: ('sent' | 'failed')[] } = {}) {
  const channel = recorder('telegram-channel', o.channel);
  const xPost = recorder('x-post', o.x);
  const drafts = recorder('x-draft');
  const preview = recorder('telegram-preview');
  const set: OutputSet = { channel: [channel.output], xPost: [xPost.output], drafts: [drafts.output], preview: [preview.output] };
  return { set, channel: channel.sent, xPost: xPost.sent, drafts: drafts.sent, preview: preview.sent };
}

async function monthlyRun(now: string, o: { env?: Partial<Env>; outputs?: ReturnType<typeof outputSet> } = {}) {
  const outputs = o.outputs ?? outputSet();
  const h = harness({ now, env: { ...ON, ...o.env } });
  await runBroadcasts(h.c, { kind: 'monthly' }, outputs.set);
  return { ...outputs, alerts: h.alerts.map((a) => a.signature), texts: h.alerts.map((a) => a.text) };
}

const keys = (sent: Broadcast[]) => sent.map((b) => b.key);

describe('the monthly video', () => {
  it("posts last month's video once, on the channel and X, with its caption and no tag, once the archive bucket holds it", async () => {
    // #given
    await seedSeptember();
    await seedVideo();
    // #when two hourly runs on the 1st
    const first = await monthlyRun('2026-10-01T02:00:00.000Z');
    const again = await monthlyRun('2026-10-01T03:00:00.000Z');
    // #then
    const sent = first.channel[0]!;
    expect({
      channel: keys(first.channel),
      x: keys(first.xPost),
      drafts: keys(first.drafts),
      media: sent.media.kind === 'video' ? { name: sent.media.filename, type: sent.media.mp4.type, bytes: [...new Uint8Array(await sent.media.mp4.arrayBuffer())], size: [sent.media.width, sent.media.height, sent.media.durationS] } : null,
      x_text: first.xPost[0]?.xText,
      caption: sent.telegramHtml.split('\n')[0],
      claims: await store.getMetas(env.DB, [KEY, `${KEY}#telegram-channel`, `${KEY}#x-post`]).then((m) => [...m.values()].map((v) => v.slice(0, 5))),
      again: [...keys(again.channel), ...keys(again.xPost)],
    }).toEqual({
      channel: [KEY],
      x: [KEY],
      drafts: [],
      media: { name: 'ccip-2026-09.mp4', type: 'video/mp4', bytes: [...MP4], size: [1024, 1024, 30] },
      x_text: '🎬 CCIP in September 2026\n6,000 messages · $240.0M moved · $120 in fees\n#CCIP #Chainlink $LINK',
      caption: '<b>🎬 CCIP in September 2026</b>',
      claims: ['sent:', 'sent:', 'sent:'],
      again: [],
    });
  });

  it('plans nothing while the video is not in the bucket, and nothing after the 3rd', async () => {
    // #given
    await seedSeptember();
    // #when
    const missing = await monthlyRun('2026-10-01T02:00:00.000Z');
    await seedVideo();
    const late = await monthlyRun('2026-10-04T00:00:00.000Z');
    const third = await monthlyRun('2026-10-03T23:00:00.000Z');
    // #then
    expect({ missing: keys(missing.channel), late: keys(late.channel), third: keys(third.channel) }).toEqual({ missing: [], late: [], third: [KEY] });
  });

  it('alerts a missing video once, on the 1st from 06:00, and never on the 2nd', async () => {
    // #given no video
    await seedSeptember();
    // #when
    const runs = [];
    for (const now of ['2026-10-01T05:00:00.000Z', '2026-10-01T06:00:00.000Z', '2026-10-01T07:00:00.000Z', '2026-10-02T06:00:00.000Z']) runs.push((await monthlyRun(now)).alerts);
    // #then
    expect(runs).toEqual([[], ['monthly-video-missing:2026-09'], [], []]);
  });

  it('alerts once and posts nothing when the video is 50 MB or more', async () => {
    // #given an archive bucket whose video is 50,000,000 bytes
    await seedSeptember();
    const big = { head: async (key: string) => (key === VIDEO_KEY ? { size: 50_000_000 } : null) } as unknown as R2Bucket;
    // #when
    const runs = [await monthlyRun('2026-10-01T02:00:00.000Z', { env: { ARCHIVE: big } }), await monthlyRun('2026-10-01T03:00:00.000Z', { env: { ARCHIVE: big } })];
    // #then
    expect(runs.map((r) => ({ sent: r.channel.length + r.xPost.length, alerts: r.alerts }))).toEqual([
      { sent: 0, alerts: ['monthly-video-size:2026-09'] },
      { sent: 0, alerts: [] },
    ]);
  });

  it('follows the MOMENTS switch, with BROADCASTS: off posts nothing, and drafts sends it to the drafts chat only', async () => {
    // #given
    await seedSeptember();
    await seedVideo();
    // #when
    const off = await monthlyRun('2026-10-01T02:00:00.000Z', { env: { MOMENTS: 'off' } });
    const broadcastsOff = await monthlyRun('2026-10-01T02:00:00.000Z', { env: { BROADCASTS: 'off' } });
    const drafts = await monthlyRun('2026-10-01T02:00:00.000Z', { env: { MOMENTS: 'drafts' } });
    // #then
    expect({
      off: off.channel.length + off.xPost.length + off.drafts.length,
      broadcastsOff: broadcastsOff.channel.length + broadcastsOff.xPost.length + broadcastsOff.drafts.length,
      drafts: { channel: drafts.channel.length, x: drafts.xPost.length, draft: drafts.drafts[0]?.xText.startsWith('🎬'), preview: drafts.preview[0]?.telegramHtml.startsWith('<b>🎬') },
    }).toEqual({ off: 0, broadcastsOff: 0, drafts: { channel: 0, x: 0, draft: true, preview: true } });
  });

  it('retries only the output that failed, under the same claim and output keys', async () => {
    // #given the channel fails once
    await seedSeptember();
    await seedVideo();
    const outputs = outputSet({ channel: ['failed', 'sent'] });
    // #when
    const first = await monthlyRun('2026-10-01T02:00:00.000Z', { outputs });
    const between = await store.getMetas(env.DB, [KEY, `${KEY}#x-post`, `${KEY}#telegram-channel`]);
    await monthlyRun('2026-10-01T03:00:00.000Z', { outputs });
    // #then
    expect({
      alerts: first.alerts,
      between: Object.fromEntries([...between].map(([k, v]) => [k, v.slice(0, 5)])),
      channel: outputs.channel.length,
      x: outputs.xPost.length,
      done: (await store.getMeta(env.DB, KEY))?.startsWith('sent:'),
    }).toEqual({ alerts: [`broadcast-telegram-channel:${KEY}`], between: { [`${KEY}#x-post`]: 'sent:' }, channel: 2, x: 1, done: true });
  });

  it('alerts and releases its claim when the video is gone by the time it is read', async () => {
    // #given head finds the video, get does not
    await seedSeptember();
    const vanishing = { head: async () => ({ size: MP4.length }), get: async (key: string) => (key === SUMMARY_KEY ? { text: async () => SUMMARY } : null) } as unknown as R2Bucket;
    // #when
    const run = await monthlyRun('2026-10-01T02:00:00.000Z', { env: { ARCHIVE: vanishing } });
    // #then
    expect({ alerts: run.alerts, sent: run.channel.length, claim: await store.getMeta(env.DB, KEY) }).toEqual({ alerts: [`broadcast-video:${KEY}`], sent: 0, claim: null });
  });
});

describe("the monthly video's summary", () => {
  it('treats a missing summary as a missing video: nothing posted or claimed, and one alert on the 1st from 06:00 naming the file', async () => {
    // #given the video without its summary
    await seedSeptember();
    await seedVideo(null);
    // #when
    const runs = [];
    for (const now of ['2026-10-01T05:00:00.000Z', '2026-10-01T06:00:00.000Z', '2026-10-01T07:00:00.000Z']) runs.push(await monthlyRun(now));
    // #then
    expect({
      sent: runs.map((r) => r.channel.length + r.xPost.length),
      alerts: runs.map((r) => r.alerts),
      text: runs[1]!.texts[0],
      claim: await store.getMeta(env.DB, KEY),
    }).toEqual({
      sent: [0, 0, 0],
      alerts: [[], ['monthly-video-missing:2026-09'], []],
      text: `The September 2026 video is not posted: its summary ${SUMMARY_KEY} is not in the archive bucket. Check the monthly-video workflow's run.`,
      claim: null,
    });
  });

  it('treats a summary for another month the same, and says what is wrong with it', async () => {
    // #given
    await seedSeptember();
    await seedVideo(JSON.stringify({ month: '2026-08', summary: { ...SEPTEMBER, month: '2026-08' } }));
    // #when
    const run = await monthlyRun('2026-10-01T06:00:00.000Z');
    // #then
    expect({ sent: run.channel.length + run.xPost.length, texts: run.texts, claim: await store.getMeta(env.DB, KEY) }).toEqual({
      sent: 0,
      texts: [`The September 2026 video is not posted: its summary ${SUMMARY_KEY} is for 2026-08, not 2026-09. Check the monthly-video workflow's run.`],
      claim: null,
    });
  });

  it('writes a retried output from the summary recorded with the video, though the late finalize has since changed the rows', async () => {
    // #given at 02:00 the channel sends and X fails; at 06:00 the late finalize adds 40 messages and $1M to Sep 30
    await seedSeptember();
    await seedVideo();
    const outputs = outputSet({ x: ['failed', 'sent'] });
    await monthlyRun('2026-10-01T02:00:00.000Z', { outputs });
    const day = '2026-09-30';
    await store.replaceDaily(
      env.DB,
      { day, messages: 240, token_messages: 0, usd_value: 9e6, fee_usd: 5, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 },
      [{ day, dim: 'lane', key: `${ETH}>${BASE}`, messages: 240, usd_value: 9e6, fee_usd: 5 }],
      '2026-10-01T06:00:00.000Z',
    );
    // #when the 07:00 run retries X
    await monthlyRun('2026-10-01T07:00:00.000Z', { outputs });
    // #then both outputs carry the recorded summary's numbers, as the video's end card does
    const recorded = composeMonthlyCopy({ kind: 'monthly', month: '2026-09', summary: SEPTEMBER });
    expect({ channel: outputs.channel.map((b) => b.telegramHtml), x: outputs.xPost.map((b) => b.xText) }).toEqual({
      channel: [recorded.telegramHtml],
      x: [recorded.xText, recorded.xText],
    });
  });
});

describe('the monthly video through the real outputs', () => {
  const ENV = { ...ON, TELEGRAM_BOT_TOKEN: 'bot', TELEGRAM_CHANNEL_ID: '@ccipdev', X_API_KEY: 'k', X_API_SECRET: 's', X_ACCESS_TOKEN: 't', X_ACCESS_SECRET: 'a' };
  const RESERVE = { transfers: [], weekly: [], cost_basis: null } as unknown as ReserveBody;
  const routes = () =>
    fakeFetch(
      (url) => (url.endsWith('/sendVideo') ? jsonResponse({ ok: true, result: { message_id: 1 } }) : undefined),
      (url) => (url.endsWith('/media/upload/initialize') ? jsonResponse({ data: { id: '77' } }) : undefined),
      (url) => (url.endsWith('/77/append') ? jsonResponse({ data: { expires_at: 1 } }) : undefined),
      (url) => (url.endsWith('/77/finalize') ? jsonResponse({ data: { id: '77', processing_info: { state: 'succeeded' } } }) : undefined),
      (url) => (url.endsWith('/2/tweets') ? jsonResponse({ data: { id: 'post-1' } }, 201) : undefined),
    );

  it('posts it in the 06:00 hourly run, the late finalize hour, with sendVideo and the chunked X upload', async () => {
    // #given
    await seedSeptember();
    await seedVideo();
    const fetch = routes();
    const h = harness({ now: '2026-10-01T06:00:00.000Z', fetch, env: ENV });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // #when
    await broadcastHourly(h.c, RESERVE);
    vi.restoreAllMocks();
    // #then
    const upload = fetch.calls.find((c) => c.url.endsWith('/sendVideo'))?.init;
    const video = await new Response(upload?.body, { headers: upload?.headers }).formData();
    const posted = JSON.parse(String(fetch.calls.find((c) => c.url.endsWith('/2/tweets'))?.init?.body));
    expect({
      steps: fetch.calls.map((c) => c.url.replace(/^https:\/\/[^/]+/, '').replace(/bot[^/]+/, 'bot')),
      chat: video.get('chat_id'),
      duration: video.get('duration'),
      posted,
      alerts: h.alerts,
    }).toEqual({
      steps: ['/bot/sendVideo', '/2/media/upload/initialize', '/2/media/upload/77/append', '/2/media/upload/77/finalize', '/2/tweets'],
      chat: '@ccipdev',
      duration: '30',
      posted: { text: '🎬 CCIP in September 2026\n6,000 messages · $240.0M moved · $120 in fees\n#CCIP #Chainlink $LINK', media: { media_ids: ['77'] } },
      alerts: [],
    });
  });

  it("alerts a monthly run that throws under broadcast-run:monthly, and another request's under broadcast-run", async () => {
    // #given the archive bucket is down, and the Reserve body is broken
    const down = { head: async () => { throw new Error('R2 is down'); } } as unknown as R2Bucket;
    const broken = { transfers: null, weekly: [], cost_basis: {} } as unknown as ReserveBody;
    const h = harness({ now: '2026-10-01T02:00:00.000Z', env: { ...ENV, ARCHIVE: down } });
    // #when
    await broadcastHourly(h.c, broken);
    // #then
    expect(h.alerts.map((a) => a.signature)).toEqual(['broadcast-run', 'broadcast-run:monthly']);
  });

  it('stops calling X for the run once the upload hits an outage, and the next run retries X alone', async () => {
    // #given X answers 503 to the upload
    await seedSeptember();
    await seedVideo();
    const down = fakeFetch(
      (url) => (url.endsWith('/sendVideo') ? jsonResponse({ ok: true, result: { message_id: 1 } }) : undefined),
      (url) => (url.includes('api.x.com') ? jsonResponse({ title: 'Service Unavailable' }, 503) : undefined),
    );
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // #when
    const h = harness({ now: '2026-10-01T02:00:00.000Z', fetch: down, env: ENV });
    await runBroadcasts(h.c, { kind: 'monthly' });
    const retried = routes();
    await runBroadcasts(harness({ now: '2026-10-01T03:00:00.000Z', fetch: retried, env: ENV }).c, { kind: 'monthly' });
    err.mockRestore();
    // #then
    expect({
      xCalls: down.calls.filter((c) => c.url.includes('api.x.com')).length,
      alerts: h.alerts.map((a) => a.signature),
      retried: retried.calls.map((c) => c.url.replace(/^https:\/\/[^/]+/, '')),
    }).toEqual({
      xCalls: 1,
      alerts: [`broadcast-x-post:${KEY}`],
      retried: ['/2/media/upload/initialize', '/2/media/upload/77/append', '/2/media/upload/77/finalize', '/2/tweets'],
    });
  });
});
