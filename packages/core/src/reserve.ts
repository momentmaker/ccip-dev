import { z } from 'zod';
import { USER_AGENT, type HttpDeps } from './http';

export const LINK_TOKEN = '0x514910771AF9Ca656af840dff83E8264EcF986CA';
export const LINK_TOKEN_CHAIN_SELECTOR = '5009297550715157269';
/**
 * LINK fee tokens on chains whose CCIP token registry has no LINK row, keyed by chain selector (CCIP docs, tokens.json).
 * A wrong decimals value would misstate LINK paid by a power of ten, so each was read with decimals() through the chain's
 * keyless RPC in config/endpoints.json on 2026-10-09; every one is 18 and matches tokens.json.
 */
export const UNLISTED_LINK_FEE_TOKENS: Readonly<Record<string, { address: string; decimals: number }>> = {
  '4949039107694359620': { address: '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', decimals: 18 }, // Arbitrum
  '6433500567565415381': { address: '0x5947BB275c521040051D82396192181b413227A3', decimals: 18 }, // Avalanche (LINK.e)
  '11344663589394136015': { address: '0x404460C6A5EdE2D891e8297795264fDe62ADBB75', decimals: 18 }, // BSC
  '3734403246176062136': { address: '0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6', decimals: 18 }, // OP
  '4051577828743386545': { address: '0xb0897686c545045aFc77CF20eC7A532E3120E0F1', decimals: 18 }, // Polygon
  '465200170687744372': { address: '0xE2e73A1c69ecF83F464EFCE6A5be353a37cA09b2', decimals: 18 }, // Gnosis
  '2442541497099098535': { address: '0x1AC2EE68b8d038C982C1E1f73F596927dd70De59', decimals: 18 }, // Hyperliquid
  '9813823125703490621': { address: '0x7311DED199CC28D80E58e81e8589aa160199FCD2', decimals: 18 }, // Kaia
  '3229138320728879060': { address: '0x7Ce6bb2Cc2D3Fd45a974Da6a0F29236cb9513a98', decimals: 18 }, // Hedera
  '13624601974233774587': { address: '0x8ce7618E8f8E514d13889283F58FF03B794e6CC3', decimals: 18 }, // Etherlink
  '2135107236357186872': { address: '0xf09AFe78d3c7d359b334d7cB88995751F7eC5E13', decimals: 18 }, // Bittensor
  '8788096068760390840': { address: '0x61170ca9fB9cF98d4c7d684e07be6D969D59667E', decimals: 18 }, // Cronos zkEVM
  '12657445206920369324': { address: '0x76a443768A5e3B8d1AED0105FC250877841Deb40', decimals: 18 }, // Nexon Henesys
};
export const LINK_TOKEN_DECIMALS = 18;
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
    const isTransfer = (log: { removed?: boolean; data: string }) => !log.removed && BigInt(log.data) !== 0n;
    const logs = [
      ...inLogs.filter(isTransfer).map((log) => ({ log, direction: 'in' as const })),
      ...outLogs.filter(isTransfer).map((log) => ({ log, direction: 'out' as const })),
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
