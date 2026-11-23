import { z } from 'zod';
import { decodeAggregate3, decodeValue, encodeAggregate3, HEX_DATA, MULTICALL3, type EvmCall } from './evm-abi';
import { ethRpc, HEX_QUANTITY, isRevert, NO_RESULT, toHex, type Fetcher } from './eth-rpc';
import { retryAfterMs, type HttpDeps } from './http';

export const READ_DEFAULTS = { confirmations: 12, maxAgeS: 3 * 3600, batchSize: 100 } as const;
const ATTEMPTS = 3;
const BACKOFF_MS = 500;
const RATE_LIMITED_ATTEMPTS = 4;
const RATE_LIMITED_BACKOFF_MS = 1000;
const MAX_RETRY_AFTER_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;

export type ChainReadErrorKind = 'wrong-chain' | 'stale-node' | 'endpoint';

/** Why a chain gave no reading: it is not the chain asked for, its node is behind, or its endpoint stopped answering. */
export class ChainReadError extends Error {
  constructor(readonly kind: ChainReadErrorKind, message: string) {
    super(message);
    this.name = 'ChainReadError';
  }
}

export interface OpenChainOptions {
  chainId: number;
  /** The block of the chain's last accepted reading; a node behind it is stale. */
  lastBlock?: number | null;
  confirmations?: number;
  maxAgeS?: number;
}

/** A chain checked and pinned to one block, which every read through readCalls uses. */
export interface PinnedChain {
  rpcUrl: string;
  chainId: number;
  block: number;
  blockHash: string;
  timestamp: number;
  multicall3: boolean;
}

export type CallResult = { status: 'answered'; data: string } | { status: 'reverted' } | { status: 'failed'; reason: string };

const BlockHeader = z.object({ hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), timestamp: z.string().regex(HEX_QUANTITY) });
/** Errors that say nothing about the call itself: rate limits, server errors and a node that does not hold the block yet. */
const RETRYABLE = /^HTTP (429|5\d\d)$|rate limit|too many requests|limit exceeded|header not found|block not found|unknown block|missing trie node|timeout|timed out/i;
const RATE_LIMITED = /^HTTP (429|503)$/;

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const transport = err.name === 'TimeoutError' || err.name === 'AbortError' || err instanceof TypeError || err instanceof SyntaxError;
  return transport || err.message === NO_RESULT || RETRYABLE.test(err.message);
}

/**
 * One JSON-RPC request, retried on a retryable error; after the last attempt the endpoint counts as no longer answering.
 * An HTTP 429 or 503 gets a longer schedule, or the wait its Retry-After asks for, up to MAX_RETRY_AFTER_MS.
 */
async function request(deps: HttpDeps, rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const last = { retryAfterMs: null as number | null };
  const timed: Fetcher = {
    fetch: async (input, init) => {
      const res = await deps.fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      last.retryAfterMs = retryAfterMs(res);
      return res;
    },
  };
  for (let attempt = 1; ; attempt++) {
    try {
      return await ethRpc(timed, rpcUrl, method, params);
    } catch (err) {
      if (!isRetryable(err)) throw err;
      const limited = RATE_LIMITED.test(messageOf(err));
      if (attempt >= (limited ? RATE_LIMITED_ATTEMPTS : ATTEMPTS)) throw new ChainReadError('endpoint', `${rpcUrl}: ${method} failed ${attempt} times, last with ${messageOf(err)}`);
      const backoff = (limited ? RATE_LIMITED_BACKOFF_MS : BACKOFF_MS) * 2 ** (attempt - 1);
      await deps.sleep(limited ? Math.min(last.retryAfterMs ?? backoff, MAX_RETRY_AFTER_MS) : backoff);
    }
  }
}

async function openingStep<T>(deps: HttpDeps, rpcUrl: string, method: string, params: unknown[], parse: (value: unknown) => T): Promise<T> {
  try {
    return parse(await request(deps, rpcUrl, method, params));
  } catch (err) {
    if (err instanceof ChainReadError) throw err;
    throw new ChainReadError('endpoint', `${rpcUrl}: ${method} failed: ${messageOf(err)}`);
  }
}

const quantity = (value: unknown) => BigInt(z.string().regex(HEX_QUANTITY).parse(value));

async function multicallMatches(deps: HttpDeps, rpcUrl: string, chainId: number, blockTag: string): Promise<boolean> {
  const code = await openingStep(deps, rpcUrl, 'eth_getCode', [MULTICALL3.address, blockTag], (v) => z.string().regex(HEX_DATA).parse(v));
  if (code === '0x') return false;
  try {
    const answer = await request(deps, rpcUrl, 'eth_call', [{ to: MULTICALL3.address, data: MULTICALL3.getChainId }, blockTag]);
    return decodeValue(answer, 'uint256') === BigInt(chainId);
  } catch (err) {
    if (err instanceof ChainReadError) throw err;
    return false;
  }
}

/**
 * Checks the endpoint serves the expected chain, pins a block `confirmations` behind its latest, and refuses a block lower
 * than the last accepted one or older than `maxAgeS`. Multicall3 is used only once its code is there and its getChainId()
 * answers the expected id.
 */
export async function openChain(deps: HttpDeps, rpcUrl: string, options: OpenChainOptions): Promise<PinnedChain> {
  const { chainId, lastBlock = null, confirmations = READ_DEFAULTS.confirmations, maxAgeS = READ_DEFAULTS.maxAgeS } = options;
  const answeredId = await openingStep(deps, rpcUrl, 'eth_chainId', [], quantity);
  if (answeredId !== BigInt(chainId)) throw new ChainReadError('wrong-chain', `${rpcUrl} serves chain ${answeredId}, expected ${chainId}`);
  const block = Number(await openingStep(deps, rpcUrl, 'eth_blockNumber', [], quantity)) - confirmations;
  if (lastBlock !== null && block < lastBlock) throw new ChainReadError('stale-node', `${rpcUrl} pins block ${block}, below the last accepted block ${lastBlock}`);
  const blockTag = toHex(block);
  const header = await openingStep(deps, rpcUrl, 'eth_getBlockByNumber', [blockTag, false], (v) => BlockHeader.parse(v));
  const timestamp = Number(BigInt(header.timestamp));
  const ageS = deps.clock() / 1000 - timestamp;
  if (ageS > maxAgeS) throw new ChainReadError('stale-node', `${rpcUrl} pins block ${block}, ${Math.round(ageS)} s old, over the ${maxAgeS} s limit`);
  const multicall3 = await multicallMatches(deps, rpcUrl, chainId, blockTag);
  return { rpcUrl, chainId, block, blockHash: header.hash.toLowerCase(), timestamp, multicall3 };
}

async function nodeRead(deps: HttpDeps, chain: PinnedChain, method: string, params: unknown[]): Promise<CallResult> {
  try {
    const data = await request(deps, chain.rpcUrl, method, params);
    if (typeof data !== 'string' || !HEX_DATA.test(data)) return { status: 'failed', reason: 'malformed answer' };
    return { status: 'answered', data: data.toLowerCase() };
  } catch (err) {
    if (err instanceof ChainReadError) throw err;
    const message = messageOf(err);
    return isRevert(message) ? { status: 'reverted' } : { status: 'failed', reason: message };
  }
}

const readOne = (deps: HttpDeps, chain: PinnedChain, call: EvmCall): Promise<CallResult> =>
  nodeRead(deps, chain, 'eth_call', [{ to: call.to, data: call.data }, toHex(chain.block)]);

/** The code at an address at the pinned block; `0x` when it has none. */
export function readCode(deps: HttpDeps, chain: PinnedChain, address: string): Promise<CallResult> {
  return nodeRead(deps, chain, 'eth_getCode', [address, toHex(chain.block)]);
}

/** One storage word at the pinned block. A node that refuses eth_getStorageAt fails this read alone. */
export function readStorage(deps: HttpDeps, chain: PinnedChain, address: string, slot: string): Promise<CallResult> {
  return nodeRead(deps, chain, 'eth_getStorageAt', [address, slot, toHex(chain.block)]);
}

/** One aggregate3 request; a batch it cannot answer is halved until each call stands alone. */
async function readBatch(deps: HttpDeps, chain: PinnedChain, calls: readonly EvmCall[]): Promise<CallResult[]> {
  if (calls.length === 1) return [await readOne(deps, chain, calls[0]!)];
  try {
    const answer = await request(deps, chain.rpcUrl, 'eth_call', [{ to: MULTICALL3.address, data: encodeAggregate3(calls) }, toHex(chain.block)]);
    const results = decodeAggregate3(answer);
    if (results !== null && results.length === calls.length) {
      return results.map((r): CallResult => (r.success ? { status: 'answered', data: r.data } : { status: 'reverted' }));
    }
  } catch {
    // Any failure of the whole batch, a dead endpoint included, is settled by the halves: a call alone either answers,
    // fails by itself, or throws once the endpoint stops answering it.
  }
  const half = Math.ceil(calls.length / 2);
  return [...(await readBatch(deps, chain, calls.slice(0, half))), ...(await readBatch(deps, chain, calls.slice(half)))];
}

/**
 * Every call at the pinned block, results in call order. A revert is an answer; a call that fails by itself comes back
 * failed while the rest answer. Throws a ChainReadError only when the endpoint stops answering.
 */
export async function readCalls(deps: HttpDeps, chain: PinnedChain, calls: readonly EvmCall[], batchSize: number = READ_DEFAULTS.batchSize): Promise<CallResult[]> {
  const out: CallResult[] = [];
  if (!chain.multicall3) {
    for (const call of calls) out.push(await readOne(deps, chain, call));
    return out;
  }
  for (let i = 0; i < calls.length; i += batchSize) out.push(...(await readBatch(deps, chain, calls.slice(i, i + batchSize))));
  return out;
}
