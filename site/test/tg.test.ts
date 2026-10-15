import type { MarineSummary, SessionAnswer } from '@ccip-dev/core/linkmarine';
import { describe, expect, it } from 'vitest';
import { callsignParts, canShareToStory, chanceText, firstScreen, mainButton, MAX_TILT, shareLink, startParam, storyText, storyUrl, tgApi, tierBanner, tilt, tiltOn } from '../src/lib/tg';
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
});
