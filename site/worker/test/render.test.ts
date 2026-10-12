import { afterEach, describe, expect, it, vi } from 'vitest';
import chains from '../../test/fixtures/chains.json';
import topToken from '../../test/fixtures/top-token.json';
import { BROADCAST_FILES, DAY, DEPOSIT_TX } from '../../test/fixtures/broadcast';
import { orbitSky, skyNodes } from '../cards/orbit-sky';
import { h } from '../h';
import worker from '../index';
import { renderPng } from '../render';
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
  delete assets['/chains/ethereum-mainnet-base-1.svg'];
  await caches.default.delete(new Request(`https://ccip.dev/og/broadcast/daily/${DAY}.png`));
  await caches.default.delete(new Request(`https://ccip.dev/og/broadcast/reserve/${DEPOSIT_TX}.png`));
});

describe('site Worker', () => {
  it('renders the daily broadcast card as a real 1200×675 PNG, its hub coin drawn from the site assets', async () => {
    // #given Base, the busiest chain, has a red icon
    assets['/chains/ethereum-mainnet-base-1.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="#ff0000"/></svg>';
    stubData(BROADCAST_FILES);
    // #when
    const png = await renderCard(`/og/broadcast/daily/${DAY}.png`);
    // #then
    const [r, g] = await pngPixel(png, 860, 300);
    expect({ height: new DataView(png.buffer).getUint32(20), hub: r > 200 && g < 60 }).toEqual({ height: 675, hub: true });
  });

  it('renders the Reserve broadcast card as a real 1200×675 PNG with the Chainlink hexagon mark', async () => {
    // #given
    stubData(BROADCAST_FILES);
    // #when
    const png = await renderCard(`/og/broadcast/reserve/${DEPOSIT_TX}.png`);
    // #then the mark's #375BD2 stroke runs through (880, 200), just below its top corner
    const [r, g, b] = await pngPixel(png, 880, 200);
    expect({ height: new DataView(png.buffer).getUint32(20), mark: b > 180 && r < 100 && g < 130 }).toEqual({ height: 675, mark: true });
  });

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

  it('renders the orbit sky at 1200×675 with a coin clipped to a circle and a lettermark coin, in well under the CPU limit', async () => {
    // #given a red square icon on the hub and no icon for the second chain
    const red = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="#ff0000"/></svg>')}`;
    const sky = orbitSky({ chains: [{ selector: 'a', name: 'Alpha', value: 100 }, { selector: 'b', name: 'Beta', value: 100 }], lanes: [{ src: 'a', dst: 'b', usd: 1 }], seed: 3 });
    const tree = h('div', { style: { width: 1200, height: 675, display: 'flex', position: 'relative', backgroundColor: '#070a10', fontFamily: 'Inter' } }, ...skyNodes(sky, new Map([['a', red], ['b', null]])));
    // #when
    const started = Date.now();
    const png = await renderPng(tree, { width: 1200, height: 675 });
    const elapsed = Date.now() - started;
    // #then the hub (860, 300, r 46) is red inside and not at its square corner; Beta's coin is the lettermark color
    const [cr, cg] = await pngPixel(png, 860, 300);
    const [kr, kg] = await pngPixel(png, 816, 256);
    const [lr, lg, lb] = await pngPixel(png, 1045, 205);
    expect({
      height: new DataView(png.buffer).getUint32(20),
      center: cr > 200 && cg < 60,
      corner: kr < 200 || kg > 60,
      lettermark: Math.abs(lr - 0x2a) < 14 && Math.abs(lg - 0x34) < 14 && Math.abs(lb - 0x46) < 14,
      fast: elapsed < 10_000,
    }).toEqual({ height: 675, center: true, corner: true, lettermark: true, fast: true });
  });
});
