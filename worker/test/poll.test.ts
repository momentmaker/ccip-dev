import type { Dim } from '@ccip-dev/core';
import { fakeFetch, jsonResponse, NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PollFacts } from '../src/broadcasts/moment-facts';
import { selectPollOutputs, telegramOutputs, type Broadcast, type BroadcastOutput } from '../src/broadcasts/outputs';
import { closeOpenPolls } from '../src/broadcasts/poll';
import { MOMENTS_SEED_KEY, runBroadcasts } from '../src/broadcasts/run';
import * as store from '../src/store';
import { harness, resetStorage, seedRegistry, watchedDb } from './helpers';

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

async function mondayRun(o: { now?: string; days?: string[]; mode?: string; cardFails?: number; pollFails?: number; fetch?: typeof fetch } = {}) {
  const channel = recorder('telegram-channel', { failures: o.cardFails });
  const drafts = recorder('x-draft');
  const preview = recorder('telegram-preview');
  const channelPoll = recorder('telegram-poll', { after: 'telegram-channel', failures: o.pollFails });
  const draftsPoll = recorder('telegram-poll', { after: 'telegram-preview' });
  const h = harness({ now: o.now ?? NOW, fetch: o.fetch ?? card(), env: { BROADCASTS: 'on', MOMENTS: o.mode ?? 'on' } });
  await runBroadcasts(h.c, { kind: 'finalize', days: o.days ?? ['2026-10-11'] }, {
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
    // #given the moments switch is on drafts
    // #when
    const run = await mondayRun({ mode: 'drafts' });
    // #then
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
    // #given the weekly card is down
    // #when
    const run = await mondayRun({ fetch: card('weekly/2026-10-05') });
    // #then
    expect({ channel: run.channel, channelPoll: run.channelPoll, reports: run.reports, alerts: run.alerts }).toEqual({
      channel: [POLL_KEY], channelPoll: [POLL_KEY], reports: ['broadcast:daily:2026-10-11'], alerts: ['broadcast-image:broadcast:weekly:2026-10-05'],
    });
  });

  it('is never planned on another day, so a Tuesday retry posts no poll', async () => {
    // #given Monday's poll is not sent yet
    // #when the hourly run plans Tuesday, with the days it passes then
    const tuesday = await mondayRun({ now: '2026-10-13T01:00:00.000Z', days: ['2026-10-12'] });
    // #then
    expect([tuesday.channel, tuesday.channelPoll]).toEqual([[], []]);
  });
});

describe('the Monday poll and the moments budget', () => {
  it('posts on the first moments run, which seeds the other moments', async () => {
    // #given two moments already went out today
    await seedLastWeek();
    await env.DB.batch(['1', '2'].map((s) => env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind(`broadcast:welcome:${s}`, 'sent:2026-10-12T00:07:01.000Z')));
    // #when no seed key exists yet
    const run = await mondayRun();
    // #then
    expect({ poll: run.channelPoll, seed: (await store.getMeta(env.DB, MOMENTS_SEED_KEY))?.startsWith('seeded:') }).toEqual({ poll: [POLL_KEY], seed: true });
  });

  it('posts when the day already holds two moments, and no third moment goes out', async () => {
    // #given seeded moments, two of them sent today, and a third one due
    await seedLastWeek();
    await env.DB.prepare("INSERT INTO daily_breakdown (day, dim, key, messages, usd_value, fee_usd) VALUES ('2026-10-11', 'lane', ?, 1, 1, 1)").bind(`${ETH}>${NETWORKS.bsc.chainSelector}`).run();
    await store.setMeta(env.DB, MOMENTS_SEED_KEY, 'seeded:2026-10-01T00:00:00.000Z');
    await env.DB.batch(['1', '2'].map((s) => env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind(`broadcast:welcome:${s}`, 'sent:2026-10-12T00:07:01.000Z')));
    // #when
    const run = await mondayRun();
    // #then the poll posts, and the budget keeps the third moment back
    expect({ poll: run.channelPoll, sentToday: await store.momentsSentOn(env.DB, '2026-10-12') }).toEqual({ poll: [POLL_KEY], sentToday: 2 });
  });
});

describe('the Monday poll and X', () => {
  const ENV = {
    BROADCASTS: 'on', MOMENTS: 'on', TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_CHANNEL_ID: '@ccipdev',
    X_API_KEY: 'k-key', X_API_SECRET: 'k-secret', X_ACCESS_TOKEN: 't-token', X_ACCESS_SECRET: 't-secret',
  };
  const mark = async (key: string) => (await store.getMeta(env.DB, key))?.split(':')[0] ?? null;

  beforeEach(async () => {
    await seedLastWeek();
    await store.setMeta(env.DB, MOMENTS_SEED_KEY, 'seeded:2026-10-01T00:00:00.000Z');
  });

  it('sends the reports to X but nothing for the poll card, whose X text is empty, and the card and poll still complete on Telegram', async () => {
    // #given the card, the Telegram API and X all answer
    const telegram: string[] = [];
    const f = fakeFetch(
      (url) => (url.startsWith('https://ccip.dev/og/') ? new Response(new Uint8Array(PNG), { headers: { 'content-type': 'image/png' } }) : undefined),
      (url) => {
        const method = /\/(sendPhoto|sendPoll)$/.exec(url)?.[1];
        if (method === undefined) return undefined;
        telegram.push(method);
        return method === 'sendPoll' ? jsonResponse({ ok: true, result: { message_id: 812 } }) : new Response('{"ok":true}');
      },
      (url) => (url.endsWith('/2/media/upload') ? jsonResponse({ data: { id: 'media-1' } }) : undefined),
      (url) => (url.endsWith('/2/tweets') ? jsonResponse({ data: { id: 'post-9' } }, 201) : undefined),
    );
    const h = harness({ now: NOW, fetch: f, env: ENV });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    // #when
    await runBroadcasts(h.c, { kind: 'finalize', days: ['2026-10-11'] });
    log.mockRestore();
    // #then the daily and the weekly report post to X; the poll's card and poll go to the channel only, and the poll closes
    expect({
      xPosts: f.calls.filter((c) => c.url.endsWith('/2/tweets')).length,
      onX: [await mark('broadcast:daily:2026-10-11#x-post'), await mark('broadcast:weekly:2026-10-05#x-post'), await mark(`${POLL_KEY}#x-post`)],
      telegram,
      poll: [await mark(`${POLL_KEY}#telegram-channel`), await mark(`${POLL_KEY}#telegram-poll`), await mark(POLL_KEY)],
      alerts: h.alerts.map((a) => a.signature),
    }).toEqual({
      xPosts: 2,
      onX: ['sent', 'sent', null],
      telegram: ['sendPhoto', 'sendPhoto', 'sendPhoto', 'sendPoll'],
      poll: ['sent', 'sent', 'sent'],
      alerts: [],
    });
  });

  it('never selects the X post for the poll, in on mode or drafts', () => {
    // #given an output set with an X post
    const out = (name: string): BroadcastOutput => ({ name, send: async () => 'sent' });
    const set = {
      channel: [out('telegram-channel')], xPost: [out('x-post')], drafts: [out('x-draft')], preview: [out('telegram-preview')],
      channelPoll: [out('telegram-poll')], draftsPoll: [out('telegram-poll')],
    };
    // #when
    const names = (mode: 'on' | 'drafts') => selectPollOutputs(set, mode).map((o) => o.name);
    // #then
    expect({ on: names('on'), drafts: names('drafts') }).toEqual({ on: ['telegram-channel', 'telegram-poll'], drafts: ['telegram-preview', 'telegram-poll'] });
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

  it('does not send a second poll when the record is kept but the output mark was lost', async () => {
    // #given the poll went out and its record was saved
    const fetch = fakeFetch((url) => (url.endsWith('/sendPoll') ? jsonResponse({ ok: true, result: { message_id: 813 } }) : undefined));
    await store.setMeta(env.DB, 'poll:2026-10-12', JSON.stringify({ chat_id: '@ccipdev', message_id: 812, question_kind: 'fee_chain', question: QUESTION, options: facts.poll.options }));
    const outputs = telegramOutputs(harness({ now: NOW, fetch, env: ENV }).c);
    // #when the run finds no #telegram-poll mark
    const result = await outputs.channelPoll![0]!.send(broadcast);
    // #then
    expect({ result, calls: fetch.calls.length }).toEqual({ result: 'sent', calls: 0 });
  });

  it('alerts when the poll went out but its record cannot be saved', async () => {
    // #given
    const fetch = fakeFetch((url) => (url.endsWith('/sendPoll') ? jsonResponse({ ok: true, result: { message_id: 812 } }) : undefined));
    const { db } = watchedDb(/ON CONFLICT/, { fail: true });
    const h = harness({ now: NOW, fetch, env: ENV, db });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // #when
    const result = await telegramOutputs(h.c).channelPoll![0]!.send(broadcast);
    // #then
    expect({ result, alerts: h.alerts.map((a) => a.signature) }).toEqual({ result: 'sent', alerts: ['poll-close:2026-10-12'] });
    log.mockRestore();
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

describe('closeOpenPolls', () => {
  const RECORD = { chat_id: '@ccipdev', message_id: 7, question_kind: 'fee_chain', question: QUESTION, options: OPTIONS };
  const ENV = { BROADCASTS: 'on', MOMENTS: 'on', TELEGRAM_BOT_TOKEN: 'bot' };
  const telegram = (answer: () => Response) => fakeFetch((url) => (url.endsWith('/stopPoll') ? answer() : undefined));
  const closed = () => jsonResponse({ ok: true, result: { total_voter_count: 13, options: [{ voter_count: 5 }, { voter_count: 8 }, { voter_count: 0 }] } });

  beforeEach(async () => {
    await store.setMeta(env.DB, 'poll:2026-10-05', JSON.stringify(RECORD));
  });

  it('alerts that the counts were lost, not that the poll stayed open, when they cannot be saved after a close', async () => {
    // #given Telegram closes the poll, but D1 refuses every write
    const { db } = watchedDb(/ON CONFLICT/, { fail: true });
    const { c, alerts } = harness({ now: NOW, fetch: telegram(closed), env: ENV, db });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // #when
    await closeOpenPolls(c);
    // #then
    expect(alerts).toEqual([{
      signature: 'poll-close:2026-10-05',
      text: 'The poll of the week of 2026-10-05 was closed, but its counts could not be saved, so its result posts without vote shares',
    }]);
    log.mockRestore();
  });

  it('alerts and keeps no counts when Telegram counts a different number of options', async () => {
    // #given
    const short = () => jsonResponse({ ok: true, result: { total_voter_count: 5, options: [{ voter_count: 5 }, { voter_count: 0 }] } });
    const { c, alerts } = harness({ now: NOW, fetch: telegram(short), env: ENV });
    // #when
    await closeOpenPolls(c);
    // #then
    expect({ alerts: alerts.map((a) => a.text), record: JSON.parse((await store.getMeta(env.DB, 'poll:2026-10-05'))!) }).toEqual({
      alerts: ['The poll of the week of 2026-10-05 could not be closed, so its result posts without vote shares: Telegram counted 2 options for 3'],
      record: RECORD,
    });
  });

  it("closes last week's poll on Monday and keeps its voter counts in its record", async () => {
    // #given
    const fetch = telegram(closed);
    // #when
    await closeOpenPolls(harness({ now: NOW, fetch, env: ENV }).c);
    // #then
    expect({ body: JSON.parse(String(fetch.calls[0]?.init?.body)), record: JSON.parse((await store.getMeta(env.DB, 'poll:2026-10-05'))!) }).toEqual({
      body: { chat_id: '@ccipdev', message_id: 7 },
      record: { ...RECORD, voters: [5, 8, 0], total_voters: 13 },
    });
  });

  it.each([
    ['already closed', 'Bad Request: poll has already been closed'],
    ['deleted', 'Bad Request: message with poll to stop not found'],
    ['deleted, in the older wording and another case', 'Bad Request: Message To Stop Poll Not Found'],
  ])('marks a poll Telegram reports %s as closed without counts, alerts once, and never tries it again', async (_, description) => {
    // #given
    const fetch = telegram(() => jsonResponse({ ok: false, error_code: 400, description }, 400));
    const h = harness({ now: NOW, fetch, env: ENV });
    // #when Monday's early and 06:00 finalize and Tuesday's run
    for (const now of [NOW, '2026-10-12T06:00:00.000Z', '2026-10-13T00:07:00.000Z']) {
      h.setNow(now);
      await closeOpenPolls(h.c);
    }
    // #then
    expect({ stops: fetch.calls.length, alerts: h.alerts, record: JSON.parse((await store.getMeta(env.DB, 'poll:2026-10-05'))!) }).toEqual({
      stops: 1,
      alerts: [{
        signature: 'poll-close:2026-10-05',
        text: `The poll of the week of 2026-10-05 was already closed or deleted, so its votes cannot be read and its result posts without vote shares: Telegram returned HTTP 400: ${description}`,
      }],
      record: { ...RECORD, closed: 'unavailable' },
    });
  });

  it('keeps no counts and alerts when the close fails on the network, and closes the poll at the next finalize', async () => {
    // #given the first stopPoll call fails to connect
    let stops = 0;
    const fetch = (async (input: RequestInfo | URL) => {
      if (!String(input).endsWith('/stopPoll')) throw new Error(`unexpected ${String(input)}`);
      stops += 1;
      if (stops === 1) throw new TypeError('network connection lost');
      return closed();
    }) as typeof globalThis.fetch;
    const h = harness({ now: NOW, fetch, env: ENV });
    // #when the early finalize, then the 06:00 one
    await closeOpenPolls(h.c);
    const afterEarly = await store.getMeta(env.DB, 'poll:2026-10-05');
    h.setNow('2026-10-12T06:00:00.000Z');
    await closeOpenPolls(h.c);
    // #then
    expect({ afterEarly: JSON.parse(afterEarly!), alerts: h.alerts.map((a) => a.text), record: JSON.parse((await store.getMeta(env.DB, 'poll:2026-10-05'))!) }).toEqual({
      afterEarly: RECORD,
      alerts: ['The poll of the week of 2026-10-05 could not be closed, so its result posts without vote shares: Telegram request failed (TypeError)'],
      record: { ...RECORD, voters: [5, 8, 0], total_voters: 13 },
    });
  });

  it('does nothing without a bot token', async () => {
    // #given
    const fetch = telegram(closed);
    // #when
    await closeOpenPolls(harness({ now: NOW, fetch, env: { ...ENV, TELEGRAM_BOT_TOKEN: '' } }).c);
    // #then
    expect(fetch.calls).toEqual([]);
  });

  it("leaves this week's poll open on its Monday and the days after, and a poll older than 8 weeks alone", async () => {
    // #given the poll of the week of Oct 5 is this week's, and the poll of Aug 3 is 9 weeks before it
    const fetch = telegram(closed);
    await store.setMeta(env.DB, 'poll:2026-08-03', JSON.stringify(RECORD));
    // #when Monday's and Tuesday's finalize run
    await closeOpenPolls(harness({ now: '2026-10-05T00:07:00.000Z', fetch, env: ENV }).c);
    await closeOpenPolls(harness({ now: '2026-10-06T00:07:00.000Z', fetch, env: ENV }).c);
    // #then
    expect(fetch.calls).toEqual([]);
  });

  it("closes last week's poll with moments off, since closing posts nothing", async () => {
    // #given the documented kill switch is on
    const fetch = telegram(closed);
    // #when
    await closeOpenPolls(harness({ now: NOW, fetch, env: { ...ENV, MOMENTS: 'off' } }).c);
    // #then
    expect(JSON.parse((await store.getMeta(env.DB, 'poll:2026-10-05'))!)).toEqual({ ...RECORD, voters: [5, 8, 0], total_voters: 13 });
  });

  it('closes a poll that a skipped Monday left open, oldest first', async () => {
    // #given the poll of Sep 28 was never closed, and last week's is open too
    const fetch = telegram(closed);
    await store.setMeta(env.DB, 'poll:2026-09-28', JSON.stringify({ ...RECORD, message_id: 6 }));
    // #when
    await closeOpenPolls(harness({ now: NOW, fetch, env: ENV }).c);
    // #then
    expect({
      closed: fetch.calls.map((call) => JSON.parse(String(call.init?.body)).message_id),
      counts: [(await store.getMeta(env.DB, 'poll:2026-09-28'))?.includes('"voters"'), (await store.getMeta(env.DB, 'poll:2026-10-05'))?.includes('"voters"')],
    }).toEqual({ closed: [6, 7], counts: [true, true] });
  });

  it('never sends a closed poll to stopPoll again', async () => {
    // #given the poll of Sep 28 already has its counts
    const fetch = telegram(closed);
    await store.setMeta(env.DB, 'poll:2026-09-28', JSON.stringify({ ...RECORD, message_id: 6, voters: [1, 1, 1], total_voters: 3 }));
    // #when Monday's early and 06:00 finalize and Tuesday's both run
    for (const now of [NOW, '2026-10-12T06:00:00.000Z', '2026-10-13T00:07:00.000Z']) await closeOpenPolls(harness({ now, fetch, env: ENV }).c);
    // #then only last week's poll was closed, once
    expect(fetch.calls.map((call) => JSON.parse(String(call.init?.body)).message_id)).toEqual([7]);
  });

  it('never throws, even when D1 and the alerter both fail', async () => {
    // #given
    const h = harness({ now: NOW, fetch: telegram(closed), env: ENV, db: new Proxy(env.DB, { get: () => () => { throw new Error('D1 down'); } }) });
    const c = { ...h.c, alert: async () => { throw new Error('alerter down'); } };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // #when
    const run = closeOpenPolls(c);
    // #then
    await expect(run).resolves.toBeUndefined();
    log.mockRestore();
  });
});
