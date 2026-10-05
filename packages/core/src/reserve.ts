import { USER_AGENT, type HttpDeps } from './http';

export const LINK_TOKEN = '0x514910771AF9Ca656af840dff83E8264EcF986CA';
export const LINK_RESERVE = '0x9A709B7B69EA42D5eeb1ceBC48674C69E1569eC6';
export const DEFAULT_RPC_URLS = ['https://ethereum-rpc.publicnode.com'];

const BALANCE_OF = '0x70a08231';

export async function readLinkBalance(deps: Pick<HttpDeps, 'fetch'>, rpcUrls: string[]): Promise<bigint> {
  const data = `${BALANCE_OF}${LINK_RESERVE.slice(2).toLowerCase().padStart(64, '0')}`;
  const failures: string[] = [];
  for (const [index, url] of rpcUrls.entries()) {
    try {
      const res = await deps.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: LINK_TOKEN, data }, 'latest'] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { result?: string; error?: { message?: string } };
      if (typeof body.result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(body.result)) {
        throw new Error(body.error?.message ?? 'no result');
      }
      return BigInt(body.result);
    } catch (err) {
      failures.push(`endpoint ${index + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`Reserve balance read failed on every RPC endpoint (${failures.join('; ')})`);
}
