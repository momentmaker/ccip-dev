import { createThrottle, getJson, parseWith, type HttpDeps } from '../http';
import { ChainsResponse, ListPage, TokensPage, type ListMessage, type NetworkInfo, type RegistryToken } from './schemas';

export const CCIP_API_BASE = 'https://api.ccip.chain.link/v2';

export interface CcipClientOptions {
  baseUrl?: string;
  maxRetries?: number;
  minIntervalMs?: number;
}

export interface MessagePage {
  messages: ListMessage[];
  raw: unknown[];
  cursor: string | null;
}

export interface TokenPage {
  tokens: RegistryToken[];
  cursor: string | null;
}

export interface CcipClient {
  listMessages(opts: { limit: number; cursor?: string | null }): Promise<MessagePage>;
  getMessageRaw(messageId: string): Promise<unknown>;
  listChains(): Promise<NetworkInfo[]>;
  listTokens(opts: { limit: number; cursor?: string | null }): Promise<TokenPage>;
}

export function createCcipClient(deps: HttpDeps, options: CcipClientOptions = {}): CcipClient {
  const baseUrl = options.baseUrl ?? CCIP_API_BASE;
  const maxRetries = options.maxRetries ?? 4;
  const throttle = createThrottle(deps, options.minIntervalMs ?? 1000);
  const get = (path: string, endpoint: string) => getJson(deps, `${baseUrl}${path}`, { endpoint, maxRetries, throttle });

  return {
    async listMessages({ limit, cursor }) {
      const query = new URLSearchParams({ environment: 'mainnet', limit: String(limit) });
      if (cursor) query.set('cursor', cursor);
      const json = await get(`/messages?${query}`, 'GET /messages');
      const page = parseWith(ListPage, json, 'GET /messages');
      const next = page.pagination.hasNextPage ? (page.pagination.cursor ?? null) : null;
      return { messages: page.data, raw: (json as { data: unknown[] }).data, cursor: next };
    },
    getMessageRaw(messageId) {
      return get(`/messages/${encodeURIComponent(messageId)}`, 'GET /messages/{id}');
    },
    async listChains() {
      const json = await get('/chains?environment=mainnet', 'GET /chains');
      return parseWith(ChainsResponse, json, 'GET /chains').chains;
    },
    async listTokens({ limit, cursor }) {
      const query = new URLSearchParams({ environment: 'mainnet', limit: String(limit) });
      if (cursor) query.set('cursor', cursor);
      const page = parseWith(TokensPage, await get(`/tokens?${query}`, 'GET /tokens'), 'GET /tokens');
      return { tokens: page.data, cursor: page.pagination.hasNextPage ? (page.pagination.cursor ?? null) : null };
    },
  };
}
