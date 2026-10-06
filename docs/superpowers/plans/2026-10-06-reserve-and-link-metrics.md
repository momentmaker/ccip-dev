# Chainlink Reserve cost basis and LINK metrics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every LINK transfer into and out of the Chainlink Reserve with its deposit-time price. Publish cost basis vs value now, accumulation pace, weekly deposits, deposit performance and the transfer list in `reserve.json`, alert on outflows, and add the daily share of CCIP fees paid in LINK.

**Architecture:**
- The hourly job gains a block-cursor scan of LINK `Transfer` logs via free RPC endpoints. The first runs backfill from block 23,039,541. New rows are priced with one DefiLlama `batchHistorical` call, and the stored transfers are reconciled against `balanceOf` at the last scanned block.
- A pure core module computes every published statistic from the stored transfers.
- A separate pure function computes fees paid in LINK. Finalize stores it, and `today.json` and `history.json` publish it.

**Tech Stack:** TypeScript (pnpm workspace), Cloudflare Workers + D1 + R2, Vitest with `@cloudflare/vitest-plugin`, zod 4, DefiLlama coins API, Ethereum JSON-RPC.

**Spec:** `docs/superpowers/specs/2026-10-06-reserve-and-link-metrics-design.md` (read it with this plan; it wins on any conflict).

## Global Constraints

**Sources and constants**
- Free sources only. The keyless log endpoints are exactly `['https://rpc.mevblocker.io', 'https://0xrpc.io/eth']`. The DefiLlama coins API needs no key. Keyed RPC URLs exist only in the `RPC_ETHEREUM` and `RPC_FALLBACKS` secrets.
- LINK token `0x514910771AF9Ca656af840dff83E8264EcF986CA` on chain selector `5009297550715157269`. Reserve `0x9A709B7B69EA42D5eeb1ceBC48674C69E1569eC6`. First Reserve transfer block `23_039_541`.
- Scan: 12 confirmations, chunks of at most 10,000 blocks (`to − from + 1 ≤ 10_000`), at most 50 chunks per run.
- Pricing: at most 200 rows per run, DefiLlama `searchWidth=600` seconds, price key `ethereum:0x514910771AF9Ca656af840dff83E8264EcF986CA`.
- Deposit = inbound transfer of at least 1,000 LINK. Total supply 1,000,000,000 LINK. Milestone step 1,000,000 LINK.
- Rounding: LINK to 2 decimals, USD to 2, percentages to 2 (`supply_share_pct` to 4), prices to 4.

**Behaviour**
- Before `reserve_scan_caught_up` = `1`, `cost_basis`, `pace`, `performance` and `latest_transfer` are null, and `weekly` and `transfers` are `[]`.
- Each new hourly step catches its own errors; a failure never stops the steps after it. Error messages never contain an endpoint URL, since keyed URLs carry API keys.
- Alert signatures: `reserve-scan` (after 3 failed runs in a row), `reserve-outflow:<tx_hash>` (block time within 24 h), `reserve-mismatch`.
- `reserve.json` keeps `token`, `reserve`, `latest` and `series` unchanged, and `schema_version` stays 1.

**Process**
- Tests make no real network calls.
- Follow the surrounding code style. No comments that restate code.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: `pnpm test` (all packages), `pnpm typecheck`, `pnpm --filter @ccip-dev/core exec vitest run test/<file>`, `pnpm --filter @ccip-dev/worker exec vitest run test/<file>`. There is no lint script.

## Review Focus

1. **Mixed `blockTimestamp`:** an endpoint whose logs carry `blockTimestamp` on some entries but not others must still give every transfer a time, with one `eth_getBlockByNumber` per block that lacks it. Test: Task 1.
2. **Re-scanned range:** a range scanned twice, after a cursor rollback or a crash before `setMeta`, must neither duplicate rows nor re-send an outflow alert. Test: Task 4.
3. **Far or missing price:** DefiLlama may return a point more than 600 s from the requested time, or no point. The transfer must stay unpriced, never priced at a far point. Test: Task 2.
4. **Weekly edges:** an empty week inside the series, and the current partial week, must not distort the 4-week average. Test: Task 3.
5. **No LINK price:** when the price is unavailable at publish time, `link_price_usd` and every "now" value are null, the cost basis still shows, and nothing throws. Tests: Task 3 and Task 6.

---

### Task 1: Core Reserve RPC reads

**Files:**
- Modify: `packages/core/src/reserve.ts` (whole file)
- Test: `packages/core/test/reserve.test.ts`

**Interfaces:**
- Consumes: `USER_AGENT`, `HttpDeps` from `./http`; `zod`.
- Produces, all exported from `@ccip-dev/core` through the existing `export * from './reserve'`:
  - `LOG_RPC_URLS: string[]`, `RESERVE_FIRST_BLOCK = 23_039_541`, `LINK_TOKEN_CHAIN_SELECTOR = '5009297550715157269'`, `LINK_PRICE_KEY = 'ethereum:0x514910771AF9Ca656af840dff83E8264EcF986CA'`
  - `interface ReserveTransfer { txHash: string; logIndex: number; blockNumber: number; ts: string; direction: 'in' | 'out'; counterparty: string; amount: string }`
  - `readLinkBalance(deps, rpcUrls, block: number | 'latest' = 'latest'): Promise<bigint>`, extended without breaking existing callers
  - `readBlockNumber(deps, rpcUrls): Promise<number>`
  - `readReserveTransfers(deps, rpcUrls, fromBlock: number, toBlock: number): Promise<ReserveTransfer[]>`, sorted by block then log index; `txHash` and `counterparty` are lowercase, `amount` is the raw integer as a decimal string, `ts` is ISO UTC.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/reserve.test.ts`, extending its imports to
`import { DEFAULT_RPC_URLS, LINK_RESERVE, LINK_TOKEN, LOG_RPC_URLS, readBlockNumber, readLinkBalance, readReserveTransfers, RESERVE_FIRST_BLOCK } from '../src/reserve';`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/reserve.test.ts`
Expected: FAIL. `LOG_RPC_URLS`, `readBlockNumber`, `readReserveTransfers` and `RESERVE_FIRST_BLOCK` are not exported.

- [ ] **Step 3: Implement**

Replace `packages/core/src/reserve.ts` with:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/reserve.test.ts`
Expected: PASS, including the four tests that existed before this task.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck`. Expected: no errors.

```bash
git add packages/core/src/reserve.ts packages/core/test/reserve.test.ts
git commit -m "feat(core): read the Reserve's LINK transfers, the head block and the balance at a block

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: DefiLlama price at a point in time

**Files:**
- Modify: `packages/core/src/prices.ts` (the `PricesClient` interface and `createPricesClient`)
- Modify: `packages/core/src/testing.ts` (`FakePricesOptions`, `FakePrices`, `fakePrices`)
- Modify: `worker/test/details.test.ts:234`, where an inline `PricesClient` object needs the new method
- Test: `packages/core/test/prices.test.ts`

**Interfaces:**
- Produces:
  - `PRICE_SEARCH_WIDTH_SECONDS = 600`
  - `PricesClient.historicalAt(key: string, timestamps: number[]): Promise<Map<number, number>>`. Keys are the requested Unix seconds, and a timestamp is present only when DefiLlama returned a point within 600 s of it.
  - `FakePricesOptions.historical?: Record<string, Record<number, number>>`
  - `FakePricesOptions.failHistorical?: Error`
  - `FakePrices.historicalCalls: { key: string; timestamps: number[] }[]`

- [ ] **Step 1: Write the failing tests**

Append inside `describe('createPricesClient', …)` in `packages/core/test/prices.test.ts`:

```ts
  it('prices each requested time from batchHistorical, matching the nearest point within 600 seconds', async () => {
    const key = 'ethereum:0x514910771AF9Ca656af840dff83E8264EcF986CA';
    const f = fakeFetch((url) => {
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/batchHistorical');
      expect(parsed.searchParams.get('searchWidth')).toBe('600');
      expect(JSON.parse(parsed.searchParams.get('coins')!)).toEqual({ [key]: [1000, 5000, 9000] });
      return jsonResponse({ coins: { [key]: { prices: [
        { timestamp: 1030, price: 11.5, confidence: 0.99 },
        { timestamp: 5700, price: 12, confidence: 0.99 },
        { timestamp: 8990, price: 13.25, confidence: 0.99 },
      ] } } });
    });
    const result = await createPricesClient(instantDeps(f), { minIntervalMs: 0 }).historicalAt(key, [1000, 5000, 9000, 1000]);
    expect(result).toEqual(new Map([[1000, 11.5], [9000, 13.25]]));
  });

  it('asks for at most 100 times per request', async () => {
    const key = 'ethereum:0x514910771AF9Ca656af840dff83E8264EcF986CA';
    const f = fakeFetch(() => jsonResponse({ coins: {} }));
    const times = Array.from({ length: 150 }, (_, i) => 1000 + i);
    const result = await createPricesClient(instantDeps(f), { minIntervalMs: 0 }).historicalAt(key, times);
    expect(f.calls).toHaveLength(2);
    expect(result.size).toBe(0);
  });
```

Add a new `describe` at the end of the file:

```ts
describe('fakePrices.historicalAt', () => {
  it('returns configured points for the requested times and records the call', async () => {
    const prices = fakePrices({ historical: { k: { 10: 1.5 } } });
    await expect(prices.historicalAt('k', [10, 20])).resolves.toEqual(new Map([[10, 1.5]]));
    expect(prices.historicalCalls).toEqual([{ key: 'k', timestamps: [10, 20] }]);
  });

  it('throws the configured failure', async () => {
    await expect(fakePrices({ failHistorical: new Error('llama down') }).historicalAt('k', [1])).rejects.toThrow('llama down');
  });
});
```

Change the testing import at the top of the file to `import { fakeFetch, fakePrices, instantDeps, jsonResponse } from '../src/testing';`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/prices.test.ts`
Expected: FAIL. `historicalAt` is not a function.

- [ ] **Step 3: Implement**

In `packages/core/src/prices.ts`, add the constant after `MAX_CHART_POINTS`:

```ts
export const PRICE_SEARCH_WIDTH_SECONDS = 600;
```

Add the method to the interface:

```ts
export interface PricesClient {
  latest(keys: string[]): Promise<Map<string, PriceInfo>>;
  dailyHistory(key: string, fromDay: string, toDay: string): Promise<Map<string, number>>;
  historicalAt(key: string, timestamps: number[]): Promise<Map<number, number>>;
}
```

Add this method to the object returned by `createPricesClient`, after `dailyHistory`. `ChartResponse` already has the same `coins → { prices: [{ timestamp, price }] }` shape, so it is reused:

```ts
    async historicalAt(key, timestamps) {
      const out = new Map<number, number>();
      const wanted = [...new Set(timestamps)];
      for (let i = 0; i < wanted.length; i += PRICE_BATCH) {
        const batch = wanted.slice(i, i + PRICE_BATCH);
        const coins = encodeURIComponent(JSON.stringify({ [key]: batch }));
        const json = await getJson(deps, `${base}/batchHistorical?coins=${coins}&searchWidth=${PRICE_SEARCH_WIDTH_SECONDS}`, {
          endpoint: 'GET /batchHistorical', maxRetries, throttle,
        });
        const points = parseWith(ChartResponse, json, 'GET /batchHistorical').coins[key]?.prices ?? [];
        for (const ts of batch) {
          let nearest: { timestamp: number; price: number } | undefined;
          for (const point of points) {
            if (nearest === undefined || Math.abs(point.timestamp - ts) < Math.abs(nearest.timestamp - ts)) nearest = point;
          }
          if (nearest !== undefined && Math.abs(nearest.timestamp - ts) <= PRICE_SEARCH_WIDTH_SECONDS) out.set(ts, nearest.price);
        }
      }
      return out;
    },
```

In `packages/core/src/testing.ts`, replace `FakePricesOptions`, `FakePrices` and `fakePrices` with:

```ts
export interface FakePricesOptions {
  latest?: Record<string, PriceInfo>;
  history?: Record<string, Record<string, number>>;
  historical?: Record<string, Record<number, number>>;
  failHistorical?: Error;
}

export type FakePrices = PricesClient & { latestCalls: string[][]; historicalCalls: { key: string; timestamps: number[] }[] };

export function fakePrices(opts: FakePricesOptions = {}): FakePrices {
  const latestCalls: string[][] = [];
  const historicalCalls: { key: string; timestamps: number[] }[] = [];
  return {
    latestCalls,
    historicalCalls,
    async latest(keys) {
      latestCalls.push(keys);
      return new Map(keys.flatMap((k) => (opts.latest?.[k] ? [[k, opts.latest[k]] as const] : [])));
    },
    async dailyHistory(key, fromDay, toDay) {
      const series = opts.history?.[key] ?? {};
      return new Map(Object.entries(series).filter(([day]) => day >= fromDay && day <= toDay));
    },
    async historicalAt(key, timestamps) {
      historicalCalls.push({ key, timestamps });
      if (opts.failHistorical) throw opts.failHistorical;
      const series = opts.historical?.[key] ?? {};
      return new Map(timestamps.flatMap((t) => (series[t] === undefined ? [] : [[t, series[t]!] as const])));
    },
  };
}
```

In `worker/test/details.test.ts`, at line 234, give the inline client the new method:

```ts
    const prices = {
      latest: async () => { throw new Error('prices down'); },
      dailyHistory: async () => new Map(),
      historicalAt: async () => new Map(),
    };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/prices.test.ts`, then `pnpm typecheck`.
Expected: PASS, and no type errors. `scripts/test/build.test.ts` uses `Object.assign` on a `FakePrices`, so it still typechecks.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/prices.ts packages/core/src/testing.ts packages/core/test/prices.test.ts worker/test/details.test.ts
git commit -m "feat(core): price a token at given times with DefiLlama batchHistorical

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Reserve statistics (pure)

**Files:**
- Create: `packages/core/src/reserve-stats.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './reserve-stats';`)
- Test: `packages/core/test/reserve-stats.test.ts`

**Interfaces:**
- Consumes: `toUnits(amount: string, decimals: number): number` from `./value`; `dayOf(timestamp: string | Date): string` from `./time`.
- Produces:
  - `DEPOSIT_MIN_LINK = 1_000`, `LINK_TOTAL_SUPPLY = 1_000_000_000`, `MILESTONE_STEP_LINK = 1_000_000`
  - `interface PricedTransfer { ts: string; tx: string; direction: 'in' | 'out'; counterparty: string; amount: string; linkUsd: number | null }`
  - `weekStart(iso: string): string`, the Monday (UTC) of the week containing `iso`
  - `reserveStats(input: { transfers: PricedTransfer[]; linkPriceUsd: number | null; now: Date }): ReserveStats`, with the field names exactly as in spec §5: `cost_basis`, `pace`, `weekly`, `performance`, `transfers`, `latest_transfer`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/reserve-stats.test.ts`. The expected values are hand-computed from this fixture; the comments show the working.

```ts
import { describe, expect, it } from 'vitest';
import { reserveStats, weekStart, type PricedTransfer } from '../src/reserve-stats';

const raw = (link: number) => (BigInt(Math.round(link * 100)) * 10n ** 16n).toString();
const D = '0x5680681ed3767b96914ce741a308155c7fb9171d';
const NOW = new Date('2026-10-06T16:00:00.000Z');

const t = (ts: string, tx: string, direction: 'in' | 'out', link: number, linkUsd: number | null, counterparty = D): PricedTransfer =>
  ({ ts, tx, direction, counterparty, amount: raw(link), linkUsd });

// Weeks start on Monday: 08-31, 09-07, 09-14, 09-21, 09-28, 10-05 (current).
const FIXTURE: PricedTransfer[] = [
  t('2026-09-01T10:00:00.000Z', '0x01', 'in', 100_000, 10),
  t('2026-09-02T12:00:00.000Z', '0x02', 'in', 5, 10, '0xgift'),
  t('2026-09-16T15:00:00.000Z', '0x03', 'in', 50_000, 20),
  t('2026-09-20T09:00:00.000Z', '0x04', 'out', 1, 18, '0xback'),
  t('2026-09-30T15:00:00.000Z', '0x05', 'in', 60_000, null),
  t('2026-10-06T10:00:00.000Z', '0x06', 'in', 40_000, 12.5),
];

describe('weekStart', () => {
  it('returns the UTC Monday of the week', () => {
    expect(weekStart('2026-10-06T16:00:00.000Z')).toBe('2026-10-05');
    expect(weekStart('2026-10-05T00:00:00.000Z')).toBe('2026-10-05');
    expect(weekStart('2026-10-04T23:59:59.000Z')).toBe('2026-09-28');
  });
});

describe('reserveStats', () => {
  const stats = reserveStats({ transfers: FIXTURE, linkPriceUsd: 15, now: NOW });

  it('computes cost at transfer-time prices and value at the current price', () => {
    // in 250,005, out 1, so net 250,004. Cost: 1,000,000 + 50 + 1,000,000 + 500,000 − 18 = 2,500,032 (0x05 is unpriced).
    expect(stats.cost_basis).toEqual({
      link_in: 250_005,
      link_out: 1,
      cost_usd: 2_500_032,
      value_usd: 3_750_060,
      change_usd: 1_250_028,
      change_pct: 50,
      avg_deposit_price_usd: 13.1579,
      unpriced_transfers: 1,
    });
  });

  it('buckets deposits by week, skipping gifts and keeping empty weeks', () => {
    expect(stats.weekly).toEqual([
      { week: '2026-08-31', deposits: 1, link: 100_000, usd: 1_000_000 },
      { week: '2026-09-07', deposits: 0, link: 0, usd: 0 },
      { week: '2026-09-14', deposits: 1, link: 50_000, usd: 1_000_000 },
      { week: '2026-09-21', deposits: 0, link: 0, usd: 0 },
      { week: '2026-09-28', deposits: 1, link: 60_000, usd: 0 },
      { week: '2026-10-05', deposits: 1, link: 40_000, usd: 500_000 },
    ]);
  });

  it('averages the last four complete weeks and projects the next million', () => {
    // Complete weeks 09-07 … 09-28: 110,000 LINK / 4 = 27,500; 1,000,000 USD / 4 = 250,000.
    // (1,000,000 − 250,004) / 27,500 = 27.2726 weeks after NOW, which lands on 2027-04-15.
    expect(stats.pace).toEqual({
      deposits: 4,
      last_deposit: { ts: '2026-10-06T10:00:00.000Z', tx: '0x06', link: 40_000, price_usd: 12.5, usd: 500_000 },
      days_since_last_deposit: 0.25,
      avg_weekly_link_4w: 27_500,
      avg_weekly_usd_4w: 250_000,
      annualized_link: 1_430_000,
      supply_share_pct: 0.025,
      next_milestone: { link: 1_000_000, eta: '2027-04-15' },
    });
  });

  it('ranks priced deposits by entry price against the current price', () => {
    expect(stats.performance).toEqual({
      best: { ts: '2026-09-01T10:00:00.000Z', tx: '0x01', price_usd: 10 },
      worst: { ts: '2026-09-16T15:00:00.000Z', tx: '0x03', price_usd: 20 },
      above: 2,
      below: 1,
    });
  });

  it('lists every transfer oldest first, with now-values only for inflows', () => {
    expect(stats.transfers).toHaveLength(6);
    expect(stats.transfers[0]).toEqual({
      ts: '2026-09-01T10:00:00.000Z', tx: '0x01', direction: 'in', counterparty: D, link: 100_000,
      price_usd: 10, usd: 1_000_000, value_now_usd: 1_500_000, change_pct: 50,
    });
    expect(stats.transfers[3]).toMatchObject({ direction: 'out', usd: 18, value_now_usd: null, change_pct: null });
    expect(stats.transfers[4]).toMatchObject({ price_usd: null, usd: null, value_now_usd: 900_000, change_pct: null });
    expect(stats.latest_transfer).toEqual(stats.transfers[5]);
  });

  it('sorts its input by time, so a shuffled list gives the same result', () => {
    expect(reserveStats({ transfers: [...FIXTURE].reverse(), linkPriceUsd: 15, now: NOW })).toEqual(stats);
  });

  it('nulls every value that needs the current price when the price is unavailable', () => {
    const noPrice = reserveStats({ transfers: FIXTURE, linkPriceUsd: null, now: NOW });
    expect(noPrice.cost_basis).toMatchObject({ cost_usd: 2_500_032, value_usd: null, change_usd: null, change_pct: null });
    expect(noPrice.performance).toMatchObject({ above: null, below: null });
    expect(noPrice.transfers[0]).toMatchObject({ value_now_usd: null, change_pct: null });
  });

  it('has no pace, weeks or milestone before the first deposit', () => {
    const empty = reserveStats({ transfers: [t('2026-09-02T12:00:00.000Z', '0x02', 'in', 5, 10, '0xgift')], linkPriceUsd: 15, now: NOW });
    expect(empty.weekly).toEqual([]);
    expect(empty.pace).toMatchObject({
      deposits: 0, last_deposit: null, days_since_last_deposit: null, avg_weekly_link_4w: null, annualized_link: null, next_milestone: null,
    });
    expect(empty.performance).toEqual({ best: null, worst: null, above: 0, below: 0 });
  });

  it('averages over fewer than four complete weeks when the history is short', () => {
    const short = reserveStats({
      transfers: [t('2026-09-22T10:00:00.000Z', '0x10', 'in', 30_000, 10), t('2026-09-30T10:00:00.000Z', '0x11', 'in', 10_000, 10)],
      linkPriceUsd: 10,
      now: NOW,
    });
    expect(short.pace?.avg_weekly_link_4w).toBe(20_000);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/reserve-stats.test.ts`
Expected: FAIL. Cannot find module `../src/reserve-stats`.

- [ ] **Step 3: Implement**

Create `packages/core/src/reserve-stats.ts`:

```ts
import { dayOf } from './time';
import { toUnits } from './value';

export const DEPOSIT_MIN_LINK = 1_000;
export const LINK_TOTAL_SUPPLY = 1_000_000_000;
export const MILESTONE_STEP_LINK = 1_000_000;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const AVERAGE_WEEKS = 4;

export interface PricedTransfer {
  ts: string;
  tx: string;
  direction: 'in' | 'out';
  counterparty: string;
  amount: string;
  linkUsd: number | null;
}

export interface TransferView {
  ts: string;
  tx: string;
  direction: 'in' | 'out';
  counterparty: string;
  link: number;
  price_usd: number | null;
  usd: number | null;
  value_now_usd: number | null;
  change_pct: number | null;
}

export interface WeekView {
  week: string;
  deposits: number;
  link: number;
  usd: number;
}

export interface ReserveStats {
  cost_basis: {
    link_in: number;
    link_out: number;
    cost_usd: number;
    value_usd: number | null;
    change_usd: number | null;
    change_pct: number | null;
    avg_deposit_price_usd: number | null;
    unpriced_transfers: number;
  };
  pace: {
    deposits: number;
    last_deposit: { ts: string; tx: string; link: number; price_usd: number | null; usd: number | null } | null;
    days_since_last_deposit: number | null;
    avg_weekly_link_4w: number | null;
    avg_weekly_usd_4w: number | null;
    annualized_link: number | null;
    supply_share_pct: number;
    next_milestone: { link: number; eta: string } | null;
  };
  weekly: WeekView[];
  performance: {
    best: { ts: string; tx: string; price_usd: number } | null;
    worst: { ts: string; tx: string; price_usd: number } | null;
    above: number | null;
    below: number | null;
  };
  transfers: TransferView[];
  latest_transfer: TransferView | null;
}

interface Row extends PricedTransfer {
  link: number;
  usd: number | null;
}

const round = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const roundOrNull = (value: number | null, digits: number) => (value === null ? null : round(value, digits));
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const mondayMs = (iso: string) => Date.parse(`${weekStart(iso)}T00:00:00.000Z`);

export function weekStart(iso: string): string {
  const midnight = Date.parse(`${dayOf(iso)}T00:00:00.000Z`);
  const sinceMonday = (new Date(midnight).getUTCDay() + 6) % 7;
  return dayOf(new Date(midnight - sinceMonday * DAY_MS));
}

function weeks(deposits: Row[], now: Date): WeekView[] {
  if (deposits.length === 0) return [];
  const series: WeekView[] = [];
  const byWeek = new Map<string, WeekView>();
  for (let ms = mondayMs(deposits[0]!.ts); ms <= mondayMs(now.toISOString()); ms += WEEK_MS) {
    const week = { week: dayOf(new Date(ms)), deposits: 0, link: 0, usd: 0 };
    series.push(week);
    byWeek.set(week.week, week);
  }
  for (const d of deposits) {
    const week = byWeek.get(weekStart(d.ts));
    if (!week) continue;
    week.deposits += 1;
    week.link += d.link;
    week.usd += d.usd ?? 0;
  }
  return series;
}

export function reserveStats(input: { transfers: PricedTransfer[]; linkPriceUsd: number | null; now: Date }): ReserveStats {
  const { linkPriceUsd, now } = input;
  const rows: Row[] = [...input.transfers]
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .map((t) => {
      const link = toUnits(t.amount, 18);
      return { ...t, link, usd: t.linkUsd === null ? null : link * t.linkUsd };
    });
  const inflows = rows.filter((r) => r.direction === 'in');
  const outflows = rows.filter((r) => r.direction === 'out');
  const deposits = inflows.filter((r) => r.link >= DEPOSIT_MIN_LINK);
  const pricedDeposits = deposits.filter((r) => r.linkUsd !== null);

  const linkIn = sum(inflows.map((r) => r.link));
  const linkOut = sum(outflows.map((r) => r.link));
  const net = linkIn - linkOut;
  const cost = sum(inflows.map((r) => r.usd ?? 0)) - sum(outflows.map((r) => r.usd ?? 0));
  const value = linkPriceUsd === null ? null : net * linkPriceUsd;
  const change = value === null ? null : value - cost;
  const pricedDepositLink = sum(pricedDeposits.map((r) => r.link));

  const series = weeks(deposits, now);
  const complete = series.slice(0, -1).slice(-AVERAGE_WEEKS);
  const avgLink = complete.length === 0 ? null : sum(complete.map((w) => w.link)) / complete.length;
  const avgUsd = complete.length === 0 ? null : sum(complete.map((w) => w.usd)) / complete.length;
  const milestone = (Math.floor(net / MILESTONE_STEP_LINK) + 1) * MILESTONE_STEP_LINK;
  const last = deposits.at(-1);

  const byPrice = [...pricedDeposits].sort((a, b) => a.linkUsd! - b.linkUsd!);
  const entry = (r: Row | undefined) => (r === undefined ? null : { ts: r.ts, tx: r.tx, price_usd: round(r.linkUsd!, 4) });

  const view = (r: Row): TransferView => ({
    ts: r.ts,
    tx: r.tx,
    direction: r.direction,
    counterparty: r.counterparty,
    link: round(r.link, 2),
    price_usd: roundOrNull(r.linkUsd, 4),
    usd: roundOrNull(r.usd, 2),
    value_now_usd: r.direction === 'in' && linkPriceUsd !== null ? round(r.link * linkPriceUsd, 2) : null,
    change_pct:
      r.direction === 'in' && linkPriceUsd !== null && r.linkUsd !== null && r.linkUsd > 0
        ? round((linkPriceUsd / r.linkUsd - 1) * 100, 2)
        : null,
  });
  const transfers = rows.map(view);

  return {
    cost_basis: {
      link_in: round(linkIn, 2),
      link_out: round(linkOut, 2),
      cost_usd: round(cost, 2),
      value_usd: roundOrNull(value, 2),
      change_usd: roundOrNull(change, 2),
      change_pct: change === null || cost <= 0 ? null : round((change / cost) * 100, 2),
      avg_deposit_price_usd: pricedDepositLink === 0 ? null : round(sum(pricedDeposits.map((r) => r.usd!)) / pricedDepositLink, 4),
      unpriced_transfers: rows.filter((r) => r.linkUsd === null).length,
    },
    pace: {
      deposits: deposits.length,
      last_deposit: last
        ? { ts: last.ts, tx: last.tx, link: round(last.link, 2), price_usd: roundOrNull(last.linkUsd, 4), usd: roundOrNull(last.usd, 2) }
        : null,
      days_since_last_deposit: last ? round((now.getTime() - Date.parse(last.ts)) / DAY_MS, 2) : null,
      avg_weekly_link_4w: roundOrNull(avgLink, 2),
      avg_weekly_usd_4w: roundOrNull(avgUsd, 2),
      annualized_link: avgLink === null ? null : round(avgLink * 52, 2),
      supply_share_pct: round((net / LINK_TOTAL_SUPPLY) * 100, 4),
      next_milestone:
        avgLink === null || avgLink <= 0
          ? null
          : { link: milestone, eta: dayOf(new Date(now.getTime() + ((milestone - net) / avgLink) * WEEK_MS)) },
    },
    weekly: series.map((w) => ({ ...w, link: round(w.link, 2), usd: round(w.usd, 2) })),
    performance: {
      best: entry(byPrice[0]),
      worst: entry(byPrice.at(-1)),
      above: linkPriceUsd === null ? null : pricedDeposits.filter((r) => r.linkUsd! < linkPriceUsd).length,
      below: linkPriceUsd === null ? null : pricedDeposits.filter((r) => r.linkUsd! > linkPriceUsd).length,
    },
    transfers,
    latest_transfer: transfers.at(-1) ?? null,
  };
}
```

In `packages/core/src/index.ts`, add after `export * from './reserve';`:

```ts
export * from './reserve-stats';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/reserve-stats.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck`

```bash
git add packages/core/src/reserve-stats.ts packages/core/src/index.ts packages/core/test/reserve-stats.test.ts
git commit -m "feat(core): compute Reserve cost basis, pace, weekly deposits and performance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Scan the Reserve's transfers in the hourly job

**Files:**
- Create: `worker/migrations/0003_reserve_transfers.sql`
- Create: `worker/src/rpc.ts`
- Create: `worker/src/jobs/reserve.ts`
- Modify: `worker/src/jobs/hourly.ts` (use `rpc.ts`, call the scan)
- Modify: `worker/src/store.ts` (append the Reserve transfer functions)
- Modify: `worker/test/helpers.ts` (add `reserve_transfers` to `TABLES`; add `rpcFake` and `transferLog`)
- Modify: `worker/test/hourly.test.ts` (use `rpcFake`)
- Test: `worker/test/reserve-job.test.ts`

**Interfaces:**
- Consumes:
  - from Task 1: `readBlockNumber`, `readReserveTransfers`, `ReserveTransfer`, `LOG_RPC_URLS`, `RESERVE_FIRST_BLOCK`, `DEFAULT_RPC_URLS`
  - from core: `toUnits`
- Produces:
  - `worker/src/rpc.ts`: `keyedRpcUrls(env): string[]`, `balanceRpcUrls(env): string[]` (keyed URLs, or `DEFAULT_RPC_URLS` when none are set), `logRpcUrls(env): string[]` (keyed URLs, then `LOG_RPC_URLS`)
  - `store.insertReserveTransfers(db, transfers: ReserveTransfer[]): Promise<ReserveTransfer[]>`, which returns only the newly inserted rows
  - `store.reserveTransfers(db): Promise<ReserveTransferRow[]>`, ordered by block then log index
  - `interface ReserveTransferRow { tx_hash: string; log_index: number; block_number: number; ts: string; direction: 'in' | 'out'; counterparty: string; amount: string; link_usd: number | null }`
  - `jobs/reserve.ts`:
    - `CONFIRMATIONS = 12`, `CHUNK_BLOCKS = 10_000`, `MAX_CHUNKS_PER_RUN = 50`
    - `scanReserveTransfers(c): Promise<number | null>`, which returns the last scanned block once caught up, else null
    - `runReserveTransfers(c): Promise<void>`
    - `formatLink(raw: string | bigint): string`
  - Meta keys: `reserve_scan_block`, `reserve_scan_failures`, `reserve_scan_caught_up`.

- [ ] **Step 1: Add the migration and test helpers**

Create `worker/migrations/0003_reserve_transfers.sql` (exactly the spec's §3):

```sql
CREATE TABLE reserve_transfers (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  ts TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  counterparty TEXT NOT NULL,
  amount TEXT NOT NULL,
  link_usd REAL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX reserve_transfers_ts ON reserve_transfers (ts);

ALTER TABLE daily_totals ADD COLUMN fee_link_usd REAL;
```

In `worker/test/helpers.ts`, add `'reserve_transfers'` to the end of `TABLES`. Extend the `@ccip-dev/core/testing` import with `fakeFetch, jsonResponse, type FakeFetch`, and import `LINK_RESERVE, RESERVE_FIRST_BLOCK` from `@ccip-dev/core`. Then append:

```ts
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const topicOf = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;

/** A LINK Transfer log as eth_getLogs returns it, with blockTimestamp. */
export function transferLog(o: { block: number; index: number; tx: string; direction: 'in' | 'out'; counterparty: string; link: bigint; ts: string }) {
  const [from, to] = o.direction === 'in' ? [o.counterparty, LINK_RESERVE] : [LINK_RESERVE, o.counterparty];
  return {
    blockNumber: `0x${o.block.toString(16)}`,
    logIndex: `0x${o.index.toString(16)}`,
    transactionHash: o.tx,
    topics: [TRANSFER_TOPIC, topicOf(from), topicOf(to)],
    data: `0x${(o.link * 10n ** 18n).toString(16).padStart(64, '0')}`,
    blockTimestamp: `0x${(Date.parse(o.ts) / 1000).toString(16)}`,
  };
}

export interface RpcFakeOptions {
  /** eth_blockNumber; the default puts the confirmed head at RESERVE_FIRST_BLOCK. */
  head?: number;
  /** eth_call at 'latest', in LINK. */
  balanceLink?: bigint;
  /** eth_call at a block number, in raw units. Defaults to 0. */
  balanceAt?: (block: number) => bigint;
  /** Logs for one eth_getLogs call. */
  logs?: (call: { fromBlock: number; toBlock: number; direction: 'in' | 'out' }) => unknown[];
  down?: boolean;
}

/** An Ethereum JSON-RPC endpoint that answers by method. */
export function rpcFake(opts: RpcFakeOptions = {}): FakeFetch {
  return fakeFetch((_url, init) => {
    if (opts.down) return jsonResponse({}, 503);
    const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: any[] };
    const ok = (result: unknown) => jsonResponse({ jsonrpc: '2.0', id: 1, result });
    if (method === 'eth_blockNumber') return ok(`0x${(opts.head ?? RESERVE_FIRST_BLOCK + 12).toString(16)}`);
    if (method === 'eth_call') {
      const tag = params[1] as string;
      const raw = tag === 'latest' ? (opts.balanceLink ?? 0n) * 10n ** 18n : (opts.balanceAt?.(Number(BigInt(tag))) ?? 0n);
      return ok(`0x${raw.toString(16)}`);
    }
    if (method === 'eth_getLogs') {
      const filter = params[0] as { fromBlock: string; toBlock: string; topics: (string | null)[] };
      const direction = filter.topics[1] === null ? 'in' : 'out';
      return ok(opts.logs?.({ fromBlock: Number(BigInt(filter.fromBlock)), toBlock: Number(BigInt(filter.toBlock)), direction }) ?? []);
    }
    return jsonResponse({ jsonrpc: '2.0', id: 1, error: { message: `unexpected ${method}` } });
  });
}
```

- [ ] **Step 2: Write the failing tests**

Create `worker/test/reserve-job.test.ts`:

```ts
import { RESERVE_FIRST_BLOCK } from '@ccip-dev/core';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { CHUNK_BLOCKS, MAX_CHUNKS_PER_RUN, scanReserveTransfers } from '../src/jobs/reserve';
import * as store from '../src/store';
import { harness, resetStorage, rpcFake, transferLog } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-10-06T16:00:00.000Z';
const DEPOSITOR = '0x5680681ed3767b96914ce741a308155c7fb9171d';
const OUT_TO = '0x176c2ee163d764dcea38bc1340639b398b4fe713';
const FIRST = RESERVE_FIRST_BLOCK;

describe('scanReserveTransfers', () => {
  it('backfills in chunks across runs and resumes from the cursor', async () => {
    const perRun = MAX_CHUNKS_PER_RUN * CHUNK_BLOCKS;
    const head = FIRST - 1 + perRun + 5_000 + 12;
    const logs = rpcFake({
      head,
      logs: ({ fromBlock, toBlock, direction }) => [
        transferLog({ block: FIRST, index: 0, tx: '0xa1', direction: 'in', counterparty: DEPOSITOR, link: 100n, ts: '2025-07-31T14:00:23.000Z' }),
        transferLog({ block: FIRST + perRun + 10, index: 0, tx: '0xa2', direction: 'in', counterparty: DEPOSITOR, link: 50n, ts: '2025-09-10T00:00:00.000Z' }),
      ].filter((l) => direction === 'in' && Number(BigInt(l.blockNumber)) >= fromBlock && Number(BigInt(l.blockNumber)) <= toBlock),
    });

    const first = harness({ now: NOW, fetch: logs });
    await expect(scanReserveTransfers(first.c)).resolves.toBeNull();
    expect(await store.getMeta(env.DB, 'reserve_scan_block')).toBe(String(FIRST - 1 + perRun));
    expect(await store.getMeta(env.DB, 'reserve_scan_caught_up')).toBeNull();
    expect((await store.reserveTransfers(env.DB)).map((r) => r.tx_hash)).toEqual(['0xa1']);

    await expect(scanReserveTransfers(harness({ now: NOW, fetch: logs }).c)).resolves.toBe(head - 12);
    expect(await store.getMeta(env.DB, 'reserve_scan_caught_up')).toBe('1');
    expect((await store.reserveTransfers(env.DB)).map((r) => r.tx_hash)).toEqual(['0xa1', '0xa2']);
  });

  it('scans no more than 10,000 blocks per request', async () => {
    const f = rpcFake({ head: FIRST - 1 + 25_000 + 12 });
    await scanReserveTransfers(harness({ now: NOW, fetch: f }).c);
    const ranges = f.calls
      .map((call) => JSON.parse(String(call.init?.body)))
      .filter((body) => body.method === 'eth_getLogs')
      .map((body) => Number(BigInt(body.params[0].toBlock)) - Number(BigInt(body.params[0].fromBlock)) + 1);
    expect(Math.max(...ranges)).toBe(10_000);
    expect(ranges.reduce((a: number, b: number) => a + b, 0)).toBe(2 * 25_000);
  });

  it('stores a transfer once and alerts on its outflow once, even when the range is scanned again', async () => {
    const f = rpcFake({
      logs: ({ direction }) =>
        direction === 'out'
          ? [transferLog({ block: FIRST, index: 3, tx: '0xb1', direction: 'out', counterparty: OUT_TO, link: 1n, ts: '2026-10-06T15:00:00.000Z' })]
          : [],
    });
    const h = harness({ now: NOW, fetch: f });
    await scanReserveTransfers(h.c);
    await store.setMeta(env.DB, 'reserve_scan_block', String(FIRST - 1));
    await scanReserveTransfers(h.c);
    expect(await store.reserveTransfers(env.DB)).toEqual([
      { tx_hash: '0xb1', log_index: 3, block_number: FIRST, ts: '2026-10-06T15:00:00.000Z', direction: 'out', counterparty: OUT_TO, amount: '1000000000000000000', link_usd: null },
    ]);
    expect(h.alerts).toEqual([
      { signature: 'reserve-outflow:0xb1', text: `LINK left the Chainlink Reserve: 1 LINK to ${OUT_TO} (tx 0xb1)` },
    ]);
  });

  it('does not alert on an outflow older than 24 hours', async () => {
    const f = rpcFake({
      logs: ({ direction }) =>
        direction === 'out'
          ? [transferLog({ block: FIRST, index: 0, tx: '0xb2', direction: 'out', counterparty: OUT_TO, link: 1n, ts: '2025-08-02T19:02:47.000Z' })]
          : [],
    });
    const h = harness({ now: NOW, fetch: f });
    await scanReserveTransfers(h.c);
    expect(h.alerts).toEqual([]);
  });

  it('alerts on the third failed run in a row and resets after a good run', async () => {
    const signatures: string[] = [];
    for (let i = 0; i < 4; i++) {
      const h = harness({ now: NOW, fetch: rpcFake({ down: true }) });
      await expect(scanReserveTransfers(h.c)).resolves.toBeNull();
      signatures.push(...h.alerts.map((a) => a.signature));
    }
    expect(signatures).toEqual(['reserve-scan', 'reserve-scan']);
    expect(await store.getMeta(env.DB, 'reserve_scan_failures')).toBe('4');
    await scanReserveTransfers(harness({ now: NOW, fetch: rpcFake() }).c);
    expect(await store.getMeta(env.DB, 'reserve_scan_failures')).toBe('0');
  });

  it('treats a cursor at or past the head as caught up without asking for logs', async () => {
    await store.setMeta(env.DB, 'reserve_scan_block', String(FIRST + 5));
    const f = rpcFake();
    await expect(scanReserveTransfers(harness({ now: NOW, fetch: f }).c)).resolves.toBe(FIRST + 5);
    expect(f.calls.map((call) => JSON.parse(String(call.init?.body)).method)).toEqual(['eth_blockNumber']);
    expect(await store.getMeta(env.DB, 'reserve_scan_caught_up')).toBe('1');
  });
});
```

The harness's `alert` records every call, so the four failed runs show alerts on runs 3 and 4. The real alerter suppresses repeats within an hour; that suppression is tested elsewhere.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/reserve-job.test.ts`
Expected: FAIL. Cannot find module `../src/jobs/reserve`.

- [ ] **Step 4: Implement**

Create `worker/src/rpc.ts`:

```ts
import { DEFAULT_RPC_URLS, LOG_RPC_URLS } from '@ccip-dev/core';
import type { Env } from './env';

export function keyedRpcUrls(env: Env): string[] {
  return [env.RPC_ETHEREUM ?? '', ...(env.RPC_FALLBACKS ?? '').split(',')].map((u) => u.trim()).filter((u) => u.length > 0);
}

export function balanceRpcUrls(env: Env): string[] {
  const keyed = keyedRpcUrls(env);
  return keyed.length > 0 ? keyed : DEFAULT_RPC_URLS;
}

export function logRpcUrls(env: Env): string[] {
  return [...keyedRpcUrls(env), ...LOG_RPC_URLS];
}
```

In `worker/src/jobs/hourly.ts`:
- Delete the `rpcUrls` function, and drop `DEFAULT_RPC_URLS` and the `Env` type import if they become unused.
- Add `import { balanceRpcUrls } from '../rpc';` and `import { runReserveTransfers } from './reserve';`.
- In `recordReserve`, change `readLinkBalance(c.deps, rpcUrls(c.env))` to `readLinkBalance(c.deps, balanceRpcUrls(c.env))`.
- Change `runHourly` to:

```ts
export async function runHourly(c: RunContext): Promise<void> {
  await recordReserve(c);
  await runReserveTransfers(c);
  await snapshotRegistry(c);
  await publishRegistryFiles(c);
  await refreshCoingeckoIds(c);
}
```

Append to `worker/src/store.ts`, adding `type ReserveTransfer` to its existing `@ccip-dev/core` import:

```ts
export interface ReserveTransferRow {
  tx_hash: string;
  log_index: number;
  block_number: number;
  ts: string;
  direction: 'in' | 'out';
  counterparty: string;
  amount: string;
  link_usd: number | null;
}

export async function insertReserveTransfers(db: D1Database, transfers: ReserveTransfer[]): Promise<ReserveTransfer[]> {
  if (transfers.length === 0) return [];
  const insert = db.prepare(
    `INSERT OR IGNORE INTO reserve_transfers (tx_hash, log_index, block_number, ts, direction, counterparty, amount)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const results = await db.batch(
    transfers.map((t) => insert.bind(t.txHash, t.logIndex, t.blockNumber, t.ts, t.direction, t.counterparty, t.amount)),
  );
  return transfers.filter((_, i) => (results[i]?.meta.changes ?? 0) > 0);
}

export async function reserveTransfers(db: D1Database): Promise<ReserveTransferRow[]> {
  const { results } = await db.prepare('SELECT * FROM reserve_transfers ORDER BY block_number, log_index').all<ReserveTransferRow>();
  return results;
}
```

Create `worker/src/jobs/reserve.ts`:

```ts
import { RESERVE_FIRST_BLOCK, readBlockNumber, readReserveTransfers, toUnits, type ReserveTransfer } from '@ccip-dev/core';
import type { RunContext } from '../context';
import { logRpcUrls } from '../rpc';
import * as store from '../store';

export const CONFIRMATIONS = 12;
export const CHUNK_BLOCKS = 10_000;
export const MAX_CHUNKS_PER_RUN = 50;
const SCAN_ALERT_AFTER = 3;
const OUTFLOW_ALERT_WINDOW_MS = 24 * 3_600_000;

export async function runReserveTransfers(c: RunContext): Promise<void> {
  await scanReserveTransfers(c);
}

export function formatLink(raw: string | bigint): string {
  return (Math.round(toUnits(String(raw), 18) * 100) / 100).toLocaleString('en-US');
}

export async function scanReserveTransfers(c: RunContext): Promise<number | null> {
  const db = c.env.DB;
  try {
    const urls = logRpcUrls(c.env);
    let cursor = Number((await store.getMeta(db, 'reserve_scan_block')) ?? RESERVE_FIRST_BLOCK - 1);
    const head = (await readBlockNumber(c.deps, urls)) - CONFIRMATIONS;
    for (let chunk = 0; chunk < MAX_CHUNKS_PER_RUN && cursor < head; chunk++) {
      const to = Math.min(cursor + CHUNK_BLOCKS, head);
      const inserted = await store.insertReserveTransfers(db, await readReserveTransfers(c.deps, urls, cursor + 1, to));
      await alertOutflows(c, inserted);
      cursor = to;
      await store.setMeta(db, 'reserve_scan_block', String(cursor));
    }
    await store.setMeta(db, 'reserve_scan_failures', '0');
    if (cursor < head) return null;
    await store.setMeta(db, 'reserve_scan_caught_up', '1');
    return cursor;
  } catch (err) {
    await recordScanFailure(c, err);
    return null;
  }
}

async function alertOutflows(c: RunContext, inserted: ReserveTransfer[]): Promise<void> {
  const now = c.deps.now().getTime();
  for (const t of inserted) {
    if (t.direction !== 'out' || now - Date.parse(t.ts) > OUTFLOW_ALERT_WINDOW_MS) continue;
    await c.alert(`reserve-outflow:${t.txHash}`, `LINK left the Chainlink Reserve: ${formatLink(t.amount)} LINK to ${t.counterparty} (tx ${t.txHash})`);
  }
}

async function recordScanFailure(c: RunContext, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`Reserve transfer scan failed: ${message}`);
  try {
    const failures = Number((await store.getMeta(c.env.DB, 'reserve_scan_failures')) ?? '0') + 1;
    await store.setMeta(c.env.DB, 'reserve_scan_failures', String(failures));
    if (failures >= SCAN_ALERT_AFTER) {
      await c.alert('reserve-scan', `Reserve transfer scan failed ${failures} hours in a row: ${message}`);
    }
  } catch (metaErr) {
    console.warn(`Reserve scan failure could not be recorded: ${metaErr instanceof Error ? metaErr.message : String(metaErr)}`);
  }
}
```

- [ ] **Step 5: Update the hourly tests to answer RPC calls by method**

In `worker/test/hourly.test.ts`:
- Delete the `rpcOk` and `rpcDown` constants, and add `rpcFake` to the `./helpers` import.
- Replace every `rpcOk(N)` with `rpcFake({ balanceLink: N })` and every `rpcDown()` with `rpcFake({ down: true })`.
- The run with RPC down now also fails the transfer scan, so the alert test expects both signatures. Change it to:

```ts
  it('alerts after three consecutive failed Reserve reads and resets on success', async () => {
    const ccip = fakeCcip({ chains: [NETWORKS.base], tokens: [LINK] });
    const signatures: string[] = [];
    for (let i = 0; i < 3; i++) {
      const h = harness({ now: NOW, ccip, coingecko: linkMapped(), fetch: rpcFake({ down: true }) });
      await runHourly(h.c);
      signatures.push(...h.alerts.map((a) => a.signature));
    }
    expect(signatures).toEqual(['reserve-read', 'reserve-scan']);
    await runHourly(harness({ now: NOW, ccip, fetch: rpcFake({ balanceLink: 1n }) }).c);
    expect(await store.getMeta(env.DB, 'reserve_failures')).toBe('0');
  });
```

Remove `fakeFetch` and `jsonResponse` from the `@ccip-dev/core/testing` import if nothing else in the file uses them.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/reserve-job.test.ts test/hourly.test.ts`, then `pnpm test` and `pnpm typecheck`.
Expected: all PASS, with no type errors.

- [ ] **Step 7: Commit**

```bash
git add worker/migrations/0003_reserve_transfers.sql worker/src/rpc.ts worker/src/jobs/reserve.ts worker/src/jobs/hourly.ts worker/src/store.ts worker/test/helpers.ts worker/test/hourly.test.ts worker/test/reserve-job.test.ts
git commit -m "feat(reserve): scan the Reserve's LINK transfers from a block cursor and alert on outflows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Price the transfers and reconcile them with the balance

**Files:**
- Modify: `worker/src/jobs/reserve.ts`
- Modify: `worker/src/store.ts` (append two functions)
- Test: `worker/test/reserve-job.test.ts` (append)

**Interfaces:**
- Consumes:
  - from Task 1: `readLinkBalance(deps, urls, block)`, `LINK_PRICE_KEY`
  - from Task 2: `c.prices.historicalAt`
  - from Task 4: `scanReserveTransfers`, `store.reserveTransfers`, `logRpcUrls`, `formatLink`
- Produces:
  - `store.unpricedReserveTransfers(db, limit): Promise<{ tx_hash: string; log_index: number; ts: string }[]>`
  - `store.setReserveTransferPrices(db, prices: { txHash: string; logIndex: number; linkUsd: number }[]): Promise<void>`
  - `priceReserveTransfers(c): Promise<void>`
  - `reconcileReserve(c, block: number): Promise<void>`
  - `runReserveTransfers` now runs scan, then price, then reconcile when the scan returned a block.

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/reserve-job.test.ts`. Add `LINK_PRICE_KEY` to the `@ccip-dev/core` import, `fakePrices` from `@ccip-dev/core/testing`, and `priceReserveTransfers, reconcileReserve, runReserveTransfers` to the `../src/jobs/reserve` import:

```ts
const seconds = (iso: string) => Date.parse(iso) / 1000;
const T1 = '2025-08-07T10:14:59.000Z';
const T2 = '2026-10-01T15:35:47.000Z';

async function seedTwoDeposits(): Promise<void> {
  await store.insertReserveTransfers(env.DB, [
    { txHash: '0xc1', logIndex: 0, blockNumber: FIRST + 1, ts: T1, direction: 'in', counterparty: DEPOSITOR, amount: (100n * 10n ** 18n).toString() },
    { txHash: '0xc2', logIndex: 0, blockNumber: FIRST + 2, ts: T2, direction: 'in', counterparty: DEPOSITOR, amount: (50n * 10n ** 18n).toString() },
  ]);
}

describe('priceReserveTransfers', () => {
  it('prices transfers at their block time and leaves the ones DefiLlama lacks for the next run', async () => {
    await seedTwoDeposits();
    const prices = fakePrices({ historical: { [LINK_PRICE_KEY]: { [seconds(T1)]: 16.8 } } });
    await priceReserveTransfers(harness({ now: NOW, prices }).c);
    expect(prices.historicalCalls).toEqual([{ key: LINK_PRICE_KEY, timestamps: [seconds(T1), seconds(T2)] }]);
    expect((await store.reserveTransfers(env.DB)).map((r) => r.link_usd)).toEqual([16.8, null]);

    const later = fakePrices({ historical: { [LINK_PRICE_KEY]: { [seconds(T2)]: 14.2564 } } });
    await priceReserveTransfers(harness({ now: NOW, prices: later }).c);
    expect(later.historicalCalls[0]!.timestamps).toEqual([seconds(T2)]);
    expect((await store.reserveTransfers(env.DB)).map((r) => r.link_usd)).toEqual([16.8, 14.2564]);
  });

  it('does not throw when DefiLlama fails', async () => {
    await seedTwoDeposits();
    const prices = fakePrices({ failHistorical: new Error('llama down') });
    await expect(priceReserveTransfers(harness({ now: NOW, prices }).c)).resolves.toBeUndefined();
    expect((await store.reserveTransfers(env.DB)).map((r) => r.link_usd)).toEqual([null, null]);
  });

  it('asks DefiLlama nothing when every transfer is priced', async () => {
    const prices = fakePrices();
    await priceReserveTransfers(harness({ now: NOW, prices }).c);
    expect(prices.historicalCalls).toEqual([]);
  });
});

describe('reconcileReserve', () => {
  it('stays quiet when the transfers net to the balance at the given block', async () => {
    await seedTwoDeposits();
    const f = rpcFake({ balanceAt: () => 150n * 10n ** 18n });
    const h = harness({ now: NOW, fetch: f });
    await reconcileReserve(h.c, FIRST + 9);
    expect(h.alerts).toEqual([]);
    const call = JSON.parse(String(f.calls[0]!.init?.body));
    expect(call.params[1]).toBe(`0x${(FIRST + 9).toString(16)}`);
  });

  it('alerts with both amounts when they differ', async () => {
    await seedTwoDeposits();
    const h = harness({ now: NOW, fetch: rpcFake({ balanceAt: () => 149n * 10n ** 18n }) });
    await reconcileReserve(h.c, FIRST + 9);
    expect(h.alerts).toEqual([
      { signature: 'reserve-mismatch', text: `Reserve transfers net to 150 LINK but balanceOf at block ${FIRST + 9} is 149 LINK` },
    ]);
  });

  it('does not throw when the balance cannot be read', async () => {
    await expect(reconcileReserve(harness({ now: NOW, fetch: rpcFake({ down: true }) }).c, FIRST)).resolves.toBeUndefined();
  });
});

describe('runReserveTransfers', () => {
  it('does not reconcile before the scan has caught up', async () => {
    const f = rpcFake({ head: FIRST - 1 + MAX_CHUNKS_PER_RUN * CHUNK_BLOCKS + 100_000 });
    const h = harness({ now: NOW, fetch: f });
    await runReserveTransfers(h.c);
    const methods = f.calls.map((call) => JSON.parse(String(call.init?.body)).method);
    expect(methods).not.toContain('eth_call');
  });

  it('scans, prices and reconciles in one run once caught up', async () => {
    const f = rpcFake({
      logs: ({ direction }) =>
        direction === 'in'
          ? [transferLog({ block: FIRST, index: 0, tx: '0xd1', direction: 'in', counterparty: DEPOSITOR, link: 7n, ts: T2 })]
          : [],
      balanceAt: () => 7n * 10n ** 18n,
    });
    const prices = fakePrices({ historical: { [LINK_PRICE_KEY]: { [seconds(T2)]: 14 } } });
    const h = harness({ now: NOW, fetch: f, prices });
    await runReserveTransfers(h.c);
    expect((await store.reserveTransfers(env.DB)).map((r) => r.link_usd)).toEqual([14]);
    expect(h.alerts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/reserve-job.test.ts`
Expected: FAIL. `priceReserveTransfers` and `reconcileReserve` are not exported.

- [ ] **Step 3: Implement**

Append to `worker/src/store.ts`:

```ts
export async function unpricedReserveTransfers(db: D1Database, limit: number): Promise<{ tx_hash: string; log_index: number; ts: string }[]> {
  const { results } = await db
    .prepare('SELECT tx_hash, log_index, ts FROM reserve_transfers WHERE link_usd IS NULL ORDER BY block_number, log_index LIMIT ?')
    .bind(limit)
    .all<{ tx_hash: string; log_index: number; ts: string }>();
  return results;
}

export async function setReserveTransferPrices(
  db: D1Database,
  prices: { txHash: string; logIndex: number; linkUsd: number }[],
): Promise<void> {
  const update = db.prepare('UPDATE reserve_transfers SET link_usd = ? WHERE tx_hash = ? AND log_index = ?');
  await runBatch(db, prices.map((p) => update.bind(p.linkUsd, p.txHash, p.logIndex)));
}
```

In `worker/src/jobs/reserve.ts`, add `LINK_PRICE_KEY` and `readLinkBalance` to the `@ccip-dev/core` import, add a constant after `OUTFLOW_ALERT_WINDOW_MS`:

```ts
const PRICE_ROWS_PER_RUN = 200;
```

replace `runReserveTransfers` with:

```ts
export async function runReserveTransfers(c: RunContext): Promise<void> {
  const scannedTo = await scanReserveTransfers(c);
  await priceReserveTransfers(c);
  if (scannedTo !== null) await reconcileReserve(c, scannedTo);
}
```

and append:

```ts
const unixSeconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export async function priceReserveTransfers(c: RunContext): Promise<void> {
  try {
    const rows = await store.unpricedReserveTransfers(c.env.DB, PRICE_ROWS_PER_RUN);
    if (rows.length === 0) return;
    const prices = await c.prices.historicalAt(LINK_PRICE_KEY, rows.map((r) => unixSeconds(r.ts)));
    await store.setReserveTransferPrices(
      c.env.DB,
      rows.flatMap((r) => {
        const linkUsd = prices.get(unixSeconds(r.ts));
        return linkUsd === undefined ? [] : [{ txHash: r.tx_hash, logIndex: r.log_index, linkUsd }];
      }),
    );
  } catch (err) {
    console.warn(`Reserve transfer pricing failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function reconcileReserve(c: RunContext, block: number): Promise<void> {
  try {
    const net = (await store.reserveTransfers(c.env.DB)).reduce(
      (total, r) => (r.direction === 'in' ? total + BigInt(r.amount) : total - BigInt(r.amount)),
      0n,
    );
    const balance = await readLinkBalance(c.deps, logRpcUrls(c.env), block);
    if (balance !== net) {
      await c.alert(
        'reserve-mismatch',
        `Reserve transfers net to ${formatLink(net)} LINK but balanceOf at block ${block} is ${formatLink(balance)} LINK`,
      );
    }
  } catch (err) {
    console.warn(`Reserve reconcile failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/reserve-job.test.ts test/hourly.test.ts`, then `pnpm test` and `pnpm typecheck`.
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/jobs/reserve.ts worker/src/store.ts worker/test/reserve-job.test.ts
git commit -m "feat(reserve): price Reserve transfers at their block time and reconcile them with the balance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Publish the Reserve statistics and document them

**Files:**
- Modify: `worker/src/publish.ts` (`publishRegistryFiles`)
- Modify: `docs/methodology.md` (new "Chainlink Reserve" section)
- Modify: `docs/runbook.md` (health check)
- Modify: `docs/superpowers/specs/2026-10-05-data-core-design.md` (the `reserve.json` row of §6.3)
- Test: `worker/test/publish.test.ts` (append)

**Interfaces:**
- Consumes:
  - from Task 3: `reserveStats`, `PricedTransfer`
  - from Task 1: `LINK_PRICE_KEY`
  - from Task 4: `store.reserveTransfers`, `ReserveTransferRow`, the `reserve_scan_caught_up` meta key
- Produces: `reserve.json` with the existing fields plus `link_price_usd`, `cost_basis`, `pace`, `weekly`, `performance`, `transfers` and `latest_transfer`, as in Global Constraints.

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/publish.test.ts`. Extend its imports to:
- `import { ATTRIBUTION, publishLiveFiles, publishRegistryFiles, putJson, retryPut } from '../src/publish';`
- `import { LINK_PRICE_KEY } from '@ccip-dev/core';`
- `import { fakePrices } from '@ccip-dev/core/testing';`

It keeps its existing `env`, `store`, `harness` and `readPublic` imports.

```ts
describe('reserve.json statistics', () => {
  const NOW_RESERVE = '2026-10-06T16:00:00.000Z';
  const D = '0x5680681ed3767b96914ce741a308155c7fb9171d';
  const linkRaw = (n: bigint) => (n * 10n ** 18n).toString();

  async function seedReserve(): Promise<void> {
    await store.insertReserve(env.DB, '2026-10-06T16:00:00.000Z', linkRaw(150_000n));
    await store.insertReserveTransfers(env.DB, [
      { txHash: '0xe1', logIndex: 0, blockNumber: 1, ts: '2026-09-15T15:35:00.000Z', direction: 'in', counterparty: D, amount: linkRaw(100_000n) },
      { txHash: '0xe2', logIndex: 0, blockNumber: 2, ts: '2026-09-30T15:35:00.000Z', direction: 'in', counterparty: D, amount: linkRaw(50_000n) },
    ]);
    await store.setReserveTransferPrices(env.DB, [
      { txHash: '0xe1', logIndex: 0, linkUsd: 10 },
      { txHash: '0xe2', logIndex: 0, linkUsd: 20 },
    ]);
  }

  it('publishes cost basis, pace, weeks and transfers once the scan has caught up, keeping the existing fields', async () => {
    await seedReserve();
    await store.setMeta(env.DB, 'reserve_scan_caught_up', '1');
    const prices = fakePrices({ latest: { [LINK_PRICE_KEY]: { price: 14.05836, decimals: 18 } } });
    await publishRegistryFiles(harness({ now: NOW_RESERVE, prices }).c);
    const doc = await readPublic('reserve.json');
    expect(doc).toMatchObject({
      schema_version: 1,
      latest: { ts: '2026-10-06T16:00:00.000Z', link: 150_000 },
      link_price_usd: 14.0584,
      cost_basis: { link_in: 150_000, link_out: 0, cost_usd: 2_000_000, value_usd: 2_108_754, unpriced_transfers: 0 },
      pace: { deposits: 2, last_deposit: { tx: '0xe2', link: 50_000, price_usd: 20, usd: 1_000_000 } },
      performance: { best: { tx: '0xe1', price_usd: 10 }, worst: { tx: '0xe2', price_usd: 20 }, above: 1, below: 1 },
    });
    expect(doc.weekly.map((w: { week: string }) => w.week)).toEqual(['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']);
    expect(doc.transfers).toHaveLength(2);
    expect(doc.latest_transfer).toEqual(doc.transfers[1]);
    expect(Array.isArray(doc.series)).toBe(true);
  });

  it('publishes empty statistics before the scan has caught up', async () => {
    await seedReserve();
    const prices = fakePrices({ latest: { [LINK_PRICE_KEY]: { price: 14, decimals: 18 } } });
    await publishRegistryFiles(harness({ now: NOW_RESERVE, prices }).c);
    expect(await readPublic('reserve.json')).toMatchObject({
      link_price_usd: 14, cost_basis: null, pace: null, weekly: [], performance: null, transfers: [], latest_transfer: null,
    });
  });

  it('publishes the cost basis without now-values when the LINK price is unavailable', async () => {
    await seedReserve();
    await store.setMeta(env.DB, 'reserve_scan_caught_up', '1');
    const prices = { ...fakePrices(), latest: async () => { throw new Error('llama down'); } };
    await publishRegistryFiles(harness({ now: NOW_RESERVE, prices }).c);
    expect(await readPublic('reserve.json')).toMatchObject({
      link_price_usd: null,
      cost_basis: { cost_usd: 2_000_000, value_usd: null, change_usd: null, change_pct: null },
    });
  });
});
```

`value_usd` = 150,000 × 14.05836 = 2,108,754. The 4-decimal rounding applies only to the published `link_price_usd`; `reserveStats` receives the unrounded price.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/publish.test.ts`
Expected: FAIL. `reserve.json` has no `link_price_usd` or `cost_basis`.

- [ ] **Step 3: Implement**

In `worker/src/publish.ts`, add `LINK_PRICE_KEY`, `reserveStats` and `type PricedTransfer` to the `@ccip-dev/core` import. Add the helpers above `publishRegistryFiles`:

```ts
async function latestLinkPrice(c: RunContext): Promise<number | null> {
  try {
    return (await c.prices.latest([LINK_PRICE_KEY])).get(LINK_PRICE_KEY)?.price ?? null;
  } catch (err) {
    console.warn(`LINK price read failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function pricedTransfer(r: store.ReserveTransferRow): PricedTransfer {
  return { ts: r.ts, tx: r.tx_hash, direction: r.direction, counterparty: r.counterparty, amount: r.amount, linkUsd: r.link_usd };
}
```

Replace the `reserve.json` part of `publishRegistryFiles` (from the `series` line through the end of the `putJson` call) with:

```ts
  const series = await store.reserveSeries(db, new Date(now.getTime() - 90 * DAY_MS).toISOString());
  const latest = series.at(-1);
  const linkPriceUsd = await latestLinkPrice(c);
  const caughtUp = (await store.getMeta(db, 'reserve_scan_caught_up')) === '1';
  const stats = caughtUp ? reserveStats({ transfers: (await store.reserveTransfers(db)).map(pricedTransfer), linkPriceUsd, now }) : null;
  await putJson(
    c.env.PUBLIC,
    'reserve.json',
    {
      token: LINK_TOKEN,
      reserve: LINK_RESERVE,
      latest: latest ? { ts: latest.ts, link: linkUnits(latest.link_balance) } : null,
      series: series.map((s) => ({ ts: s.ts, link: linkUnits(s.link_balance) })),
      link_price_usd: linkPriceUsd === null ? null : Math.round(linkPriceUsd * 10_000) / 10_000,
      cost_basis: stats?.cost_basis ?? null,
      pace: stats?.pace ?? null,
      weekly: stats?.weekly ?? [],
      performance: stats?.performance ?? null,
      transfers: stats?.transfers ?? [],
      latest_transfer: stats?.latest_transfer ?? null,
    },
    TTL.reserve,
    now,
  );
```

- [ ] **Step 4: Write the docs**

Add a section to `docs/methodology.md` before "## Cross-check":

```markdown
## Chainlink Reserve
- **Balance:** read every hour with `balanceOf` on the LINK token for the Reserve, `0x9A709B7B69EA42D5eeb1ceBC48674C69E1569eC6`.
- **Transfers:** every LINK `Transfer` into or out of the Reserve since its first transfer (block 23,039,541,
  2025-07-31). They come from Ethereum logs through free public RPC endpoints, 12 blocks behind the chain head.
  Each run checks that transfers in minus transfers out equal the balance at the last block scanned, and alerts if
  they differ.
- **Price at transfer:** DefiLlama's LINK price at the transfer's block time, within 10 minutes. This is the market
  price when the LINK arrived, not the price Chainlink paid for it.
- **Cost basis:** every inbound transfer at its own time price, minus every outbound transfer at its own time price.
  **Value now** is the net LINK at DefiLlama's current price.
- **Deposits:** inbound transfers of at least 1,000 LINK. Smaller inbound transfers (a 1-LINK test and gifts of up
  to 7 LINK) count toward the balance and the cost basis, but not toward pace, weekly deposits or performance.
- **Weekly:** UTC weeks starting Monday. The weekly USD is the deposit-time value of the LINK deposited, not
  Chainlink's revenue.
- **Pace:** the 4-week figures average the last four complete weeks. The milestone date assumes that pace continues.
```

In `docs/runbook.md`, add to the health-check list:

```markdown
- Reserve: `curl -s https://data.ccip.dev/v1/reserve.json | jq '{link_price_usd, cost_basis, deposits: .pace.deposits}'`. About 7 hours after the first deploy with the transfer scan (the backfill), `cost_basis` is non-null, and no `reserve-mismatch` alert has arrived.
```

In `docs/superpowers/specs/2026-10-05-data-core-design.md` §6.3, change the `reserve.json` row's description from "Latest balance and a 90-day hourly series" to "Latest balance and a 90-day hourly series, plus cost basis, pace, weekly deposits, performance and transfers (see `2026-10-06-reserve-and-link-metrics-design.md`)".

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/publish.test.ts test/hourly.test.ts`, then `pnpm test` and `pnpm typecheck`.
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/publish.ts worker/test/publish.test.ts docs/methodology.md docs/runbook.md docs/superpowers/specs/2026-10-05-data-core-design.md
git commit -m "feat(reserve): publish cost basis, pace, weekly deposits, performance and transfers in reserve.json

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: CCIP fees paid in LINK

**Files:**
- Modify: `packages/core/src/rollup.ts` (add `linkFeeUsd`, `linkFeeMatcher`)
- Modify: `worker/src/store.ts` (add `linkFeeTokens`, `setFeeLinkUsd`, `feeLinkByDay`)
- Modify: `worker/src/jobs/finalize.ts` (store `fee_link_usd`)
- Modify: `worker/src/publish.ts` (`publishToday`, `publishHistoryFiles`)
- Modify: `docs/methodology.md` (one line under "What is counted")
- Test: `packages/core/test/rollup.test.ts`, `worker/test/finalize.test.ts`, `worker/test/publish.test.ts`

**Interfaces:**
- Consumes:
  - from Task 1: `LINK_TOKEN`, `LINK_TOKEN_CHAIN_SELECTOR`
  - the `daily_totals.fee_link_usd` column, from Task 4's migration
- Produces:
  - `linkFeeMatcher(keys: ReadonlySet<string>): (chain: string, feeToken: string) => boolean`. Keys are `` `${chainSelector}:${normalizeAddress(address)}` ``.
  - `linkFeeUsd(messages: MessageRow[], day: string, isLinkFee): number | null`
  - `store.linkFeeTokens(db): Promise<Set<string>>`
  - `store.setFeeLinkUsd(db, day, value: number | null): Promise<void>`
  - `store.feeLinkByDay(db): Promise<Map<string, number | null>>`
  - `today.json` `totals.fee_link_usd` and `totals.fee_link_share_pct`; `history.json` `days[].fee_link_usd`

- [ ] **Step 1: Write the failing core tests**

Append to `packages/core/test/rollup.test.ts`, importing `linkFeeMatcher, linkFeeUsd` from `../src/rollup` and `type MessageRow` from `../src/types` if the file doesn't already:

```ts
describe('linkFeeUsd', () => {
  const LINK_BASE = '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196';
  const BASE = '15971525489660198786';
  const isLinkFee = linkFeeMatcher(new Set([`${BASE}:${LINK_BASE.toLowerCase()}`]));
  const row = (id: string, day: string, feeToken: string | null, feeUsd: number | null) =>
    ({ message_id: id, day, src_chain: BASE, fee_token: feeToken, fee_usd: feeUsd }) as MessageRow;

  it('sums the fees paid in LINK, matching a checksummed fee token', () => {
    const rows = [row('a', '2026-10-05', LINK_BASE, 2), row('b', '2026-10-05', '0x4200000000000000000000000000000000000006', 3), row('c', '2026-10-05', LINK_BASE, 0.5)];
    expect(linkFeeUsd(rows, '2026-10-05', isLinkFee)).toBe(2.5);
  });

  it('is 0 when fees exist but none were paid in LINK', () => {
    expect(linkFeeUsd([row('a', '2026-10-05', '0x4200000000000000000000000000000000000006', 3)], '2026-10-05', isLinkFee)).toBe(0);
  });

  it('is null when no message of the day has a fee', () => {
    expect(linkFeeUsd([row('a', '2026-10-05', null, null)], '2026-10-05', isLinkFee)).toBeNull();
  });

  it('ignores other days and counts a duplicated message once', () => {
    const rows = [row('a', '2026-10-05', LINK_BASE, 2), row('a', '2026-10-05', LINK_BASE, 2), row('z', '2026-10-04', LINK_BASE, 9)];
    expect(linkFeeUsd(rows, '2026-10-05', isLinkFee)).toBe(2);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ccip-dev/core exec vitest run test/rollup.test.ts`
Expected: FAIL. `linkFeeUsd` is not exported.

- [ ] **Step 3: Implement the core functions**

Append to `packages/core/src/rollup.ts`, adding `import { normalizeAddress } from './normalize';` at the top:

```ts
export type LinkFeeMatcher = (chain: string, feeToken: string) => boolean;

export function linkFeeMatcher(keys: ReadonlySet<string>): LinkFeeMatcher {
  return (chain, feeToken) => keys.has(`${chain}:${normalizeAddress(feeToken)}`);
}

export function linkFeeUsd(messages: MessageRow[], day: string, isLinkFee: LinkFeeMatcher): number | null {
  const byId = new Map<string, MessageRow>();
  for (const m of messages) if (m.day === day) byId.set(m.message_id, m);
  const rows = [...byId.values()];
  if (!rows.some((r) => r.fee_usd !== null)) return null;
  return sum(rows.filter((r) => r.fee_usd !== null && r.fee_token !== null && isLinkFee(r.src_chain, r.fee_token)).map((r) => r.fee_usd!));
}
```

Run: `pnpm --filter @ccip-dev/core exec vitest run test/rollup.test.ts`. Expected: PASS.

- [ ] **Step 4: Write the failing worker tests**

Append to `worker/test/finalize.test.ts`, inside its top-level `describe` or as a new one, using its existing imports (`store`, `harness`, `fakeCcip`, `runFinalize`, `seedRegistry`, `liveRow`, `NETWORKS`, `env`), plus `readPublic` from `./helpers`:

```ts
describe('fees paid in LINK', () => {
  it('stores the USD value of the day\'s fees paid in LINK and publishes it in history.json', async () => {
    const day = '2026-10-09';
    const linkEth = '0x514910771AF9Ca656af840dff83E8264EcF986CA';
    const linkBase = '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196';
    await seedRegistry([NETWORKS.ethereum, NETWORKS.base], [
      { chainSelector: NETWORKS.ethereum.chainSelector, address: linkEth, symbol: 'LINK', name: 'Chainlink', decimals: 18, groupId: 'link' },
      { chainSelector: NETWORKS.base.chainSelector, address: linkBase, symbol: 'LINK', name: 'Chainlink', decimals: 18, groupId: 'link' },
    ]);
    await store.setMeta(env.DB, 'live_start_day', day);
    await store.setMeta(env.DB, 'last_finalize_day', '2026-10-08');
    await store.upsertListRows(env.DB, [
      liveRow({ id: 'f1', sendTs: `${day}T10:00:00.000Z`, src: NETWORKS.base }, { fee_token: linkBase, fee_amount: '1', fee_usd: 2, detail_fetched_at: `${day}T10:01:00.000Z`, next_check_at: null }),
      liveRow({ id: 'f2', sendTs: `${day}T11:00:00.000Z`, src: NETWORKS.base }, { fee_token: '0x4200000000000000000000000000000000000006', fee_amount: '1', fee_usd: 3, detail_fetched_at: `${day}T11:01:00.000Z`, next_check_at: null }),
    ], []);
    const { c } = harness({ now: '2026-10-10T00:10:00.000Z', ccip: fakeCcip({ messages: [] }) });
    await runFinalize(c, 'early');
    const stored = await env.DB.prepare('SELECT fee_link_usd FROM daily_totals WHERE day = ?').bind(day).first<{ fee_link_usd: number | null }>();
    expect(stored?.fee_link_usd).toBe(2);
    const history = await readPublic('history.json');
    expect(history.days.find((d: { day: string }) => d.day === day)).toMatchObject({ fee_usd: 5, fee_link_usd: 2 });
  });
});
```

`store.upsertListRows` writes every message column, fee fields included, so the `liveRow` extras reach D1. `detail_fetched_at` is set so finalize does not try to fetch details for these rows.

Append to `worker/test/publish.test.ts`:

```ts
describe('today.json fees paid in LINK', () => {
  const NOW = '2026-10-08T12:00:00.000Z';

  it('publishes the LINK fee total and its share of all fees', async () => {
    const linkBase = '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196';
    await seedRegistry([NETWORKS.base], [
      { chainSelector: NETWORKS.base.chainSelector, address: linkBase, symbol: 'LINK', name: 'Chainlink', decimals: 18, groupId: 'link' },
    ]);
    await env.DB.prepare(`INSERT INTO tokens (chain, address, symbol, name, decimals, group_id, first_seen, last_seen) VALUES (?, ?, 'LINK', 'Chainlink', 18, 'link', ?, ?)`)
      .bind('5009297550715157269', '0x514910771AF9Ca656af840dff83E8264EcF986CA', NOW, NOW).run();
    const today = NOW.slice(0, 10);
    await store.upsertListRows(env.DB, [
      liveRow({ id: 't1', sendTs: `${today}T00:01:00.000Z`, src: NETWORKS.base }, { fee_token: linkBase, fee_amount: '1', fee_usd: 2 }),
      liveRow({ id: 't2', sendTs: `${today}T00:02:00.000Z`, src: NETWORKS.base }, { fee_token: '0x4200000000000000000000000000000000000006', fee_amount: '1', fee_usd: 3 }),
    ], []);
    await publishLiveFiles(harness({ now: NOW }).c);
    expect((await readPublic('today.json')).totals).toMatchObject({ fee_usd: 5, fee_link_usd: 2, fee_link_share_pct: 40 });
  });
});
```

Update the imports at the top of `worker/test/publish.test.ts`:
- `import { ATTRIBUTION, publishLiveFiles, publishRegistryFiles, putJson, retryPut } from '../src/publish';`
- `import { harness, liveRow, readPublic, resetStorage, seedRegistry } from './helpers';`
- `import { LINK_PRICE_KEY } from '@ccip-dev/core';`
- `import { fakePrices, NETWORKS } from '@ccip-dev/core/testing';`

The Task 6 tests need some of these too, so whichever of Task 6 and Task 7 runs first adds them. The test defines its own `NOW`, matching the existing today-totals test (`2026-10-08T12:00:00.000Z`), and its message times fall inside that UTC day.

- [ ] **Step 5: Run them to verify they fail**

Run: `pnpm --filter @ccip-dev/worker exec vitest run test/finalize.test.ts test/publish.test.ts`
Expected: FAIL. `fee_link_usd` is null or missing.

- [ ] **Step 6: Implement the store, finalize and publish changes**

Append to `worker/src/store.ts`. Add `LINK_TOKEN`, `LINK_TOKEN_CHAIN_SELECTOR` and `normalizeAddress` to its `@ccip-dev/core` import; `store.ts` does not import `normalizeAddress` yet:

```ts
export async function linkFeeTokens(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare(
      `SELECT chain, address FROM tokens
       WHERE group_id IS NOT NULL AND group_id = (SELECT group_id FROM tokens WHERE chain = ? AND lower(address) = lower(?))`,
    )
    .bind(LINK_TOKEN_CHAIN_SELECTOR, LINK_TOKEN)
    .all<{ chain: string; address: string }>();
  return new Set([
    `${LINK_TOKEN_CHAIN_SELECTOR}:${normalizeAddress(LINK_TOKEN)}`,
    ...results.map((r) => `${r.chain}:${normalizeAddress(r.address)}`),
  ]);
}

export async function setFeeLinkUsd(db: D1Database, day: string, value: number | null): Promise<void> {
  await db.prepare('UPDATE daily_totals SET fee_link_usd = ? WHERE day = ?').bind(value, day).run();
}

export async function feeLinkByDay(db: D1Database): Promise<Map<string, number | null>> {
  const { results } = await db.prepare('SELECT day, fee_link_usd FROM daily_totals').all<{ day: string; fee_link_usd: number | null }>();
  return new Map(results.map((r) => [r.day, r.fee_link_usd]));
}
```

In `worker/src/jobs/finalize.ts`, add `linkFeeMatcher, linkFeeUsd` to the `@ccip-dev/core` import. In `runFinalize`, add after `const loader = fallbackLoader(c);`:

```ts
  const isLinkFee = linkFeeMatcher(await store.linkFeeTokens(db));
```

and replace the two lines that roll up and store the day with:

```ts
    const messages = await store.messagesForDay(db, day);
    const { totals, breakdown } = rollupDay(day, messages, await store.tokensForDay(db, day));
    await store.replaceDaily(db, totals, breakdown, c.deps.now().toISOString());
    await store.setFeeLinkUsd(db, day, linkFeeUsd(messages, day, isLinkFee));
```

In `worker/src/publish.ts`, add `linkFeeMatcher, linkFeeUsd` to the `@ccip-dev/core` import and this helper next to `usd`:

```ts
function feeLinkShare(feeLinkUsd: number | null, feeUsd: number | null): number | null {
  return feeLinkUsd === null || feeUsd === null || feeUsd === 0 ? null : Math.round((feeLinkUsd / feeUsd) * 10_000) / 100;
}
```

In `publishToday`, replace the rollup line with:

```ts
  const messages = await store.messagesForDay(c.env.DB, day);
  const { totals, breakdown } = rollupDay(day, messages, await store.tokensForDay(c.env.DB, day));
  const feeLink = linkFeeUsd(messages, day, linkFeeMatcher(await store.linkFeeTokens(c.env.DB)));
```

and its `totals` entry with:

```ts
      totals: {
        ...totals,
        usd_value: usd(totals.usd_value),
        fee_usd: usd(totals.fee_usd),
        fee_link_usd: usd(feeLink),
        fee_link_share_pct: feeLinkShare(feeLink, totals.fee_usd),
      },
```

In `publishHistoryFiles`, read the map after `const history = await store.dailyHistory(db);`:

```ts
  const feeLink = await store.feeLinkByDay(db);
```

and change the `days` mapping to:

```ts
    { since, days: history.map((d) => ({ ...d, usd_value: usd(d.usd_value), fee_usd: usd(d.fee_usd), fee_link_usd: usd(feeLink.get(d.day) ?? null) })) },
```

In `docs/methodology.md`, add under "## What is counted", after the **Fees** bullet:

```markdown
- **Fees paid in LINK:** the part of a day's fees whose fee token is LINK on its chain, meaning any token in CCIP's LINK token group. `fee_link_share_pct` is that part as a share of all fees. Available from 2026-10-05 onward.
```

- [ ] **Step 7: Run all the tests**

Run: `pnpm test` and `pnpm typecheck`.
Expected: all PASS. The existing finalize parity test compares `dailyHistory` rows, which do not include `fee_link_usd`, so it is unaffected.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/rollup.ts packages/core/test/rollup.test.ts worker/src/store.ts worker/src/jobs/finalize.ts worker/src/publish.ts worker/test/finalize.test.ts worker/test/publish.test.ts docs/methodology.md
git commit -m "feat(fees): record and publish the USD value and share of CCIP fees paid in LINK

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the last task (controller)

- Ask the owner to `git push`. The deploy workflow applies migration 0003, then deploys.
- Watch the backfill. `reserve_scan_block` should advance about 500,000 blocks per hourly run, and after about 7 runs `reserve_scan_caught_up` should be `1` with no `reserve-mismatch` alert. `reserve.json` should then show `cost_basis` close to the exploration figures: about $67.98M cost, an average deposit price of about $11.10, and 61 deposits.
- Fees: the next 00:10 UTC finalize writes `fee_link_usd`, and `today.json` shows it within a minute of the deploy.
