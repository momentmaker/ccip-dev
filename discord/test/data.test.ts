import { beforeEach, describe, expect, it } from 'vitest';
import { clearDataCache, DATA_BASE, DataError, publicData } from '../src/data';
import { CHAINS } from './fixtures/intel';

beforeEach(clearDataCache);

function server(body: () => Response) {
  const urls: string[] = [];
  const fetch = (async (url: string) => {
    urls.push(url);
    return body();
  }) as unknown as typeof globalThis.fetch;
  return { urls, fetch };
}

/** The Cache API as a map. */
function memoryCache() {
  const stored = new Map<string, string>();
  return {
    stored,
    match: async (url: RequestInfo | URL) => (stored.has(String(url)) ? new Response(stored.get(String(url))) : undefined),
    put: async (url: RequestInfo | URL, res: Response) => void stored.set(String(url), await res.text()),
  };
}

describe('the public data files', () => {
  it('reads a file against its schema and keeps it 60 s in the isolate', async () => {
    // #given
    const s = server(() => new Response(JSON.stringify(CHAINS)));
    let now = 0;
    const data = publicData({ fetch: s.fetch, now: () => now, cache: null });
    // #when
    const first = await data.load('chains.json');
    now = 59_000;
    await data.load('chains.json');
    now = 61_000;
    await data.load('chains.json');
    // #then
    expect({ chains: first.chains.length, urls: s.urls }).toEqual({ chains: 7, urls: [`${DATA_BASE}/chains.json`, `${DATA_BASE}/chains.json`] });
  });

  it("shares a file through the Cache API with the colo's other isolates", async () => {
    // #given one isolate fetched it
    const cache = memoryCache();
    const s = server(() => new Response(JSON.stringify(CHAINS)));
    await publicData({ fetch: s.fetch, now: () => 0, cache }).load('chains.json');
    clearDataCache();
    // #when another reads it
    const again = await publicData({ fetch: s.fetch, now: () => 0, cache }).load('chains.json');
    // #then
    expect({ fetched: s.urls.length, chains: again.chains.length }).toEqual({ fetched: 1, chains: 7 });
  });

  it('names the file in a DataError, and keeps nothing it could not read', async () => {
    // #given
    const cache = memoryCache();
    const load = (body: () => Response) => publicData({ fetch: server(body).fetch, now: () => 0, cache }).load('today.json');
    // #when
    const errors = await Promise.all([
      load(() => new Response('down', { status: 503 })).catch((e: unknown) => e),
      load(() => new Response('<html>')).catch((e: unknown) => e),
      load(() => new Response('{"schema_version":1}')).catch((e: unknown) => e),
    ]);
    // #then
    expect({ errors: errors.map((e) => [e instanceof DataError, (e as DataError).file, (e as Error).message.split(':').slice(0, 2).join(':')]), cached: cache.stored.size }).toEqual({
      errors: [[true, 'today.json', 'today.json: HTTP 503'], [true, 'today.json', 'today.json: body is not JSON'], [true, 'today.json', 'today.json: unexpected shape at updated_at']],
      cached: 0,
    });
  });
});
