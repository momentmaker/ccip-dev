import { LOG_RPC_URLS } from '@ccip-dev/core';
import { describe, expect, it } from 'vitest';
import endpoints from '../../config/endpoints.json';
import type { Env } from '../src/env';
import { logRpcUrls } from '../src/rpc';

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
