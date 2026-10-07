import { afterEach, describe, expect, it, vi } from 'vitest';
import chains from '../../test/fixtures/chains.json';
import topToken from '../../test/fixtures/top-token.json';
import worker from '../index';

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
const env = {
  ASSETS: {
    fetch: async (req: Request | string) =>
      new URL(typeof req === 'string' ? req : req.url).pathname === '/card-sky.svg' ? new Response(SKY) : new Response('missing', { status: 404 }),
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

afterEach(() => {
  vi.unstubAllGlobals();
  requested.length = 0;
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

  it('passes every other path to the static assets', async () => {
    const assetEnv = { ASSETS: { fetch: async () => new Response('asset') } };
    const res = await worker.fetch(new Request('https://ccip.dev/about/'), assetEnv as never, {} as never);
    expect(await res.text()).toBe('asset');
  });
});
