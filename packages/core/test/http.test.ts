import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createThrottle, getJson, issuePath, parseWith, UpstreamHttpError, UpstreamSchemaError, USER_AGENT } from '../src/http';
import { fakeFetch, jsonResponse } from '../src/testing';

function deps(fetchFn: typeof fetch) {
  const sleeps: number[] = [];
  return { deps: { fetch: fetchFn, sleep: async (ms: number) => { sleeps.push(ms); }, clock: () => 0 }, sleeps };
}

describe('getJson', () => {
  it('sends the curl user agent and returns parsed JSON', async () => {
    const f = fakeFetch(() => jsonResponse({ ok: true }));
    const { deps: d } = deps(f);
    await expect(getJson(d, 'https://x/a', { endpoint: 'GET /a', maxRetries: 0 })).resolves.toEqual({ ok: true });
    expect(new Headers(f.calls[0]!.init?.headers).get('user-agent')).toBe(USER_AGENT);
  });

  it('retries 503 with exponential backoff, then succeeds', async () => {
    let n = 0;
    const { deps: d, sleeps } = deps(fakeFetch(() => (n++ < 2 ? jsonResponse({}, 503) : jsonResponse({ ok: 1 }))));
    await expect(getJson(d, 'https://x/a', { endpoint: 'GET /a', maxRetries: 4 })).resolves.toEqual({ ok: 1 });
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('honors Retry-After on 429', async () => {
    let n = 0;
    const { deps: d, sleeps } = deps(
      fakeFetch(() => (n++ === 0 ? jsonResponse({}, 429, { 'retry-after': '7' }) : jsonResponse({ ok: 1 }))),
    );
    await getJson(d, 'https://x/a', { endpoint: 'GET /a', maxRetries: 4 });
    expect(sleeps).toEqual([7000]);
  });

  it('does not retry a 404', async () => {
    const f = fakeFetch(() => jsonResponse({}, 404));
    const { deps: d } = deps(f);
    await expect(getJson(d, 'https://x/a', { endpoint: 'GET /a', maxRetries: 4 })).rejects.toBeInstanceOf(UpstreamHttpError);
    expect(f.calls).toHaveLength(1);
  });

  it('gives up after maxRetries with the endpoint and status in the error', async () => {
    const { deps: d } = deps(fakeFetch(() => jsonResponse({}, 500)));
    await expect(getJson(d, 'https://x/a', { endpoint: 'GET /a', maxRetries: 2 })).rejects.toThrow('GET /a returned HTTP 500');
  });

  it('retries network errors', async () => {
    let n = 0;
    const { deps: d } = deps(fakeFetch(() => { if (n++ === 0) throw new TypeError('network down'); return jsonResponse({ ok: 1 }); }));
    await expect(getJson(d, 'https://x/a', { endpoint: 'GET /a', maxRetries: 1 })).resolves.toEqual({ ok: 1 });
  });
});

describe('createThrottle', () => {
  it('waits out the remainder of the interval between calls', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const throttle = createThrottle({ fetch, sleep: async (ms) => { sleeps.push(ms); now += ms; }, clock: () => now }, 1000);
    await throttle();
    now += 300;
    await throttle();
    expect(sleeps).toEqual([700]);
  });
});

describe('parseWith', () => {
  it('throws UpstreamSchemaError naming the failing path', () => {
    const schema = z.object({ data: z.array(z.object({ id: z.string() })) });
    try {
      parseWith(schema, { data: [{ id: 1 }] }, 'GET /x');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamSchemaError);
      expect((err as UpstreamSchemaError).path).toBe('data.0.id');
    }
  });
});

describe('issuePath', () => {
  it('joins the first issue path with dots', () => {
    const result = z.object({ data: z.array(z.object({ id: z.string() })) }).safeParse({ data: [{ id: 1 }] });
    expect(result.success ? null : issuePath(result.error)).toBe('data.0.id');
  });

  it('names the root when the value itself is wrong', () => {
    const result = z.object({ id: z.string() }).safeParse('nope');
    expect(result.success ? null : issuePath(result.error)).toBe('(root)');
  });
});
