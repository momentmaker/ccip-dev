import { describe, expect, it, vi } from 'vitest';
import { handleOg, type OgDeps, type OgEnv } from '../worker/og';
import chains from './fixtures/chains.json';
import history from './fixtures/history.json';
import reserve from './fixtures/reserve.json';
import status from './fixtures/status.json';
import today from './fixtures/today.json';
import topToken from './fixtures/top-token.json';

const DATA: Record<string, unknown> = {
  'today.json': today,
  'history.json': history,
  'status.json': { ...status, last_finalize_day: '2026-10-06' },
  'chains.json': chains,
  'top/token.json': topToken,
  'reserve.json': reserve,
};
const PNG = new Uint8Array([137, 80, 78, 71]);
const FALLBACK = new Uint8Array([1, 2, 3]);

class MemoryCache {
  store = new Map<string, Response>();
  async match(req: Request) {
    return this.store.get(req.url)?.clone();
  }
  async put(req: Request, res: Response) {
    this.store.set(req.url, res);
  }
}

function setup(overrides: Partial<OgDeps> = {}, broken: string[] = []) {
  const dataUrls: string[] = [];
  const fetchFn = (async (url: string) => {
    dataUrls.push(url);
    const name = url.replace('https://data.ccip.dev/v1/', '');
    if (broken.includes(name)) return new Response('down', { status: 500 });
    return name in DATA ? new Response(JSON.stringify(DATA[name])) : new Response('missing', { status: 404 });
  }) as unknown as typeof fetch;
  const env: OgEnv = {
    ASSETS: {
      fetch: async (req: Request | string) => {
        const path = new URL(typeof req === 'string' ? req : req.url).pathname;
        if (path === '/layout.json') return Response.json([{ selector: 'a', x: 1, y: 0 }]);
        if (path === '/og-default.png') return new Response(FALLBACK);
        return new Response('missing', { status: 404 });
      },
    },
  };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
  const renderPng = vi.fn(async (_tree: unknown) => PNG);
  const deps: OgDeps = { fetch: fetchFn, renderPng, cache: new MemoryCache(), ...overrides };
  const get = async (path: string) => {
    const res = await handleOg(new Request(`https://ccip.dev${path}`), env, ctx, deps);
    await Promise.all(pending);
    return res;
  };
  return { get, renderPng, dataUrls };
}

describe('handleOg', () => {
  it('renders a known card as a cacheable PNG', async () => {
    const { get, renderPng } = setup();
    const res = await get('/og/home.png?v=2026-10-07');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(JSON.stringify(renderPng.mock.calls[0]![0])).toContain('CCIP TODAY');
  });

  it('answers 404 without rendering for an unknown pattern or a day with no data', async () => {
    const { get, renderPng, dataUrls } = setup();
    expect((await get('/og/top/chain/7d.png')).status).toBe(404);
    expect(dataUrls).toEqual([]);
    expect((await get('/og/day/2026-01-01.png')).status).toBe(404);
    expect(renderPng).not.toHaveBeenCalled();
  });

  it('caches finalized days for a week', async () => {
    const { get } = setup();
    const day = (history as { days: { day: string }[] }).days[0]!.day;
    expect((await get(`/og/day/${day}.png`)).headers.get('cache-control')).toBe('public, max-age=604800');
  });

  it('serves a second request from the cache whatever its ?v', async () => {
    const { get, renderPng } = setup();
    await get('/og/top/token/30d.png?v=2026-10-06');
    const again = await get('/og/top/token/30d.png?v=2026-10-07');
    expect(again.status).toBe(200);
    expect(renderPng).toHaveBeenCalledTimes(1);
  });

  it('serves the fallback card for a minute when the data is down', async () => {
    const { get, renderPng } = setup({}, ['reserve.json']);
    const res = await get('/og/reserve.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(FALLBACK);
    expect(renderPng).not.toHaveBeenCalled();
  });

  it('serves the fallback card when rendering throws', async () => {
    const { get } = setup({ renderPng: async () => { throw new Error('wasm trap'); } });
    expect(new Uint8Array(await (await get('/og/records.png')).arrayBuffer())).toEqual(FALLBACK);
  });
});
