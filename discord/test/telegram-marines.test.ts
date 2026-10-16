import type { MarineCard } from '@ccip-dev/core/linkmarine';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enlistMarine } from '../src/enlistment';
import type { Env } from '../src/env';
import { storyKey, webCardKey } from '../src/public';
import type { Marine } from '../src/store';
import type { TelegramUser } from '../src/telegram-auth';
import { checkGate, claimStamp, marineSummary, stampTelegram, STAMP_CLAIM_MS, TELEGRAM_PLATFORM, telegramAvatar, telegramName, telegramSettings } from '../src/telegram-marines';
import { fakeFetch, fakeRenderer, fakeTelegram, fakeTelegramBot, PNG_BYTES, resetStorage, TG_SETTINGS, TG_USER, tgError, tgOk } from './helpers';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);
const PHOTOS = tgOk({ total_count: 1, photos: [[{ file_id: 'small', width: 160 }, { file_id: 'mid', width: 640 }, { file_id: 'big', width: 1280 }]] });

const jpeg = (type: string | null = 'image/jpeg') => new Response(JPEG, type === null ? {} : { headers: { 'content-type': type } });
const noPhotos = () => fakeTelegram({ getUserProfilePhotos: () => tgOk({ total_count: 0, photos: [] }) });
const asUser = (fields: Record<string, unknown>) => fields as unknown as TelegramUser;

async function enlisted(bot: ReturnType<typeof fakeTelegramBot>): Promise<Marine> {
  const result = await enlistMarine(bot, { platform: TELEGRAM_PLATFORM, userId: String(TG_USER.id), displayName: telegramName(TG_USER) });
  if (result.kind !== 'enlisted') throw new Error(result.kind);
  return result.marine;
}

beforeEach(resetStorage);
afterEach(() => vi.restoreAllMocks());

describe('the Telegram settings', () => {
  const settingsOf = (vars: Partial<Env>) => telegramSettings(vars as Env);

  it.each([
    [undefined, false],
    ['', false],
    ['off', false],
    ['ON', false],
    ['on', true],
  ])('reads TELEGRAM_BOT %j as open: %s', (value, open) => {
    // #when
    const settings = settingsOf({ TELEGRAM_BOT: value });
    // #then
    expect(settings.open).toBe(open);
  });

  it.each([
    [undefined, []],
    ['', []],
    ['@ccipdev', ['@ccipdev']],
    [' @ccipdev , -1001 ,, -1002 , ', ['@ccipdev', '-1001', '-1002']],
  ])('reads TELEGRAM_GATE_CHATS %j as %j, trimmed and without empty entries', (value, gateChats) => {
    // #when
    const settings = settingsOf({ TELEGRAM_GATE_CHATS: value });
    // #then
    expect(settings.gateChats).toEqual(gateChats);
  });

  it.each([
    ['42', 42],
    [' 42 ', 42],
    [undefined, null],
    ['', null],
    ['abc', null],
    ['0', null],
    ['-5', null],
    ['4.5', null],
    ['1e3', null],
    ['0x10', null],
    ['9007199254740993', null],
  ])('reads TELEGRAM_STICKER_OWNER_ID %j as %j', (value, ownerId) => {
    // #when
    const settings = settingsOf({ TELEGRAM_STICKER_OWNER_ID: value });
    // #then
    expect(settings.ownerId).toBe(ownerId);
  });

  it.each([
    ['-1007777', '-1007777'],
    [' -1007777 ', '-1007777'],
    [undefined, ''],
    ['', ''],
  ])('reads TELEGRAM_ALERT_CHAT_ID %j as %j, trimmed', (value, alertChatId) => {
    // #when
    const settings = settingsOf({ TELEGRAM_ALERT_CHAT_ID: value });
    // #then
    expect(settings.alertChatId).toBe(alertChatId);
  });

  it('reads the bot token, empty while unset', () => {
    // #then
    expect([settingsOf({ TELEGRAM_BOT_TOKEN: '123:abc' }).botToken, settingsOf({}).botToken]).toEqual(['123:abc', '']);
  });
});

describe('a Telegram Marine’s stamped name', () => {
  it('is the first and last name, else @username, else "Marine"', () => {
    // #then
    expect([
      telegramName({ first_name: 'Ada', last_name: 'Lovelace', username: 'ada' }),
      telegramName({ first_name: 'Ada' }),
      telegramName({ first_name: ' ', last_name: ' ', username: 'ada' }),
      telegramName({ first_name: '' }),
    ]).toEqual(['Ada Lovelace', 'Ada', '@ada', 'Marine']);
  });

  it('takes only strings from launch data, which is cast and not checked past the id and first name', () => {
    // #when
    const names = [
      telegramName(asUser({ first_name: 'Ada', last_name: 42, username: { handle: 'ada' } })),
      telegramName(asUser({ first_name: ' ', last_name: ['Lovelace'], username: 7 })),
      telegramName(asUser({ first_name: '', last_name: null, username: true })),
    ];
    // #then
    expect(names).toEqual(['Ada', 'Marine', 'Marine']);
  });
});

describe('a Telegram Marine’s photo', () => {
  it('takes the launch photo when it is a JPEG on t.me, as the 240 px PNG the site makes, and keeps it', async () => {
    // #given
    const renderer = fakeRenderer();
    const bot = fakeTelegramBot({ renderer, fetch: fakeFetch({ 'https://t.me/i/userpic/': () => jpeg() }) });
    // #when
    const avatar = await telegramAvatar(bot, 3, { ...TG_USER, photo_url: 'https://t.me/i/userpic/320/abc.jpg' });
    // #then
    expect({ avatar: avatar && [...avatar], prepared: renderer.calls, kept: (await env.MARINES.head('avatars/3.png'))?.httpMetadata?.contentType, asked: bot.tg.calls }).toEqual({
      avatar: [...PNG_BYTES],
      prepared: ['prepareMeme'],
      kept: 'image/png',
      asked: [],
    });
  });

  it('else asks for the newest profile photo, at the largest size up to 640 px', async () => {
    // #given
    const bot = fakeTelegramBot({ tg: fakeTelegram({ getUserProfilePhotos: () => PHOTOS, getFile: (b) => tgOk({ file_path: `photos/${b.file_id}.jpg` }) }, { 'photos/mid.jpg': JPEG }) });
    // #when an SVG launch photo, which the card can't draw
    const avatar = await telegramAvatar(bot, 3, { ...TG_USER, photo_url: 'https://t.me/i/userpic/320/abc.svg' });
    // #then
    expect({ avatar: avatar && [...avatar], asked: bot.tg.calls.map((c) => [c.method, c.body.file_id ?? c.body.user_id]) }).toEqual({
      avatar: [...PNG_BYTES],
      asked: [['getUserProfilePhotos', TG_USER.id], ['getFile', 'mid']],
    });
  });

  it('else asks for the profile photo when the launch photo fails to download, logging the error name and never the URL', async () => {
    // #given
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const timeout = Object.assign(new Error('GET https://t.me/i/userpic/320/abc.jpg timed out'), { name: 'TimeoutError' });
    const tg = fakeTelegram({ getUserProfilePhotos: () => PHOTOS, getFile: (b) => tgOk({ file_path: `photos/${b.file_id}.jpg` }) }, { 'photos/mid.jpg': JPEG });
    const bot = fakeTelegramBot({
      tg,
      fetch: fakeFetch({
        'https://t.me/i/userpic/': () => {
          throw timeout;
        },
      }),
    });
    // #when
    const avatar = await telegramAvatar(bot, 3, { ...TG_USER, photo_url: 'https://t.me/i/userpic/320/abc.jpg' });
    // #then
    expect({ avatar: avatar && [...avatar], asked: tg.calls.map((c) => c.method), logged: warn.mock.calls }).toEqual({
      avatar: [...PNG_BYTES],
      asked: ['getUserProfilePhotos', 'getFile'],
      logged: [['telegram launch photo download failed (TimeoutError)']],
    });
  });

  it.each(['https://example.com/a.jpg', 'http://t.me/a.jpg', 'https://t.me@example.com/a.jpg'])('never fetches %s as the launch photo, asking for the profile photo instead', async (photoUrl) => {
    // #given
    const bot = fakeTelegramBot({ fetch: fakeFetch({ 'http': () => jpeg() }), tg: noPhotos() });
    // #when
    await telegramAvatar(bot, 3, { ...TG_USER, photo_url: photoUrl });
    // #then
    expect({ fetched: bot.fetch.urls, asked: bot.tg.calls.map((c) => c.method) }).toEqual({ fetched: [], asked: ['getUserProfilePhotos'] });
  });

  it.each([['text/html'], ['image/svg+xml'], [null]])('takes the launch photo only as image/jpeg: a response typed %s is a failed download, so the profile photo is asked for', async (type) => {
    // #given
    const tg = fakeTelegram({ getUserProfilePhotos: () => PHOTOS, getFile: (b) => tgOk({ file_path: `photos/${b.file_id}.jpg` }) }, { 'photos/mid.jpg': JPEG });
    const bot = fakeTelegramBot({ tg, fetch: fakeFetch({ 'https://t.me/i/userpic/': () => jpeg(type) }) });
    // #when
    const avatar = await telegramAvatar(bot, 3, { ...TG_USER, photo_url: 'https://t.me/i/userpic/320/abc.jpg' });
    // #then
    expect({ avatar: avatar && [...avatar], asked: tg.calls.map((c) => c.method) }).toEqual({ avatar: [...PNG_BYTES], asked: ['getUserProfilePhotos', 'getFile'] });
  });

  it('never fetches a launch photo that is not a string, asking for the profile photo instead', async () => {
    // #given
    const bot = fakeTelegramBot({
      fetch: fakeFetch({ 'https://t.me/': () => new Response(JPEG) }),
      tg: noPhotos(),
    });
    // #when
    await telegramAvatar(bot, 3, asUser({ ...TG_USER, photo_url: ['https://t.me/i/userpic/320/abc.jpg'] }));
    // #then
    expect({ fetched: bot.fetch.urls, asked: bot.tg.calls.map((c) => c.method) }).toEqual({ fetched: [], asked: ['getUserProfilePhotos'] });
  });

  it('is the gradient disc when the photo is hidden or there is none, keeping nothing', async () => {
    // #given a profile whose photo only contacts may see: the bot gets no photos
    const bot = fakeTelegramBot({ tg: noPhotos() });
    // #when
    const avatar = await telegramAvatar(bot, 3, TG_USER);
    // #then
    expect([avatar, await env.MARINES.head('avatars/3.png')]).toEqual([null, null]);
  });
});

describe('a Telegram Marine’s photo that Telegram is slow to give', () => {
  const never = <T>() => new Promise<T>(() => undefined);
  const STALLS = [
    { stalls: 'getUserProfilePhotos', tg: () => ({ ...fakeTelegram(), call: never }) },
    { stalls: 'the download of the photo', tg: () => ({ ...fakeTelegram({ getUserProfilePhotos: () => PHOTOS, getFile: () => tgOk({ file_path: 'photos/mid.jpg' }) }), download: never }) },
  ];

  it.each(STALLS)('stamps the card with the gradient disc after one 6 s budget when $stalls never answers', async ({ tg }) => {
    // #given
    const budgets: number[] = [];
    const deadline = (ms: number) => {
      budgets.push(ms);
      return new Promise<null>((resolve) => setTimeout(() => resolve(null), 5));
    };
    const renderer = fakeRenderer();
    const drawn: MarineCard[] = [];
    const drawing = {
      ...renderer,
      renderMarineCards: async (card: MarineCard) => {
        drawn.push(card);
        return renderer.renderMarineCards(card);
      },
    };
    const bot = fakeTelegramBot({ renderer: drawing, tg: tg(), deadline });
    const marine = await enlisted(bot);
    // #when
    await stampTelegram(bot, marine, TG_USER);
    // #then
    expect({ budgets, avatar: drawn[0]?.avatar ?? null, card: (await env.MARINES.head('cards/1.png'))?.httpMetadata?.contentType, alerts: bot.alerts }).toEqual({ budgets: [6_000], avatar: null, card: 'image/png', alerts: [] });
  });
});

describe('the gate', () => {
  const member = (status: string, extra: Record<string, unknown> = {}) => fakeTelegram({ getChatMember: () => tgOk({ status, ...extra }) });

  it('lets in a creator, an administrator, a member and a restricted member', async () => {
    // #when
    const gates = await Promise.all([member('creator'), member('administrator'), member('member'), member('restricted', { is_member: true })].map((tg) => checkGate(fakeTelegramBot({ tg }), TG_USER.id)));
    // #then
    expect(gates).toEqual(['ok', 'ok', 'ok', 'ok']);
  });

  it('turns away one who left, was banned, or is restricted outside the chat, alerting no one', async () => {
    // #given
    const bots = [member('left'), member('kicked'), member('restricted', { is_member: false }), fakeTelegram({ getChatMember: () => tgError(400, 'Bad Request: user not found') })].map((tg) => fakeTelegramBot({ tg }));
    // #when
    const gates = await Promise.all(bots.map((b) => checkGate(b, TG_USER.id)));
    // #then
    expect({ gates, alerts: bots.flatMap((b) => b.alerts) }).toEqual({ gates: ['join', 'join', 'join', 'join'], alerts: [] });
  });

  it('asks every gate chat, and a member of any one gets in', async () => {
    // #given
    const tg = fakeTelegram({ getChatMember: (b) => tgOk({ status: b.chat_id === '-1001' ? 'member' : 'left' }) });
    const bot = fakeTelegramBot({ tg, settings: { ...TG_SETTINGS, gateChats: ['@ccipdev', '-1001'] } });
    // #when
    const gate = await checkGate(bot, TG_USER.id);
    // #then
    expect([gate, tg.calls.map((c) => c.body.chat_id)]).toEqual(['ok', ['@ccipdev', '-1001']]);
  });

  it('asks to try again, letting no one in, and alerts telegram-gate:<chat> when the chat cannot be checked, as when the bot was removed from @ccipdev', async () => {
    // #given
    const bot = fakeTelegramBot({ tg: fakeTelegram({ getChatMember: () => tgError(403, 'Forbidden: bot is not a member of the channel chat') }) });
    // #when
    const gate = await checkGate(bot, TG_USER.id);
    // #then
    expect([gate, bot.alerts.map((a) => a.signature), bot.alerts[0]?.text.includes('@ccipdev')]).toEqual(['retry', ['telegram-gate:@ccipdev'], true]);
  });

  it('asks to try again, and alerts for the chat that fails, when another chat answers that the user left: the failing one may hold them', async () => {
    // #given
    const tg = fakeTelegram({ getChatMember: (b) => (b.chat_id === '@ccipdev' ? tgError(0, 'request failed (TimeoutError)') : tgOk({ status: 'left' })) });
    const bot = fakeTelegramBot({ tg, settings: { ...TG_SETTINGS, gateChats: ['@ccipdev', '-1001'] } });
    // #when
    const gate = await checkGate(bot, TG_USER.id);
    // #then
    expect([gate, bot.alerts.map((a) => a.signature)]).toEqual(['retry', ['telegram-gate:@ccipdev']]);
  });

  it('lets in a member of one chat and still alerts for another that fails', async () => {
    // #given
    const tg = fakeTelegram({ getChatMember: (b) => (b.chat_id === '@ccipdev' ? tgError(403, 'Forbidden: bot is not a member of the channel chat') : tgOk({ status: 'member' })) });
    const bot = fakeTelegramBot({ tg, settings: { ...TG_SETTINGS, gateChats: ['@ccipdev', '-1001'] } });
    // #when
    const gate = await checkGate(bot, TG_USER.id);
    // #then
    expect([gate, bot.alerts.map((a) => a.signature)]).toEqual(['ok', ['telegram-gate:@ccipdev']]);
  });

  it('alerts once per failing chat', async () => {
    // #given
    const bot = fakeTelegramBot({ tg: fakeTelegram({ getChatMember: () => tgError(500, 'Internal Server Error') }), settings: { ...TG_SETTINGS, gateChats: ['@ccipdev', '-1001'] } });
    // #when
    await checkGate(bot, TG_USER.id);
    // #then
    expect(bot.alerts.map((a) => a.signature)).toEqual(['telegram-gate:@ccipdev', 'telegram-gate:-1001']);
  });

  it('asks to try again, letting no one in, and alerts telegram-gate when there are no gate chats', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: { ...TG_SETTINGS, gateChats: [] } });
    // #when
    const gate = await checkGate(bot, TG_USER.id);
    // #then
    expect([gate, bot.alerts.map((a) => a.signature)]).toEqual(['retry', ['telegram-gate']]);
  });
});

describe('stamping a Telegram Marine', () => {
  it('stamps the card with the name and photo, and the web and Story cards with neither', async () => {
    // #given
    const renderer = fakeRenderer();
    const drawn: MarineCard[] = [];
    const drawing = {
      ...renderer,
      renderMarineCards: async (card: MarineCard) => {
        drawn.push(card);
        return renderer.renderMarineCards(card);
      },
    };
    const bot = fakeTelegramBot({ renderer: drawing, tg: fakeTelegram({ getUserProfilePhotos: () => PHOTOS, getFile: () => tgOk({ file_path: 'photos/mid.jpg' }) }, { 'photos/mid.jpg': JPEG }) });
    const marine = await enlisted(bot);
    // #when
    await stampTelegram(bot, marine, TG_USER);
    // #then
    const kept = await Promise.all(['cards/1.png', webCardKey(1), storyKey(1), 'avatars/1.png'].map(async (k) => (await env.MARINES.head(k))?.httpMetadata?.contentType));
    const publicCards = JSON.stringify([...renderer.webCards, ...renderer.stories]);
    expect({ kept, named: publicCards.includes('Ada') || publicCards.includes('avatar'), alerts: bot.alerts, private: { name: drawn[0]?.name, avatar: drawn[0]?.avatar && [...drawn[0].avatar] } }).toEqual({
      kept: Array(4).fill('image/png'),
      named: false,
      alerts: [],
      private: { name: 'Ada Lovelace', avatar: [...PNG_BYTES] },
    });
  });

  it.each([
    { failing: 'renderMarineStory', failed: 'Story card', web: 'image/png', story: undefined },
    { failing: 'renderMarineWebCard', failed: 'web card', web: undefined, story: 'image/png' },
  ] as const)('alerts telegram-stamp:<serial> once when the $failed fails, keeping the card and the other public card that rendered', async ({ failing, failed, web, story }) => {
    // #given
    const bot = fakeTelegramBot({ renderer: fakeRenderer(failing), tg: noPhotos() });
    const marine = await enlisted(bot);
    // #when
    await stampTelegram(bot, marine, TG_USER);
    // #then
    const contentType = async (key: string) => (await env.MARINES.head(key))?.httpMetadata?.contentType;
    expect({ alerts: bot.alerts.map((a) => [a.signature, a.text]), card: await contentType('cards/1.png'), web: await contentType(webCardKey(1)), story: await contentType(storyKey(1)) }).toEqual({
      alerts: [['telegram-stamp:1', `Marine #1: the ${failed} failed: ${failing} failed`]],
      card: 'image/png',
      web,
      story,
    });
  });

  it('alerts once when the memes cannot be read for the public cards, as well as for the card', async () => {
    // #given
    const unreadable = new Proxy(env.MARINES, {
      get(target, prop) {
        if (prop === 'get') return async () => Promise.reject(new Error('R2 is down'));
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const bot = fakeTelegramBot({ bucket: unreadable, tg: noPhotos() });
    const marine = await enlisted(bot);
    // #when
    await stampTelegram(bot, marine, TG_USER);
    // #then
    expect(bot.alerts.map((a) => [a.signature, a.text.includes('the web and Story cards could not be made: R2 is down')])).toEqual([['telegram-stamp:1', true]]);
  });

  it('runs one stamp a minute per Marine, however often it is asked', async () => {
    // #given
    const t0 = new Date('2026-10-15T10:00:00.000Z');
    // #when
    const claims = [await claimStamp(env.DB, 1, t0), await claimStamp(env.DB, 1, new Date(t0.getTime() + 2_000)), await claimStamp(env.DB, 2, t0), await claimStamp(env.DB, 1, new Date(t0.getTime() + STAMP_CLAIM_MS))];
    // #then
    expect(claims).toEqual([true, false, true, true]);
  });
});

describe('a Telegram stamp that fails', () => {
  const refusingCards = () =>
    new Proxy(env.MARINES, {
      get(target, prop) {
        if (prop === 'put') return async (key: string, ...rest: [never]) => (key.startsWith('cards/') ? Promise.reject(new Error('R2 is full')) : target.put(key, ...rest));
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  const FAILURES = [
    { failure: 'the memes cannot be copied', bot: () => fakeTelegramBot({ fetch: fakeFetch(), tg: noPhotos() }) },
    { failure: 'the card does not render', bot: () => fakeTelegramBot({ renderer: fakeRenderer('renderMarineCard'), tg: noPhotos() }) },
    { failure: 'R2 will not keep the card', bot: () => fakeTelegramBot({ bucket: refusingCards(), tg: noPhotos() }) },
  ];

  it.each(FAILURES)('is alerted as telegram-stamp:<serial> when $failure', async ({ bot: makeBot }) => {
    // #given
    const bot = makeBot();
    const marine = await enlisted(bot);
    // #when
    await stampTelegram(bot, marine, TG_USER);
    // #then
    expect(bot.alerts.map((a) => a.signature)).toEqual(['telegram-stamp:1']);
  });
});

describe('the Mini App’s view of a Marine', () => {
  it('carries the draw and the sticker volume, never the name or the account', async () => {
    // #given
    const bot = fakeTelegramBot();
    const marine = await enlisted(bot);
    // #when
    const summary = marineSummary(bot, marine);
    // #then
    expect({ keys: Object.keys(summary).sort(), volume: summary.volume, leaks: JSON.stringify(summary).includes('Ada') || JSON.stringify(summary).includes(String(TG_USER.id)) }).toEqual({
      keys: ['callsign', 'cardReady', 'memes', 'percentile', 'serial', 'tags', 'tier', 'volume'],
      volume: 1,
      leaks: false,
    });
  });
});
