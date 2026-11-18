import { decodePegReading, pegLiveBody } from '@ccip-dev/core';
import type { PegEpisodeView } from '@ccip-dev/core/public';
import { fakeFetch, PEG_LIVE_WORDS } from '@ccip-dev/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Broadcast, BroadcastOutput } from '../src/broadcasts/outputs';
import { runBroadcasts } from '../src/broadcasts/run';
import { harness, resetStorage } from './helpers';

beforeEach(resetStorage);

const LIVE = { ...pegLiveBody(decodePegReading(PEG_LIVE_WORDS.map((w) => BigInt(w)))), spot: 0.9916, gap: -0.0084 };
const EPISODE: PegEpisodeView = {
  id: 7, side: 'discount', opened_at: '2026-11-18T00:00:00.000Z', closed_at: null, peak_gap: -0.0091, peak_at: '2026-11-18T00:30:00.000Z',
  best_size: 10_000, best_profit: 0.53, public: true, public_at: '2026-11-18T00:20:00.000Z',
};

function recorder(name: string) {
  const sent: Broadcast[] = [];
  const output: BroadcastOutput = { name, send: async (b) => (sent.push(b), 'sent') };
  return { output, sent };
}

const card = (status = 200) =>
  fakeFetch((url) => (url.startsWith('https://ccip.dev/og/broadcast/peg/') ? new Response(status === 200 ? new Uint8Array([137, 80, 78, 71]) : 'no', { status, headers: { 'content-type': status === 200 ? 'image/png' : 'text/plain' } }) : undefined));

async function pegRun(now: string, episodes: PegEpisodeView[], opts: { publicPosts?: boolean; cardStatus?: number } = {}) {
  const channel = recorder('telegram-channel');
  const x = recorder('x-post');
  const h = harness({ now, fetch: card(opts.cardStatus), env: { BROADCASTS: 'on', PEG_PUBLIC: opts.publicPosts === false ? 'off' : 'on' } });
  await runBroadcasts(h.c, { kind: 'peg', live: LIVE, episodes }, { channel: [channel.output], xPost: [x.output], drafts: [], preview: [] });
  return { channel: channel.sent, x: x.sent, alerts: h.alerts };
}

describe('public peg posts', () => {
  it('posts an open public episode to the channel only, never to X, ending with the disclaimer', async () => {
    const { channel, x } = await pegRun('2026-11-18T00:25:00.000Z', [EPISODE]);
    expect(channel.map((b) => b.key)).toEqual(['broadcast:peg:7:open']);
    expect(x).toEqual([]);
    expect(channel[0]!.telegramHtml).toContain('stLINK discount on Curve: 0.91% at its widest so far');
    expect(channel[0]!.telegramHtml).toContain('Now: 1 stLINK = 0.9916 LINK');
    expect(channel[0]!.telegramHtml.trimEnd().split('\n').at(-1)).toBe('Not financial advice.');
  });

  it('posts each phase once', async () => {
    await pegRun('2026-11-18T00:25:00.000Z', [EPISODE]);
    expect((await pegRun('2026-11-18T00:30:00.000Z', [EPISODE])).channel).toEqual([]);
  });

  it('posts nothing while PEG_PUBLIC is off', async () => {
    expect((await pegRun('2026-11-18T00:25:00.000Z', [EPISODE], { publicPosts: false })).channel).toEqual([]);
  });

  it('posts nothing for an episode that never went public', async () => {
    expect((await pegRun('2026-11-18T00:25:00.000Z', [{ ...EPISODE, public: false, public_at: null }])).channel).toEqual([]);
  });

  it('waits quietly for a card the edge does not serve yet, then alerts once it is late', async () => {
    const early = await pegRun('2026-11-18T00:25:00.000Z', [EPISODE], { cardStatus: 404 });
    expect([early.channel, early.alerts]).toEqual([[], []]);
    const late = await pegRun('2026-11-18T01:00:00.000Z', [EPISODE], { cardStatus: 404 });
    expect(late.alerts.map((a) => a.signature)).toEqual(['broadcast-image:broadcast:peg:7:open']);
  });

  it('recaps a closed public episode whose open post went out', async () => {
    await pegRun('2026-11-18T00:25:00.000Z', [EPISODE]);
    const closed = { ...EPISODE, closed_at: '2026-11-18T03:20:00.000Z' };
    const { channel } = await pegRun('2026-11-18T03:25:00.000Z', [closed]);
    expect(channel.map((b) => b.key)).toEqual(['broadcast:peg:7:close']);
    expect(channel[0]!.telegramHtml).toContain('The stLINK discount closed after 3h 20m');
  });

  it('does not recap a closed episode whose open post never went out', async () => {
    const closed = { ...EPISODE, closed_at: '2026-11-18T03:20:00.000Z' };
    expect((await pegRun('2026-11-18T03:25:00.000Z', [closed])).channel).toEqual([]);
  });

  it('does not open-post a running public episode that crossed the line over 6 hours ago', async () => {
    expect((await pegRun('2026-11-18T07:25:00.000Z', [EPISODE])).channel).toEqual([]);
  });

  it('recaps the first episode of a flip as well as opening the second', async () => {
    await pegRun('2026-11-18T00:25:00.000Z', [EPISODE]);
    const closed = { ...EPISODE, closed_at: '2026-11-18T03:20:00.000Z' };
    const premium = { ...EPISODE, id: 8, side: 'premium' as const, peak_gap: 0.009, opened_at: '2026-11-18T03:15:00.000Z', public_at: '2026-11-18T03:20:00.000Z' };
    const { channel } = await pegRun('2026-11-18T03:25:00.000Z', [premium, closed]);
    expect(channel.map((b) => b.key).sort()).toEqual(['broadcast:peg:7:close', 'broadcast:peg:8:open']);
  });

  it('does not recap an episode that closed over a day ago', async () => {
    expect((await pegRun('2026-11-20T00:00:00.000Z', [{ ...EPISODE, closed_at: '2026-11-18T03:20:00.000Z' }])).channel).toEqual([]);
  });
});
