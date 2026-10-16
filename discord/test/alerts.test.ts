import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAlerter } from '../src/alerts';
import { resetStorage } from './helpers';

beforeEach(resetStorage);

function telegram(status = 200) {
  const sent: { url: string; body: { chat_id: string; text: string } }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url, body: JSON.parse(init!.body as string) });
    return new Response('{}', { status });
  }) as unknown as typeof globalThis.fetch;
  return { sent, fetch };
}

describe('alerts', () => {
  it('sends each signature to the alert chat once an hour', async () => {
    // #given
    const t = telegram();
    let now = Date.parse('2026-10-13T10:00:00.000Z');
    const alert = createAlerter(env.DB, { token: 'bot', chatId: '-100' }, { fetch: t.fetch, now: () => new Date(now) });
    // #when
    await alert('discord-data:today.json', 'today.json: HTTP 503');
    await alert('discord-data:today.json', 'today.json: HTTP 503');
    await alert('discord-render:sitrep', 'the sitrep card failed');
    now += 3_600_000;
    await alert('discord-data:today.json', 'today.json: HTTP 503');
    // #then
    expect(t.sent.map((s) => [s.url, s.body.chat_id, s.body.text])).toEqual([
      ['https://api.telegram.org/botbot/sendMessage', '-100', 'ccip.dev discord alert: today.json: HTTP 503'],
      ['https://api.telegram.org/botbot/sendMessage', '-100', 'ccip.dev discord alert: the sitrep card failed'],
      ['https://api.telegram.org/botbot/sendMessage', '-100', 'ccip.dev discord alert: today.json: HTTP 503'],
    ]);
  });

  it('labels LinkMarines on Telegram alerts telegram, and the rest discord', async () => {
    // #given
    const t = telegram();
    const alert = createAlerter(env.DB, { token: 'bot', chatId: '-100' }, { fetch: t.fetch, now: () => new Date('2026-10-13T10:00:00.000Z') });
    // #when
    await alert('telegram-sticker:7', "Marine #7's sticker: uploadStickerFile 400 Bad Request");
    await alert('discord-command:enlist', '/enlist failed');
    // #then
    expect(t.sent.map((s) => s.body.text)).toEqual(["ccip.dev telegram alert: Marine #7's sticker: uploadStickerFile 400 Bad Request", 'ccip.dev discord alert: /enlist failed']);
  });

  it('lets the next alert retry when Telegram fails, and only logs without the secrets', async () => {
    // #given
    const down = telegram(502);
    const up = telegram();
    const now = () => new Date('2026-10-13T10:00:00.000Z');
    // #when
    await createAlerter(env.DB, { token: 'bot', chatId: '-100' }, { fetch: down.fetch, now })('discord-memes', 'GitHub is down');
    await createAlerter(env.DB, { token: 'bot', chatId: '-100' }, { fetch: up.fetch, now })('discord-memes', 'GitHub is down');
    await createAlerter(env.DB, {}, { fetch: up.fetch, now })('discord-draw', 'every draw clashed');
    // #then
    expect([down.sent.length, up.sent.length]).toEqual([1, 1]);
  });

  it('never throws, even when the database or Telegram is down', async () => {
    // #given
    const brokenDb = { prepare: () => { throw new Error('D1 is down'); } } as unknown as D1Database;
    const refusing = (async () => { throw new Error('offline'); }) as unknown as typeof globalThis.fetch;
    const now = () => new Date('2026-10-13T10:00:00.000Z');
    // #when
    const results = await Promise.allSettled([
      createAlerter(brokenDb, { token: 'bot', chatId: '-100' }, { fetch: refusing, now })('discord-draw', 'x'),
      createAlerter(env.DB, { token: 'bot', chatId: '-100' }, { fetch: refusing, now })('discord-memes', 'y'),
    ]);
    // #then
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
  });
});
