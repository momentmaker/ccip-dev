import { describe, expect, it } from 'vitest';
import { blockNear, budgeted, historicalScan, mergeKeys, prBody, REPORT_PROCESSED_TOPIC, signersOf, sinceSeconds, unionKeys, weekStarts, type ChainScan } from '../cre-keys/refresh';
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

describe('signersOf with a missing transaction', () => {
  it('skips a report transaction the RPC answers null for, and keeps the other signers', async () => {
    // #given an RPC that has lost one report transaction
    const fetch = (async (_url: string, init: RequestInit) => {
      const { method, params } = JSON.parse(String(init.body));
      const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
      if (method === 'eth_blockNumber') return reply('0x2710');
      if (method === 'eth_getBlockByNumber') return reply({ timestamp: params[0] === '0x2710' ? '0x15180' : '0x14f8c' });
      if (method === 'eth_getLogs') return reply(parseInt(params[0].toBlock, 16) === 10000 ? [{ transactionHash: '0xaa' }, { transactionHash: '0xbb' }] : []);
      if (method === 'eth_getTransactionByHash') return reply(params[0] === '0xaa' ? null : { from: NEW });
      throw new Error(`unexpected ${method}`);
    }) as unknown as typeof globalThis.fetch;
    // #when
    const signers = await signersOf({ fetch }, 'https://rpc.test', FWD['ethereum-mainnet-base-1']);
    // #then
    expect(signers).toEqual([NEW]);
  });
});

const DAY_S = 86_400;
const at = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;

describe('weekStarts', () => {
  it('plans one window a week from the first day, the last one before now', () => {
    // #when
    const starts = weekStarts(at('2025-10-17'), at('2025-11-01') + 3600);
    // #then
    expect(starts).toEqual([at('2025-10-17'), at('2025-10-24'), at('2025-10-31')]);
  });

  it('plans nothing when the first day is not before now', () => {
    // #when
    const starts = weekStarts(at('2025-11-01'), at('2025-11-01'));
    // #then
    expect(starts).toEqual([]);
  });
});

/** A 2-second chain whose block 0 is at GENESIS. */
const GENESIS = at('2025-10-01');
const HEAD = (at('2025-11-05') - GENESIS) / 2;
const blockAt = (ts: number) => Math.floor((ts - GENESIS) / 2);

describe('blockNear', () => {
  it('finds a block within hours of the target from the head and its block time', async () => {
    // #given
    const reads: number[] = [];
    const timestampOf = async (n: number) => {
      reads.push(n);
      return GENESIS + 2 * n;
    };
    // #when
    const block = await blockNear(timestampOf, at('2025-10-17'), { head: HEAD, headTs: GENESIS + 2 * HEAD, secondsPerBlock: 2.4 });
    // #then
    expect(Math.abs(GENESIS + 2 * block - at('2025-10-17'))).toBeLessThanOrEqual(6 * 3600);
    expect(reads.length).toBeLessThanOrEqual(3);
  });

  it('stops at block 0 for a target before the chain began', async () => {
    // #when
    const block = await blockNear(async (n) => GENESIS + 2 * n, at('2025-01-01'), { head: HEAD, headTs: GENESIS + 2 * HEAD, secondsPerBlock: 2 });
    // #then
    expect(block).toBe(0);
  });
});

describe('historical scan', () => {
  const RETIRED = '0x00000000000000000000000000000000000000c3';
  const RETIRED_UNTIL = blockAt(at('2025-10-20'));
  const ARCHIVE = 'https://archive.test';
  const PRUNED = 'https://pruned.test';
  const BROKEN_WEEK = blockAt(at('2025-10-24'));

  /** PRUNED refuses logs older than a week back; ARCHIVE serves all of them but fails the week of 2025-10-24. */
  function chainRpc(calls: string[]): typeof globalThis.fetch {
    return (async (url: string, init: RequestInit) => {
      const { method, params } = JSON.parse(String(init.body));
      calls.push(`${url} ${method}`);
      const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
      const refuse = (message: string) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message } }));
      if (method === 'eth_blockNumber') return reply(`0x${HEAD.toString(16)}`);
      if (method === 'eth_getBlockByNumber') return reply({ timestamp: `0x${(GENESIS + 2 * parseInt(params[0], 16)).toString(16)}` });
      if (method === 'eth_getLogs') {
        const from = parseInt(params[0].fromBlock, 16);
        if (url === PRUNED && from < HEAD - 7 * DAY_S / 2) return refuse('missing trie node');
        if (url === ARCHIVE && Math.abs(from - BROKEN_WEEK) < 7 * DAY_S / 4) return new Response('busy', { status: 503 });
        return reply([{ transactionHash: `0x${from.toString(16)}` }, { transactionHash: '0xdead' }]);
      }
      if (method === 'eth_getTransactionByHash') {
        if (params[0] === '0xdead') return reply(null);
        return reply({ from: parseInt(params[0], 16) < RETIRED_UNTIL ? RETIRED : NEW });
      }
      throw new Error(`unexpected ${method}`);
    }) as unknown as typeof globalThis.fetch;
  }

  it('reads a window a week, on the next endpoint when one refuses old logs, and counts the windows no endpoint served', async () => {
    // #given weeks starting 10-17, 10-24, 10-31
    const calls: string[] = [];
    // #when
    const scan = await historicalScan({ fetch: chainRpc(calls) }, [PRUNED, ARCHIVE], 'ethereum-mainnet-base-1', FWD['ethereum-mainnet-base-1'], weekStarts(at('2025-10-17'), at('2025-11-05')));
    // #then
    expect(scan).toEqual({ chain: 'ethereum-mainnet-base-1', signers: [NEW, RETIRED], error: null, windows: { read: 2, skipped: 1 } });
  });

  it('adds a retired key the daily scan never saw, with the run day as first_seen, and lists the windows in the PR body', async () => {
    // #given
    const scan = await historicalScan({ fetch: chainRpc([]) }, [ARCHIVE], 'ethereum-mainnet-base-1', FWD['ethereum-mainnet-base-1'], weekStarts(at('2025-10-17'), at('2025-11-05')));
    // #when
    const r = mergeKeys(current, [scan], FWD, SELECTORS, '2026-11-06');
    // #then
    expect(r.file.chains['ethereum-mainnet-base-1']!.keys).toEqual([
      { address: OLD, first_seen: '2026-11-01' },
      { address: NEW, first_seen: '2026-11-06' },
      { address: RETIRED, first_seen: '2026-11-06' },
    ]);
    expect(r.windows).toEqual(['ethereum-mainnet-base-1: 2 of 3 weekly windows read, 1 skipped']);
    expect(prBody(r)).toContain('- `ethereum-mainnet-base-1: 2 of 3 weekly windows read, 1 skipped`');
  });

  it('fails the chain, keeping its keys, when no window could be read', async () => {
    // #given
    const fetch = (async () => new Response('busy', { status: 503 })) as unknown as typeof globalThis.fetch;
    const scan = await historicalScan({ fetch }, [ARCHIVE], 'ethereum-mainnet-base-1', FWD['ethereum-mainnet-base-1'], weekStarts(at('2025-10-17'), at('2025-11-05')));
    // #when
    const r = mergeKeys(current, [scan], FWD, SELECTORS, '2026-11-06');
    // #then
    expect(r.file.chains['ethereum-mainnet-base-1']).toEqual(current.chains['ethereum-mainnet-base-1']);
    expect(r.failed).toEqual(['ethereum-mainnet-base-1: no weekly window read (archive.test: HTTP 503)']);
    expect(r.windows).toEqual(['ethereum-mainnet-base-1: 0 of 3 weekly windows read, 3 skipped']);
  });

  it('skips the windows left once the call budget is spent', async () => {
    // #given a budget of 12 calls
    const calls: string[] = [];
    const deps = budgeted({ fetch: chainRpc(calls) }, 12, Number.POSITIVE_INFINITY);
    // #when
    const scan = await historicalScan(deps, [ARCHIVE], 'ethereum-mainnet-base-1', FWD['ethereum-mainnet-base-1'], weekStarts(at('2025-10-03'), at('2025-11-05')));
    // #then
    expect(calls.length).toBe(12);
    expect(scan.windows!.read + scan.windows!.skipped).toBe(5);
    expect(scan.windows!.skipped).toBeGreaterThan(0);
  });
});

describe('unionKeys', () => {
  it("keeps the keys an open refresh PR found that the base file lacks, and the base file's own keys", () => {
    // #given the open PR's file found NEW; the base file has OLD only
    const open: CreKeyFile = {
      source: 's',
      chains: { 'ethereum-mainnet-base-1': { selector: BASE_SEL, forwarder: FWD['ethereum-mainnet-base-1'], keys: [{ address: NEW, first_seen: '2026-11-03' }, { address: OLD, first_seen: '2026-11-02' }] } },
    };
    // #when
    const merged = unionKeys(current, open);
    // #then
    expect(merged!.chains['ethereum-mainnet-base-1']!.keys).toEqual([
      { address: OLD, first_seen: '2026-11-01' },
      { address: NEW, first_seen: '2026-11-03' },
    ]);
  });

  it('is the base file when there is no open PR', () => {
    // #when
    const merged = unionKeys(current, null);
    // #then
    expect(merged).toBe(current);
  });
});

describe('sinceSeconds', () => {
  it('reads a UTC day', () => {
    // #when
    const seconds = sinceSeconds('2025-10-17', at('2026-11-05'));
    // #then
    expect(seconds).toBe(at('2025-10-17'));
  });

  it.each(['2025-1-17', 'yesterday', '2026-11-05'])('refuses %s', (since) => {
    // #when
    const read = () => sinceSeconds(since, at('2026-11-05'));
    // #then
    expect(read).toThrow(/--since wants a past UTC day/);
  });
});
