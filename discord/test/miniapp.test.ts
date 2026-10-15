import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import worker from '../src/index';
import { miniAppRoute } from '../src/miniapp';
import { fakeRenderer, fakeTelegram, fakeTelegramBot, GIF_BYTES, PNG_BYTES, resetStorage, seedMarine, signedLaunch, TG_SETTINGS, TG_USER, tgOk, type FakeTelegramBot } from './helpers';

const OTHER = { id: 888000222, first_name: 'Grace' };

/** A Bot API whose users have no profile photo, so a stamp takes the gradient avatar without a warning in the output. */
const faceless = (answers: Parameters<typeof fakeTelegram>[0] = {}) => fakeTelegram({ getUserProfilePhotos: () => tgOk({ photos: [] }), ...answers });
const memberOf = (status: string) => faceless({ getChatMember: () => tgOk({ status }) });
const botWith = (overrides: Parameters<typeof fakeTelegramBot>[0] = {}) => fakeTelegramBot({ tg: faceless(), ...overrides });

/** The bot's fake clock in Unix seconds: launch data signed at it is fresh. */
const nowS = (bot: FakeTelegramBot) => Math.floor(bot.clock.ms / 1000);

async function ask(bot: FakeTelegramBot, path: string, user: Record<string, unknown> = TG_USER, extra: Record<string, unknown> = {}) {
  const work: Promise<unknown>[] = [];
  const initData = await signedLaunch(user, nowS(bot));
  const res = await miniAppRoute(new Request(`https://discord.ccip.dev${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://ccip.dev' }, body: JSON.stringify({ initData, ...extra }) }), bot, (p) => void work.push(p));
  await Promise.all(work);
  return res;
}

const body = async (res: Response): Promise<any> => res.json();

beforeEach(resetStorage);

describe('the Mini App API: requests', () => {
  it('answers a preflight from ccip.dev, and allows ccip.dev alone on every answer', async () => {
    // #given
    const bot = botWith();
    // #when
    const preflight = await miniAppRoute(new Request('https://discord.ccip.dev/tg/enlist', { method: 'OPTIONS', headers: { origin: 'https://ccip.dev' } }), bot, () => {});
    const answer = await ask(bot, '/tg/session');
    // #then
    expect([preflight.status, preflight.headers.get('access-control-allow-origin'), preflight.headers.get('access-control-allow-methods'), preflight.headers.get('access-control-allow-headers'), answer.headers.get('access-control-allow-origin')]).toEqual([
      204,
      'https://ccip.dev',
      'POST, OPTIONS',
      'content-type',
      'https://ccip.dev',
    ]);
  });

  it('refuses missing, stale and tampered launch data with 401, a body without it with 400, and a GET with 405', async () => {
    // #given
    const bot = botWith();
    const stale = await signedLaunch(TG_USER, nowS(bot) - 86_401);
    const tampered = new URLSearchParams(await signedLaunch(TG_USER, nowS(bot)));
    tampered.set('user', JSON.stringify(OTHER));
    const post = (body: string) => miniAppRoute(new Request('https://discord.ccip.dev/tg/session', { method: 'POST', body }), bot, () => {});
    // #when
    const answers = await Promise.all([
      post(JSON.stringify({ initData: '' })),
      post(JSON.stringify({ initData: stale })),
      post(JSON.stringify({ initData: tampered.toString() })),
      post('not json'),
      post(JSON.stringify({})),
      miniAppRoute(new Request('https://discord.ccip.dev/tg/session'), bot, () => {}),
      miniAppRoute(new Request('https://discord.ccip.dev/tg/other', { method: 'POST' }), bot, () => {}),
    ]);
    // #then
    expect(answers.map((r) => r.status)).toEqual([401, 401, 401, 400, 400, 405, 404]);
  });

  it('refuses a body over 16 KB with 413, by its declared length or by what it sends, and reads one of exactly 16 KB', async () => {
    // #given
    const bot = botWith();
    const initData = await signedLaunch(TG_USER, nowS(bot));
    const padded = (size: number) => {
      const bare = JSON.stringify({ initData, pad: '' });
      return JSON.stringify({ initData, pad: 'x'.repeat(size - bare.length) });
    };
    const post = (text: string, headers: Record<string, string> = {}) => miniAppRoute(new Request('https://discord.ccip.dev/tg/session', { method: 'POST', headers, body: text }), bot, () => {});
    // #when
    const answers = await Promise.all([post(padded(16 * 1024 + 1)), post(JSON.stringify({ initData }), { 'content-length': '999999' }), post(padded(16 * 1024))]);
    // #then
    expect(answers.map((r) => r.status)).toEqual([413, 413, 200]);
  });

  it('is reached through the Worker at /tg/, which keeps it shut while TELEGRAM_BOT is off', async () => {
    // #given the test config, whose TELEGRAM_BOT is "off"
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
    const initData = await signedLaunch(TG_USER, Math.floor(Date.now() / 1000), 'test-token');
    // #when
    const res = await worker.fetch(new Request('https://discord.ccip.dev/tg/session', { method: 'POST', body: JSON.stringify({ initData }) }) as Parameters<typeof worker.fetch>[0], { ...env, TELEGRAM_BOT_TOKEN: 'test-token' }, ctx);
    // #then
    expect([res.status, await res.json()]).toEqual([200, { switch: 'off' }]);
  });
});

describe('the Mini App API: /tg/session', () => {
  it('says only that it is off while the switch is off', async () => {
    // #when
    const res = await ask(botWith({ settings: { ...TG_SETTINGS, open: false } }), '/tg/session');
    // #then
    expect(await body(res)).toEqual({ switch: 'off' });
  });

  it('checks the gate for someone not yet enlisted', async () => {
    // #when
    const [inside, outside] = await Promise.all([ask(botWith({ tg: memberOf('member') }), '/tg/session'), ask(botWith({ tg: memberOf('left') }), '/tg/session')]);
    // #then
    expect([await body(inside), await body(outside)]).toEqual([
      { switch: 'on', marine: null, gate: 'ok' },
      { switch: 'on', marine: null, gate: 'join' },
    ]);
  });

  it('lets an enlisted Marine skip the gate, even one who has since left @ccipdev', async () => {
    // #given
    await ask(botWith({ tg: memberOf('member') }), '/tg/enlist');
    const tg = memberOf('left');
    // #when
    const res = await ask(botWith({ tg }), '/tg/session');
    // #then
    const answer = await body(res);
    expect([answer.gate, answer.marine.serial, tg.calls.length]).toEqual(['ok', 1, 0]);
  });
});

describe('the Mini App API: /tg/enlist', () => {
  it('draws, answers the Marine with its banner, and stamps the card, web card and Story card after answering', async () => {
    // #given every draw is Legendary
    const bot = botWith({ tg: memberOf('member') });
    bot.snapshot = { ...bot.snapshot, cutoffs: { uncommon: 0, rare: 0, legendary: 0 } };
    // #when
    const answer = await body(await ask(bot, '/tg/enlist'));
    // #then
    const kept = await Promise.all(['cards/1.png', 'cards/1.gif', 'web/1.png', 'story/1.png'].map(async (k) => (await env.MARINES.head(k)) !== null));
    expect({ already: answer.already, banner: answer.banner, serial: answer.marine.serial, tier: answer.marine.tier, volume: answer.marine.volume, kept }).toEqual({
      already: false,
      banner: 'legendary',
      serial: 1,
      tier: 'legendary',
      volume: 1,
      kept: [true, true, true, true],
    });
  });

  it('answers an enlisted Marine with their own Marine, drawing nothing and checking no gate', async () => {
    // #given
    const first = await body(await ask(botWith({ tg: memberOf('member') }), '/tg/enlist'));
    const tg = memberOf('member');
    // #when
    const again = await body(await ask(botWith({ tg }), '/tg/enlist'));
    // #then
    expect([again.already, again.banner, again.marine.callsign, tg.calls.length]).toEqual([true, null, first.marine.callsign, 0]);
  });

  it('refuses someone outside the gate chats with 403, taking no serial', async () => {
    // #when
    const res = await ask(botWith({ tg: memberOf('left') }), '/tg/enlist');
    // #then
    expect([res.status, await body(res), (await env.DB.prepare('SELECT COUNT(*) AS n FROM marines').first<{ n: number }>())?.n]).toEqual([403, { gate: 'join' }, 0]);
  });

  it('refuses with 409 while the switch is off', async () => {
    // #when
    const res = await ask(botWith({ settings: { ...TG_SETTINGS, open: false } }), '/tg/enlist');
    // #then
    expect([res.status, await body(res)]).toEqual([409, { switch: 'off' }]);
  });

  it('stamps the Telegram name, never the Discord one of an account with the same id', async () => {
    // #given a Discord Marine whose account id is the Telegram user's
    await seedMarine(String(TG_USER.id), 'On Discord', 'painting-space-prophecy');
    const renderer = fakeRenderer();
    const drawn: string[] = [];
    const bot = botWith({
      tg: memberOf('member'),
      renderer: { ...renderer, renderMarineCards: async (c) => (drawn.push(c.name), renderer.renderMarineCards(c)) },
    });
    // #when
    const answer = await body(await ask(bot, '/tg/enlist', { id: TG_USER.id, first_name: '', username: 'ada' }));
    // #then
    expect({ already: answer.already, drawn }).toEqual({ already: false, drawn: ['@ada'] });
  });
});

describe('the Mini App API: /tg/card', () => {
  it("serves the requester's own card, privately, the glint for Rare and up", async () => {
    // #given
    const bot = botWith({ tg: memberOf('member') });
    bot.snapshot = { ...bot.snapshot, cutoffs: { uncommon: 0, rare: 0, legendary: 0 } };
    await ask(bot, '/tg/enlist');
    // #when
    const res = await ask(bot, '/tg/card');
    // #then
    expect([res.status, res.headers.get('content-type'), res.headers.get('cache-control'), [...new Uint8Array(await res.arrayBuffer())]]).toEqual([200, 'image/gif', 'private, no-store', [...GIF_BYTES]]);
  });

  it('answers 202 and stamps again a card whose stamp failed, then serves it', async () => {
    // #given a Marine whose stamp failed at enlistment
    const failing = botWith({ tg: memberOf('member'), renderer: fakeRenderer('renderMarineCard') });
    await ask(failing, '/tg/enlist');
    const renderer = fakeRenderer();
    const bot = botWith({ renderer });
    bot.clock.ms += 61_000;
    // #when the app polls twice
    const [first, second] = [await ask(bot, '/tg/card'), await ask(bot, '/tg/card')];
    // #then the first poll started a stamp, which has finished by the second
    expect([first.status, second.status, second.headers.get('content-type'), renderer.calls.filter((c) => c === 'renderMarineCards').length]).toEqual([202, 200, 'image/png', 1]);
  });

  it('starts one stamp when two polls arrive while it is still running', async () => {
    // #given a Marine whose stamp failed at enlistment, and a renderer held until released
    const failing = botWith({ tg: memberOf('member'), renderer: fakeRenderer('renderMarineCard') });
    await ask(failing, '/tg/enlist');
    const renderer = fakeRenderer();
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const bot = botWith({ renderer: { ...renderer, renderMarineCards: async (c) => (await held, renderer.renderMarineCards(c)) } });
    bot.clock.ms += 61_000;
    const work: Promise<unknown>[] = [];
    const poll = async () => {
      const initData = await signedLaunch(TG_USER, nowS(bot));
      return miniAppRoute(new Request('https://discord.ccip.dev/tg/card', { method: 'POST', body: JSON.stringify({ initData }) }), bot, (p) => void work.push(p));
    };
    // #when both polls are answered before the stamp finishes
    const [first, second] = [await poll(), await poll()];
    release();
    await Promise.all(work);
    // #then
    expect([first.status, second.status, work.length, renderer.calls.filter((c) => c === 'renderMarineCards').length]).toEqual([202, 202, 1, 1]);
  });

  it('answers 404 to someone not enlisted, whatever Marine the body names', async () => {
    // #given a Marine, and another user asking for it by serial
    await ask(botWith({ tg: memberOf('member') }), '/tg/enlist');
    // #when
    const res = await ask(botWith(), '/tg/card', OTHER, { serial: 1 });
    // #then
    expect([res.status, await body(res)]).toEqual([404, { error: 'not enlisted' }]);
  });

  it('serves the static card to a Common Marine', async () => {
    // #given
    const bot = botWith({ tg: memberOf('member') });
    bot.snapshot = { ...bot.snapshot, cutoffs: { uncommon: 99, rare: 99, legendary: 99 } };
    await ask(bot, '/tg/enlist');
    // #when
    const res = await ask(bot, '/tg/card');
    // #then
    expect([res.status, res.headers.get('content-type'), [...new Uint8Array(await res.arrayBuffer())]]).toEqual([200, 'image/png', [...PNG_BYTES]]);
  });
});

describe('the Mini App API: what an answer holds', () => {
  it('never carries the Telegram id, name, username or photo of the user it answers', async () => {
    // #given users whose launch data carries a photo
    const photo = 'https://t.me/i/userpic/320/someone.jpg';
    const ada = { ...TG_USER, photo_url: photo };
    const grace = { ...OTHER, username: 'grace', photo_url: photo };
    const off = botWith({ settings: { ...TG_SETTINGS, open: false } });
    const outside = botWith({ tg: memberOf('left') });
    const stampFailed = botWith({ tg: memberOf('member'), renderer: fakeRenderer('renderMarineCard') });
    // #when every answer a JSON route gives is collected
    const answers = [
      await ask(off, '/tg/session', ada),
      await ask(off, '/tg/enlist', ada),
      await ask(outside, '/tg/session', ada),
      await ask(outside, '/tg/enlist', ada),
      await ask(stampFailed, '/tg/enlist', ada),
      await ask(stampFailed, '/tg/enlist', ada),
      await ask(stampFailed, '/tg/session', ada),
      await ask(stampFailed, '/tg/card', ada),
      await ask(stampFailed, '/tg/card', grace),
    ];
    // #then
    const texts = await Promise.all(answers.map((r) => r.text()));
    const leaks = [String(ada.id), String(grace.id), 'Ada', 'Lovelace', 'ada', 'Grace', 'grace', 'photo', 't.me'];
    expect({ statuses: answers.map((r) => r.status), leaking: texts.filter((t) => leaks.some((l) => t.includes(l))) }).toEqual({ statuses: [200, 409, 200, 403, 200, 200, 200, 202, 404], leaking: [] });
  });
});

describe('the Mini App API: failures', () => {
  it('answers 500 and alerts telegram-api:<route> when the database fails, without the launch data', async () => {
    // #given
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    onTestFinished(() => error.mockRestore());
    const bot = botWith({ db: { prepare: () => { throw new Error('D1 is down'); } } as unknown as D1Database });
    // #when
    const res = await ask(bot, '/tg/session');
    // #then
    const told = [...bot.alerts.map((a) => a.text), ...error.mock.calls.map(String)];
    expect([res.status, bot.alerts.map((a) => a.signature), told.some((t) => t.includes('hash='))]).toEqual([500, ['telegram-api:session'], false]);
  });
});
