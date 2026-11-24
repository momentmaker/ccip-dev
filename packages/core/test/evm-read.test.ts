import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { encodeCall, MULTICALL3, uintWord, type EvmCall } from '../src/evm-abi';
import { openChain, readCalls, readCode, readStorage, type CallResult } from '../src/evm-read';
import type { HttpDeps } from '../src/http';
import { evmCallKey, fakeEvmChain, fakeFetch, type FakeEvmChain, type FakeEvmChainOptions, type RecordedCall } from '../src/testing';
import recorded from './fixtures/evm/ethereum-link-pool.json';

const selector = (signature: string) => `0x${bytesToHex(keccak_256(utf8ToBytes(signature))).slice(0, 8)}`;

const RPC = 'https://rpc.example';
const BLOCK = recorded.block;
const PINNED = `0x${BLOCK.toString(16)}`;
const TIMESTAMP = recorded.timestamp;
const LINK_POOL = '0x1b7492c3bd23a4adb448710e4275ff14a5288932';
const BURNER = '0x00000000000000000000000000000000000000b0';

const RECORDED: Record<string, RecordedCall> = Object.fromEntries(
  Object.values(recorded.calls)
    .filter((c) => c.to !== MULTICALL3.address)
    .map((c) => [evmCallKey(c.to, c.data), 'result' in c ? (c.result as `0x${string}`) : 'revert']),
);
const OWNER = { to: LINK_POOL, data: selector('owner()') };
const REMOTE_POOL_V150 = { to: LINK_POOL, data: encodeCall(selector('getRemotePool(uint64)'), uintWord(15971525489660198786n)) };
const TOKEN = { to: LINK_POOL, data: selector('getToken()') };
const BURN_OWNER = { to: BURNER, data: selector('owner()') };
const BURN_TOKEN = { to: BURNER, data: selector('getToken()') };
const CALLS: Record<string, RecordedCall> = { ...RECORDED, [evmCallKey(BURNER, BURN_OWNER.data)]: 'burn', [evmCallKey(BURNER, BURN_TOKEN.data)]: 'burn' };

const ANSWERED_OWNER: CallResult = { status: 'answered', data: recorded.calls['pool.owner'].result };
const ANSWERED_TOKEN: CallResult = { status: 'answered', data: recorded.calls['pool.getToken'].result };

const chain = (over: Partial<FakeEvmChainOptions> = {}) => fakeEvmChain({ chainId: 1, latest: BLOCK + 12, timestamp: TIMESTAMP, calls: CALLS, ...over });
const depsFor = (fake: FakeEvmChain, nowS = TIMESTAMP + 60): HttpDeps => ({ fetch: fakeFetch(fake), sleep: async () => {}, clock: () => nowS * 1000 });
const ethCalls = (fake: FakeEvmChain) => fake.requests.filter((r) => r.method === 'eth_call');

async function read(fake: FakeEvmChain, calls: readonly EvmCall[], batchSize?: number) {
  const deps = depsFor(fake);
  const pinned = await openChain(deps, RPC, { chainId: 1 });
  return readCalls(deps, pinned, calls, batchSize);
}

const PINNED_CHAIN = { rpcUrl: RPC, chainId: 1, block: BLOCK, blockHash: `0x${BLOCK.toString(16).padStart(64, '0')}`, timestamp: TIMESTAMP };

/** Reads at the recorded block without opening, so a fake's hiccups land on the reads alone. */
const readAtBlock = (fake: FakeEvmChain, calls: readonly EvmCall[], multicall3: boolean) => readCalls(depsFor(fake), { ...PINNED_CHAIN, multicall3 }, calls);

/** Reads one by one at the recorded block, recording each wait between attempts in `sleeps`. */
const readAtBlockSleeping = (fake: FakeEvmChain, calls: readonly EvmCall[], sleeps: number[]) =>
  readCalls({ ...depsFor(fake), sleep: async (ms) => { sleeps.push(ms); } }, { ...PINNED_CHAIN, multicall3: false }, calls);

describe('openChain', () => {
  it('pins the block 12 behind the latest and trusts Multicall3 once its code and chain id check out', async () => {
    const pinned = await openChain(depsFor(chain()), RPC, { chainId: 1 });
    expect(pinned).toEqual({ rpcUrl: RPC, chainId: 1, block: BLOCK, blockHash: `0x${BLOCK.toString(16).padStart(64, '0')}`, timestamp: TIMESTAMP, multicall3: true });
  });

  it('pins as many blocks behind the latest as it is asked to', async () => {
    expect((await openChain(depsFor(chain()), RPC, { chainId: 1, confirmations: 20 })).block).toBe(BLOCK - 8);
  });

  it('fails as a wrong-chain error before any read when eth_chainId differs from the expected id', async () => {
    const fake = chain();
    await expect(openChain(depsFor(fake), RPC, { chainId: 10 })).rejects.toMatchObject({ name: 'ChainReadError', kind: 'wrong-chain' });
    expect(fake.requests.map((r) => r.method)).toEqual(['eth_chainId']);
  });

  it('fails as a stale-node error when the pinned block is lower than the last accepted block', async () => {
    await expect(openChain(depsFor(chain()), RPC, { chainId: 1, lastBlock: BLOCK + 1 })).rejects.toMatchObject({ kind: 'stale-node' });
  });

  it('accepts a pinned block equal to the last accepted block', async () => {
    expect((await openChain(depsFor(chain()), RPC, { chainId: 1, lastBlock: BLOCK })).block).toBe(BLOCK);
  });

  it('fails as a stale-node error when the pinned block is more than three hours old', async () => {
    await expect(openChain(depsFor(chain(), TIMESTAMP + 3 * 3600 + 1), RPC, { chainId: 1 })).rejects.toMatchObject({ kind: 'stale-node' });
  });

  it('takes another age limit when given one', async () => {
    expect((await openChain(depsFor(chain(), TIMESTAMP + 3 * 3600 + 1), RPC, { chainId: 1, maxAgeS: 4 * 3600 })).block).toBe(BLOCK);
  });

  it('does not use Multicall3 where its address holds no code', async () => {
    expect((await openChain(depsFor(chain({ multicall3: 'absent' })), RPC, { chainId: 1 })).multicall3).toBe(false);
  });

  it('does not use Multicall3 where its getChainId() answers another id', async () => {
    expect((await openChain(depsFor(chain({ multicall3: { chainId: 1088 } })), RPC, { chainId: 1 })).multicall3).toBe(false);
  });

  it('retries a rate limit and a timeout while opening', async () => {
    expect((await openChain(depsFor(chain({ hiccups: { eth_blockNumber: [429, 'timeout'] } })), RPC, { chainId: 1 })).block).toBe(BLOCK);
  });

  it('fails as an endpoint error when a step fails three times', async () => {
    await expect(openChain(depsFor(chain({ hiccups: { eth_getBlockByNumber: [500, 500, 500] } })), RPC, { chainId: 1 })).rejects.toMatchObject({ kind: 'endpoint' });
  });
});

describe('readCalls', () => {
  it('fails the chain instead of one call when the endpoint refuses state with HTTP 403', async () => {
    await expect(readAtBlock(chain({ multicall3: 'absent', hiccups: { eth_call: [403] } }), [OWNER, TOKEN], false)).rejects.toMatchObject({ name: 'ChainReadError', kind: 'endpoint' });
  });

  it('fails the chain instead of one call when the endpoint no longer holds the pinned block state', async () => {
    await expect(readAtBlock(chain({ multicall3: 'absent', hiccups: { eth_call: ['unknown state'] } }), [OWNER, TOKEN], false)).rejects.toMatchObject({ name: 'ChainReadError', kind: 'endpoint' });
  });

  it('answers three calls through one Multicall3 batch at the pinned block, the reverted second one included', async () => {
    const fake = chain();
    expect(await read(fake, [OWNER, REMOTE_POOL_V150, TOKEN])).toEqual([ANSWERED_OWNER, { status: 'reverted' }, ANSWERED_TOKEN]);
    expect(ethCalls(fake).map((r) => [(r.params[0] as EvmCall).to, r.params[1]])).toEqual([
      [MULTICALL3.address, PINNED],
      [MULTICALL3.address, PINNED],
    ]);
  });

  it('gets the same results one by one at the pinned block where Multicall3 has no code', async () => {
    const fake = chain({ multicall3: 'absent' });
    expect(await read(fake, [OWNER, REMOTE_POOL_V150, TOKEN])).toEqual([ANSWERED_OWNER, { status: 'reverted' }, ANSWERED_TOKEN]);
    expect(ethCalls(fake).map((r) => [(r.params[0] as EvmCall).to, r.params[1]])).toEqual([
      [LINK_POOL, PINNED],
      [LINK_POOL, PINNED],
      [LINK_POOL, PINNED],
    ]);
  });

  it('gets the same results one by one where Multicall3 answers another chain id', async () => {
    expect(await read(chain({ multicall3: { chainId: 1088 } }), [OWNER, REMOTE_POOL_V150, TOKEN])).toEqual([ANSWERED_OWNER, { status: 'reverted' }, ANSWERED_TOKEN]);
  });

  it('answers every recorded call the same through Multicall3 and one by one', async () => {
    const calls = Object.values(recorded.calls).filter((c) => c.to !== MULTICALL3.address);
    expect(await read(chain(), calls)).toEqual(await read(chain({ multicall3: 'absent' }), calls));
  });

  it('sends as many Multicall3 batches as the batch size asks', async () => {
    const fake = chain();
    expect(await read(fake, [OWNER, REMOTE_POOL_V150, TOKEN, OWNER], 2)).toEqual([ANSWERED_OWNER, { status: 'reverted' }, ANSWERED_TOKEN, ANSWERED_OWNER]);
    expect(ethCalls(fake).filter((r) => (r.params[0] as EvmCall).data.startsWith(MULTICALL3.aggregate3))).toHaveLength(2);
  });

  it('retries an HTTP 429 and a timeout at the same pinned block', async () => {
    const fake = chain({ multicall3: 'absent', hiccups: { eth_call: [429, 'timeout'] } });
    expect(await read(fake, [OWNER])).toEqual([ANSWERED_OWNER]);
    expect(ethCalls(fake).map((r) => r.params[1])).toEqual([PINNED, PINNED, PINNED]);
  });

  it('retries a node that has not seen the pinned block yet', async () => {
    expect(await readAtBlock(chain({ hiccups: { eth_call: ['header not found'] } }), [OWNER, TOKEN], true)).toEqual([ANSWERED_OWNER, ANSWERED_TOKEN]);
  });

  it('throws after three failed attempts, 0.5 s and 1 s apart, when the endpoint is not rate limiting', async () => {
    const fake = chain({ multicall3: 'absent', hiccups: { eth_call: ['timeout', 500, 'timeout'] } });
    const sleeps: number[] = [];
    await expect(readAtBlockSleeping(fake, [OWNER], sleeps)).rejects.toMatchObject({ name: 'ChainReadError', kind: 'endpoint' });
    expect({ attempts: ethCalls(fake).length, sleeps }).toEqual({ attempts: 3, sleeps: [500, 1000] });
  });

  it('answers after an HTTP 429, waiting 1 s', async () => {
    const fake = chain({ multicall3: 'absent', hiccups: { eth_call: [429] } });
    const sleeps: number[] = [];
    expect({ results: await readAtBlockSleeping(fake, [OWNER], sleeps), sleeps }).toEqual({ results: [ANSWERED_OWNER], sleeps: [1000] });
  });

  it('waits the 2 s an HTTP 429 asks for in its Retry-After', async () => {
    const fake = chain({ multicall3: 'absent', hiccups: { eth_call: [{ status: 429, retryAfter: '2' }] } });
    const sleeps: number[] = [];
    expect({ results: await readAtBlockSleeping(fake, [OWNER], sleeps), sleeps }).toEqual({ results: [ANSWERED_OWNER], sleeps: [2000] });
  });

  it('waits no more than 10 s for a Retry-After of a minute', async () => {
    const fake = chain({ multicall3: 'absent', hiccups: { eth_call: [{ status: 503, retryAfter: '60' }] } });
    const sleeps: number[] = [];
    expect({ results: await readAtBlockSleeping(fake, [OWNER], sleeps), sleeps }).toEqual({ results: [ANSWERED_OWNER], sleeps: [10_000] });
  });

  it('throws as an endpoint error after four HTTP 429s, 1 s, 2 s and 4 s apart', async () => {
    const fake = chain({ multicall3: 'absent', hiccups: { eth_call: [429, 429, 429, 429] } });
    const sleeps: number[] = [];
    await expect(readAtBlockSleeping(fake, [OWNER], sleeps)).rejects.toMatchObject({ name: 'ChainReadError', kind: 'endpoint' });
    expect({ attempts: ethCalls(fake).length, sleeps }).toEqual({ attempts: 4, sleeps: [1000, 2000, 4000] });
  });

  it('answers on the fourth attempt after three HTTP 503s, 1 s, 2 s and 4 s apart', async () => {
    const fake = chain({ multicall3: 'absent', hiccups: { eth_call: [503, 503, 503] } });
    const sleeps: number[] = [];
    expect({ results: await readAtBlockSleeping(fake, [OWNER], sleeps), sleeps }).toEqual({ results: [ANSWERED_OWNER], sleeps: [1000, 2000, 4000] });
  });

  it('throws when the endpoint stops answering a Multicall3 batch and its halves', async () => {
    await expect(readAtBlock(chain({ hiccups: { eth_call: Array<429>(40).fill(429) } }), [OWNER, REMOTE_POOL_V150, TOKEN], true)).rejects.toMatchObject({ kind: 'endpoint' });
  });

  it('splits a batch that fails because one callee burns its gas, and fails only the calls to that callee', async () => {
    const fake = chain();
    expect(await read(fake, [OWNER, BURN_OWNER, TOKEN, BURN_TOKEN])).toEqual([
      ANSWERED_OWNER,
      { status: 'failed', reason: expect.stringMatching(/out of gas/) },
      ANSWERED_TOKEN,
      { status: 'failed', reason: expect.stringMatching(/out of gas/) },
    ]);
  });

  it('fails a callee that burns its gas as a single call while the other calls answer', async () => {
    expect(await read(chain({ multicall3: 'absent' }), [OWNER, BURN_OWNER, TOKEN])).toEqual([
      ANSWERED_OWNER,
      { status: 'failed', reason: expect.stringMatching(/out of gas/) },
      ANSWERED_TOKEN,
    ]);
  });
});

describe('readCode and readStorage', () => {
  const OWNER_EOA = '0x00000000000000000000000000000000000000e0';
  const ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
  const ADMIN_WORD = `0x${'0'.repeat(24)}${'ad'.repeat(20)}`;

  it('reads the code at an address at the pinned block, and an address with none answers 0x', async () => {
    const fake = chain({ code: { [LINK_POOL]: '0x6080ABCD' } });
    const deps = depsFor(fake);
    const pinned = await openChain(deps, RPC, { chainId: 1 });
    expect(await readCode(deps, pinned, LINK_POOL)).toEqual({ status: 'answered', data: '0x6080abcd' });
    expect(await readCode(deps, pinned, OWNER_EOA)).toEqual({ status: 'answered', data: '0x' });
    expect(fake.requests.filter((r) => r.method === 'eth_getCode').at(-1)?.params).toEqual([OWNER_EOA, PINNED]);
  });

  it('reads one storage slot at the pinned block', async () => {
    const fake = chain({ storage: { [`${LINK_POOL}:${ADMIN_SLOT}`]: ADMIN_WORD } });
    const deps = depsFor(fake);
    const pinned = await openChain(deps, RPC, { chainId: 1 });
    expect(await readStorage(deps, pinned, LINK_POOL, ADMIN_SLOT)).toEqual({ status: 'answered', data: ADMIN_WORD });
    expect(fake.requests.at(-1)).toEqual({ method: 'eth_getStorageAt', params: [LINK_POOL, ADMIN_SLOT, PINNED] });
  });

  it('fails only the read when the node refuses eth_getStorageAt', async () => {
    const deps = depsFor(chain({ storage: 'unsupported' }));
    const pinned = await openChain(deps, RPC, { chainId: 1 });
    expect(await readStorage(deps, pinned, LINK_POOL, ADMIN_SLOT)).toEqual({ status: 'failed', reason: expect.stringMatching(/does not exist/) });
  });

  it('retries eth_getCode on a rate limit and answers once the endpoint does', async () => {
    const fake = chain({ code: { [LINK_POOL]: '0x60' }, hiccups: { eth_getCode: [429] } });
    const deps = depsFor(fake);
    const pinned = await openChain(deps, RPC, { chainId: 1, });
    fake.requests.length = 0;
    expect(await readCode(deps, pinned, LINK_POOL)).toEqual({ status: 'answered', data: '0x60' });
  });
});
