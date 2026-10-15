import { describe, expect, it } from 'vitest';
import { telegramApi } from '../src/telegram-api';

const TOKEN = '123456:SECRET';

/** A fetch answering one canned response, recording each request. */
function answering(res: () => Response | Promise<Response>) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return res();
  }) as typeof fetch;
  return { requests, fetchFn };
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the Telegram Bot API client', () => {
  it('posts JSON to the method and hands back the result', async () => {
    // #given
    const t = answering(() => reply({ ok: true, result: { status: 'member' } }));
    // #when
    const got = await telegramApi(TOKEN, t.fetchFn).call<{ status: string }>('getChatMember', { chat_id: '@ccipdev', user_id: 7 });
    // #then
    expect({ got, url: t.requests[0]!.url, body: JSON.parse(t.requests[0]!.init!.body as string) }).toEqual({
      got: { ok: true, result: { status: 'member' } },
      url: `https://api.telegram.org/bot${TOKEN}/getChatMember`,
      body: { chat_id: '@ccipdev', user_id: 7 },
    });
  });

  it("reports Telegram's refusal and a 429's retry_after, never waiting", async () => {
    // #given
    const refused = answering(() => reply({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }, 400));
    const limited = answering(() => reply({ ok: false, error_code: 429, description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } }, 429));
    // #when
    const results = [await telegramApi(TOKEN, refused.fetchFn).call('getChat', {}), await telegramApi(TOKEN, limited.fetchFn).call('addStickerToSet', {})];
    // #then
    expect({ results, calls: limited.requests.length }).toEqual({
      results: [
        { ok: false, status: 400, description: 'Bad Request: chat not found', retryAfter: null },
        { ok: false, status: 429, description: 'Too Many Requests: retry after 7', retryAfter: 7 },
      ],
      calls: 1,
    });
  });

  it('turns a failed request into a result that never names the token', async () => {
    // #given
    const t = answering(() => Promise.reject(new TypeError(`fetch to https://api.telegram.org/bot${TOKEN}/x failed`)));
    // #when
    const got = await telegramApi(TOKEN, t.fetchFn).call('getMe', {});
    // #then
    expect([got, JSON.stringify(got).includes('SECRET')]).toEqual([{ ok: false, status: 0, description: 'request failed (TypeError)', retryAfter: null }, false]);
  });

  it('uploads a file as multipart beside its fields', async () => {
    // #given
    const t = answering(() => reply({ ok: true, result: { file_id: 'F1' } }));
    // #when
    await telegramApi(TOKEN, t.fetchFn).upload('uploadStickerFile', { user_id: '42', sticker_format: 'static' }, { field: 'sticker', name: 'marine-7.png', type: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
    // #then
    const form = t.requests[0]!.init!.body as FormData;
    const file = form.get('sticker') as File;
    expect([form.get('user_id'), form.get('sticker_format'), file.name, file.type, [...new Uint8Array(await file.arrayBuffer())]]).toEqual(['42', 'static', 'marine-7.png', 'image/png', [1, 2, 3]]);
  });

  it("downloads a file by getFile's path, or gives null", async () => {
    // #given
    const found = answering(() => new Response(new Uint8Array([9, 8])));
    const missing = answering(() => new Response('no', { status: 404 }));
    // #when
    const got = [await telegramApi(TOKEN, found.fetchFn).download('photos/file_1.jpg'), await telegramApi(TOKEN, missing.fetchFn).download('photos/x.jpg')];
    // #then
    expect([got[0] && [...got[0]], got[1], found.requests[0]!.url]).toEqual([[9, 8], null, `https://api.telegram.org/file/bot${TOKEN}/photos/file_1.jpg`]);
  });

  it('turns a hostile upload into a failure result, never a throw', async () => {
    // #given
    const t = answering(() => reply({ ok: true, result: {} }));
    const fields = {
      get user_id(): string {
        throw new Error('unreadable field');
      },
    };
    // #when
    const got = await telegramApi(TOKEN, t.fetchFn).upload('uploadStickerFile', fields, { field: 'sticker', name: 's.png', type: 'image/png', bytes: new Uint8Array() });
    // #then
    expect([got, t.requests.length]).toEqual([{ ok: false, status: 0, description: 'request failed (Error)', retryAfter: null }, 0]);
  });

  it('keeps the real status when Telegram, or a proxy, answers with a JSON null', async () => {
    // #given
    const t = answering(() => reply(null, 502));
    // #when
    const got = await telegramApi(TOKEN, t.fetchFn).call('getMe', {});
    // #then
    expect(got).toEqual({ ok: false, status: 502, description: 'HTTP 502', retryAfter: null });
  });

  it('gives up on a request that outlasts its timeout: a failure result, or null, never a throw', async () => {
    // #given a fetch that only ever ends by being aborted
    const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)))) as typeof fetch;
    const api = telegramApi(TOKEN, hanging);
    // #when
    const results = await Promise.all([api.call('getMe', {}, 10), api.upload('uploadStickerFile', {}, { field: 'sticker', name: 's.png', type: 'image/png', bytes: new Uint8Array() }, 10), api.download('photos/x.jpg', 10)]);
    // #then
    expect(results).toEqual([
      { ok: false, status: 0, description: 'request failed (TimeoutError)', retryAfter: null },
      { ok: false, status: 0, description: 'request failed (TimeoutError)', retryAfter: null },
      null,
    ]);
  });
});
