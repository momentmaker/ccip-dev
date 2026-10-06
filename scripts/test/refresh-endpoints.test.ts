import { fakeFetch, jsonResponse, type FakeRoute } from '@ccip-dev/core/testing';
import { describe, expect, it } from 'vitest';
import {
  candidateExplorers, candidateRpcs, refreshEndpoints, verifyBlockscout, verifyEthereumLogs, verifyEvmRpc, RESERVE_DEPOSIT_TX,
  type ChainlistEntry, type Endpoints,
} from '../refresh-endpoints';

const rpcRoute = (url: string, opts: { chainId?: number; code?: unknown; logs?: unknown[] } = {}): FakeRoute => async (u, init) => {
  if (u !== url) return undefined;
  const { method } = JSON.parse(String(init?.body)) as { method: string };
  if (method === 'eth_chainId') return jsonResponse({ result: `0x${(opts.chainId ?? 1).toString(16)}` });
  if (method === 'eth_getCode') return jsonResponse({ result: opts.code ?? '0x' });
  if (method === 'eth_getLogs') return jsonResponse({ result: opts.logs ?? [{ transactionHash: RESERVE_DEPOSIT_TX }] });
  return jsonResponse({ error: 'unsupported' });
};
const dead = (url: string): FakeRoute => (u) => (u === url ? new Response('down', { status: 503 }) : undefined);
const blockscoutRoute = (base: string, body: unknown = { total_blocks: '10' }): FakeRoute => (u) =>
  u === `${base}/api/v2/stats` ? jsonResponse(body) : undefined;

const entry = (chainId: number, urls: string[], explorers: { name: string; url: string }[] = []): ChainlistEntry => ({
  chainId, rpc: urls.map((url) => ({ url })), explorers,
});
const empty: Endpoints = { source: 'test', rpc: {}, explorer: {}, ethereumLogs: [] };
const base = { source: 'test' };
const evmChain = (name: string, chain_id: string) => ({ name, family: 'EVM', chain_id });

describe('candidateRpcs', () => {
  it('keeps keyless https endpoints in order and rejects the rest', () => {
    const chain: ChainlistEntry = {
      chainId: 10,
      rpc: [
        { url: 'http://insecure.example' },
        { url: 'https://a.example/${API_KEY}' },
        { url: 'https://b.example/?apikey=abc' },
        { url: 'https://c.example/v3/0123456789abcdef0123456789abcdef' },
        { url: 'https://tracked.example', tracking: 'yes' },
        { url: 'https://one.valve.city/rpc/vk_demo/evm/1' },
        { url: 'wss://socket.example' },
        { url: 'https://good-1.example', tracking: 'none' },
        { url: 'https://good-2.example' },
        { url: 'https://limited.example', tracking: 'limited' },
      ],
    };
    expect(candidateRpcs(chain)).toEqual(['https://good-1.example', 'https://good-2.example']);
  });
});

describe('candidateExplorers', () => {
  it('keeps blockscout explorers without a trailing slash', () => {
    const chain = entry(1, [], [
      { name: 'etherscan', url: 'https://etherscan.io' },
      { name: 'Blockscout', url: 'https://eth.blockscout.com/' },
      { name: 'explorer', url: 'https://x.blockscout.example' },
    ]);
    expect(candidateExplorers(chain)).toEqual(['https://eth.blockscout.com', 'https://x.blockscout.example']);
  });
});

describe('verification', () => {
  it('accepts an endpoint on the right chain that serves eth_getCode', async () => {
    expect(await verifyEvmRpc(fakeFetch(rpcRoute('https://r.example')), 'https://r.example', 1)).toBe(true);
  });

  it('rejects a chain id mismatch', async () => {
    expect(await verifyEvmRpc(fakeFetch(rpcRoute('https://r.example', { chainId: 5 })), 'https://r.example', 1)).toBe(false);
  });

  it('treats any error as a failure', async () => {
    expect(await verifyEvmRpc(fakeFetch(), 'https://r.example', 1)).toBe(false);
  });

  it('accepts a blockscout that reports stats and rejects other bodies', async () => {
    expect(await verifyBlockscout(fakeFetch(blockscoutRoute('https://b.example')), 'https://b.example')).toBe(true);
    expect(await verifyBlockscout(fakeFetch(blockscoutRoute('https://b.example', { nope: 1 })), 'https://b.example')).toBe(false);
  });

  it('rejects an Ethereum log endpoint that lacks the known Reserve deposit', async () => {
    const lying = fakeFetch(rpcRoute('https://r.example', { logs: [] }));
    expect(await verifyEthereumLogs(lying, 'https://r.example')).toBe(false);
    expect(await verifyEthereumLogs(fakeFetch(rpcRoute('https://r.example')), 'https://r.example')).toBe(true);
  });
});

describe('refreshEndpoints', () => {
  it('keeps a working current entry without trying chainlist candidates', async () => {
    const fetch = fakeFetch(rpcRoute('https://current.example', { chainId: 10 }), rpcRoute('https://candidate.example', { chainId: 10 }));
    const { endpoints, changes } = await refreshEndpoints({
      fetch, ccipChains: [evmChain('optimism-mainnet', '10')], chainlist: [entry(10, ['https://candidate.example'])],
      current: { ...base, rpc: { 'optimism-mainnet': 'https://current.example' }, explorer: {}, ethereumLogs: [] },
    });
    expect(endpoints.rpc).toEqual({ 'optimism-mainnet': 'https://current.example' });
    expect(changes).toEqual([]);
    expect(fetch.calls.some((c) => c.url === 'https://candidate.example')).toBe(false);
  });

  it('replaces a dead current entry with the first verified candidate', async () => {
    const fetch = fakeFetch(
      dead('https://current.example'), dead('https://bad.example'), rpcRoute('https://wrongchain.example', { chainId: 99 }),
      rpcRoute('https://good.example', { chainId: 10 }),
    );
    const { endpoints, changes } = await refreshEndpoints({
      fetch, ccipChains: [evmChain('optimism-mainnet', '10')],
      chainlist: [entry(10, ['https://bad.example', 'https://wrongchain.example', 'https://good.example'])],
      current: { ...base, rpc: { 'optimism-mainnet': 'https://current.example' }, explorer: {}, ethereumLogs: [] },
    });
    expect(endpoints.rpc).toEqual({ 'optimism-mainnet': 'https://good.example' });
    expect(changes).toEqual([{ kind: 'rpc', chain: 'optimism-mainnet', change: 'replaced', url: 'https://good.example' }]);
  });

  it('adds new chains and records removal when nothing verifies', async () => {
    const fetch = fakeFetch(rpcRoute('https://new.example', { chainId: 7 }), dead('https://old.example'));
    const { endpoints, changes } = await refreshEndpoints({
      fetch, ccipChains: [evmChain('new-chain', '7'), evmChain('gone-chain', '8')],
      chainlist: [entry(7, ['https://new.example']), entry(8, [])],
      current: { ...base, rpc: { 'gone-chain': 'https://old.example' }, explorer: {}, ethereumLogs: [] },
    });
    expect(endpoints.rpc).toEqual({ 'new-chain': 'https://new.example' });
    expect(changes).toEqual([
      { kind: 'rpc', chain: 'new-chain', change: 'added', url: 'https://new.example' },
      { kind: 'rpc', chain: 'gone-chain', change: 'removed' },
    ]);
  });

  it('carries non-EVM entries over unchanged', async () => {
    const { endpoints } = await refreshEndpoints({
      fetch: fakeFetch(), ccipChains: [{ name: 'solana-mainnet', family: 'SVM', chain_id: 'abc' }], chainlist: [],
      current: { ...base, rpc: { 'solana-mainnet': 'https://sol.example' }, explorer: { 'solana-mainnet': 'https://sol-scan.example' }, ethereumLogs: [] },
    });
    expect(endpoints.rpc).toEqual({ 'solana-mainnet': 'https://sol.example' });
    expect(endpoints.explorer).toEqual({ 'solana-mainnet': 'https://sol-scan.example' });
  });

  it('finds a blockscout explorer among the first candidates', async () => {
    const fetch = fakeFetch(rpcRoute('https://r.example', { chainId: 10 }), blockscoutRoute('https://scout.example'));
    const { endpoints, changes } = await refreshEndpoints({
      fetch, ccipChains: [evmChain('optimism-mainnet', '10')],
      chainlist: [entry(10, ['https://r.example'], [{ name: 'blockscout', url: 'https://scout.example/' }])], current: empty,
    });
    expect(endpoints.explorer).toEqual({ 'optimism-mainnet': 'https://scout.example' });
    expect(changes).toContainEqual({ kind: 'explorer', chain: 'optimism-mainnet', change: 'added', url: 'https://scout.example' });
  });

  it('keeps verified log endpoints, tops up to four from chain 1 and skips the trusted pair', async () => {
    const urls = ['https://rpc.mevblocker.io', 'https://rpc.mevblocker.io/fast', 'https://0xrpc.io/eth', 'https://liar.example', 'https://a.example', 'https://b.example', 'https://c.example', 'https://d.example', 'https://e.example'];
    const fetch = fakeFetch(
      rpcRoute('https://kept.example'), rpcRoute('https://rpc.mevblocker.io/fast'), rpcRoute('https://liar.example', { logs: [] }), dead('https://stale.example'),
      ...['a', 'b', 'c', 'd', 'e'].map((n) => rpcRoute(`https://${n}.example`)),
    );
    const { endpoints, changes } = await refreshEndpoints({
      fetch, ccipChains: [], chainlist: [entry(1, urls)],
      current: { ...base, rpc: {}, explorer: {}, ethereumLogs: ['https://kept.example', 'https://stale.example'] },
    });
    expect(endpoints.ethereumLogs).toEqual(['https://kept.example', 'https://a.example', 'https://b.example', 'https://c.example']);
    expect(changes).toContainEqual({ kind: 'ethereumLogs', change: 'removed', url: 'https://stale.example' });
    expect(changes).toContainEqual({ kind: 'ethereumLogs', change: 'added', url: 'https://a.example' });
  });

  it('drops a current RPC or log endpoint that carries a demo key', async () => {
    const demo = 'https://one.valve.city/rpc/vk_demo/evm/1';
    const fetch = fakeFetch(rpcRoute(demo), rpcRoute('https://ok.example'));
    const { endpoints } = await refreshEndpoints({
      fetch, ccipChains: [evmChain('ethereum-mainnet', '1')], chainlist: [entry(1, ['https://ok.example'])],
      current: { ...base, rpc: { 'ethereum-mainnet': demo }, explorer: {}, ethereumLogs: [demo] },
    });
    expect(endpoints.rpc).toEqual({ 'ethereum-mainnet': 'https://ok.example' });
    expect(endpoints.ethereumLogs).toEqual(['https://ok.example']);
  });

  it('sorts the keys of every map', async () => {
    const fetch = fakeFetch(rpcRoute('https://z.example', { chainId: 1 }), rpcRoute('https://a.example', { chainId: 2 }));
    const { endpoints } = await refreshEndpoints({
      fetch, ccipChains: [evmChain('zeta', '1'), evmChain('alpha', '2')],
      chainlist: [entry(1, ['https://z.example']), entry(2, ['https://a.example'])], current: empty,
    });
    expect(Object.keys(endpoints.rpc)).toEqual(['alpha', 'zeta']);
  });
});
