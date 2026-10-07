import { describe, expect, it } from 'vitest';
import { DataError, fetchPublic, pollDelay } from '../src/lib/data';
import status from './fixtures/status.json';

const respond = (body: unknown, init: ResponseInit = {}) =>
  (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), init)) as unknown as typeof fetch;

describe('fetchPublic', () => {
  it('fetches from the base URL and parses the file', async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(status));
    }) as unknown as typeof fetch;
    const parsed = await fetchPublic('status.json', { fetch: fetchFn, base: 'https://example.test/v1' });
    expect(urls).toEqual(['https://example.test/v1/status.json']);
    expect(parsed.coverage_from).toBe(status.coverage_from);
  });

  it('ignores unknown fields', async () => {
    const parsed = await fetchPublic('status.json', { fetch: respond({ ...status, extra: true }) });
    expect(parsed).not.toHaveProperty('extra');
  });

  it.each([
    ['an HTTP error', respond('nope', { status: 503 }), 'status.json: HTTP 503'],
    ['a body that is not JSON', respond('<html>'), 'status.json: body is not JSON'],
    ['a missing required field', respond({ ...status, lag_seconds: undefined }), 'status.json: unexpected shape at lag_seconds'],
  ])('throws a DataError on %s', async (_case, fetchFn, message) => {
    const error = await fetchPublic('status.json', { fetch: fetchFn }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).message).toContain(message);
    expect((error as DataError).file).toBe('status.json');
  });

  it('throws a DataError when the request itself fails', async () => {
    const fetchFn = (async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    await expect(fetchPublic('live.json', { fetch: fetchFn })).rejects.toThrow('live.json: request failed (network down)');
  });
});

describe('pollDelay', () => {
  it('backs off 30 s, 60 s, 120 s, then stays at 300 s', () => {
    expect([0, 1, 2, 3, 9].map(pollDelay)).toEqual([30_000, 60_000, 120_000, 300_000, 300_000]);
  });
});
