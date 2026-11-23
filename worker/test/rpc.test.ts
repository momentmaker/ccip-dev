import { LOG_RPC_URLS } from '@ccip-dev/core';
import { describe, expect, it } from 'vitest';
import endpoints from '../../config/endpoints.json';
import type { Env } from '../src/env';
import { chainEndpoint, logRpcUrls } from '../src/rpc';

const ETHEREUM_SELECTOR = '5009297550715157269';

describe('chainEndpoint', () => {
  it("returns Ethereum's RPC URL, router and registry", () => {
    // #when
    const endpoint = chainEndpoint({ selector: ETHEREUM_SELECTOR, name: 'ethereum-mainnet' });
    // #then
    expect(endpoint).toEqual({
      ok: true,
      rpcUrl: endpoints.rpc['ethereum-mainnet'],
      router: '0x80226fc0ee2b096224eeac085bb9a8cba1146f7d',
      tokenAdminRegistry: '0xb22764f98dd05c789929716d677382df22c05cb6',
    });
  });

  it('says "no endpoint" for a chain missing from the endpoints file', () => {
    // #when
    const endpoint = chainEndpoint({ selector: ETHEREUM_SELECTOR, name: 'not-a-chain-mainnet' });
    // #then
    expect(endpoint).toEqual({ ok: false, reason: 'no endpoint' });
  });

  it('says "no registry" for a chain missing from the directory file', () => {
    // #when
    const endpoint = chainEndpoint({ selector: '1', name: 'ethereum-mainnet' });
    // #then
    expect(endpoint).toEqual({ ok: false, reason: 'no registry' });
  });
});

describe('logRpcUrls', () => {
  it('without secrets lists the trusted endpoints, then the vetted chainlist ones', () => {
    const urls = logRpcUrls({} as Env);
    expect(urls).toEqual([...LOG_RPC_URLS, ...endpoints.ethereumLogs]);
  });

  it('puts keyed endpoints first and never repeats a URL', () => {
    const urls = logRpcUrls({ RPC_ETHEREUM: LOG_RPC_URLS[0], RPC_FALLBACKS: 'https://keyed.example' } as Env);
    expect(urls.slice(0, 2)).toEqual([LOG_RPC_URLS[0], 'https://keyed.example']);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
