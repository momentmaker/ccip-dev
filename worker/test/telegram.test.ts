import { fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { sendTelegramPhoto } from '../src/telegram';

const CONFIG = { token: 'secret-token', chatId: '@ccipdev' };
const PNG = new Uint8Array([137, 80, 78, 71]);
const PHOTO = { photo: PNG, caption: '<b>hi</b>', parseMode: 'HTML' as const };

describe('sendTelegramPhoto', () => {
  const fields = async (init?: RequestInit) => {
    const form = init?.body as FormData;
    const photo = form.get('photo') as Blob;
    return {
      chat_id: form.get('chat_id'),
      caption: form.get('caption'),
      parse_mode: form.get('parse_mode'),
      type: photo.type,
      bytes: [...new Uint8Array(await photo.arrayBuffer())],
    };
  };

  it('uploads the card as multipart with its caption and parse mode', async () => {
    // #given
    const fetch = fakeFetch(() => jsonResponse({ ok: true, result: {} }));
    // #when
    const failure = await sendTelegramPhoto({ fetch, sleep: async () => {} }, CONFIG, PHOTO);
    // #then
    const init = fetch.calls[0]?.init;
    expect({ failure, url: fetch.calls[0]?.url, isForm: init?.body instanceof FormData, headers: init?.headers, body: await fields(init) }).toEqual({
      failure: null,
      url: 'https://api.telegram.org/botsecret-token/sendPhoto',
      isForm: true,
      headers: undefined,
      body: { chat_id: '@ccipdev', caption: '<b>hi</b>', parse_mode: 'HTML', type: 'image/png', bytes: [137, 80, 78, 71] },
    });
  });

  it('leaves parse_mode out when none is set', async () => {
    // #given
    const fetch = fakeFetch(() => jsonResponse({ ok: true, result: {} }));
    // #when
    await sendTelegramPhoto({ fetch, sleep: async () => {} }, CONFIG, { photo: PNG, caption: 'plain' });
    // #then
    expect((fetch.calls[0]?.init?.body as FormData).has('parse_mode')).toBe(false);
  });

  it('sends a complete second multipart body on the 429 retry', async () => {
    // #given
    let calls = 0;
    const fetch = fakeFetch(() => (++calls === 1 ? jsonResponse({ ok: false, error_code: 429, parameters: { retry_after: 1 } }, 429) : jsonResponse({ ok: true, result: {} })));
    // #when
    const failure = await sendTelegramPhoto({ fetch, sleep: async () => {} }, CONFIG, PHOTO);
    // #then
    const [first, second] = fetch.calls.map((c) => c.init?.body);
    expect({ failure, distinct: first !== second, first: await fields({ body: first }), second: await fields({ body: second }) }).toEqual({
      failure: null,
      distinct: true,
      first: { chat_id: '@ccipdev', caption: '<b>hi</b>', parse_mode: 'HTML', type: 'image/png', bytes: [137, 80, 78, 71] },
      second: { chat_id: '@ccipdev', caption: '<b>hi</b>', parse_mode: 'HTML', type: 'image/png', bytes: [137, 80, 78, 71] },
    });
  });

  it("waits Telegram's retry_after after a 429 and tries once more", async () => {
    // #given
    let calls = 0;
    const fetch = fakeFetch(() => (++calls === 1 ? jsonResponse({ ok: false, error_code: 429, parameters: { retry_after: 5 } }, 429) : jsonResponse({ ok: true, result: {} })));
    const sleep = vi.fn(async () => {});
    // #when
    const failure = await sendTelegramPhoto({ fetch, sleep }, CONFIG, PHOTO);
    // #then
    expect({ failure, calls, waits: sleep.mock.calls }).toEqual({ failure: null, calls: 2, waits: [[5000]] });
  });

  it('caps the wait at 30 s and gives up after the one retry, naming the error but not the token', async () => {
    // #given
    const fetch = fakeFetch(() => jsonResponse({ ok: false, description: 'Too Many Requests: retry after 120', parameters: { retry_after: 120 } }, 429));
    const sleep = vi.fn(async () => {});
    // #when
    const failure = await sendTelegramPhoto({ fetch, sleep }, CONFIG, PHOTO);
    // #then
    expect({ failure, calls: fetch.calls.length, waits: sleep.mock.calls }).toEqual({
      failure: 'Telegram returned HTTP 429: Too Many Requests: retry after 120',
      calls: 2,
      waits: [[30_000]],
    });
  });

  it('gives up on a request that never answers, naming only the error', async () => {
    // #given a fetch that settles only when its signal aborts, with a short timeout in place of the 30 s one
    const fetch = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    // #when
    const failure = await sendTelegramPhoto({ fetch, sleep: async () => {} }, CONFIG, PHOTO, 20);
    // #then
    expect({ failure, signalled: fetch.calls[0]?.init?.signal instanceof AbortSignal }).toEqual({ failure: 'Telegram request failed (TimeoutError)', signalled: true });
  });

  it('reports a failed request without the token', async () => {
    // #given
    const fetch = fakeFetch(async () => {
      throw new TypeError('network down for secret-token');
    });
    // #when
    const failure = await sendTelegramPhoto({ fetch, sleep: async () => {} }, CONFIG, PHOTO);
    // #then
    expect(failure).toBe('Telegram request failed (TypeError)');
  });
});
