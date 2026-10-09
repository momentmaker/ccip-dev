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

let origins = 0;

function setup(overrides: Partial<OgDeps> = {}, broken: string[] = [], data: Record<string, unknown> = DATA, assets: Record<string, string> = {}) {
  const origin = `https://ccip${++origins}.test`;
  const dataUrls: string[] = [];
  const assetPaths: string[] = [];
  const fetchFn = (async (url: string) => {
    dataUrls.push(url);
    const name = url.replace('https://data.ccip.dev/v1/', '');
    if (broken.includes(name)) return new Response('down', { status: 500 });
    return name in data ? new Response(JSON.stringify(data[name])) : new Response('missing', { status: 404 });
  }) as unknown as typeof fetch;
  const env: OgEnv = {
    ASSETS: {
      fetch: async (req: Request | string) => {
        const path = new URL(typeof req === 'string' ? req : req.url).pathname;
        assetPaths.push(path);
        if (path === '/card-sky.svg') return new Response('<svg xmlns="http://www.w3.org/2000/svg"/>');
        if (path === '/og-default.png') return new Response(FALLBACK);
        if (path in assets) return new Response(assets[path]);
        return new Response('missing', { status: 404 });
      },
    },
  };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
  const renderPng = vi.fn(async (_tree: unknown) => PNG);
  const deps: OgDeps = { fetch: fetchFn, renderPng, cache: new MemoryCache(), ...overrides };
  const get = async (path: string) => {
    const res = await handleOg(new Request(`${origin}${path}`), env, ctx, deps);
    await Promise.all(pending);
    return res;
  };
  return { get, renderPng, dataUrls, assetPaths };
}

function imgSrcs(node: unknown): string[] {
  if (typeof node !== 'object' || node === null) return [];
  const { type, props } = node as { type?: string; props?: { src?: string; children?: unknown } };
  const own = type === 'img' && typeof props?.src === 'string' ? [props.src] : [];
  const kids = props?.children;
  return [...own, ...(Array.isArray(kids) ? kids.flatMap(imgSrcs) : imgSrcs(kids))];
}

describe('handleOg', () => {
  it('places the coins from /card-coins.json on the card', async () => {
    const coins = { coins: [{ x: 100, y: 80, d: 32, src: 'data:image/svg+xml;base64,AAAA' }] };
    const { get, renderPng } = setup({}, [], DATA, { '/card-coins.json': JSON.stringify(coins) });
    expect((await get('/og/home.png')).status).toBe(200);
    expect(imgSrcs(renderPng.mock.calls[0]![0])).toContain('data:image/svg+xml;base64,AAAA');
  });

  it('renders without coins when /card-coins.json is missing, invalid or unsafe', async () => {
    const unusable: Record<string, string>[] = [
      {},
      { '/card-coins.json': '{not json' },
      { '/card-coins.json': JSON.stringify({ coins: [{ x: 1, y: 1, d: 10, src: 'https://evil.example/x.svg' }, { x: 'a', y: 1, d: 10, src: 'data:image/svg+xml;base64,AA' }] }) },
    ];
    for (const assets of unusable) {
      const { get, renderPng } = setup({}, [], DATA, assets);
      expect((await get('/og/home.png')).status).toBe(200);
      expect(imgSrcs(renderPng.mock.calls[0]![0]).filter((s) => !s.startsWith('data:image/svg+xml;base64,PHN2Zy'))).toEqual([]);
    }
  });

  it('renders a known card as a cacheable PNG', async () => {
    const { get, renderPng } = setup();
    const res = await get('/og/home.png?v=2026-10-07');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(JSON.stringify(renderPng.mock.calls[0]![0])).toContain('CCIP TODAY');
  });

  it('renders a Chains fees card from top/src_chain.json and answers 404 for a token fees card', async () => {
    // #given a source-chain file with a fee ranking
    const entry = { key: '5009297550715157269', messages: 9, usd: 100, fee_usd: 12.5 };
    const srcChain = { ...topToken, dim: 'src_chain', windows: { '7d': [entry], '30d': [], all: [] }, by_fees: { '7d': [entry], '30d': [], all: [] } };
    const { get, renderPng, dataUrls } = setup({}, [], { ...DATA, 'top/src_chain.json': srcChain });
    // #when
    const fees = await get('/og/top/chain/7d/fees.png');
    const token = await get('/og/top/token/7d/fees.png');
    // #then
    expect({
      fees: fees.status,
      token: token.status,
      card: JSON.stringify(renderPng.mock.calls[0]![0]).includes('TOP CHAIN BY FEES'),
      read: dataUrls.some((u) => u.endsWith('/top/src_chain.json')),
    }).toEqual({ fees: 200, token: 404, card: true, read: true });
  });

  it('answers 404 without rendering for an unknown pattern or a day with no data', async () => {
    const { get, renderPng, dataUrls } = setup();
    expect((await get('/og/top/route/7d.png')).status).toBe(404);
    expect(dataUrls).toEqual([]);
    expect((await get('/og/day/2026-01-01.png')).status).toBe(404);
    expect(renderPng).not.toHaveBeenCalled();
  });

  it('serves the one-minute fallback card for the daily card while the finalized day has no history row', async () => {
    const { get, renderPng } = setup({}, [], { ...DATA, 'status.json': { ...status, last_finalize_day: '2026-01-01' } });
    const res = await get('/og/daily.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(FALLBACK);
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

  it('serves the fallback card when the cache itself throws', async () => {
    const cache = { match: async () => { throw new Error('cache down'); }, put: async () => {} };
    const { get } = setup({ cache });
    const res = await get('/og/home.png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(FALLBACK);
  });

  it('serves the fallback card when rendering throws', async () => {
    const { get } = setup({ renderPng: async () => { throw new Error('wasm trap'); } });
    expect(new Uint8Array(await (await get('/og/records.png')).arrayBuffer())).toEqual(FALLBACK);
  });

  it('renders a chain replay card from the build-time card data, 404s an unknown chain, and falls back without the data', async () => {
    const cards = { base: { name: 'Base', since: '2023-11-03', usd: 1, messages: 2, partners: 3, coin: null } };
    const { get } = setup({}, [], DATA, { '/replay-cards.json': JSON.stringify(cards) });
    expect((await get('/og/replay/base.png')).status).toBe(200);
    expect((await get('/og/replay/nope.png')).status).toBe(404);
    const bare = setup();
    expect((await bare.get('/og/replay/base.png')).headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('404s prototype-named slugs and entries with invalid or remote data', async () => {
    const good = { name: 'Base', since: '2023-11-03', usd: 1, messages: 2, partners: 3, coin: null };
    const cards = {
      base: good,
      evil: { ...good, coin: 'https://evil.example/x.png' },
      neg: { ...good, usd: -1 },
      nodate: { ...good, since: 'soon' },
      noname: { ...good, name: '' },
    };
    const { get } = setup({}, [], DATA, { '/replay-cards.json': JSON.stringify(cards) });
    for (const slug of ['constructor', 'evil', 'neg', 'nodate', 'noname']) {
      expect((await get(`/og/replay/${slug}.png`)).status).toBe(404);
    }
    expect((await get('/og/replay/base.png')).status).toBe(200);
  });

  it('reads /replay-cards.json once per isolate and origin, however many chain cards it renders', async () => {
    const entry = { name: 'Base', since: '2023-11-03', usd: 1, messages: 2, partners: 3, coin: null };
    const { get, assetPaths } = setup({}, [], DATA, { '/replay-cards.json': JSON.stringify({ base: entry, arbitrum: { ...entry, name: 'Arbitrum' } }) });
    expect((await get('/og/replay/base.png')).status).toBe(200);
    expect((await get('/og/replay/arbitrum.png')).status).toBe(200);
    expect((await get('/og/replay/nope.png')).status).toBe(404);
    expect(assetPaths.filter((p) => p === '/replay-cards.json')).toHaveLength(1);
  });

  it('retries /replay-cards.json on the next request after a failed read', async () => {
    const entry = { name: 'Base', since: '2023-11-03', usd: 1, messages: 2, partners: 3, coin: null };
    const assets: Record<string, string> = {};
    const { get, assetPaths } = setup({}, [], DATA, assets);
    expect((await get('/og/replay/base.png')).headers.get('cache-control')).toBe('public, max-age=60');
    assets['/replay-cards.json'] = JSON.stringify({ base: entry });
    expect((await get('/og/replay/base.png')).status).toBe(200);
    expect(assetPaths.filter((p) => p === '/replay-cards.json')).toHaveLength(2);
  });
});
