import type { Dim } from '@ccip-dev/core';
import type { MomentsBody } from '@ccip-dev/core/moments';
import { fakeFetch, jsonResponse, NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dueMoments, pickMoments, type DueMoment } from '../src/broadcasts/moment-plan';
import { momentMode, type Broadcast, type BroadcastOutput } from '../src/broadcasts/outputs';
import { MOMENTS_SEED_KEY, runBroadcasts } from '../src/broadcasts/run';
import * as store from '../src/store';
import { harness, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const ETH = NETWORKS.ethereum.chainSelector;
const BASE = NETWORKS.base.chainSelector;
const NEW = ['1000000000000000001', '1000000000000000002', '1000000000000000003'];
const welcome = (selector: string) => `broadcast:welcome:${selector}`;

describe('momentMode', () => {
  it.each([
    ['on', 'on', 'on'], ['on', 'drafts', 'drafts'], ['drafts', 'on', 'drafts'], ['on', 'off', 'off'], ['off', 'on', 'off'], ['on', undefined, 'off'], ['on', 'On', 'off'],
  ] as const)('BROADCASTS %s and MOMENTS %s make moments %s', (broadcasts, moments, mode) => {
    expect(momentMode({ BROADCASTS: broadcasts, MOMENTS: moments })).toBe(mode);
  });
});

const board = (key: string, rank: number, previous: number | null) => ({ key, label: null, value: 100 - rank, rank, previous_rank: previous });
const QUIET = { fee_chains: [board('a', 1, 1)], tokens: [board('t', 1, 1)], lanes: [board('l', 1, 1)] };
const SPOT = { selector: 'a', rank: 1, messages: 300, previous_messages: 100, usd: 1, previous_usd: 1, fee_usd: null, previous_fee_usd: null, partners: [], token: null };
const MOMENTS: MomentsBody = {
  network: { chains: 3, lanes: 2 },
  arrivals: {
    chains: [{ selector: 'n1', day: '2026-10-11', number: 3, partners: [], messages: 1, usd: 1 }, { selector: 'n0', day: '2026-10-08', number: 2, partners: [], messages: 1, usd: 1 }],
    lanes: [{ key: 'a>b', day: '2026-10-07', messages: 1, usd: 1 }, { key: 'b>a', day: '2026-10-13', messages: 1, usd: 1 }],
    tokens: [],
  },
  weeks: [
    { week: '2026-09-21', boards: QUIET, spotlight: null },
    { week: '2026-09-28', boards: QUIET, spotlight: null },
    { week: '2026-10-05', boards: { ...QUIET, fee_chains: [board('b', 1, 2)] }, spotlight: SPOT },
  ],
  countdowns: [
    { metric: 'messages', threshold: 1e6, total: 1, per_day: 1, days_left: 1, previous: null },
    { metric: 'value', threshold: 1e9, total: 1, per_day: 1, days_left: 7, previous: null },
    { metric: 'fees', threshold: 1e6, total: 1, per_day: 1, days_left: 8, previous: null },
  ],
  polls: [],
};
const due = (today: string) => dueMoments(MOMENTS, today).map((d) => `${d.target.kind}:${'selector' in d.target ? d.target.selector : 'monday' in d.target ? d.target.monday : d.target.metric}@${d.due}`);

describe('dueMoments', () => {
  it('plans each moment on its day: a welcome the day after the first message, movers on Tuesday, the spotlight on Thursday and New on CCIP on Saturday', () => {
    expect([due('2026-10-12'), due('2026-10-13'), due('2026-10-15'), due('2026-10-10')]).toEqual([
      ['welcome:n1@2026-10-12', 'countdown:value@2026-10-12', 'roundup:2026-10-05@2026-10-10'],
      ['welcome:n1@2026-10-12', 'countdown:value@2026-10-13', 'movers:2026-10-05@2026-10-13'],
      ['countdown:value@2026-10-15', 'movers:2026-10-05@2026-10-13', 'spotlight:2026-10-05@2026-10-15'],
      ['welcome:n0@2026-10-09', 'countdown:value@2026-10-10', 'roundup:2026-10-05@2026-10-10'],
    ]);
  });

  it('carries a moment over for 2 days after its own, then drops it', () => {
    // #when the Oct 5 week's movers were due Tuesday the 13th
    const kinds = ['2026-10-14', '2026-10-15', '2026-10-16'].map((today) => due(today).filter((d) => d.startsWith('movers')));
    // #then
    expect(kinds).toEqual([['movers:2026-10-05@2026-10-13'], ['movers:2026-10-05@2026-10-13'], []]);
  });

  it('counts down only between 7 and 2 days out, and plans no movers for a week with nothing to say', () => {
    // #given the week of Sep 28 kept every leader and nothing climbed, so Tuesday Oct 6 has no movers
    const tuesday = dueMoments(MOMENTS, '2026-10-06').map((d) => d.target.kind);
    // #then of the countdowns 1, 7 and 8 days out, only the one 7 days out is planned
    expect(tuesday).toEqual(['countdown']);
  });
});

describe('pickMoments', () => {
  const d = (target: DueMoment['target'], day: string): DueMoment => ({ target, due: day });
  const ALL = [
    d({ kind: 'roundup', monday: '2026-10-05' }, '2026-10-10'),
    d({ kind: 'spotlight', monday: '2026-10-05' }, '2026-10-15'),
    d({ kind: 'countdown', metric: 'fees', threshold: 1e6 }, '2026-10-15'),
    d({ kind: 'welcome', selector: 'b' }, '2026-10-15'),
    d({ kind: 'welcome', selector: 'a' }, '2026-10-14'),
    d({ kind: 'movers', monday: '2026-10-05' }, '2026-10-13'),
  ];
  const keys = (list: DueMoment[]) => list.map((m) => `${m.target.kind}${'selector' in m.target ? `:${m.target.selector}` : ''}`);

  it('takes welcome, countdown, movers, spotlight and New on CCIP in that order, an older one first, up to 2 a day', () => {
    expect([keys(pickMoments(ALL, { done: new Set(), sentToday: 0 })), keys(pickMoments(ALL, { done: new Set(), sentToday: 1 })), keys(pickMoments(ALL, { done: new Set(), sentToday: 2 }))]).toEqual([
      ['welcome:a', 'welcome:b'], ['welcome:a'], [],
    ]);
  });

  it('skips the moments already sent or seeded', () => {
    // #when
    const picked = pickMoments(ALL, { done: new Set(['broadcast:welcome:a', 'broadcast:welcome:b', 'broadcast:countdown:fees:1000000']), sentToday: 0 });
    // #then
    expect(keys(picked)).toEqual(['movers', 'spotlight']);
  });
});

describe('momentsSentOn', () => {
  it("counts today's sent budgeted moment keys, not their output rows, the poll, a seeded key or another day's", async () => {
    // #given
    await env.DB.batch(
      [
        ['broadcast:welcome:1', 'sent:2026-10-12T00:07:01.000Z'],
        ['broadcast:welcome:1#telegram-channel', 'sent:2026-10-12T00:07:01.000Z'],
        ['broadcast:countdown:fees:2500000', 'sent:2026-10-12T13:00:00.000Z'],
        ['broadcast:movers:2026-10-05', 'sent:2026-10-11T00:07:00.000Z'],
        ['broadcast:spotlight:2026-10-05', 'seeded:2026-10-12T00:07:00.000Z'],
        ['broadcast:roundup:2026-10-05', 'pending:2026-10-12T00:07:00.000Z'],
        ['broadcast:poll:2026-10-12', 'sent:2026-10-12T00:07:02.000Z'],
        ['broadcast:daily:2026-10-11', 'sent:2026-10-12T00:07:00.000Z'],
      ].map(([key, value]) => env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind(key, value)),
    );
    // #then
    expect(await store.momentsSentOn(env.DB, '2026-10-12')).toBe(2);
  });

  it('reads the count through the meta primary key', async () => {
    // #when
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${store.MOMENTS_SENT_SQL}`).bind('2026-10-12', '2026-10-13').all<{ detail: string }>();
    // #then
    expect(plan.results.map((r) => r.detail).join(' | ')).toContain('USING INDEX sqlite_autoindex_meta_1 (key>? AND key<?)');
  });
});

const NOW = '2026-10-13T00:07:00.000Z';
const DAY = '2026-10-12';
const PNG = [137, 80, 78, 71];
const card = (failing: string | null = null) =>
  fakeFetch((url) => {
    if (!url.startsWith('https://ccip.dev/og/')) return undefined;
    return failing !== null && url.includes(failing) ? new Response('down', { status: 500 }) : new Response(new Uint8Array(PNG), { headers: { 'content-type': 'image/png' } });
  });

function recorder(name: string, fails: (b: Broadcast) => boolean = () => false) {
  const sent: string[] = [];
  const output: BroadcastOutput = {
    name,
    send: async (b) => {
      if (fails(b)) return 'failed';
      sent.push(b.key);
      return 'sent';
    },
  };
  return { output, sent };
}

/** An old lane, then three chains whose first message was on Monday, Oct 12, and a fourth on Oct 13. */
async function seedArrivals(): Promise<void> {
  await seedRegistry([NETWORKS.ethereum, NETWORKS.base], []);
  const totals = (day: string, messages: number) => ({ day, messages, token_messages: 0, usd_value: messages, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 });
  const lane = (day: string, key: string) => ({ day, dim: 'lane' as Dim, key, messages: 1, usd_value: 1, fee_usd: null });
  await store.replaceDaily(env.DB, totals('2026-08-03', 100), [lane('2026-08-03', `${ETH}>${BASE}`)], NOW);
  await store.replaceDaily(env.DB, totals(DAY, 3), NEW.map((s) => lane(DAY, `${s}>${ETH}`)), NOW);
  await store.replaceDaily(env.DB, totals('2026-10-13', 1), [lane('2026-10-13', `9000000000000000009>${ETH}`)], NOW);
}

async function momentRun(o: { now?: string; day?: string; mode?: string; moments?: string; channelFails?: (b: Broadcast) => boolean; fetch?: typeof fetch }) {
  const channel = recorder('telegram-channel', o.channelFails);
  const drafts = recorder('x-draft');
  const preview = recorder('telegram-preview');
  const h = harness({ now: o.now ?? NOW, fetch: o.fetch ?? card(), env: { BROADCASTS: o.mode ?? 'on', MOMENTS: o.moments ?? 'on' } });
  await runBroadcasts(h.c, { kind: 'finalize', days: [o.day ?? DAY] }, { channel: [channel.output], drafts: [drafts.output], preview: [preview.output] });
  const isMoment = (key: string) => /^broadcast:(welcome|countdown|movers|spotlight|roundup|poll):/.test(key);
  const moments = (keys: string[]) => keys.filter(isMoment);
  return { channel: moments(channel.sent), drafts: moments(drafts.sent), preview: moments(preview.sent), reports: channel.sent.filter((k) => !isMoment(k)), alerts: h.alerts.map((a) => a.signature) };
}

describe('moments after finalize', () => {
  beforeEach(async () => {
    await seedArrivals();
    await store.setMeta(env.DB, MOMENTS_SEED_KEY, 'seeded:2026-10-01T00:00:00.000Z');
  });

  it('posts at most 2 moments a day after the daily report, and the one left over on the next day', async () => {
    // #when
    const tuesday = await momentRun({});
    const wednesday = await momentRun({ now: '2026-10-14T00:07:00.000Z', day: '2026-10-13' });
    // #then the fourth chain arrived on Oct 13, so it is due on Wednesday too, behind the older welcome
    expect({ tuesday: [tuesday.reports, tuesday.channel], wednesday: wednesday.channel }).toEqual({
      tuesday: [['broadcast:daily:2026-10-12'], [welcome(NEW[0]!), welcome(NEW[1]!)]],
      wednesday: [welcome(NEW[2]!), welcome('9000000000000000009')],
    });
  });

  it('gives the hourly retry only the place a failed moment left, never a third moment', async () => {
    // #given at 00:07 the second welcome's channel post fails
    const first = await momentRun({ channelFails: (b) => b.key === welcome(NEW[1]!) });
    // #when the hourly run retries yesterday, twice
    const retry = await momentRun({ now: '2026-10-13T01:00:00.000Z' });
    const again = await momentRun({ now: '2026-10-13T02:00:00.000Z' });
    // #then the retry sends the channel post that failed, and the third welcome waits for tomorrow
    expect({ first: first.channel, retry: [retry.channel, retry.drafts], again: [again.channel, again.drafts] }).toEqual({
      first: [welcome(NEW[0]!)],
      retry: [[welcome(NEW[1]!)], []],
      again: [[], []],
    });
  });

  it('keeps posting the other moments when one moment fails, after the daily', async () => {
    // #given the first welcome's card answers 500
    const { reports, channel, alerts } = await momentRun({ fetch: card(`welcome/${NEW[0]}`) });
    // #then its place is not given away within the run; the next run retries it
    expect({ reports, channel, alerts }).toEqual({ reports: ['broadcast:daily:2026-10-12'], channel: [welcome(NEW[1]!)], alerts: [`broadcast-image:${welcome(NEW[0]!)}`] });
  });

  it('posts no moment with MOMENTS off, and sends moments only to the owner with MOMENTS drafts, while the reports post', async () => {
    // #when
    const off = await momentRun({ moments: 'off' });
    await resetStorage();
    await seedArrivals();
    await store.setMeta(env.DB, MOMENTS_SEED_KEY, 'seeded:2026-10-01T00:00:00.000Z');
    const drafts = await momentRun({ moments: 'drafts' });
    // #then
    expect({ off: [off.reports.length, off.channel, off.drafts], drafts: [drafts.reports.length, drafts.channel, drafts.drafts, drafts.preview] }).toEqual({
      off: [1, [], []],
      drafts: [1, [], [welcome(NEW[0]!), welcome(NEW[1]!)], [welcome(NEW[0]!), welcome(NEW[1]!)]],
    });
  });
});

describe('the first moments run', () => {
  beforeEach(seedArrivals);

  it('marks every moment due today as seeded without posting it, and starts fresh the next day', async () => {
    // #when
    const first = await momentRun({});
    const seeded = await Promise.all(NEW.map(async (s) => (await store.getMeta(env.DB, welcome(s)))?.split(':')[0]));
    const next = await momentRun({ now: '2026-10-14T00:07:00.000Z', day: '2026-10-13' });
    // #then
    expect({ first: first.channel, seeded, seed: (await store.getMeta(env.DB, MOMENTS_SEED_KEY))?.startsWith('seeded:'), next: next.channel }).toEqual({
      first: [], seeded: ['seeded', 'seeded', 'seeded'], seed: true, next: [welcome('9000000000000000009')],
    });
  });
});

describe('moments on X', () => {
  const X_KEYS = { X_API_KEY: 'k-key', X_API_SECRET: 'k-secret', X_ACCESS_TOKEN: 't-token', X_ACCESS_SECRET: 't-secret' };
  const ENV = { BROADCASTS: 'on', TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_CHANNEL_ID: '@ccipdev', TELEGRAM_DRAFTS_CHAT_ID: '99', ...X_KEYS };
  const HANDLES = { chains: { 'binance_smart_chain-mainnet': 'BNBCHAIN', 'ethereum-mainnet': 'ethereum', 'ethereum-mainnet-base-1': 'base' }, tokens: [] };
  const BSC_WELCOME = welcome(NETWORKS.bsc.chainSelector);

  /** The card, the Telegram API and X, recording the chats sendPhoto reached and the texts posted to X. */
  function world() {
    const chats: string[] = [];
    const f = fakeFetch(
      (url) => (url.startsWith('https://ccip.dev/og/') ? new Response(new Uint8Array(PNG), { headers: { 'content-type': 'image/png' } }) : undefined),
      (url, init) => {
        if (!url.endsWith('/sendPhoto')) return undefined;
        chats.push(String((init?.body as FormData).get('chat_id')));
        return new Response('{"ok":true}');
      },
      (url) => (url.endsWith('/2/media/upload') ? jsonResponse({ data: { id: 'media-1' } }) : undefined),
      (url) => (url.endsWith('/2/tweets') ? jsonResponse({ data: { id: 'post-9' } }, 201) : undefined),
    );
    const xCalls = () => f.calls.map((c) => c.url).filter((u) => u.startsWith('https://api.x.com/'));
    const posts = () => f.calls.filter((c) => c.url.endsWith('/2/tweets')).map((c) => (JSON.parse(String(c.init?.body)) as { text: string }).text);
    return { f, chats, xCalls, posts };
  }

  /** BNB Chain's first lane opened on Monday, Oct 12, to Ethereum, so Tuesday's run welcomes it. */
  async function seedBnbArrival(): Promise<void> {
    await seedRegistry([NETWORKS.ethereum, NETWORKS.base, NETWORKS.bsc], []);
    const totals = (day: string) => ({ day, messages: 5, token_messages: 0, usd_value: 5, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 });
    await store.replaceDaily(env.DB, totals('2026-08-03'), [{ day: '2026-08-03', dim: 'lane', key: `${ETH}>${BASE}`, messages: 5, usd_value: 5, fee_usd: null }], NOW);
    await store.replaceDaily(env.DB, totals(DAY), [{ day: DAY, dim: 'lane', key: `${NETWORKS.bsc.chainSelector}>${ETH}`, messages: 5, usd_value: 5, fee_usd: null }], NOW);
    await store.setMeta(env.DB, MOMENTS_SEED_KEY, 'seeded:2026-10-01T00:00:00.000Z');
  }

  async function run(moments: string) {
    const w = world();
    const h = harness({ now: NOW, fetch: w.f, env: { ...ENV, MOMENTS: moments }, handles: HANDLES });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runBroadcasts(h.c, { kind: 'finalize', days: [DAY] });
    log.mockRestore();
    return { ...w, alerts: h.alerts.map((a) => a.signature) };
  }

  beforeEach(seedBnbArrival);

  it('posts a welcome to X in on mode, uploading its card and then posting, and tags only the welcomed chain', async () => {
    // #when
    const r = await run('on');
    const posted = r.posts().find((t) => t.startsWith('🎉 Welcome to #CCIP')) ?? '';
    // #then the daily report posts first, then the welcome
    expect({
      x: r.xCalls(),
      tags: posted.match(/@\w+/g),
      ats: posted.split('@').length - 1,
      marks: [await store.getMeta(env.DB, `${BSC_WELCOME}#x-post`), await store.getMeta(env.DB, BSC_WELCOME)].map((m) => m?.split(':')[0]),
      chats: r.chats,
      alerts: r.alerts,
    }).toEqual({
      x: ['https://api.x.com/2/media/upload', 'https://api.x.com/2/tweets', 'https://api.x.com/2/media/upload', 'https://api.x.com/2/tweets'],
      tags: ['@BNBCHAIN'],
      ats: 1,
      marks: ['sent', 'sent'],
      chats: ['@ccipdev', '@ccipdev'],
      alerts: [],
    });
  });

  it('keeps a moment off X in drafts mode, sending it to the owner as an X draft and a preview', async () => {
    // #when the reports are on and the moments on drafts
    const r = await run('drafts');
    // #then only the daily report reaches X
    expect({ x: r.xCalls().length, welcomeOnX: await store.getMeta(env.DB, `${BSC_WELCOME}#x-post`), chats: r.chats }).toEqual({
      x: 2, welcomeOnX: null, chats: ['@ccipdev', '99', '99'],
    });
  });
});
