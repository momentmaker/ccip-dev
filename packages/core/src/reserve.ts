import { z } from 'zod';
import { USER_AGENT, type HttpDeps } from './http';

export const LINK_TOKEN = '0x514910771AF9Ca656af840dff83E8264EcF986CA';
export const LINK_TOKEN_CHAIN_SELECTOR = '5009297550715157269';
export const LINK_PRICE_KEY = `ethereum:${LINK_TOKEN}`;
export const LINK_RESERVE = '0x9A709B7B69EA42D5eeb1ceBC48674C69E1569eC6';
export const DEFAULT_RPC_URLS = [
  'https://eth.drpc.org',
  'https://eth.merkle.io',
  'https://ethereum-rpc.publicnode.com',
  'https://rpc.mevblocker.io',
  'https://eth-mainnet.public.blastapi.io',
];
export const LOG_RPC_URLS = ['https://rpc.mevblocker.io', 'https://0xrpc.io/eth'];
export const RESERVE_FIRST_BLOCK = 23_039_541;

const BALANCE_OF = '0x70a08231';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const RESERVE_TOPIC = `0x${LINK_RESERVE.slice(2).toLowerCase().padStart(64, '0')}`;
const HEX_QUANTITY = /^0x[0-9a-fA-F]+$/;

export interface ReserveTransfer {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  ts: string;
  direction: 'in' | 'out';
  counterparty: string;
  amount: string;
}

const Quantity = z.string().regex(HEX_QUANTITY);
const RpcLogs = z.array(
  z.object({
    blockNumber: Quantity,
    transactionHash: z.string(),
    logIndex: Quantity,
    topics: z.array(z.string()).min(3),
    data: Quantity,
    blockTimestamp: Quantity.optional(),
    removed: z.boolean().optional(),
  }),
);
const RpcBlock = z.object({ timestamp: Quantity });

type Fetcher = Pick<HttpDeps, 'fetch'>;

const toHex = (n: number) => `0x${n.toString(16)}`;

async function rpc(deps: Fetcher, url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await deps.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.result === undefined || body.result === null) throw new Error(body.error?.message ?? 'no result');
  return body.result;
}

function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !HEX_QUANTITY.test(value)) throw new Error('malformed result');
  return BigInt(value);
}

async function onFirstEndpoint<T>(rpcUrls: string[], what: string, attempt: (url: string) => Promise<T>): Promise<T> {
  const failures: string[] = [];
  for (const [index, url] of rpcUrls.entries()) {
    try {
      return await attempt(url);
    } catch (err) {
      failures.push(`endpoint ${index + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`${what} failed on every RPC endpoint (${failures.join('; ')})`);
}

export async function readLinkBalance(deps: Fetcher, rpcUrls: string[], block: number | 'latest' = 'latest'): Promise<bigint> {
  const data = `${BALANCE_OF}${RESERVE_TOPIC.slice(2)}`;
  const tag = block === 'latest' ? 'latest' : toHex(block);
  return onFirstEndpoint(rpcUrls, 'Reserve balance read', async (url) =>
    quantity(await rpc(deps, url, 'eth_call', [{ to: LINK_TOKEN, data }, tag])),
  );
}

export async function readBlockNumber(deps: Fetcher, rpcUrls: string[]): Promise<number> {
  return onFirstEndpoint(rpcUrls, 'Block number read', async (url) => Number(quantity(await rpc(deps, url, 'eth_blockNumber', []))));
}

export async function readReserveTransfers(
  deps: Fetcher,
  rpcUrls: string[],
  fromBlock: number,
  toBlock: number,
): Promise<ReserveTransfer[]> {
  const range = { address: LINK_TOKEN, fromBlock: toHex(fromBlock), toBlock: toHex(toBlock) };
  return onFirstEndpoint(rpcUrls, `Reserve transfer scan of blocks ${fromBlock}-${toBlock}`, async (url) => {
    const inLogs = RpcLogs.parse(await rpc(deps, url, 'eth_getLogs', [{ ...range, topics: [TRANSFER_TOPIC, null, RESERVE_TOPIC] }]));
    const outLogs = RpcLogs.parse(await rpc(deps, url, 'eth_getLogs', [{ ...range, topics: [TRANSFER_TOPIC, RESERVE_TOPIC] }]));
    const logs = [
      ...inLogs.filter((log) => !log.removed).map((log) => ({ log, direction: 'in' as const })),
      ...outLogs.filter((log) => !log.removed).map((log) => ({ log, direction: 'out' as const })),
    ];
    const blockTimes = new Map<string, number>();
    const transfers: ReserveTransfer[] = [];
    for (const { log, direction } of logs) {
      let seconds = log.blockTimestamp === undefined ? blockTimes.get(log.blockNumber) : Number(BigInt(log.blockTimestamp));
      if (seconds === undefined) {
        const block = RpcBlock.parse(await rpc(deps, url, 'eth_getBlockByNumber', [log.blockNumber, false]));
        seconds = Number(BigInt(block.timestamp));
        blockTimes.set(log.blockNumber, seconds);
      }
      transfers.push({
        txHash: log.transactionHash.toLowerCase(),
        logIndex: Number(BigInt(log.logIndex)),
        blockNumber: Number(BigInt(log.blockNumber)),
        ts: new Date(seconds * 1000).toISOString(),
        direction,
        counterparty: `0x${log.topics[direction === 'in' ? 1 : 2]!.slice(26).toLowerCase()}`,
        amount: BigInt(log.data).toString(),
      });
    }
    return transfers.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  });
}
