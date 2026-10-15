import type { MarineSummary, SessionAnswer } from '@ccip-dev/core/linkmarine';
import { describe, expect, it } from 'vitest';
import { backVisible, callsignParts, canShareToStory, chanceText, firstScreen, mainButton, MAX_TILT, shareLink, startParam, storyText, storyUrl, tgApi, tierBanner, tilt, tiltOn, toDogTag, type Screen } from '../src/lib/tg';
import { telegramWebApp, type TelegramWebApp } from '../src/lib/telegram-webapp';

const MARINE: MarineSummary = {
  serial: 42,
  callsign: 'sergey-pepe-linkpilled',
  tags: ['sergey', 'pepe', 'linkpilled'],
  tier: 'rare',
  percentile: 88.4,
  memes: [
    { tag: 'sergey', file: 's1.jpeg', count: 653 },
    { tag: 'pepe', file: 'p1.jpeg', count: 426 },
    { tag: 'linkpilled', file: 'l1.jpeg', count: 3 },
  ],
  volume: 1,
  cardReady: true,
};
const ON_NEW: SessionAnswer = { switch: 'on', marine: null, gate: 'ok' };
const ON_ENLISTED: SessionAnswer = { switch: 'on', marine: MARINE, gate: 'ok' };
const OFF: SessionAnswer = { switch: 'off' };

describe('where the Mini App opens', () => {
  it('opens a Marine’s or a tag’s link on the roster, and enlist or nothing on the welcome or your dog tag', () => {
    // #then
    expect([
      firstScreen({ kind: 'marine', serial: 7 }, ON_ENLISTED),
      firstScreen({ kind: 'tag', tag: 'pepe' }, ON_NEW),
      firstScreen({ kind: 'enlist' }, ON_NEW),
      firstScreen({ kind: 'enlist' }, ON_ENLISTED),
      firstScreen(null, ON_ENLISTED),
      firstScreen(null, OFF),
    ]).toEqual([{ name: 'roster', marine: 7, tag: null }, { name: 'roster', marine: null, tag: 'pepe' }, { name: 'welcome' }, { name: 'dogtag' }, { name: 'dogtag' }, { name: 'welcome' }]);
  });

  it("reads startapp from Telegram's start_param, else from the URL the bot's button opens", () => {
    // #then
    expect([startParam({ initDataUnsafe: { start_param: 'marine_42' } }, '?startapp=enlist'), startParam({ initDataUnsafe: {} }, '?startapp=tag_pepe'), startParam({ initDataUnsafe: {} }, '?startapp=evil')]).toEqual([
      { kind: 'marine', serial: 42 },
      { kind: 'tag', tag: 'pepe' },
      null,
    ]);
  });

  it('is the outside screen in a plain browser, where Telegram’s script loads without launch data', () => {
    // #then
    expect([telegramWebApp({}), telegramWebApp({ Telegram: { WebApp: { initData: '' } as TelegramWebApp } }), telegramWebApp({ Telegram: { WebApp: { initData: 'x' } as TelegramWebApp } })?.initData]).toEqual([null, null, 'x']);
  });
});

describe('the draw', () => {
  it('fills the callsign in as the hexes lock', () => {
    // #then
    expect([1, 3].map((n) => callsignParts(MARINE.tags, n).map((p) => p.text).join('-'))).toEqual(['SERGEY-······-······', 'SERGEY-PEPE-LINKPILLED']);
  });

  it('prints a chance per draw and the tier banner', () => {
    // #then
    expect([chanceText(0.04412), tierBanner('rare', 88.4), tierBanner('common', 55.9)]).toEqual(['4.4%', 'RARE · RARER THAN 88%', 'COMMON · RARER THAN 55%']);
  });

  it('leaves “rarer than” off the banner for a draw rarer than under one in a hundred, as the card does', () => {
    // #then
    expect([tierBanner('common', 0), tierBanner('common', 0.9), tierBanner('common', 1)]).toEqual(['COMMON', 'COMMON', 'COMMON · RARER THAN 1%']);
  });
});

describe('the bottom button', () => {
  it('is ENLIST on the welcome, DRAWING… and disabled in the draw, gold SHARE TO STORY on your dog tag', () => {
    // #then
    expect(['welcome', 'draw', 'dogtag'].map((s) => { const b = mainButton(s as 'welcome', ON_ENLISTED); return [b.text, b.active, b.color]; })).toEqual([
      ['ENLIST', true, '#2f62df'],
      ['DRAWING…', false, '#2f62df'],
      ['SHARE TO STORY', true, '#f5c451'],
    ]);
  });

  it('is MY DOG TAG on the roster once enlisted, else ENLIST, which waits for the gate', () => {
    // #then
    expect([mainButton('roster', ON_ENLISTED).text, mainButton('roster', ON_NEW).text, mainButton('welcome', { switch: 'on', marine: null, gate: 'join' }).active]).toEqual(['MY DOG TAG', 'ENLIST', false]);
  });

  it('hides while LinkMarines on Telegram is off, or before the session is in', () => {
    // #then
    expect([mainButton('welcome', OFF).visible, mainButton('roster', OFF).visible, mainButton('welcome', null).visible]).toEqual([false, false, false]);
  });
});

describe('the tilt', () => {
  it('turns the card up to ±8° each way from where the phone was first held, the streak crossing with it', () => {
    // #given
    const rest = { beta: 40, gamma: 0 };
    // #then
    expect([tilt(40, 0, rest), tilt(52, 12, rest), tilt(100, -90, rest)]).toEqual([
      { x: 0, y: 0, streak: 50 },
      { x: -4, y: 4, streak: 75 },
      { x: -MAX_TILT, y: -MAX_TILT, streak: 0 },
    ]);
  });

  it('holds the card at rest, never NaN, when a reading is not a number', () => {
    // #given
    const rest = { beta: 40, gamma: 0 };
    // #then
    expect([tilt(Number.NaN, 0, rest), tilt(40, Number.POSITIVE_INFINITY, rest), tilt(40, 0, { beta: Number.NaN, gamma: 0 })]).toEqual([
      { x: 0, y: 0, streak: 50 },
      { x: 0, y: 0, streak: 50 },
      { x: 0, y: 0, streak: 50 },
    ]);
  });

  it('stays off under prefers-reduced-motion, and where the phone reports no orientation', () => {
    // #then
    expect([tiltOn(false, true), tiltOn(true, true), tiltOn(false, false)]).toEqual([true, false, false]);
  });
});

describe('sharing', () => {
  const app = (platform: string, version: number, story = true) => ({ platform, isVersionAtLeast: (v: string) => version >= Number(v), shareToStory: story ? () => {} : undefined });

  it('shares to Story on Telegram for phones from Bot API 7.8, and falls back everywhere else', () => {
    // #then
    expect([app('ios', 8), app('android', 7.8), app('android_x', 8), app('tdesktop', 8), app('macos', 9), app('weba', 8), app('ios', 7.7), app('android', 8, false)].map(canShareToStory)).toEqual([true, true, true, false, false, false, false, false]);
  });

  it('posts the public Story card with the serial, the callsign and the enlist link', () => {
    // #then
    expect([storyUrl(42), storyText(MARINE)]).toEqual(['https://discord.ccip.dev/story/42.png', 'LINK MARINE #0042 · SERGEY-PEPE-LINKPILLED · Enlist: t.me/ccipdevbot/marines']);
  });

  it('shares the Marine’s page through Telegram’s share sheet', () => {
    // #then
    expect(shareLink(MARINE)).toBe(`https://t.me/share/url?url=${encodeURIComponent('https://ccip.dev/marines/0042/')}&text=${encodeURIComponent('LINK MARINE #0042 · sergey-pepe-linkpilled · RARE')}`);
  });
});

describe('the Mini App API client', () => {
  it('sends the launch data in a POST body, never in the URL', async () => {
    // #given
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(ON_NEW));
    }) as unknown as typeof fetch;
    // #when
    const answer = await tgApi('query_id=1&hash=abc', fetchFn).session();
    // #then
    expect([answer, seen[0]!.url, seen[0]!.init.method, JSON.parse(seen[0]!.init.body as string)]).toEqual([ON_NEW, 'https://discord.ccip.dev/tg/session', 'POST', { initData: 'query_id=1&hash=abc' }]);
  });

  it('gives null for the card while it is stamping, and the gate or the switch as answers, not errors', async () => {
    // #given
    const answering = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    // #when
    const results = [await tgApi('x', answering(202, { stamping: true })).card(), await tgApi('x', answering(403, { gate: 'join' })).enlist(), await tgApi('x', answering(409, { switch: 'off' })).enlist()];
    // #then
    expect(results).toEqual([null, { gate: 'join' }, { switch: 'off' }]);
  });

  describe('when the Worker refuses', () => {
    const LAUNCH = 'query_id=SECRET&hash=abc';
    /** A Worker that echoes the request body into its refusal, so an error that quoted the body would carry the launch data. */
    const refusing = (status: number) => (async (_url: string, init: RequestInit) => new Response(JSON.stringify({ error: 'refused', echo: init.body }), { status })) as unknown as typeof fetch;
    const failure = (call: 'session' | 'enlist' | 'card', status: number) =>
      tgApi(LAUNCH, refusing(status))
        [call]()
        .then(
          () => 'resolved',
          (err: Error) => err.message,
        );

    it('throws on bad launch data, a failed draw and a server error, for the session and the enlist alike', async () => {
      // #when
      const messages = await Promise.all([401, 503, 500].flatMap((status) => [failure('session', status), failure('enlist', status)]));
      // #then
      expect(messages).toEqual(['session: HTTP 401', 'enlist: HTTP 401', 'session: HTTP 503', 'enlist: HTTP 503', 'session: HTTP 500', 'enlist: HTTP 500']);
    });

    it('throws on a card for the switch off or no Marine', async () => {
      // #then
      expect(await Promise.all([failure('card', 409), failure('card', 404)])).toEqual(['card: HTTP 409', 'card: HTTP 404']);
    });

    it('never puts the launch data in an error', async () => {
      // #when
      const messages = await Promise.all([401, 413, 503, 500].flatMap((status) => [failure('session', status), failure('enlist', status), failure('card', status)]));
      // #then
      expect(messages.filter((message) => message.includes(LAUNCH) || message.includes('SECRET'))).toEqual([]);
    });
  });

  it('gives the card as the Blob it was sent, a PNG or a glint’s GIF', async () => {
    // #given
    const sending = (type: string) => (async () => new Response(new Blob(['card'], { type }), { status: 200 })) as unknown as typeof fetch;
    // #when
    const cards = await Promise.all(['image/png', 'image/gif'].map((type) => tgApi('x', sending(type)).card()));
    // #then
    expect(cards.map((card) => [card instanceof Blob, card?.type, card?.size])).toEqual([
      [true, 'image/png', 4],
      [true, 'image/gif', 4],
    ]);
  });
});

describe('where MY DOG TAG and Back go', () => {
  it('pops back to the dog tag already in the stack, and pushes one only when there is none', () => {
    // #given
    const roster: Screen = { name: 'roster', marine: null, tag: null };
    // #then
    expect([toDogTag([{ name: 'dogtag' }, roster]), toDogTag([roster, { name: 'dogtag' }, roster]), toDogTag([roster])]).toEqual([[{ name: 'dogtag' }], [roster, { name: 'dogtag' }], [roster, { name: 'dogtag' }]]);
  });

  it('shows Back with somewhere to go back to, a sheet to close, and never during the draw', () => {
    // #then
    expect([backVisible('roster', 1, false), backVisible('roster', 2, false), backVisible('roster', 1, true), backVisible('draw', 2, false), backVisible('draw', 1, true), backVisible(null, 0, false)]).toEqual([false, true, true, false, false, false]);
  });
});
