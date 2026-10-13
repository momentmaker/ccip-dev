import { fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { createPost, oauth1Header, uploadImage, uploadVideo, X_PROCESSING_WAIT_S, X_RETRY_CAP_S, X_VIDEO_CHUNK_BYTES, type XCredentials } from '../src/x';

const CREDS: XCredentials = { apiKey: 'api-key-1', apiSecret: 'api-secret-2', accessToken: 'access-token-3', accessSecret: 'access-secret-4' };
const PNG = new Uint8Array([137, 80, 78, 71]);
const NOW_MS = 1_800_000_000_000;
const deps = (fetch: ReturnType<typeof fakeFetch>, sleep: (ms: number) => Promise<void> = async () => {}) => ({ fetch, sleep, clock: () => NOW_MS });
const authOf = (init?: RequestInit) => (init?.headers as Record<string, string>).authorization ?? '';
const param = (header: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(header)?.[1];

describe('oauth1Header', () => {
  it('signs the worked example of X\'s "Creating a signature" page', async () => {
    // #given the page's consumer and token secrets, with its status and include_entities as query params
    const creds: XCredentials = {
      apiKey: 'xvz1evFS4wEEPTGEFPHBog',
      apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
      accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
      accessSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
    };
    const url = 'https://api.x.com/1.1/statuses/update.json?include_entities=true&status=Hello%20Ladies%20%2B%20Gentlemen%2C%20a%20signed%20OAuth%20request%21';
    // #when
    const header = await oauth1Header('POST', url, creds, { nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: '1318622958' });
    // #then
    expect(decodeURIComponent(param(header, 'oauth_signature') ?? '')).toBe('Ls93hJiZbQ3akF3HF3x1Bz8/zU4=');
  });

  it('writes the OAuth scheme with percent-encoded fields and no secret', async () => {
    // #when
    const header = await oauth1Header('POST', 'https://api.x.com/2/tweets', CREDS, { nonce: 'n0nce', timestamp: '1700000000' });
    // #then
    expect({
      scheme: header.startsWith('OAuth '),
      fields: ['oauth_consumer_key', 'oauth_nonce', 'oauth_signature_method', 'oauth_timestamp', 'oauth_token', 'oauth_version'].map((n) => param(header, n)),
      secrets: header.includes(CREDS.apiSecret) || header.includes(CREDS.accessSecret),
    }).toEqual({ scheme: true, fields: ['api-key-1', 'n0nce', 'HMAC-SHA1', '1700000000', 'access-token-3', '1.0'], secrets: false });
  });

  it('percent-encodes the reserved characters !*\'() that encodeURIComponent leaves', async () => {
    // #given a signature that differs only by a token carrying those characters
    const plain = await oauth1Header('POST', 'https://api.x.com/2/tweets', CREDS, { nonce: 'n', timestamp: '1' });
    const odd = await oauth1Header('POST', 'https://api.x.com/2/tweets', { ...CREDS, accessToken: "t!*'()" }, { nonce: 'n', timestamp: '1' });
    // #then
    expect({ token: param(odd, 'oauth_token'), differs: param(odd, 'oauth_signature') !== param(plain, 'oauth_signature') }).toEqual({ token: 't%21%2A%27%28%29', differs: true });
  });
});

describe('uploadImage', () => {
  it('posts the card as multipart to /2/media/upload with a signed header and no content-type', async () => {
    // #given
    const fetch = fakeFetch(() => jsonResponse({ data: { id: '1234', media_key: '3_1234' } }));
    // #when
    const result = await uploadImage(deps(fetch), CREDS, PNG);
    // #then
    const init = fetch.calls[0]?.init;
    const form = init?.body as FormData;
    const media = form.get('media') as File;
    expect({
      result,
      url: fetch.calls[0]?.url,
      method: init?.method,
      auth: authOf(init).startsWith('OAuth '),
      headerNames: Object.keys(init?.headers as object),
      category: form.get('media_category'),
      type: media.type,
      filename: media.name,
      bytes: [...new Uint8Array(await media.arrayBuffer())],
    }).toEqual({
      result: { mediaId: '1234' },
      url: 'https://api.x.com/2/media/upload',
      method: 'POST',
      auth: true,
      headerNames: ['authorization'],
      category: 'tweet_image',
      type: 'image/png',
      filename: 'card.png',
      bytes: [137, 80, 78, 71],
    });
  });

  it.each([
    ['data.id', { data: { id: 'a' } }, 'a'],
    ['id', { id: 'b' }, 'b'],
    ['media_id_string', { media_id_string: 'c' }, 'c'],
  ])('reads the media id from %s', async (_name, body, mediaId) => {
    // #when
    const result = await uploadImage(deps(fakeFetch(() => jsonResponse(body))), CREDS, PNG);
    // #then
    expect(result).toEqual({ mediaId });
  });

  it('reports a success without a media id as a problem to retry, since uploads are not public', async () => {
    // #when
    const result = await uploadImage(deps(fakeFetch(() => jsonResponse({ data: {} }))), CREDS, PNG);
    // #then
    expect(result).toEqual({ problem: expect.stringContaining('media id'), outage: false });
  });

  it('does not accept a numeric media id, which would have lost precision', async () => {
    // #when
    const result = await uploadImage(deps(fakeFetch(() => jsonResponse({ data: { id: 1234567890123456789 } }))), CREDS, PNG);
    // #then
    expect(result).toMatchObject({ problem: expect.stringContaining('media id') });
  });
});

describe('createPost', () => {
  it('posts JSON with the text and media ids to /2/tweets', async () => {
    // #given
    const fetch = fakeFetch(() => jsonResponse({ data: { id: '999', text: 't', edit_history_post_ids: ['999'] } }, 201));
    // #when
    const result = await createPost(deps(fetch), CREDS, { text: 'hello #CCIP', mediaIds: ['1234'] });
    // #then
    const init = fetch.calls[0]?.init;
    expect({
      result,
      url: fetch.calls[0]?.url,
      method: init?.method,
      auth: authOf(init).startsWith('OAuth '),
      contentType: (init?.headers as Record<string, string>)['content-type'],
      body: JSON.parse(String(init?.body)),
    }).toEqual({
      result: { postId: '999' },
      url: 'https://api.x.com/2/tweets',
      method: 'POST',
      auth: true,
      contentType: 'application/json',
      body: { text: 'hello #CCIP', media: { media_ids: ['1234'] } },
    });
  });

  it.each([
    ['sends no id', () => jsonResponse({}, 201)],
    ['sends a body that is not JSON', () => new Response('<html>', { status: 201 })],
    ['sends a numeric id', () => jsonResponse({ data: { id: 1234567890123456789 } }, 201)],
  ])('counts a 2xx that %s as posted with an unknown id, because the post exists', async (_name, respond) => {
    // #given
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // #when
    const result = await createPost(deps(fakeFetch(respond)), CREDS, { text: 't', mediaIds: ['1'] });
    const logged = log.mock.calls.length;
    log.mockRestore();
    // #then
    expect({ result, logged }).toEqual({ result: { postId: 'unknown' }, logged: 1 });
  });

  it('counts a 2xx whose body read times out as posted with an unknown id', async () => {
    // #given
    const res = jsonResponse({}, 201);
    vi.spyOn(res, 'json').mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // #when
    const result = await createPost(deps(fakeFetch(() => res)), CREDS, { text: 't', mediaIds: ['1'] });
    log.mockRestore();
    // #then
    expect(result).toEqual({ postId: 'unknown' });
  });

  it('answers a 403 duplicate-content refusal as a duplicate, by its detail or its title', async () => {
    // #when
    const byDetail = await createPost(deps(fakeFetch(() => jsonResponse({ title: 'Forbidden', detail: 'You are not allowed to create a Tweet with duplicate content.' }, 403))), CREDS, { text: 't', mediaIds: ['1'] });
    const byTitle = await createPost(deps(fakeFetch(() => jsonResponse({ title: 'Duplicate content' }, 403))), CREDS, { text: 't', mediaIds: ['1'] });
    const otherForbidden = await createPost(deps(fakeFetch(() => jsonResponse({ detail: 'Forbidden' }, 403))), CREDS, { text: 't', mediaIds: ['1'] });
    const duplicateOn400 = await createPost(deps(fakeFetch(() => jsonResponse({ detail: 'duplicate' }, 400))), CREDS, { text: 't', mediaIds: ['1'] });
    // #then
    expect({ byDetail, byTitle, otherForbidden, duplicateOn400 }).toEqual({
      byDetail: { duplicate: true },
      byTitle: { duplicate: true },
      otherForbidden: { problem: 'X returned HTTP 403: Forbidden', outage: false },
      duplicateOn400: { problem: 'X returned HTTP 400: duplicate', outage: false },
    });
  });
});

describe('request failures', () => {
  it.each([[400, false], [401, false], [403, false], [404, false], [408, false], [429, false], [500, true], [503, true]])('marks HTTP %i as an X outage: %s', async (status, outage) => {
    // #when
    const result = await createPost(deps(fakeFetch(() => jsonResponse({ title: 'Nope' }, status))), CREDS, { text: 't', mediaIds: ['1'] });
    // #then
    expect(result).toMatchObject({ outage });
  });

  it('names the status and X\'s detail, cut to 200 characters, and leaks no credential, header or key', async () => {
    // #given
    const fetch = fakeFetch(() => jsonResponse({ title: 'Forbidden', detail: `denied ${'x'.repeat(400)}` }, 403));
    // #when
    const result = await createPost(deps(fetch), CREDS, { text: 't', mediaIds: ['1'] });
    // #then
    const problem = 'problem' in result ? result.problem : '';
    expect({
      status: problem.includes('403'),
      detail: problem.includes('denied xxx'),
      capped: problem.length < 260,
      leaks: [CREDS.apiKey, CREDS.apiSecret, CREDS.accessToken, CREDS.accessSecret, 'OAuth', 'api.x.com'].filter((s) => problem.includes(s)),
    }).toEqual({ status: true, detail: true, capped: true, leaks: [] });
  });

  it('falls back to the title when X sends no detail', async () => {
    // #when
    const result = await createPost(deps(fakeFetch(() => jsonResponse({ title: 'Unauthorized' }, 401))), CREDS, { text: 't', mediaIds: ['1'] });
    // #then
    expect(result).toEqual({ problem: 'X returned HTTP 401: Unauthorized', outage: false });
  });

  it('reports a network error by its name only, as retryable', async () => {
    // #given
    const fetch = fakeFetch(() => {
      throw new TypeError('connect failed for https://api.x.com/2/tweets');
    });
    // #when
    const result = await uploadImage(deps(fetch), CREDS, PNG);
    // #then
    expect(result).toEqual({ problem: 'X request failed (TypeError)', outage: true });
  });

  it('gives every request a timeout signal', async () => {
    // #given
    const fetch = fakeFetch(() => jsonResponse({ data: { id: '1' } }));
    // #when
    await uploadImage(deps(fetch), CREDS, PNG, 1234);
    // #then
    expect(fetch.calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('429 handling', () => {
  const resetIn = (seconds: number) => String(NOW_MS / 1000 + seconds);

  it('waits until x-rate-limit-reset, then retries once with a fresh signature and a complete body', async () => {
    // #given
    let calls = 0;
    const fetch = fakeFetch(() => (++calls === 1 ? jsonResponse({}, 429, { 'x-rate-limit-reset': resetIn(7) }) : jsonResponse({ data: { id: '55' } })));
    const sleep = vi.fn(async () => {});
    // #when
    const result = await uploadImage(deps(fetch, sleep), CREDS, PNG);
    // #then
    const [first, second] = fetch.calls.map((c) => c.init);
    expect({
      result,
      slept: sleep.mock.calls,
      distinctBodies: first?.body !== second?.body,
      secondBytes: [...new Uint8Array(await ((second?.body as FormData).get('media') as Blob).arrayBuffer())],
      freshNonce: param(authOf(first), 'oauth_nonce') !== param(authOf(second), 'oauth_nonce'),
    }).toEqual({ result: { mediaId: '55' }, slept: [[7000]], distinctBodies: true, secondBytes: [137, 80, 78, 71], freshNonce: true });
  });

  it('waits for a reset exactly 30 seconds away, and drops the first response body before retrying', async () => {
    // #given
    const first = jsonResponse({}, 429, { 'x-rate-limit-reset': resetIn(X_RETRY_CAP_S) });
    const cancel = vi.spyOn(first.body as ReadableStream, 'cancel');
    let calls = 0;
    const fetch = fakeFetch(() => (++calls === 1 ? first : jsonResponse({ data: { id: '1' } }, 201)));
    const sleep = vi.fn(async () => {});
    // #when
    const result = await createPost(deps(fetch, sleep), CREDS, { text: 't', mediaIds: ['1'] });
    // #then
    expect({ result, slept: sleep.mock.calls, cancelled: cancel.mock.calls.length }).toEqual({ result: { postId: '1' }, slept: [[30_000]], cancelled: 1 });
  });

  it('gives up at once when the reset is more than 30 seconds away', async () => {
    // #given
    const fetch = fakeFetch(() => jsonResponse({ title: 'Too Many Requests' }, 429, { 'x-rate-limit-reset': resetIn(900) }));
    const sleep = vi.fn(async () => {});
    // #when
    const result = await createPost(deps(fetch, sleep), CREDS, { text: 't', mediaIds: ['1'] });
    // #then
    expect({ result, calls: fetch.calls.length, slept: sleep.mock.calls.length }).toEqual({ result: { problem: 'X returned HTTP 429: Too Many Requests', outage: false }, calls: 1, slept: 0 });
  });

  it('gives up without waiting when X sends no reset time', async () => {
    // #given
    const fetch = fakeFetch(() => jsonResponse({ title: 'Too Many Requests' }, 429));
    const sleep = vi.fn(async () => {});
    // #when
    const result = await createPost(deps(fetch, sleep), CREDS, { text: 't', mediaIds: ['1'] });
    // #then
    expect({ result, calls: fetch.calls.length, slept: sleep.mock.calls.length }).toEqual({ result: { problem: 'X returned HTTP 429: Too Many Requests', outage: false }, calls: 1, slept: 0 });
  });

  it('retries only once', async () => {
    // #given
    const fetch = fakeFetch(() => jsonResponse({}, 429, { 'x-rate-limit-reset': resetIn(1) }));
    // #when
    const result = await createPost(deps(fetch), CREDS, { text: 't', mediaIds: ['1'] });
    // #then
    expect({ calls: fetch.calls.length, result }).toEqual({ calls: 2, result: { problem: 'X returned HTTP 429', outage: false } });
  });
});

describe('uploadVideo', () => {
  /** 9 MB: two full 4 MB segments and a 1 MB one. */
  const MP4 = new Blob([new Uint8Array(2 * X_VIDEO_CHUNK_BYTES + 1024 * 1024)], { type: 'video/mp4' });
  const UPLOAD = 'https://api.x.com/2/media/upload';
  const processing = (state: string, check_after_secs?: number, error?: string) => ({ data: { id: '77', processing_info: { state, check_after_secs, ...(error ? { error: { message: error } } : {}) } } });

  /** X's answers to each step; `status` answers the STATUS polls in turn, its last answer repeating. */
  function xVideo(o: { finalize?: unknown; status?: unknown[]; append?: Response } = {}) {
    let polls = 0;
    return fakeFetch((url) => {
      if (url === `${UPLOAD}/initialize`) return jsonResponse({ data: { id: '77', media_key: '7_77', expires_after_secs: 86_400 } });
      if (url === `${UPLOAD}/77/append`) return o.append?.clone() ?? jsonResponse({ data: { expires_at: 1 } });
      if (url === `${UPLOAD}/77/finalize`) return jsonResponse(o.finalize ?? processing('pending', 5));
      if (url === `${UPLOAD}?command=STATUS&media_id=77`) {
        const answers = o.status ?? [processing('succeeded')];
        return jsonResponse(answers[Math.min(polls++, answers.length - 1)]);
      }
      return undefined;
    });
  }

  it('initializes a tweet_video, appends it in 4 MB segments, finalizes, waits for processing and returns its id', async () => {
    // #given
    const fetch = xVideo({ status: [processing('in_progress', 10), processing('succeeded')] });
    const sleep = vi.fn(async () => {});
    // #when
    const result = await uploadVideo(deps(fetch, sleep), CREDS, MP4);
    // #then
    const appends = fetch.calls.filter((c) => c.url.endsWith('/append')).map((c) => c.init?.body as FormData);
    expect({
      result,
      steps: fetch.calls.map((c) => `${c.init?.method} ${c.url.slice(UPLOAD.length)}`),
      init: JSON.parse(String(fetch.calls[0]?.init?.body)),
      segments: appends.map((f) => [f.get('segment_index'), (f.get('media') as Blob).size]),
      signed: fetch.calls.every((c) => authOf(c.init).startsWith('OAuth ')),
      waits: sleep.mock.calls,
    }).toEqual({
      result: { mediaId: '77' },
      steps: ['POST /initialize', 'POST /77/append', 'POST /77/append', 'POST /77/append', 'POST /77/finalize', 'GET ?command=STATUS&media_id=77', 'GET ?command=STATUS&media_id=77'],
      init: { media_type: 'video/mp4', total_bytes: MP4.size, media_category: 'tweet_video' },
      segments: [['0', X_VIDEO_CHUNK_BYTES], ['1', X_VIDEO_CHUNK_BYTES], ['2', 1024 * 1024]],
      signed: true,
      waits: [[5000], [10_000]],
    });
  });

  it('takes a finalize without processing info as ready', async () => {
    // #given
    const fetch = xVideo({ finalize: { data: { id: '77' } } });
    // #when
    const result = await uploadVideo(deps(fetch), CREDS, MP4);
    // #then
    expect({ result, polled: fetch.calls.some((c) => c.url.includes('STATUS')) }).toEqual({ result: { mediaId: '77' }, polled: false });
  });

  it(`gives up after ${X_PROCESSING_WAIT_S} s of processing, and on processing that failed, neither an outage`, async () => {
    // #given
    const slow = xVideo({ status: [processing('in_progress', 50)] });
    const broken = xVideo({ status: [processing('failed', undefined, 'Unsupported video format')] });
    const sleep = vi.fn(async () => {});
    // #when
    const results = [await uploadVideo(deps(slow, sleep), CREDS, MP4), await uploadVideo(deps(broken), CREDS, MP4)];
    // #then 5 s, then 50, 50 and the last 15 s of the 2 minutes
    expect({ results, waits: sleep.mock.calls.flat() }).toEqual({
      results: [
        { problem: 'X was still processing the video after 120 s', outage: false },
        { problem: 'X could not process the video: Unsupported video format', outage: false },
      ],
      waits: [5000, 50_000, 50_000, 15_000],
    });
  });

  it('names the step that failed, and calls a 5xx an outage', async () => {
    // #given
    const fetch = xVideo({ append: jsonResponse({ title: 'Service Unavailable' }, 503) });
    // #when
    const result = await uploadVideo(deps(fetch), CREDS, MP4);
    // #then nothing after the failed segment is sent
    expect({ result, calls: fetch.calls.length }).toEqual({ result: { problem: 'append 0: X returned HTTP 503: Service Unavailable', outage: true }, calls: 2 });
  });

  it('signs the STATUS poll as a GET over its own URL', async () => {
    // #given
    const fetch = xVideo();
    // #when
    await uploadVideo(deps(fetch), CREDS, MP4);
    // #then
    const poll = fetch.calls.find((c) => c.url.includes('STATUS'));
    const header = authOf(poll?.init);
    const expected = await oauth1Header('GET', `${UPLOAD}?command=STATUS&media_id=77`, CREDS, { nonce: param(header, 'oauth_nonce') ?? '', timestamp: param(header, 'oauth_timestamp') ?? '' });
    expect(header).toBe(expected);
  });

  it('stops at a timeout during an append, as an outage naming the segment', async () => {
    // #given
    let appends = 0;
    const fetch = fakeFetch((url) => {
      if (url === `${UPLOAD}/initialize`) return jsonResponse({ data: { id: '77' } });
      if (url === `${UPLOAD}/77/append` && ++appends === 2) throw new DOMException('timed out', 'TimeoutError');
      if (url === `${UPLOAD}/77/append`) return jsonResponse({ data: {} });
      return undefined;
    });
    // #when
    const result = await uploadVideo(deps(fetch), CREDS, MP4);
    // #then
    expect({ result, calls: fetch.calls.length }).toEqual({ result: { problem: 'append 1: X request failed (TimeoutError)', outage: true }, calls: 3 });
  });
});
