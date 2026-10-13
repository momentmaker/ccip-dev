import type { CcipClient, MessagePage, TokenPage } from './ccip/client';
import { cursorAt, decodeCursor, encodeCursor } from './ccip/cursor';
import type { ListMessage, NetworkInfo, RegistryToken } from './ccip/schemas';
import type { CoingeckoClient, CoingeckoLists } from './coingecko';
import { UpstreamHttpError, type HttpDeps } from './http';
import type { PricesClient } from './prices';
import type { PriceInfo } from './types';
import type { RosterFile } from './roster';

export type FakeRoute = (url: string, init?: RequestInit) => Response | undefined | Promise<Response | undefined>;
export type FakeFetch = typeof fetch & { calls: { url: string; init?: RequestInit }[] };

export function fakeFetch(...routes: FakeRoute[]): FakeFetch {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    for (const route of routes) {
      const res = await route(url, init);
      if (res) return res;
    }
    throw new Error(`fakeFetch: no route for ${url}`);
  };
  return Object.assign(fn, { calls }) as unknown as FakeFetch;
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function instantDeps(fetchFn: typeof fetch): HttpDeps {
  return { fetch: fetchFn, sleep: async () => {}, clock: () => 0 };
}

const net = (name: string, displayName: string | null, chainSelector: string, chainId: string, chainFamily = 'EVM'): NetworkInfo => ({
  name, displayName, chainSelector, chainId, chainFamily, environment: 'mainnet',
});

export const NETWORKS = {
  ethereum: net('ethereum-mainnet', 'Ethereum Mainnet', '5009297550715157269', '1'),
  base: net('ethereum-mainnet-base-1', 'Base Mainnet', '15971525489660198786', '8453'),
  bsc: net('binance_smart_chain-mainnet', 'BNB Chain Mainnet', '11344663589394136015', '56'),
  sui: net('sui-mainnet', null, '17529533435026248318', '1', 'SUI'),
  solana: net('solana-mainnet', 'Solana', '124615329519749607', '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', 'SVM'),
} as const;

export interface ListMessageSpec {
  id: string;
  sendTs: string;
  status?: string;
  sender?: string;
  src?: NetworkInfo;
  dst?: NetworkInfo;
  token?: { address: string; amount: string } | null;
  receiptTs?: string | null;
  readyForManualExecution?: boolean;
}

export function listMessage(spec: ListMessageSpec): ListMessage {
  return {
    messageId: spec.id,
    sender: spec.sender ?? '0x1111111111111111111111111111111111111111',
    receiver: '0x2222222222222222222222222222222222222222',
    origin: '0x3333333333333333333333333333333333333333',
    status: spec.status ?? 'SENT',
    readyForManualExecution: spec.readyForManualExecution ?? false,
    sourceNetworkInfo: spec.src ?? NETWORKS.base,
    destNetworkInfo: spec.dst ?? NETWORKS.bsc,
    sendTimestamp: spec.sendTs,
    receiptTimestamp: spec.receiptTs ?? null,
    sourceTokenAmount: spec.token ? { tokenAddress: spec.token.address, tokenAmount: spec.token.amount } : null,
  };
}

export interface FakeCcipOptions {
  /** Newest first, exactly as the API orders them. Cursors are string offsets into this array. */
  messages?: ListMessage[];
  /** Raw details by message id; an Error is thrown, and a missing id answers 404 as the API does. */
  details?: Record<string, unknown>;
  chains?: NetworkInfo[];
  tokens?: RegistryToken[];
  failCursors?: Set<string>;
}

export type FakeCcip = CcipClient & { listCalls: (string | null)[] };

export function fakeCcip(opts: FakeCcipOptions = {}): FakeCcip {
  const messages = opts.messages ?? [];
  const listCalls: (string | null)[] = [];
  return {
    listCalls,
    async listMessages({ limit, cursor }): Promise<MessagePage> {
      listCalls.push(cursor ?? null);
      if (cursor && opts.failCursors?.has(cursor)) throw new UpstreamHttpError('GET /messages', 500);
      const offset = cursor ? Number(cursor) : 0;
      const slice = messages.slice(offset, offset + limit);
      const next = offset + limit < messages.length ? String(offset + limit) : null;
      return { messages: slice, raw: slice.map((m) => ({ ...m })), cursor: next };
    },
    async getMessageRaw(id) {
      const detail = opts.details?.[id];
      if (detail === undefined) throw new UpstreamHttpError('GET /messages/{id}', 404);
      if (detail instanceof Error) throw detail;
      return detail;
    },
    async listChains() {
      return opts.chains ?? [];
    },
    async listTokens({ limit, cursor }): Promise<TokenPage> {
      const all = opts.tokens ?? [];
      const offset = cursor ? Number(cursor) : 0;
      const next = offset + limit < all.length ? String(offset + limit) : null;
      return { tokens: all.slice(offset, offset + limit), cursor: next };
    },
  };
}

export interface FakeKeysetApiOptions {
  /** Any order: the fake sorts them newest first by (sendTimestamp, messageId), as the API does. */
  messages: ListMessage[];
  /** Any page that holds one of these message ids fails with HTTP 500, and its detail is a 404. */
  poison?: string[];
  chains?: NetworkInfo[];
}

export type FakeKeysetCall = { limit: number; cursor: string | null; sourceChainSelector?: string };
export type FakeKeysetApi = CcipClient & { listCalls: FakeKeysetCall[] };

/** Pages like the real API: codec cursors over a (timestamp, message id) keyset, with filters carried in the cursor. */
export function fakeKeysetApi(opts: FakeKeysetApiOptions): FakeKeysetApi {
  const position = (m: ListMessage) => ({ ts: Date.parse(m.sendTimestamp), id: BigInt(m.messageId) });
  const newestFirst = (a: ListMessage, b: ListMessage) => {
    const [pa, pb] = [position(a), position(b)];
    return pb.ts - pa.ts || (pb.id > pa.id ? 1 : pb.id < pa.id ? -1 : 0);
  };
  const sorted = [...opts.messages].sort(newestFirst);
  const poison = new Set((opts.poison ?? []).map((id) => id.toLowerCase()));
  const listCalls: FakeKeysetCall[] = [];
  return {
    listCalls,
    async listMessages({ limit, cursor, sourceChainSelector }): Promise<MessagePage> {
      listCalls.push({ limit, cursor: cursor ?? null, ...(sourceChainSelector ? { sourceChainSelector } : {}) });
      const params = cursor ? decodeCursor(cursor) : new URLSearchParams({ environment: 'mainnet' });
      if (!cursor && sourceChainSelector) params.set('sourceChainSelector', sourceChainSelector);
      const source = params.get('sourceChainSelector');
      const oldestTs = params.has('oldestSeenTimestamp') ? Number(params.get('oldestSeenTimestamp')) : Infinity;
      const oldestId = BigInt(params.get('oldestSeenMessageId') ?? 0);
      const remaining = sorted.filter((m) => {
        const { ts, id } = position(m);
        const pastCursor = ts < oldestTs || (ts === oldestTs && id < oldestId);
        return pastCursor && (source === null || m.sourceNetworkInfo.chainSelector === source);
      });
      const page = remaining.slice(0, limit);
      if (page.some((m) => poison.has(m.messageId.toLowerCase()))) throw new UpstreamHttpError('GET /messages', 500);
      const last = page.at(-1);
      const next = last && remaining.length > limit ? cursorAt(encodeCursor(params), position(last).ts, last.messageId) : null;
      return { messages: page, raw: page.map((m) => ({ ...m })), cursor: next };
    },
    async getMessageRaw(id) {
      const message = sorted.find((m) => m.messageId.toLowerCase() === id.toLowerCase());
      if (!message || poison.has(id.toLowerCase())) throw new UpstreamHttpError('GET /messages/{id}', 404);
      return { ...message };
    },
    async listChains() {
      return opts.chains ?? [];
    },
    async listTokens(): Promise<TokenPage> {
      return { tokens: [], cursor: null };
    },
  };
}

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

export type FakeCoingecko = CoingeckoClient & { calls: number };

/** CoinGecko's id lists; empty unless given, and failing with `fail`. */
export function fakeCoingecko(lists: Partial<CoingeckoLists> = {}, options: { fail?: Error } = {}): FakeCoingecko {
  const fake: FakeCoingecko = {
    calls: 0,
    async lists() {
      fake.calls += 1;
      if (options.fail) throw options.fail;
      return { platforms: lists.platforms ?? [], coins: lists.coins ?? [] };
    },
    async dailyHistory() {
      return new Map();
    },
  };
  return fake;
}

const rosterMeme = (tag: string, count: number) => ({ tag, file: `${tag}.jpeg`, count });

/**
 * A small roster: eight tags (four of them one-meme, two never drawn) and four Marines, one per tier.
 * Shared by core and site tests.
 */
export const ROSTER_FIXTURE: RosterFile = {
  version: 1,
  updatedAt: '2026-10-13T14:00:00.000Z',
  snapshot: {
    version: 1,
    tags: [
      { tag: 'sergey', count: 400, chance: 0.4, meme: 'sergey.jpeg' },
      { tag: 'pepe', count: 100, chance: 0.2, meme: 'pepe.jpeg' },
      { tag: 'comfy', count: 25, chance: 0.1, meme: 'comfy.jpeg' },
      { tag: 'prophecy', count: 3, chance: 0.1, meme: 'prophecy.jpeg' },
      { tag: 'painting', count: 1, chance: 0.05, meme: 'painting.jpeg' },
      { tag: 'space', count: 1, chance: 0.05, meme: 'space.jpeg' },
      { tag: 'zoomer', count: 1, chance: 0.05, meme: 'zoomer.jpeg' },
      { tag: 'samurai', count: 1, chance: 0.05, meme: 'samurai.jpeg' },
    ],
  },
  marines: [
    { serial: 1, callsign: 'sergey-pepe-comfy', tags: ['sergey', 'pepe', 'comfy'], tier: 'common', score: 14.2, percentile: 31.5, memes: [rosterMeme('sergey', 400), rosterMeme('pepe', 100), rosterMeme('comfy', 25)], blood: 'LINK+', faith: '4IR', enlisted: '2026-10-13' },
    { serial: 2, callsign: 'painting-space-prophecy', tags: ['painting', 'space', 'prophecy'], tier: 'legendary', score: 18.74, percentile: 97.9, memes: [rosterMeme('painting', 1), rosterMeme('space', 1), rosterMeme('prophecy', 3)], blood: 'O-LINK', faith: 'SERGEY', enlisted: '2026-10-13' },
    { serial: 3, callsign: 'pepe-sergey-prophecy', tags: ['pepe', 'sergey', 'prophecy'], tier: 'uncommon', score: 16.3, percentile: 66.1, memes: [rosterMeme('pepe', 100), rosterMeme('sergey', 400), rosterMeme('prophecy', 3)], blood: 'LINK+', faith: 'STAKING', enlisted: '2026-10-14' },
    { serial: 4, callsign: 'comfy-painting-sergey', tags: ['comfy', 'painting', 'sergey'], tier: 'rare', score: 17.5, percentile: 88.2, memes: [rosterMeme('comfy', 25), rosterMeme('painting', 1), rosterMeme('sergey', 400)], blood: '7777777', faith: '4IR', enlisted: '2026-10-14' },
  ],
};
