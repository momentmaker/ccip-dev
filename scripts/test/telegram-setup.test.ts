import { describe, expect, it } from 'vitest';
import { botUrl, callBot, checkSecret, ownerHasNotStarted, ownerIdFrom, packDoesNotExist, setupCalls, type BotAnswer } from '../telegram/requests';

describe('pnpm telegram:setup', () => {
  it('sets the webhook with its secret and two update kinds, the /start command and the menu button, then checks the owner and Vol. 1', () => {
    // #when
    const calls = setupCalls('s3cret_-', 4242424242);
    // #then
    expect(calls).toEqual([
      { method: 'setWebhook', body: { url: 'https://discord.ccip.dev/telegram', secret_token: 's3cret_-', allowed_updates: ['message', 'my_chat_member'], drop_pending_updates: true } },
      { method: 'setMyCommands', body: { commands: [{ command: 'start', description: 'Enlist and get your LinkMarine dog tag' }] } },
      { method: 'setChatMenuButton', body: { menu_button: { type: 'web_app', text: 'LinkMarines', web_app: { url: 'https://ccip.dev/tg/' } } } },
      { method: 'getChat', body: { chat_id: 4242424242 } },
      { method: 'getStickerSet', body: { name: 'linkmarines_by_ccipdevbot' } },
    ]);
  });

  it("reads the owner's id from the Worker's config, and refuses an empty one", () => {
    // #then
    expect(ownerIdFrom('[vars]\nTELEGRAM_STICKER_OWNER_ID = "4242424242"\n')).toBe(4242424242);
    expect(() => ownerIdFrom('[vars]\nTELEGRAM_STICKER_OWNER_ID = ""\n')).toThrow('set [vars] TELEGRAM_STICKER_OWNER_ID');
  });

  it('tells an owner without an id to read it from getUpdates, since /id answers nothing before setup', () => {
    // #when
    const refusal = () => ownerIdFrom('[vars]\nTELEGRAM_STICKER_OWNER_ID = ""\n');
    // #then
    expect(refusal).toThrow('getUpdates');
    expect(refusal).not.toThrow('/id');
  });

  it('refuses an owner id that is not a quoted string of digits, since the Worker reads the var as text', () => {
    // #then
    expect(() => ownerIdFrom('[vars]\nTELEGRAM_STICKER_OWNER_ID = 4242424242\n')).toThrow('set [vars] TELEGRAM_STICKER_OWNER_ID');
    expect(() => ownerIdFrom('[vars]\nTELEGRAM_STICKER_OWNER_ID = "owner"\n')).toThrow('set [vars] TELEGRAM_STICKER_OWNER_ID');
    expect(() => ownerIdFrom('name = "ccip-dev-discord"\n')).toThrow('set [vars] TELEGRAM_STICKER_OWNER_ID');
  });

  it('refuses a webhook secret Telegram would refuse', () => {
    // #then
    expect(checkSecret('a'.repeat(64))).toBe('a'.repeat(64));
    for (const bad of [undefined, 'has space', 'x'.repeat(257)]) expect(() => checkSecret(bad)).toThrow('TELEGRAM_WEBHOOK_SECRET');
  });

  it('takes a secret of exactly 256 characters and refuses an empty one or one a character longer', () => {
    // #then
    expect(checkSecret('a'.repeat(256))).toBe('a'.repeat(256));
    for (const bad of ['', 'a'.repeat(257)]) expect(() => checkSecret(bad)).toThrow('TELEGRAM_WEBHOOK_SECRET');
  });

  it("calls the bot's own URL", () => {
    // #then
    expect(botUrl('123:abc', 'getMe')).toBe('https://api.telegram.org/bot123:abc/getMe');
  });
});

describe('calling the Bot API', () => {
  const call = { method: 'setWebhook', body: { url: 'https://discord.ccip.dev/telegram' } };

  it("POSTs the call's body as JSON to the bot's URL and returns Telegram's answer", async () => {
    // #given
    const seen: { url: string; init: RequestInit }[] = [];
    const send = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return Response.json({ ok: false, description: 'Bad Request: bad webhook' }, { status: 400 });
    }) as unknown as typeof fetch;
    // #when
    const answer = await callBot('123:abc', call, send);
    // #then
    expect({ seen, answer }).toEqual({
      seen: [{ url: 'https://api.telegram.org/bot123:abc/setWebhook', init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(call.body) } }],
      answer: { ok: false, description: 'Bad Request: bad webhook', status: 400 },
    });
  });

  it('keeps the token out of the error when the request itself fails', async () => {
    // #given
    const send = (async (url: string) => {
      throw new TypeError(`fetch failed: ${url}`);
    }) as unknown as typeof fetch;
    // #when
    const failure = callBot('123:abc', call, send);
    // #then
    await expect(failure).rejects.toThrow(/^setWebhook: request failed \(TypeError\)$/);
    await expect(failure).rejects.not.toHaveProperty('cause');
  });

  it('answers not-ok with the HTTP status when Telegram does not answer in JSON', async () => {
    // #given
    const send = (async () => new Response('<html>Bad Gateway</html>', { status: 502 })) as unknown as typeof fetch;
    // #when
    const answer = await callBot('123:abc', call, send);
    // #then
    expect(answer).toEqual({ ok: false, status: 502 });
  });
});

describe('reading what Telegram answered', () => {
  const answer = (status: number, description?: string): BotAnswer => ({ ok: false, status, description });

  it('takes a 400 for an unknown chat or user as the sticker owner not having started the bot', () => {
    // #then
    expect([answer(400, 'Bad Request: chat not found'), answer(400, 'Bad Request: user not found')].map(ownerHasNotStarted)).toEqual([true, true]);
  });

  it('does not take a block, a rate limit or an outage for the owner not having started the bot', () => {
    // #then
    const others = [answer(403, 'Forbidden: bot was blocked by the user'), answer(429, 'Too Many Requests: retry after 5'), answer(400, 'Bad Request: wrong chat_id'), answer(502)];
    expect(others.map(ownerHasNotStarted)).toEqual([false, false, false, false]);
  });

  it('takes STICKERSET_INVALID for Vol. 1 not existing yet', () => {
    // #then
    expect(packDoesNotExist(answer(400, 'Bad Request: STICKERSET_INVALID'))).toBe(true);
  });

  it('does not take a rate limit, an outage or another refusal for Vol. 1 not existing yet', () => {
    // #then
    const others = [answer(429, 'Too Many Requests: retry after 5'), answer(502), answer(400, 'Bad Request: wrong parameter')];
    expect(others.map(packDoesNotExist)).toEqual([false, false, false]);
  });
});
