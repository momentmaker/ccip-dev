import type { Dim } from '@ccip-dev/core';
import { fakeFetch, jsonResponse, NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PollFacts } from '../src/broadcasts/moment-facts';
import { telegramOutputs, type Broadcast, type BroadcastOutput } from '../src/broadcasts/outputs';
import { closeLastWeekPoll } from '../src/broadcasts/poll';
import { MOMENTS_SEED_KEY, runBroadcasts } from '../src/broadcasts/run';
import * as store from '../src/store';
import { harness, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const ETH = NETWORKS.ethereum.chainSelector;
const BASE = NETWORKS.base.chainSelector;
const MONDAY = '2026-10-12';
const NOW = '2026-10-12T00:07:00.000Z';
const POLL_KEY = 'broadcast:poll:2026-10-12';
const PNG = [137, 80, 78, 71];
const OPTIONS = [{ key: BASE, label: 'Base' }, { key: ETH, label: 'Ethereum' }, { key: 'other', label: 'Another chain' }];
const QUESTION = 'Which chain will pay the most CCIP fees this week?';

const card = (failing: string | null = null) =>
  fakeFetch((url) => {
    if (!url.startsWith('https://ccip.dev/og/')) return undefined;
    return failing !== null && url.includes(failing) ? new Response('down', { status: 500 }) : new Response(new Uint8Array(PNG), { headers: { 'content-type': 'image/png' } });
  });

/** Last week Base paid $5 in fees and Ethereum $3, on an old lane, so this week's poll asks about fee chains. */
async function seedLastWeek(): Promise<void> {
  await seedRegistry([NETWORKS.ethereum, NETWORKS.base], []);
  const totals = (day: string) => ({ day, messages: 10, token_messages: 0, usd_value: 10, fee_usd: 8, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 });
  const row = (day: string, dim: Dim, key: string, fee: number | null) => ({ day, dim, key, messages: 5, usd_value: 5, fee_usd: fee });
  await store.replaceDaily(env.DB, totals('2026-08-03'), [row('2026-08-03', 'lane', `${ETH}>${BASE}`, null)], NOW);
  await store.replaceDaily(env.DB, totals('2026-10-11'), [row('2026-10-11', 'lane', `${ETH}>${BASE}`, 8), row('2026-10-11', 'src_chain', BASE, 5), row('2026-10-11', 'src_chain', ETH, 3)], NOW);
}

function recorder(name: string, o: { after?: string; failures?: number } = {}) {
  const sent: string[] = [];
  let failures = o.failures ?? 0;
  const output: BroadcastOutput = {
    name,
    after: o.after,
    send: async (b) => {
      if (failures > 0) {
        failures -= 1;
        return 'failed';
      }
      sent.push(b.key);
      return 'sent';
    },
  };
  return { output, sent };
}

async function mondayRun(o: { now?: string; mode?: string; cardFails?: number; pollFails?: number; fetch?: typeof fetch } = {}) {
  const channel = recorder('telegram-channel', { failures: o.cardFails });
  const drafts = recorder('x-draft');
  const preview = recorder('telegram-preview');
  const channelPoll = recorder('telegram-poll', { after: 'telegram-channel', failures: o.pollFails });
  const draftsPoll = recorder('telegram-poll', { after: 'telegram-preview' });
  const h = harness({ now: o.now ?? NOW, fetch: o.fetch ?? card(), env: { BROADCASTS: 'on', MOMENTS: o.mode ?? 'on' } });
  await runBroadcasts(h.c, { kind: 'finalize', days: ['2026-10-11'] }, {
    channel: [channel.output], drafts: [drafts.output], preview: [preview.output], channelPoll: [channelPoll.output], draftsPoll: [draftsPoll.output],
  });
  const polls = (keys: string[]) => keys.filter((k) => k === POLL_KEY);
  return {
    channel: polls(channel.sent), drafts: polls(drafts.sent), preview: polls(preview.sent), channelPoll: channelPoll.sent, draftsPoll: draftsPoll.sent,
    reports: channel.sent.filter((k) => k !== POLL_KEY), alerts: h.alerts.map((a) => a.signature),
  };
}

describe('the Monday poll', () => {
  beforeEach(async () => {
    await seedLastWeek();
    await store.setMeta(env.DB, MOMENTS_SEED_KEY, 'seeded:2026-10-01T00:00:00.000Z');
  });

  it('posts its card after the weekly report, then the poll to the same chat, with no X draft', async () => {
    // #when
    const run = await mondayRun();
    // #then
    expect(run).toEqual({
      channel: [POLL_KEY], drafts: [], preview: [], channelPoll: [POLL_KEY], draftsPoll: [],
      reports: ['broadcast:daily:2026-10-11', 'broadcast:weekly:2026-10-05'], alerts: [],
    });
  });

  it('sends the card as a preview and the poll to the drafts chat in drafts mode', async () => {
    const run = await mondayRun({ mode: 'drafts' });
    expect([run.channel, run.drafts, run.preview, run.channelPoll, run.draftsPoll]).toEqual([[], [], [POLL_KEY], [], [POLL_KEY]]);
  });

  it('retries a failed poll alone, without posting its card again', async () => {
    // #given the card went out and the poll failed
    const first = await mondayRun({ pollFails: 1 });
    // #when the hourly run retries
    const retry = await mondayRun({ now: '2026-10-12T01:00:00.000Z' });
    // #then
    expect({ first: [first.channel, first.channelPoll, first.alerts], retry: [retry.channel, retry.channelPoll], done: (await store.getMeta(env.DB, POLL_KEY))?.startsWith('sent:') }).toEqual({
      first: [[POLL_KEY], [], [`broadcast-telegram-poll:${POLL_KEY}`]],
      retry: [[], [POLL_KEY]],
      done: true,
    });
  });

  it('holds the poll back while its card has not posted, and sends both on the next run', async () => {
    // #given the daily, the weekly and then the poll card fail on the channel
    const first = await mondayRun({ cardFails: 3 });
    // #when
    const retry = await mondayRun({ now: '2026-10-12T01:00:00.000Z' });
    // #then the poll waited without an alert of its own
    expect({ first: [first.channelPoll, first.alerts.filter((a) => a.includes('poll'))], retry: [retry.channel, retry.channelPoll] }).toEqual({
      first: [[], [`broadcast-telegram-channel:${POLL_KEY}`]],
      retry: [[POLL_KEY], [POLL_KEY]],
    });
  });

  it("posts when the weekly report's card fails", async () => {
    // #when
    const run = await mondayRun({ fetch: card('weekly/2026-10-05') });
    // #then
    expect({ channel: run.channel, channelPoll: run.channelPoll, reports: run.reports, alerts: run.alerts }).toEqual({
      channel: [POLL_KEY], channelPoll: [POLL_KEY], reports: ['broadcast:daily:2026-10-11'], alerts: ['broadcast-image:broadcast:weekly:2026-10-05'],
    });
  });

  it('is never planned on another day, so a Tuesday retry posts no poll', async () => {
    const tuesday = await mondayRun({ now: '2026-10-13T01:00:00.000Z' });
    expect([tuesday.channel, tuesday.channelPoll]).toEqual([[], []]);
  });
});

describe('the Monday poll and the moments budget', () => {
  it('posts on the first moments run, which seeds the other moments, and never takes a place in the budget', async () => {
    // #given two moments already went out today
    await seedLastWeek();
    await env.DB.batch(['1', '2'].map((s) => env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind(`broadcast:welcome:${s}`, 'sent:2026-10-12T00:07:01.000Z')));
    // #when no seed key exists yet
    const run = await mondayRun();
    // #then
    expect({ poll: run.channelPoll, seed: (await store.getMeta(env.DB, MOMENTS_SEED_KEY))?.startsWith('seeded:') }).toEqual({ poll: [POLL_KEY], seed: true });
  });
});

describe('the poll output', () => {
  const ENV = { TELEGRAM_BOT_TOKEN: 'bot', TELEGRAM_CHANNEL_ID: '@ccipdev', TELEGRAM_DRAFTS_CHAT_ID: '99' };
  const facts: PollFacts = {
    kind: 'poll',
    monday: MONDAY,
    poll: { week: MONDAY, question_kind: 'fee_chain', question: QUESTION, options: [...OPTIONS.slice(0, 2), { key: 'x', label: 'pump.fun' }], answer: null, outcome: null, votes: null, total_votes: null },
    last: null,
  };
  const broadcast: Broadcast = { key: POLL_KEY, kind: 'poll', image: new Uint8Array(PNG), facts, xText: '', telegramHtml: 'caption' };

  it('follows the card in its own chat, sends the poll with no link in it, and keeps its message id for next Monday', async () => {
    // #given
    const fetch = fakeFetch((url) => (url.endsWith('/sendPoll') ? jsonResponse({ ok: true, result: { message_id: 812 } }) : undefined));
    const outputs = telegramOutputs(harness({ now: NOW, fetch, env: ENV }).c);
    // #when
    const result = await outputs.channelPoll![0]!.send(broadcast);
    // #then
    expect({
      result,
      outputs: [outputs.channelPoll!.map((o) => [o.name, o.after]), outputs.draftsPoll!.map((o) => [o.name, o.after])],
      body: JSON.parse(String(fetch.calls[0]?.init?.body)),
      record: JSON.parse((await store.getMeta(env.DB, 'poll:2026-10-12'))!),
    }).toEqual({
      result: 'sent',
      outputs: [[['telegram-poll', 'telegram-channel']], [['telegram-poll', 'telegram-preview']]],
      body: { chat_id: '@ccipdev', question: QUESTION, options: [{ text: 'Base' }, { text: 'Ethereum' }, { text: 'pump․fun' }], is_anonymous: true },
      record: { chat_id: '@ccipdev', message_id: 812, question_kind: 'fee_chain', question: QUESTION, options: facts.poll.options },
    });
  });

  it('fails without keeping a record when Telegram refuses the poll', async () => {
    // #given
    const fetch = fakeFetch(() => jsonResponse({ ok: false, description: 'Bad Request: chat not found' }, 400));
    const outputs = telegramOutputs(harness({ now: NOW, fetch, env: ENV }).c);
    // #when
    const result = await outputs.draftsPoll![0]!.send(broadcast);
    // #then
    expect({ result, chat: JSON.parse(String(fetch.calls[0]?.init?.body)).chat_id, record: await store.getMeta(env.DB, 'poll:2026-10-12') }).toEqual({ result: 'failed', chat: '99', record: null });
  });
});

describe('closeLastWeekPoll', () => {
  const RECORD = { chat_id: '@ccipdev', message_id: 7, question_kind: 'fee_chain', question: QUESTION, options: OPTIONS };
  const ENV = { BROADCASTS: 'on', MOMENTS: 'on', TELEGRAM_BOT_TOKEN: 'bot' };
  const telegram = (answer: () => Response) => fakeFetch((url) => (url.endsWith('/stopPoll') ? answer() : undefined));
  const closed = () => jsonResponse({ ok: true, result: { total_voter_count: 13, options: [{ voter_count: 5 }, { voter_count: 8 }, { voter_count: 0 }] } });

  beforeEach(async () => {
    await store.setMeta(env.DB, 'poll:2026-10-05', JSON.stringify(RECORD));
  });

  it("closes last week's poll on Monday and keeps its voter counts in its record", async () => {
    // #given
    const fetch = telegram(closed);
    // #when
    await closeLastWeekPoll(harness({ now: NOW, fetch, env: ENV }).c);
    // #then
    expect({ body: JSON.parse(String(fetch.calls[0]?.init?.body)), record: JSON.parse((await store.getMeta(env.DB, 'poll:2026-10-05'))!) }).toEqual({
      body: { chat_id: '@ccipdev', message_id: 7 },
      record: { ...RECORD, voters: [5, 8, 0], total_voters: 13 },
    });
  });

  it('alerts and keeps no counts when the poll cannot be closed, as when its message was deleted', async () => {
    // #given
    const fetch = telegram(() => jsonResponse({ ok: false, description: 'Bad Request: message to stop poll not found' }, 400));
    const { c, alerts } = harness({ now: NOW, fetch, env: ENV });
    // #when
    await closeLastWeekPoll(c);
    // #then
    expect({ alerts, record: JSON.parse((await store.getMeta(env.DB, 'poll:2026-10-05'))!) }).toEqual({
      alerts: [{
        signature: 'poll-close:2026-10-05',
        text: 'The poll of the week of 2026-10-05 could not be closed, so its result posts without vote shares: Telegram returned HTTP 400: Bad Request: message to stop poll not found',
      }],
      record: RECORD,
    });
  });

  it('does nothing on another day, with moments off, without a bot token, or for a poll already closed', async () => {
    // #given
    const fetch = telegram(closed);
    await store.setMeta(env.DB, 'poll:2026-09-28', JSON.stringify({ ...RECORD, voters: [1, 1, 1], total_voters: 3 }));
    // #when
    await closeLastWeekPoll(harness({ now: '2026-10-13T00:07:00.000Z', fetch, env: ENV }).c);
    await closeLastWeekPoll(harness({ now: NOW, fetch, env: { ...ENV, MOMENTS: 'off' } }).c);
    await closeLastWeekPoll(harness({ now: NOW, fetch, env: { ...ENV, BROADCASTS: 'off' } }).c);
    await closeLastWeekPoll(harness({ now: NOW, fetch, env: { ...ENV, TELEGRAM_BOT_TOKEN: '' } }).c);
    await closeLastWeekPoll(harness({ now: '2026-10-05T00:07:00.000Z', fetch, env: ENV }).c);
    // #then
    expect(fetch.calls).toEqual([]);
  });

  it('never throws, even when D1 and the alerter both fail', async () => {
    // #given
    const h = harness({ now: NOW, fetch: telegram(closed), env: ENV, db: new Proxy(env.DB, { get: () => () => { throw new Error('D1 down'); } }) });
    const c = { ...h.c, alert: async () => { throw new Error('alerter down'); } };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // #when
    const run = closeLastWeekPoll(c);
    // #then
    await expect(run).resolves.toBeUndefined();
    log.mockRestore();
  });
});
