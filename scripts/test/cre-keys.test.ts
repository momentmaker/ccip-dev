import { describe, expect, it } from 'vitest';
import { mergeKeys, prBody, REPORT_PROCESSED_TOPIC, signersOf, type ChainScan } from '../cre-keys/refresh';
import type { CreKeyFile } from '@ccip-dev/core';

const BASE_SEL = '15971525489660198786';
const FWD = { 'ethereum-mainnet-base-1': '0xf8344cfd5c43616a4366c34e3eee75af79a74482', 'monad-mainnet': '0x76c9cf548b4179f8901cda1f8623568b58215e62' };
const SELECTORS = new Map([['ethereum-mainnet-base-1', BASE_SEL]]);
const OLD = '0x00000000000000000000000000000000000000a1';
const NEW = '0x00000000000000000000000000000000000000b2';
const current: CreKeyFile = {
  source: 's',
  chains: { 'ethereum-mainnet-base-1': { selector: BASE_SEL, forwarder: FWD['ethereum-mainnet-base-1'], keys: [{ address: OLD, first_seen: '2026-11-01' }] } },
};

describe('mergeKeys', () => {
  it('adds new signers with today as first_seen and keeps every known key unchanged', () => {
    // #given
    const scans: ChainScan[] = [{ chain: 'ethereum-mainnet-base-1', signers: [OLD, NEW.toUpperCase().replace('0X', '0x')], error: null }];
    // #when
    const r = mergeKeys(current, scans, FWD, SELECTORS, '2026-11-06');
    // #then
    expect(r.file.chains['ethereum-mainnet-base-1']!.keys).toEqual([
      { address: OLD, first_seen: '2026-11-01' },
      { address: NEW, first_seen: '2026-11-06' },
    ]);
    expect(r.added).toEqual([`ethereum-mainnet-base-1 ${NEW}`]);
  });

  it('keeps a key the scan no longer sees: a rotated-out key still marks its old messages', () => {
    // #when
    const r = mergeKeys(current, [{ chain: 'ethereum-mainnet-base-1', signers: [NEW], error: null }], FWD, SELECTORS, '2026-11-06');
    // #then
    expect(r.file.chains['ethereum-mainnet-base-1']!.keys.map((k) => k.address)).toEqual([OLD, NEW]);
  });

  it("leaves a failed chain's keys exactly as they were and names it", () => {
    // #when
    const r = mergeKeys(current, [{ chain: 'ethereum-mainnet-base-1', signers: null, error: 'HTTP 403' }], FWD, SELECTORS, '2026-11-06');
    // #then
    expect(r.file.chains['ethereum-mainnet-base-1']).toEqual(current.chains['ethereum-mainnet-base-1']);
    expect(r.failed).toEqual(['ethereum-mainnet-base-1: HTTP 403']);
    expect(prBody(r)).toContain('ethereum-mainnet-base-1: HTTP 403');
  });

  it('skips a chain CCIP does not list, since none of its messages can be in D1', () => {
    // #when
    const r = mergeKeys(null, [{ chain: 'monad-mainnet', signers: [NEW], error: null }], FWD, SELECTORS, '2026-11-06');
    // #then
    expect(r.file.chains['monad-mainnet']).toBeUndefined();
    expect(r.skipped).toEqual(['monad-mainnet']);
  });
});

describe('signersOf', () => {
  it("takes the signer of each forwarder report() transaction in the window, narrowing ranges the RPC refuses", async () => {
    // #given an RPC that refuses ranges wider than 1,000 blocks
    const calls: { method: string; params: any[] }[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      const { method, params } = JSON.parse(String(init.body));
      calls.push({ method, params });
      const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
      if (method === 'eth_blockNumber') return reply('0x2710');
      if (method === 'eth_getBlockByNumber') return reply({ timestamp: params[0] === '0x2710' ? '0x15180' : '0x14f8c' });
      if (method === 'eth_getLogs') {
        const span = parseInt(params[0].toBlock, 16) - parseInt(params[0].fromBlock, 16);
        if (span > 1000) return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'range too wide' } }));
        expect(params[0].topics).toEqual([REPORT_PROCESSED_TOPIC]);
        return reply(parseInt(params[0].toBlock, 16) === 10000 ? [{ transactionHash: '0xaa' }, { transactionHash: '0xbb' }] : []);
      }
      if (method === 'eth_getTransactionByHash') return reply({ from: params[0] === '0xaa' ? OLD.toUpperCase().replace('0X', '0x') : NEW });
      throw new Error(`unexpected ${method}`);
    }) as unknown as typeof globalThis.fetch;
    // #when
    const signers = await signersOf({ fetch }, 'https://rpc.test', FWD['ethereum-mainnet-base-1']);
    // #then
    expect(signers).toEqual([OLD, NEW]);
    expect(calls.some((c) => c.method === 'eth_getLogs' && parseInt(c.params[0].toBlock, 16) - parseInt(c.params[0].fromBlock, 16) <= 1000)).toBe(true);
  });
});
