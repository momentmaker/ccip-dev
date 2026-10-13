import { fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { sendTelegramPhoto, sendTelegramPoll, sendTelegramVideo, stopTelegramPoll } from '../src/telegram';

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
      filename: (photo as File).name,
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
      body: { chat_id: '@ccipdev', caption: '<b>hi</b>', parse_mode: 'HTML', type: 'image/png', filename: 'card.png', bytes: [137, 80, 78, 71] },
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
      first: { chat_id: '@ccipdev', caption: '<b>hi</b>', parse_mode: 'HTML', type: 'image/png', filename: 'card.png', bytes: [137, 80, 78, 71] },
      second: { chat_id: '@ccipdev', caption: '<b>hi</b>', parse_mode: 'HTML', type: 'image/png', filename: 'card.png', bytes: [137, 80, 78, 71] },
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

describe('sendTelegramPoll', () => {
  const POLL = { question: 'Which chain will pay the most CCIP fees this week?', options: ['Base', 'BNB Chain', 'Ethereum', 'Another chain'] };

  it('sends an anonymous poll as JSON, with no close time, and returns its message id', async () => {
    // #given
    const fetch = fakeFetch(() => jsonResponse({ ok: true, result: { message_id: 812, poll: { id: 'p' } } }));
    // #when
    const sent = await sendTelegramPoll({ fetch, sleep: async () => {} }, CONFIG, POLL);
    // #then
    const init = fetch.calls[0]?.init;
    expect({ sent, url: fetch.calls[0]?.url, headers: init?.headers, body: JSON.parse(String(init?.body)) }).toEqual({
      sent: { messageId: 812 },
      url: 'https://api.telegram.org/botsecret-token/sendPoll',
      headers: { 'content-type': 'application/json' },
      body: {
        chat_id: '@ccipdev', question: POLL.question, is_anonymous: true,
        options: [{ text: 'Base' }, { text: 'BNB Chain' }, { text: 'Ethereum' }, { text: 'Another chain' }],
      },
    });
  });

  it("waits Telegram's retry_after once after a 429, and names the error but not the token when it fails", async () => {
    // #given
    let calls = 0;
    const retried = fakeFetch(() => (++calls === 1 ? jsonResponse({ ok: false, parameters: { retry_after: 3 } }, 429) : jsonResponse({ ok: true, result: { message_id: 9 } })));
    const refused = fakeFetch(() => jsonResponse({ ok: false, description: 'Bad Request: poll options must be non-empty' }, 400));
    const sleep = vi.fn(async () => {});
    // #when
    const results = [await sendTelegramPoll({ fetch: retried, sleep }, CONFIG, POLL), await sendTelegramPoll({ fetch: refused, sleep }, CONFIG, POLL)];
    // #then
    expect({ results, waits: sleep.mock.calls }).toEqual({
      results: [{ messageId: 9 }, { problem: 'Telegram returned HTTP 400: Bad Request: poll options must be non-empty' }],
      waits: [[3000]],
    });
  });

  it('reports an answer without a message id, and a request that never answers', async () => {
    // #given
    const odd = fakeFetch(() => jsonResponse({ ok: true, result: true }));
    const silent = fakeFetch((_url, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))));
    // #when
    const results = [await sendTelegramPoll({ fetch: odd, sleep: async () => {} }, CONFIG, POLL), await sendTelegramPoll({ fetch: silent, sleep: async () => {} }, CONFIG, POLL, 20)];
    // #then
    expect(results).toEqual([{ problem: 'Telegram answered without a message id' }, { problem: 'Telegram request failed (TimeoutError)' }]);
  });
});

describe('stopTelegramPoll', () => {
  it("closes the poll and returns each option's voter count in order and the total", async () => {
    // #given
    const fetch = fakeFetch(() =>
      jsonResponse({ ok: true, result: { id: 'p', is_closed: true, total_voter_count: 13, options: [{ text: 'Base', voter_count: 5 }, { text: 'BNB Chain', voter_count: 8 }] } }),
    );
    // #when
    const closed = await stopTelegramPoll({ fetch, sleep: async () => {} }, CONFIG, 812);
    // #then
    expect({ closed, url: fetch.calls[0]?.url, body: JSON.parse(String(fetch.calls[0]?.init?.body)) }).toEqual({
      closed: { voters: [5, 8], total: 13 },
      url: 'https://api.telegram.org/botsecret-token/stopPoll',
      body: { chat_id: '@ccipdev', message_id: 812 },
    });
  });

  it('reports a poll whose message was deleted or that was already closed as unavailable, and an answer without counts or a refusal as a problem', async () => {
    // #given
    const answer = (description: string) => fakeFetch(() => jsonResponse({ ok: false, error_code: 400, description }, 400));
    const fetches = [
      answer('Bad Request: message with poll to stop not found'),
      answer('Bad Request: poll has already been closed'),
      fakeFetch(() => jsonResponse({ ok: true, result: { options: [{ text: 'Base' }] } })),
      answer('Bad Request: chat not found'),
    ];
    // #when
    const results = await Promise.all(fetches.map((fetch) => stopTelegramPoll({ fetch, sleep: async () => {} }, CONFIG, 812)));
    // #then
    expect(results).toEqual([
      { unavailable: 'Telegram returned HTTP 400: Bad Request: message with poll to stop not found' },
      { unavailable: 'Telegram returned HTTP 400: Bad Request: poll has already been closed' },
      { problem: 'Telegram answered without vote counts' },
      { problem: 'Telegram returned HTTP 400: Bad Request: chat not found' },
    ]);
  });
});

describe('sendTelegramVideo', () => {
  const MP4 = new Blob([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], { type: 'video/mp4' });
  const VIDEO = { video: MP4, filename: 'ccip-2026-09.mp4', caption: '<b>CCIP in September 2026</b>', parseMode: 'HTML' as const, width: 1080, height: 1080, durationS: 30 };
  const fields = async (init?: RequestInit) => {
    const form = await new Response(init?.body, { headers: init?.headers }).formData();
    const video = form.get('video') as File;
    return {
      chat_id: form.get('chat_id'), caption: form.get('caption'), parse_mode: form.get('parse_mode'), width: form.get('width'), height: form.get('height'),
      duration: form.get('duration'), supports_streaming: form.get('supports_streaming'), filename: video.name, type: video.type, bytes: video.size,
    };
  };

  it('uploads the video as multipart with its caption, size, duration and streaming flag', async () => {
    // #given
    const fetch = fakeFetch(() => jsonResponse({ ok: true, result: { message_id: 5 } }));
    // #when
    const failure = await sendTelegramVideo({ fetch, sleep: async () => {} }, CONFIG, VIDEO);
    // #then
    expect({ failure, url: fetch.calls[0]?.url, body: await fields(fetch.calls[0]?.init) }).toEqual({
      failure: null,
      url: 'https://api.telegram.org/botsecret-token/sendVideo',
      body: {
        chat_id: '@ccipdev', caption: '<b>CCIP in September 2026</b>', parse_mode: 'HTML', width: '1080', height: '1080', duration: '30', supports_streaming: 'true',
        filename: 'ccip-2026-09.mp4', type: 'video/mp4', bytes: 8,
      },
    });
  });

  it("re-sends the whole video once after a 429, and names Telegram's refusal but not the token", async () => {
    // #given
    let calls = 0;
    const retried = fakeFetch(() => (++calls === 1 ? jsonResponse({ ok: false, parameters: { retry_after: 2 } }, 429) : jsonResponse({ ok: true, result: {} })));
    const refused = fakeFetch(() => jsonResponse({ ok: false, description: 'Request Entity Too Large' }, 413));
    const sleep = vi.fn(async () => {});
    // #when
    const results = [await sendTelegramVideo({ fetch: retried, sleep }, CONFIG, VIDEO), await sendTelegramVideo({ fetch: refused, sleep }, CONFIG, VIDEO)];
    // #then
    expect({ results, waits: sleep.mock.calls, second: await fields(retried.calls[1]?.init) }).toEqual({
      results: [null, 'Telegram returned HTTP 413: Request Entity Too Large'],
      waits: [[2000]],
      second: expect.objectContaining({ chat_id: '@ccipdev', caption: '<b>CCIP in September 2026</b>', filename: 'ccip-2026-09.mp4', type: 'video/mp4', bytes: 8 }),
    });
  });
});
