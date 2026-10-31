import { USER_AGENT, type HttpDeps } from './http';

export type Fetcher = Pick<HttpDeps, 'fetch'>;

export const HEX_QUANTITY = /^0x[0-9a-fA-F]+$/;

export const toHex = (n: number) => `0x${n.toString(16)}`;

export async function ethRpc(deps: Fetcher, url: string, method: string, params: unknown[]): Promise<unknown> {
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

/**
 * Several calls in one JSON-RPC batch, results in call order. An endpoint that answers a batch with any call missing or
 * failed counts as failed, so the caller's next endpoint gets the whole batch.
 */
export async function ethRpcBatch(deps: Fetcher, url: string, calls: readonly { method: string; params: unknown[] }[]): Promise<unknown[]> {
  if (calls.length === 0) return [];
  const res = await deps.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body: JSON.stringify(calls.map((c, id) => ({ jsonrpc: '2.0', id, method: c.method, params: c.params }))),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) throw new Error('batch answered with a single response');
  const byId = new Map<number, unknown>();
  for (const item of body as { id?: number; result?: unknown }[]) {
    if (typeof item?.id === 'number' && item.result !== undefined && item.result !== null) byId.set(item.id, item.result);
  }
  if (byId.size !== calls.length) throw new Error(`batch answered ${byId.size} of ${calls.length} calls`);
  return calls.map((_, id) => byId.get(id));
}

export function hexQuantity(value: unknown): bigint {
  if (typeof value !== 'string' || !HEX_QUANTITY.test(value)) throw new Error('malformed result');
  return BigInt(value);
}

export async function onFirstEndpoint<T>(rpcUrls: string[], what: string, attempt: (url: string) => Promise<T>): Promise<T> {
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
