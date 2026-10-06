import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LINK_RESERVE, LINK_TOKEN, LOG_RPC_URLS } from '@ccip-dev/core';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENDPOINTS_FILE = path.join(ROOT, 'config/endpoints.json');
const SOURCE = 'Built by pnpm endpoints:refresh from chainlist.org/rpcs.json (DefiLlama/chainlist); every entry is keyless and verified live';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const RESERVE_TOPIC = `0x${LINK_RESERVE.slice(2).toLowerCase().padStart(64, '0')}`;
export const RESERVE_DEPOSIT_TX = '0x716918279bd52bbb4af6237af26423ac95f796731df725bd4a5a6c79c69ec70b';
const PROBE_FROM_BLOCK = 26_089_400;
const PROBE_TO_BLOCK = 26_099_399;
const TRUSTED_LOG_HOSTS = new Set(LOG_RPC_URLS.map((u) => new URL(u).hostname));
const LOG_ENDPOINT_TARGET = 4;
const MAX_RPC_CANDIDATES = 6;
const MAX_EXPLORER_CANDIDATES = 3;
const PROBE_TIMEOUT_MS = 8_000;
const LOG_PROBE_TIMEOUT_MS = 20_000;
const KEYED_URL = /api[_-]?key|apikey|demo|\/vk_|\/v\d\/[0-9a-f]{20,}/i;

export interface ChainlistEntry {
  chainId: number;
  rpc?: { url: string; tracking?: string }[];
  explorers?: { name: string; url: string }[];
}

export interface Endpoints {
  source: string;
  rpc: Record<string, string>;
  explorer: Record<string, string>;
  ethereumLogs: string[];
}

export interface Change {
  kind: 'rpc' | 'explorer' | 'ethereumLogs';
  chain?: string;
  change: 'added' | 'replaced' | 'removed';
  url?: string;
}

export interface CcipChain {
  name: string;
  family: string;
  chain_id: string;
}

export function isKeylessHttps(url: string): boolean {
  return url.startsWith('https://') && !url.includes('${') && !KEYED_URL.test(url);
}

function isTrustedLogHost(url: string): boolean {
  try {
    return TRUSTED_LOG_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function candidateRpcs(entry: ChainlistEntry): string[] {
  return (entry.rpc ?? [])
    .filter((r) => isKeylessHttps(r.url))
    .filter((r) => r.tracking === undefined || r.tracking === 'none')
    .map((r) => r.url);
}

export function candidateExplorers(entry: ChainlistEntry): string[] {
  return (entry.explorers ?? [])
    .filter((e) => /blockscout/i.test(e.name) || /blockscout/i.test(e.url))
    .map((e) => e.url.replace(/\/$/, ''));
}

async function rpcResult(fetchFn: typeof fetch, url: string, method: string, params: unknown[], timeoutMs: number): Promise<unknown> {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { result?: unknown };
  return body.result;
}

export async function verifyEvmRpc(fetchFn: typeof fetch, url: string, chainId: number): Promise<boolean> {
  try {
    const reported = await rpcResult(fetchFn, url, 'eth_chainId', [], PROBE_TIMEOUT_MS);
    if (typeof reported !== 'string' || BigInt(reported) !== BigInt(chainId)) return false;
    const code = await rpcResult(fetchFn, url, 'eth_getCode', ['0x0000000000000000000000000000000000000000', 'latest'], PROBE_TIMEOUT_MS);
    return typeof code === 'string';
  } catch {
    return false;
  }
}

export async function verifyBlockscout(fetchFn: typeof fetch, base: string): Promise<boolean> {
  try {
    const res = await fetchFn(`${base}/api/v2/stats`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok) return false;
    const body = (await res.json()) as Record<string, unknown>;
    return 'total_blocks' in body || 'total_addresses' in body;
  } catch {
    return false;
  }
}

export async function verifyEthereumLogs(fetchFn: typeof fetch, url: string): Promise<boolean> {
  try {
    const logs = await rpcResult(
      fetchFn,
      url,
      'eth_getLogs',
      [{
        address: LINK_TOKEN,
        fromBlock: `0x${PROBE_FROM_BLOCK.toString(16)}`,
        toBlock: `0x${PROBE_TO_BLOCK.toString(16)}`,
        topics: [TRANSFER_TOPIC, null, RESERVE_TOPIC],
      }],
      LOG_PROBE_TIMEOUT_MS,
    );
    return Array.isArray(logs) && logs.some((l: { transactionHash?: string }) => l.transactionHash?.toLowerCase() === RESERVE_DEPOSIT_TX);
  } catch {
    return false;
  }
}

async function firstVerified(candidates: string[], limit: number, verify: (url: string) => Promise<boolean>): Promise<string | undefined> {
  for (const url of candidates.slice(0, limit)) {
    if (await verify(url)) return url;
  }
  return undefined;
}

function sortedRecord(entries: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

async function refreshMap(
  names: string[],
  current: Record<string, string>,
  kind: 'rpc' | 'explorer',
  pick: (name: string) => Promise<{ keep: boolean; found: string | undefined }>,
): Promise<{ map: Record<string, string>; changes: Change[] }> {
  const results = await Promise.all(names.map(async (name) => ({ name, ...(await pick(name)) })));
  const map: Record<string, string> = {};
  const changes: Change[] = [];
  for (const { name, keep, found } of results) {
    if (keep) map[name] = current[name]!;
    else if (found) {
      map[name] = found;
      changes.push({ kind, chain: name, change: current[name] ? 'replaced' : 'added', url: found });
    } else if (current[name]) changes.push({ kind, chain: name, change: 'removed' });
  }
  return { map, changes };
}

export async function refreshEndpoints(input: {
  fetch: typeof fetch;
  ccipChains: CcipChain[];
  chainlist: ChainlistEntry[];
  current: Endpoints;
}): Promise<{ endpoints: Endpoints; changes: Change[] }> {
  const { fetch: fetchFn, ccipChains, chainlist, current } = input;
  const byChainId = new Map(chainlist.map((c) => [Number(c.chainId), c]));
  const evm = ccipChains.filter((c) => c.family === 'EVM');
  const evmNames = evm.map((c) => c.name);
  const chainOf = new Map(evm.map((c) => [c.name, c]));
  const entryOf = (name: string): ChainlistEntry | undefined => byChainId.get(Number(chainOf.get(name)!.chain_id));

  const rpc = await refreshMap(evmNames, current.rpc, 'rpc', async (name) => {
    const chainId = Number(chainOf.get(name)!.chain_id);
    const existing = current.rpc[name];
    if (existing && isKeylessHttps(existing) && (await verifyEvmRpc(fetchFn, existing, chainId))) return { keep: true, found: undefined };
    const candidates = entryOf(name) ? candidateRpcs(entryOf(name)!) : [];
    return { keep: false, found: await firstVerified(candidates, MAX_RPC_CANDIDATES, (url) => verifyEvmRpc(fetchFn, url, chainId)) };
  });

  const explorer = await refreshMap(evmNames, current.explorer, 'explorer', async (name) => {
    const existing = current.explorer[name];
    if (existing && (await verifyBlockscout(fetchFn, existing))) return { keep: true, found: undefined };
    const candidates = entryOf(name) ? candidateExplorers(entryOf(name)!) : [];
    return { keep: false, found: await firstVerified(candidates, MAX_EXPLORER_CANDIDATES, (url) => verifyBlockscout(fetchFn, url)) };
  });

  const handEdited = (map: Record<string, string>) =>
    Object.fromEntries(ccipChains.filter((c) => c.family !== 'EVM' && map[c.name]).map((c) => [c.name, map[c.name]!]));

  const logChanges: Change[] = [];
  const ethereumLogs: string[] = [];
  for (const url of current.ethereumLogs) {
    if (isKeylessHttps(url) && !isTrustedLogHost(url) && (await verifyEthereumLogs(fetchFn, url))) ethereumLogs.push(url);
    else logChanges.push({ kind: 'ethereumLogs', change: 'removed', url });
  }
  const mainnetCandidates = byChainId.get(1) ? candidateRpcs(byChainId.get(1)!) : [];
  for (const url of mainnetCandidates) {
    if (ethereumLogs.length >= LOG_ENDPOINT_TARGET) break;
    if (isTrustedLogHost(url) || ethereumLogs.includes(url)) continue;
    if (await verifyEthereumLogs(fetchFn, url)) {
      ethereumLogs.push(url);
      logChanges.push({ kind: 'ethereumLogs', change: 'added', url });
    }
  }

  return {
    endpoints: {
      source: SOURCE,
      rpc: sortedRecord({ ...rpc.map, ...handEdited(current.rpc) }),
      explorer: sortedRecord({ ...explorer.map, ...handEdited(current.explorer) }),
      ethereumLogs,
    },
    changes: [...rpc.changes, ...explorer.changes, ...logChanges],
  };
}

export function changesMarkdown(changes: Change[]): string {
  if (changes.length === 0) return 'No changes\n';
  const rows = changes.map((c) => `| ${c.kind} | ${c.chain ?? ''} | ${c.change} | ${c.url ?? ''} |`);
  return ['| Kind | Chain | Change | URL |', '| --- | --- | --- | --- |', ...rows].join('\n') + '\n';
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`GET ${url} failed with HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function readCurrent(): Promise<Endpoints> {
  try {
    return JSON.parse(await readFile(ENDPOINTS_FILE, 'utf8')) as Endpoints;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { source: SOURCE, rpc: {}, explorer: {}, ethereumLogs: [] };
    throw err;
  }
}

async function main(): Promise<void> {
  const { chains } = await getJson<{ chains: CcipChain[] }>('https://data.ccip.dev/v1/chains.json');
  const chainlist = await getJson<ChainlistEntry[]>('https://chainlist.org/rpcs.json');
  const { endpoints, changes } = await refreshEndpoints({ fetch, ccipChains: chains, chainlist, current: await readCurrent() });
  await writeFile(ENDPOINTS_FILE, `${JSON.stringify(endpoints, null, 2)}\n`);
  await writeFile(path.join(ROOT, 'endpoints-pr.md'), changesMarkdown(changes));
  const count = (kind: Change['kind'], change: Change['change']) => changes.filter((c) => c.kind === kind && c.change === change).length;
  console.log(
    `rpc ${Object.keys(endpoints.rpc).length} (+${count('rpc', 'added')} ~${count('rpc', 'replaced')} -${count('rpc', 'removed')}), ` +
      `explorer ${Object.keys(endpoints.explorer).length} (+${count('explorer', 'added')} ~${count('explorer', 'replaced')} -${count('explorer', 'removed')}), ` +
      `ethereumLogs ${endpoints.ethereumLogs.length}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
