import { decodePegReading, NO_PASSPORT_NOTES, passportNotesHash, pegLiveBody, type NetworkInfo, type PassportPostRecord, type PassportTokenRecord } from '@ccip-dev/core';
import type { PegEpisodeView } from '@ccip-dev/core/public';
import { fakeFetch, jsonResponse, PEG_LIVE_WORDS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBroadcasts } from '../src/broadcasts/run';
import { runPassport } from '../src/jobs/passport';
import * as passportStore from '../src/passport-store';
import * as store from '../src/store';
import { harness, resetStorage } from './helpers';

beforeEach(resetStorage);
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const ETH = '5009297550715157269';
const BASE = '15971525489660198786';
const GROUP = '0e5901c9-23ca-5cde-b023-63d82251fe7f';
const TOKEN = '0x4c1dab3be86347977f3dfc4b9688224ef2272939';
const DAY = '2026-11-26';
const NOW = '2026-11-26T05:00:00.000Z';
const ID = `${DAY}-${GROUP}`;
const KEY = `broadcast:passport:${ID}`;
const PAGE = `https://ccip.dev/passport/${GROUP}/`;
const PNG = new Uint8Array([137, 80, 78, 71]);

const ENV = { PASSPORT: 'on', PASSPORT_PUBLIC: 'on', BROADCASTS: 'on', TELEGRAM_BOT_TOKEN: 'bot', TELEGRAM_CHANNEL_ID: '@ccipdev', TELEGRAM_DRAFTS_CHAT_ID: '99' };
const X_KEYS = { X_API_KEY: 'k-key', X_API_SECRET: 'k-secret', X_ACCESS_TOKEN: 't-token', X_ACCESS_SECRET: 't-secret' };

const token = (extra: Partial<PassportTokenRecord> = {}): PassportTokenRecord => ({
  id: ID, day: DAY, kind: 'token', groupId: GROUP, name: 'BMT Token (BMT)',
  changes: [{ kind: 'raised', day: DAY, correction: false, groupId: GROUP, unit: `single-key/${ETH}:${TOKEN}` }],
  arrivals: [],
  ...extra,
});

const net = (name: string, chainSelector: string): NetworkInfo => ({ name, displayName: name, chainSelector, chainId: '1', chainFamily: 'EVM', environment: 'mainnet' });

/** The day's post records as the daily evaluation leaves them, created at `at`, with the record already evaluated for the day. */
async function seed(records: PassportPostRecord[], state: 'due' | 'seeded' = 'due', at = NOW): Promise<void> {
  await store.upsertChains(env.DB, [net('ethereum-mainnet', ETH), net('ethereum-mainnet-base-1', BASE)], '2026-10-01T00:00:00.000Z');
  await store.setMeta(env.DB, 'passport:mode', 'on');
  await store.setMeta(env.DB, 'passport:since', '2026-11-01');
  await store.setMeta(env.DB, 'passport:notes', passportNotesHash(NO_PASSPORT_NOTES));
  await passportStore.replacePosts(env.DB, DAY, records, state);
  await passportStore.markDuePosts(env.DB, DAY, at);
}

interface WorldOptions {
  card?: number;
  page?: number;
  telegram?: number;
}

/** The card and page on ccip.dev, Telegram's sendPhoto and X, recording each photo's chat and caption. */
function world(opts: WorldOptions = {}) {
  const photos: { chat: string; caption: string }[] = [];
  const f = fakeFetch(
    (url) => {
      if (!url.startsWith('https://ccip.dev/og/')) return undefined;
      const status = opts.card ?? 200;
      return status === 200 ? new Response(PNG, { headers: { 'content-type': 'image/png' } }) : new Response('no', { status });
    },
    (url) => (url.startsWith('https://ccip.dev/passport/') ? new Response('page', { status: opts.page ?? 200 }) : undefined),
    (url, init) => {
      if (!url.endsWith('/sendPhoto')) return undefined;
      const form = init?.body as FormData;
      photos.push({ chat: String(form.get('chat_id')), caption: String(form.get('caption')) });
      return new Response('{"ok":true}', { status: opts.telegram ?? 200 });
    },
    (url) => (url.startsWith('https://api.x.com/') ? jsonResponse({ data: { id: 'x-1' } }, 201) : undefined),
  );
  return { f, photos };
}

/** One hourly run of the Passport job at `iso`, after the day was evaluated. */
async function run(iso: string, opts: WorldOptions & { env?: Record<string, string> } = {}) {
  const w = world(opts);
  await store.setMeta(env.DB, 'passport:evaluated', iso.slice(0, 10));
  const h = harness({ now: iso, fetch: w.f, env: { ...ENV, ...opts.env } });
  await runPassport(h.c);
  return { h, photos: w.photos, urls: w.f.calls.map((c) => c.url), alerts: h.alerts.map((a) => a.signature) };
}

const mark = (key: string) => store.getMeta(env.DB, key).then((v) => v?.split(':')[0] ?? null);

describe('Passport posts', () => {
  it('posts a due record to the channel as one photo, and marks it sent', async () => {
    // #given
    await seed([token()]);
    // #when
    const { photos, alerts } = await run(NOW);
    // #then
    expect({ chats: photos.map((p) => p.chat), mark: await mark(KEY), alerts }).toEqual({ chats: ['@ccipdev'], mark: 'sent', alerts: [] });
  });

  it('makes no request to X and creates no X draft, with the X keys set and broadcasts on', async () => {
    // #given
    await seed([token()]);
    // #when
    const { photos, urls } = await run(NOW, { env: X_KEYS });
    // #then
    expect({
      x: urls.filter((u) => u.startsWith('https://api.x.com/')),
      chats: photos.map((p) => p.chat),
      marks: [await mark(`${KEY}#x-post`), await mark(`${KEY}#x-draft`), await mark(`${KEY}#telegram-channel`)],
    }).toEqual({ x: [], chats: ['@ccipdev'], marks: [null, null, 'sent'] });
  });

  it('sends the channel caption to the preview chat only with BROADCASTS drafts', async () => {
    // #given
    await seed([token()]);
    // #when
    const { photos } = await run(NOW, { env: { BROADCASTS: 'drafts' } });
    // #then
    expect({ chats: photos.map((p) => p.chat), linked: photos[0]?.caption.endsWith(PAGE) }).toEqual({ chats: ['99'], linked: true });
  });

  it('with PASSPORT_PUBLIC drafts sends the post to the owner only and marks it sent, while a peg post in the same run reaches the channel', async () => {
    // #given
    await seed([token()]);
    const live = { ...pegLiveBody(decodePegReading(PEG_LIVE_WORDS.map((w) => BigInt(w)))), spot: 0.9916, gap: -0.0084 };
    const episode: PegEpisodeView = {
      id: 7, side: 'discount', opened_at: '2026-11-26T04:30:00.000Z', closed_at: null, peak_gap: -0.0091, peak_at: '2026-11-26T04:40:00.000Z',
      best_size: 10_000, best_profit: 0.53, public: true, public_at: '2026-11-26T04:50:00.000Z',
    };
    // #when
    const { h, photos } = await run(NOW, { env: { PASSPORT_PUBLIC: 'drafts' } });
    await runBroadcasts(h.c, { kind: 'peg', live, episodes: [episode] });
    // #then
    expect({ chats: photos.map((p) => p.chat), passport: await mark(KEY), peg: await mark('broadcast:peg:7:open#telegram-channel') }).toEqual({
      chats: ['99', '@ccipdev'],
      passport: 'sent',
      peg: 'sent',
    });
  });

  it.each([
    ['created while PASSPORT_PUBLIC was off', 'seeded', {}],
    ['while PASSPORT_PUBLIC is off', 'due', { PASSPORT_PUBLIC: 'off' }],
    ['while PASSPORT is dry', 'due', { PASSPORT: 'dry' }],
  ] as const)('sends nothing for a record %s', async (_case, state, switches) => {
    // #given
    await seed([token()], state);
    // #when
    const { photos } = await run(NOW, { env: switches });
    // #then
    expect({ photos, mark: await mark(KEY) }).toEqual({ photos: [], mark: null });
  });

  it('sends nothing in a second run after a successful send', async () => {
    // #given
    await seed([token()]);
    await run(NOW);
    // #when
    const { photos } = await run('2026-11-26T06:00:00.000Z');
    // #then
    expect(photos).toEqual([]);
  });

  it('waits quietly while the card answers 404, then sends once it answers', async () => {
    // #given
    await seed([token()]);
    // #when
    const waiting = await run(NOW, { card: 404 });
    const unmarked = await mark(KEY);
    const next = await run('2026-11-26T06:00:00.000Z');
    // #then
    expect({ photos: waiting.photos, alerts: waiting.alerts, unmarked, next: next.photos.map((p) => p.chat) }).toEqual({ photos: [], alerts: [], unmarked: null, next: ['@ccipdev'] });
  });

  it('waits quietly while the token page does not answer, then sends once it answers', async () => {
    // #given
    await seed([token()]);
    // #when
    const waiting = await run(NOW, { page: 404 });
    const unmarked = await mark(KEY);
    const next = await run('2026-11-26T06:00:00.000Z');
    // #then
    expect({ photos: waiting.photos, alerts: waiting.alerts, unmarked, next: next.photos.map((p) => p.chat) }).toEqual({ photos: [], alerts: [], unmarked: null, next: ['@ccipdev'] });
  });

  it('drops a record 48 hours after it was created, with one alert over every later run', async () => {
    // #given a record created at 05:00 whose page never answered
    await seed([token()]);
    // #when
    const first = await run('2026-11-28T05:00:00.000Z', { page: 404 });
    const second = await run('2026-11-28T06:00:00.000Z');
    // #then
    expect({ photos: [...first.photos, ...second.photos], alerts: [...first.alerts, ...second.alerts] }).toEqual({ photos: [], alerts: [`passport-post-dropped:${ID}`] });
  });

  it('still sends a record created late on its day 47 hours later, though its day began 67 hours earlier', async () => {
    // #given
    await seed([token()], 'due', '2026-11-26T20:00:00.000Z');
    // #when
    const { photos, alerts } = await run('2026-11-28T19:00:00.000Z');
    // #then
    expect({ chats: photos.map((p) => p.chat), alerts }).toEqual({ chats: ['@ccipdev'], alerts: [] });
  });

  it('leaves the output unsent after a Telegram failure, alerts, and sends only it in the next run', async () => {
    // #given
    await seed([token()]);
    // #when
    const failed = await run(NOW, { telegram: 500 });
    const unmarked = await mark(KEY);
    const next = await run('2026-11-26T06:00:00.000Z');
    // #then
    expect({ alerts: failed.alerts, unmarked, next: next.photos.map((p) => p.chat), mark: await mark(KEY) }).toEqual({
      alerts: [`broadcast-telegram-channel:${KEY}`],
      unmarked: null,
      next: ['@ccipdev'],
      mark: 'sent',
    });
  });
});

describe('Passport captions', () => {
  const captionOf = async (record: PassportPostRecord) => {
    await seed([record]);
    const { photos } = await run(NOW);
    return photos[0]!.caption;
  };

  it('covers AE8: a new token\'s caption names the token, its chains and its flag, and ends with the page link', async () => {
    // #given a token new on Ethereum and Base whose Ethereum lane to Base has no rate limit
    const record = token({
      changes: [],
      arrivals: [{
        kind: 'new token', groupId: GROUP, otherChainFlags: 0,
        chains: [
          { row: `${ETH}:${TOKEN}`, chain: ETH, readable: true, flags: [`rate-limit/${ETH}:${TOKEN}/${BASE}`] },
          { row: `${BASE}:0xb`, chain: BASE, readable: true, flags: [] },
        ],
      }],
    });
    // #then
    expect(await captionOf(record)).toBe(
      ['<b>Token Passport · BMT Token (BMT)</b>', 'New token on Ethereum and Base', 'Flagged: no rate limit on transfers from Ethereum to Base', '', PAGE].join('\n'),
    );
  });

  it('cuts a forty-lane list to fit 1,024 characters and ends it with a count of the rest', async () => {
    // #given forty lanes from Ethereum to chains with no name, each with its rate limit switched off
    const changes = Array.from({ length: 40 }, (_, i) => ({ kind: 'raised' as const, day: DAY, correction: false, groupId: GROUP, unit: `rate-limit/${ETH}:${TOKEN}/${1_000_000_000_000_000_000n + BigInt(i)}` }));
    // #when
    const caption = await captionOf(token({ changes }));
    const lines = caption.split('\n');
    const shown = lines.filter((l) => l.startsWith('Flag raised: ')).length;
    // #then
    expect({ fits: caption.length <= 1024, cut: shown < 40, last: lines.slice(-3) }).toEqual({ fits: true, cut: true, last: [`And ${40 - shown} more on the token's page`, '', PAGE] });
  });

  it('covers AE12: the summary states fifteen tokens by kind of change and links to the latest-changes list', async () => {
    // #given
    const summary: PassportPostRecord = {
      id: `${DAY}-summary`, day: DAY, kind: 'summary', groupIds: Array.from({ length: 15 }, (_, i) => `g${i}`), counts: { raised: 0, cleared: 0, newToken: 13, newChain: 2 },
    };
    // #then
    expect(await captionOf(summary)).toBe(
      ['<b>Token Passport · 15 more tokens on Nov 26, 2026</b>', '13 new tokens, 2 new chains', '', 'https://ccip.dev/passport/#passport-latest'].join('\n'),
    );
  });

  it('says a correction is a correction', async () => {
    // #given
    const record = token({ changes: [{ kind: 'cleared', day: DAY, correction: true, groupId: GROUP, unit: `single-key/${ETH}:${TOKEN}` }] });
    // #then
    expect((await captionOf(record)).split('\n')[1]).toBe('Flag cleared by a correction: everyone who can change the bridge settings on Ethereum needs two or more signers');
  });
});

describe('the Passport planner\'s read', () => {
  it('reads the due post records and when each became due through keys, never a scan', async () => {
    // #when
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${passportStore.DUE_POSTS_SQL}`).bind(DAY).all<{ detail: string }>();
    // #then
    expect(results.map((r) => r.detail).filter((d) => !/^SEARCH (p USING INDEX passport_posts_day|m USING INDEX sqlite_autoindex_meta_1)/.test(d) && !/^USE TEMP B-TREE/.test(d))).toEqual([]);
  });
});
