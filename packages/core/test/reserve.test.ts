import { describe, expect, it } from 'vitest';
import { DEFAULT_RPC_URLS, LINK_RESERVE, LINK_TOKEN, LOG_RPC_URLS, readBlockNumber, readLinkBalance, readReserveTransfers, RESERVE_FIRST_BLOCK } from '../src/reserve';
import { fakeFetch, jsonResponse } from '../src/testing';

const BALANCE = 6122201n * 10n ** 18n;

describe('readLinkBalance', () => {
  it('calls balanceOf(reserve) on the LINK token', async () => {
    const f = fakeFetch(() => jsonResponse({ jsonrpc: '2.0', id: 1, result: `0x${BALANCE.toString(16)}` }));
    await expect(readLinkBalance({ fetch: f }, ['https://rpc.one'])).resolves.toBe(BALANCE);
    const body = JSON.parse(String(f.calls[0]!.init?.body));
    expect(body.params[0]).toEqual({ to: LINK_TOKEN, data: `0x70a08231${LINK_RESERVE.slice(2).toLowerCase().padStart(64, '0')}` });
  });

  it('falls back to the next endpoint', async () => {
    const f = fakeFetch((url) =>
      url.includes('one') ? jsonResponse({}, 500) : jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x1' }),
    );
    await expect(readLinkBalance({ fetch: f }, ['https://rpc.one', 'https://rpc.two'])).resolves.toBe(1n);
  });

  it('returns the balance from the next default endpoint when the first is rate-limited', async () => {
    expect(DEFAULT_RPC_URLS.length).toBeGreaterThan(1);
    const f = fakeFetch((url) =>
      url === DEFAULT_RPC_URLS[0] ? jsonResponse({}, 429) : jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x2' }),
    );
    await expect(readLinkBalance({ fetch: f }, DEFAULT_RPC_URLS)).resolves.toBe(2n);
  });

  it('never puts endpoint URLs (which may contain API keys) in its error', async () => {
    const f = fakeFetch(() => jsonResponse({ error: { message: 'boom' } }));
    const err = await readLinkBalance({ fetch: f }, ['https://key-SECRET.example/v1']).catch((e: Error) => e);
    expect((err as Error).message).not.toContain('SECRET');
  });
});

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const word = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
const DEPOSITOR = '0x5680681ed3767b96914ce741a308155c7fb9171d';
const OTHER = '0x176c2ee163d764dcea38bc1340639b398b4fe713';

function rpcLog(o: { block: number; index: number; tx: string; from: string; to: string; amount: bigint; time?: number; removed?: boolean }) {
  return {
    blockNumber: `0x${o.block.toString(16)}`,
    logIndex: `0x${o.index.toString(16)}`,
    transactionHash: o.tx,
    topics: [TRANSFER, word(o.from), word(o.to)],
    data: `0x${o.amount.toString(16).padStart(64, '0')}`,
    ...(o.time === undefined ? {} : { blockTimestamp: `0x${o.time.toString(16)}` }),
    ...(o.removed ? { removed: true } : {}),
  };
}

type Handler = (params: any[]) => unknown;
const rpcByMethod = (handlers: Record<string, Handler>) =>
  fakeFetch((_url, init) => {
    const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: any[] };
    const handler = handlers[method];
    return handler
      ? jsonResponse({ jsonrpc: '2.0', id: 1, result: handler(params) })
      : jsonResponse({ jsonrpc: '2.0', id: 1, error: { message: `no handler for ${method}` } });
  });
const isInbound = (params: any[]) => params[0].topics[1] === null;

describe('Reserve scan constants', () => {
  it('starts at the first Reserve transfer and lists two keyless log endpoints', () => {
    expect(RESERVE_FIRST_BLOCK).toBe(23_039_541);
    expect(LOG_RPC_URLS).toEqual(['https://rpc.mevblocker.io', 'https://0xrpc.io/eth']);
  });
});

describe('readLinkBalance at a block', () => {
  it('passes the block as a hex tag', async () => {
    const f = rpcByMethod({ eth_call: () => '0x5' });
    await expect(readLinkBalance({ fetch: f }, ['https://rpc.one'], 26_000_000)).resolves.toBe(5n);
    expect(JSON.parse(String(f.calls[0]!.init?.body)).params[1]).toBe('0x18cba80');
  });
});

describe('readBlockNumber', () => {
  it('returns the head block as a number', async () => {
    const f = rpcByMethod({ eth_blockNumber: () => '0x18ec41f' });
    await expect(readBlockNumber({ fetch: f }, ['https://rpc.one'])).resolves.toBe(26_133_535);
  });
});

describe('readReserveTransfers', () => {
  it('reads inbound and outbound LINK transfers with block times, oldest first', async () => {
    const f = rpcByMethod({
      eth_getLogs: (params) =>
        isInbound(params)
          ? [rpcLog({ block: 101, index: 4, tx: '0xAA', from: DEPOSITOR, to: LINK_RESERVE, amount: 5n * 10n ** 18n, time: 1_790_000_000 })]
          : [rpcLog({ block: 100, index: 2, tx: '0xBB', from: LINK_RESERVE, to: OTHER, amount: 10n ** 18n, time: 1_789_999_988 })],
    });
    await expect(readReserveTransfers({ fetch: f }, ['https://rpc.one'], 100, 101)).resolves.toEqual([
      { txHash: '0xbb', logIndex: 2, blockNumber: 100, ts: '2026-09-21T14:13:08.000Z', direction: 'out', counterparty: OTHER, amount: '1000000000000000000' },
      { txHash: '0xaa', logIndex: 4, blockNumber: 101, ts: '2026-09-21T14:13:20.000Z', direction: 'in', counterparty: DEPOSITOR, amount: '5000000000000000000' },
    ]);
  });

  it('asks for LINK Transfer logs with the Reserve as recipient and as sender over the given range', async () => {
    const f = rpcByMethod({ eth_getLogs: () => [] });
    await readReserveTransfers({ fetch: f }, ['https://rpc.one'], 23_039_541, 23_049_540);
    const filters = f.calls.map((call) => JSON.parse(String(call.init?.body)).params[0]);
    const reserve = word(LINK_RESERVE);
    expect(filters).toEqual([
      { address: LINK_TOKEN, fromBlock: '0x15f8e35', toBlock: '0x15fb544', topics: [TRANSFER, null, reserve] },
      { address: LINK_TOKEN, fromBlock: '0x15f8e35', toBlock: '0x15fb544', topics: [TRANSFER, reserve] },
    ]);
  });

  it('fetches the block time once per block for logs that omit blockTimestamp', async () => {
    const f = rpcByMethod({
      eth_getLogs: (params) =>
        isInbound(params)
          ? [
              rpcLog({ block: 200, index: 0, tx: '0x01', from: DEPOSITOR, to: LINK_RESERVE, amount: 1n }),
              rpcLog({ block: 200, index: 1, tx: '0x02', from: OTHER, to: LINK_RESERVE, amount: 2n }),
              rpcLog({ block: 201, index: 0, tx: '0x03', from: OTHER, to: LINK_RESERVE, amount: 3n, time: 1_790_000_024 }),
            ]
          : [],
      eth_getBlockByNumber: () => ({ timestamp: `0x${(1_790_000_012).toString(16)}` }),
    });
    const transfers = await readReserveTransfers({ fetch: f }, ['https://rpc.one'], 200, 201);
    expect(transfers.map((t) => t.ts)).toEqual(['2026-09-21T14:13:32.000Z', '2026-09-21T14:13:32.000Z', '2026-09-21T14:13:44.000Z']);
    const blockCalls = f.calls.filter((call) => JSON.parse(String(call.init?.body)).method === 'eth_getBlockByNumber');
    expect(blockCalls).toHaveLength(1);
  });

  it('ignores removed logs', async () => {
    const f = rpcByMethod({
      eth_getLogs: (params) =>
        isInbound(params) ? [rpcLog({ block: 300, index: 0, tx: '0x09', from: DEPOSITOR, to: LINK_RESERVE, amount: 1n, time: 1, removed: true })] : [],
    });
    await expect(readReserveTransfers({ fetch: f }, ['https://rpc.one'], 300, 300)).resolves.toEqual([]);
  });

  it('ignores zero-value transfers in both directions', async () => {
    const f = rpcByMethod({
      eth_getLogs: (params) =>
        isInbound(params)
          ? [
              rpcLog({ block: 400, index: 0, tx: '0x0a', from: DEPOSITOR, to: LINK_RESERVE, amount: 0n, time: 1 }),
              rpcLog({ block: 400, index: 1, tx: '0x0b', from: DEPOSITOR, to: LINK_RESERVE, amount: 5n * 10n ** 18n, time: 1 }),
            ]
          : [rpcLog({ block: 400, index: 2, tx: '0x0c', from: LINK_RESERVE, to: OTHER, amount: 0n, time: 1 })],
    });
    const transfers = await readReserveTransfers({ fetch: f }, ['https://rpc.one'], 400, 400);
    expect(transfers.map((t) => t.txHash)).toEqual(['0x0b']);
  });

  it('falls back to the next endpoint when one fails mid-scan, and never names an endpoint in its error', async () => {
    const working = rpcByMethod({ eth_getLogs: () => [] });
    const f = fakeFetch((url, init) => (url.includes('SECRET') ? jsonResponse({}, 429) : working(url, init)));
    await expect(readReserveTransfers({ fetch: f }, ['https://key-SECRET.example', 'https://rpc.two'], 1, 2)).resolves.toEqual([]);
    const allDown = fakeFetch(() => jsonResponse({}, 503));
    const err = await readReserveTransfers({ fetch: allDown }, ['https://key-SECRET.example'], 1, 2).catch((e: Error) => e);
    expect((err as Error).message).toContain('Reserve transfer scan of blocks 1-2 failed on every RPC endpoint');
    expect((err as Error).message).not.toContain('SECRET');
  });
});
