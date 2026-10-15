import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { enlistMarine } from '../src/enlistment';
import { storyKey, webCardKey } from '../src/public';
import type { Marine } from '../src/store';
import type { TelegramUser } from '../src/telegram-auth';
import { checkGate, claimStamp, marineSummary, stampTelegram, STAMP_CLAIM_MS, TELEGRAM_PLATFORM, telegramAvatar, telegramName } from '../src/telegram-marines';
import { fakeFetch, fakeRenderer, fakeTelegram, fakeTelegramBot, PNG_BYTES, resetStorage, TG_SETTINGS, TG_USER, tgError, tgOk } from './helpers';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);
const PHOTOS = tgOk({ total_count: 1, photos: [[{ file_id: 'small', width: 160 }, { file_id: 'mid', width: 640 }, { file_id: 'big', width: 1280 }]] });

const noPhotos = () => fakeTelegram({ getUserProfilePhotos: () => tgOk({ total_count: 0, photos: [] }) });
const asUser = (fields: Record<string, unknown>) => fields as unknown as TelegramUser;

async function enlisted(bot: ReturnType<typeof fakeTelegramBot>): Promise<Marine> {
  const result = await enlistMarine(bot, { platform: TELEGRAM_PLATFORM, userId: String(TG_USER.id), displayName: telegramName(TG_USER) });
  if (result.kind !== 'enlisted') throw new Error(result.kind);
  return result.marine;
}

beforeEach(resetStorage);

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
    const bot = fakeTelegramBot({ renderer, fetch: fakeFetch({ 'https://t.me/i/userpic/': () => new Response(JPEG) }) });
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

  it('else asks for the profile photo when the launch photo fails to download', async () => {
    // #given
    const tg = fakeTelegram({ getUserProfilePhotos: () => PHOTOS, getFile: (b) => tgOk({ file_path: `photos/${b.file_id}.jpg` }) }, { 'photos/mid.jpg': JPEG });
    const bot = fakeTelegramBot({
      tg,
      fetch: fakeFetch({
        'https://t.me/i/userpic/': () => {
          throw new Error('the request timed out');
        },
      }),
    });
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

  it('fails closed and alerts telegram-gate:<chat> when the chat cannot be checked, as when the bot was removed from @ccipdev', async () => {
    // #given
    const bot = fakeTelegramBot({ tg: fakeTelegram({ getChatMember: () => tgError(403, 'Forbidden: bot is not a member of the channel chat') }) });
    // #when
    const gate = await checkGate(bot, TG_USER.id);
    // #then
    expect([gate, bot.alerts.map((a) => a.signature), bot.alerts[0]?.text.includes('@ccipdev')]).toEqual(['join', ['telegram-gate:@ccipdev'], true]);
  });

  it('turns away and still alerts for the chat that fails when another chat answers that the user left', async () => {
    // #given
    const tg = fakeTelegram({ getChatMember: (b) => (b.chat_id === '@ccipdev' ? tgError(0, 'request failed (TimeoutError)') : tgOk({ status: 'left' })) });
    const bot = fakeTelegramBot({ tg, settings: { ...TG_SETTINGS, gateChats: ['@ccipdev', '-1001'] } });
    // #when
    const gate = await checkGate(bot, TG_USER.id);
    // #then
    expect([gate, bot.alerts.map((a) => a.signature)]).toEqual(['join', ['telegram-gate:@ccipdev']]);
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

  it('fails closed and alerts telegram-gate when there are no gate chats', async () => {
    // #given
    const bot = fakeTelegramBot({ settings: { ...TG_SETTINGS, gateChats: [] } });
    // #when
    const gate = await checkGate(bot, TG_USER.id);
    // #then
    expect([gate, bot.alerts.map((a) => a.signature)]).toEqual(['join', ['telegram-gate']]);
  });
});

describe('stamping a Telegram Marine', () => {
  it('stamps the card with the name and photo, and the web and Story cards with neither', async () => {
    // #given
    const renderer = fakeRenderer();
    const bot = fakeTelegramBot({ renderer, tg: fakeTelegram({ getUserProfilePhotos: () => PHOTOS, getFile: () => tgOk({ file_path: 'photos/mid.jpg' }) }, { 'photos/mid.jpg': JPEG }) });
    const marine = await enlisted(bot);
    // #when
    await stampTelegram(bot, marine, TG_USER);
    // #then
    const kept = await Promise.all(['cards/1.png', webCardKey(1), storyKey(1), 'avatars/1.png'].map(async (k) => (await env.MARINES.head(k))?.httpMetadata?.contentType));
    const publicCards = JSON.stringify([...renderer.webCards, ...renderer.stories]);
    expect({ kept, named: publicCards.includes('Ada') || publicCards.includes('avatar'), alerts: bot.alerts }).toEqual({ kept: Array(4).fill('image/png'), named: false, alerts: [] });
  });

  it('alerts telegram-stamp:<serial> once when a card fails, keeping what did render', async () => {
    // #given
    const bot = fakeTelegramBot({ renderer: fakeRenderer('renderMarineStory'), tg: noPhotos() });
    const marine = await enlisted(bot);
    // #when
    await stampTelegram(bot, marine, TG_USER);
    // #then
    expect({ alerts: bot.alerts.map((a) => a.signature), card: (await env.MARINES.head('cards/1.png')) !== null }).toEqual({ alerts: ['telegram-stamp:1'], card: true });
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
