import { describe, expect, it, vi } from 'vitest';
import type { VNode } from '../worker/h';
import { passportTree } from '../worker/cards/passport-card';
import { MISSING_GLYPHS } from '../worker/cards/glyphs';
import { handleOg, type OgDeps, type OgEnv } from '../worker/og';
import { texts } from './fixtures/broadcast';
import shard0 from './fixtures/passport/passport-0.json';
import shard3 from './fixtures/passport/passport-3.json';

const BMT = '0e5901c9-23ca-5cde-b023-63d82251fe7f';
const chain = (selector: string, name: string, display: string) => ({ selector, name, display_name: display, family: 'EVM', chain_id: '1', first_seen: '2025-01-01T00:00:00.000Z' });
const CHAINS = {
  schema_version: 1,
  updated_at: '2026-11-26T01:00:00.000Z',
  attribution: 'Data: Chainlink CCIP API, DefiLlama',
  chains: [
    chain('124615329519749607', 'solana-mainnet', 'Solana Mainnet'),
    chain('5009297550715157269', 'ethereum-mainnet', 'Ethereum Mainnet'),
    chain('15971525489660198786', 'ethereum-mainnet-base-1', 'Base Mainnet'),
    chain('4949039107694359620', 'ethereum-mainnet-arbitrum-1', 'Arbitrum Mainnet'),
  ],
};
const DATA: Record<string, unknown> = { 'passport/0.json': shard0, 'passport/3.json': shard3, 'chains.json': CHAINS };
const inputs = { load: async (name: string) => DATA[name], icon: async () => null } as never;

describe('the passport card', () => {
  it('holds the token name, its chains and the flagged check\'s label', async () => {
    // #when
    const words = texts(await passportTree(BMT, inputs));
    // #then
    expect(words).toEqual(expect.arrayContaining(['BMT Token', 'Solana · Ethereum · Base', 'Single key', 'Flagged', 'Rate limit', 'Pool pointers', 'Not readable', `ccip.dev/passport/${BMT}`]));
  });

  it('writes no glyph the fonts lack', async () => {
    // #when
    const words = texts(await passportTree(BMT, inputs));
    // #then
    expect(words.filter((w) => MISSING_GLYPHS.test(w))).toEqual([]);
  });

  it('lists the results flagged first, then not readable, then clear', async () => {
    // #when
    const words = texts(await passportTree(BMT, inputs)).filter((w) => ['Flagged', 'Not readable', 'Clear'].includes(w));
    // #then
    expect(words).toEqual(['Flagged', 'Flagged', 'Not readable']);
  });

  it('has no card for a page id its shard does not hold', async () => {
    // #then
    expect(await passportTree('0aaaaaaa-0000-5000-8000-000000000000', inputs)).toBeNull();
  });
});

describe('the passport card route', () => {
  const setup = () => {
    const fetchFn = (async (url: string) => {
      const name = url.replace('https://data.ccip.dev/v1/', '');
      return name in DATA ? new Response(JSON.stringify(DATA[name])) : new Response('missing', { status: 404 });
    }) as unknown as typeof fetch;
    const env: OgEnv = { ASSETS: { fetch: async () => new Response('missing', { status: 404 }) } };
    const renderPng = vi.fn(async (_tree: VNode) => new Uint8Array([137, 80, 78, 71]));
    const deps: OgDeps = { fetch: fetchFn, renderPng, cache: null };
    const get = (path: string) => handleOg(new Request(`https://ccip.test${path}`), env, { waitUntil: () => undefined }, deps);
    return { get, renderPng };
  };

  it('draws /og/passport/<id>.png from the token\'s shard', async () => {
    // #given
    const { get, renderPng } = setup();
    // #when
    const res = await get(`/og/passport/${BMT}.png`);
    // #then
    expect([res.status, texts(renderPng.mock.calls[0]?.[0]).includes('BMT Token')]).toEqual([200, true]);
  });

  it('answers 404 for a page id no shard holds', async () => {
    // #given
    const { get } = setup();
    // #then
    expect((await get('/og/passport/0aaaaaaa-0000-5000-8000-000000000000.png')).status).toBe(404);
  });
});
