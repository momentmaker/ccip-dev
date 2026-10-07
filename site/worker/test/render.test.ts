import { afterEach, describe, expect, it, vi } from 'vitest';
import chains from '../../test/fixtures/chains.json';
import topToken from '../../test/fixtures/top-token.json';
import worker from '../index';
import { pngPixel } from './png';

const today = {
  schema_version: 1, updated_at: '2026-10-07T00:00:00.000Z', attribution: 'Data: Chainlink CCIP API, DefiLlama', day: '2026-10-07',
  totals: { day: '2026-10-07', messages: 44, token_messages: 40, usd_value: 9467.03, fee_usd: 22.59, unique_senders: 20, median_delivery_s: 62, unpriced_messages: 0, fee_link_usd: 0, fee_link_share_pct: 0 },
  top: { lane: [], token: [], sender: [] },
  arrivals: [],
};
const nonLatinTopToken = { ...topToken, windows: { ...topToken.windows, '7d': [{ ...topToken.windows['7d'][0]!, symbol: '日本→' }] } };
const SKY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 630"><circle cx="320" cy="315" r="40" fill="#e8eaed"/></svg>';

const requested: string[] = [];
const stubData = (files: Record<string, unknown>) =>
  vi.stubGlobal('fetch', async (input: string | Request) => {
    const url = typeof input === 'string' ? input : input.url;
    requested.push(url);
    const body = files[url.replace('https://data.ccip.dev/v1/', '')];
    return body ? new Response(JSON.stringify(body)) : new Response('missing', { status: 404 });
  });
const assets: Record<string, string> = { '/card-sky.svg': SKY };
const env = {
  ASSETS: {
    fetch: async (req: Request | string) => {
      const path = new URL(typeof req === 'string' ? req : req.url).pathname;
      return path in assets ? new Response(assets[path]) : new Response('missing', { status: 404 });
    },
  },
};

async function renderCard(path: string) {
  const pending: Promise<unknown>[] = [];
  const res = await worker.fetch(new Request(`https://ccip.dev${path}`), env as never, { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} } as never);
  await Promise.all(pending);
  return new Uint8Array(await res.arrayBuffer());
}

const expectPng = (bytes: Uint8Array) => {
  expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(new DataView(bytes.buffer).getUint32(16)).toBe(1200);
  expect(new DataView(bytes.buffer).getUint32(20)).toBe(630);
};

afterEach(async () => {
  await caches.default.delete(new Request('https://ccip.dev/og/home.png'));
  vi.unstubAllGlobals();
  requested.length = 0;
  delete assets['/card-coins.json'];
  delete assets['/replay-cards.json'];
  await caches.default.delete(new Request('https://ccip.dev/og/replay/base.png'));
});

describe('site Worker', () => {
  it('renders the home card as a real 1200×630 PNG fetching only our data', async () => {
    stubData({ 'today.json': today });
    expectPng(await renderCard('/og/home.png'));
    expect(requested.length).toBeGreaterThan(0);
    expect(requested.every((u) => u.startsWith('https://data.ccip.dev/v1/'))).toBe(true);
  });

  it('renders glyphs outside the Inter subset without any outside fetch', async () => {
    stubData({ 'top/token.json': nonLatinTopToken, 'chains.json': chains });
    expectPng(await renderCard('/og/top/token/7d.png'));
    expect(requested.every((u) => u.startsWith('https://data.ccip.dev/v1/'))).toBe(true);
  });

  it('draws a coin from /card-coins.json onto the real card', async () => {
    const red = btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="#ff0000"/></svg>');
    assets['/card-coins.json'] = JSON.stringify({ coins: [{ x: 560, y: 80, d: 60, src: `data:image/svg+xml;base64,${red}` }] });
    stubData({ 'today.json': today });
    const png = await renderCard('/og/home.png');
    expectPng(png);
    const [r, g, b] = await pngPixel(png, 1200 - 640 + 560, 80);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });

  it('draws the chain badge from /replay-cards.json onto the replay card', async () => {
    const red = btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="#ff0000"/></svg>');
    assets['/replay-cards.json'] = JSON.stringify({ base: { name: 'Base', since: '2023-11-03', usd: 1, messages: 2, partners: 3, coin: `data:image/svg+xml;base64,${red}` } });
    const png = await renderCard('/og/replay/base.png');
    expectPng(png);
    const [r, g, b] = await pngPixel(png, 1200 - 640 + 320, 315);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });

  it('passes every other path to the static assets', async () => {
    const assetEnv = { ASSETS: { fetch: async () => new Response('asset') } };
    const res = await worker.fetch(new Request('https://ccip.dev/about/'), assetEnv as never, {} as never);
    expect(await res.text()).toBe('asset');
  });
});
