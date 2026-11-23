import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isRevert, MULTICALL3, openChain, readPassportChain, type HttpDeps, type RowReading } from '@ccip-dev/core';
import { getJson } from './lib/http';

const ROOT = path.resolve(import.meta.dirname, '..');
const FIXTURE_DIR = path.join(ROOT, 'packages/core/test/fixtures/passport/pools');
const LANES_URL = 'https://api.ccip.chain.link/v2/lanes';
const USAGE = 'usage: pnpm passport:record <chain name from config/endpoints.json> <token address> <fixture name>';

interface Directory {
  chains: Record<string, { chainId: number; name: string; tokenAdminRegistry: string }>;
}
interface Endpoints {
  rpc: Record<string, string>;
}
interface LanesAnswer {
  lanes: { sourceChainSelector: string; destChainSelector: string; onRampAddress: string }[];
}

export type RecordedAnswer = { to: string; data: string; result: string } | { to: string; data: string; revert: true };

/** Every eth_call and eth_getStorageAt answer that passes through, the last answer for a request winning over a retried failure. */
function recordingFetch(): { fetch: typeof fetch; calls: Map<string, RecordedAnswer>; storage: Map<string, string | 'unsupported'>; failures: Map<string, string> } {
  const calls = new Map<string, RecordedAnswer>();
  const storage = new Map<string, string | 'unsupported'>();
  const failures = new Map<string, string>();
  const recording = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await fetch(input, init);
    const request = typeof init?.body === 'string' ? (JSON.parse(init.body) as { method?: string; params?: unknown[] }) : {};
    if (request.method !== 'eth_call' && request.method !== 'eth_getStorageAt') return res;
    const body = (await res.clone().json().catch(() => null)) as { result?: string; error?: { message?: string } } | null;
    if (request.method === 'eth_call') {
      const { to, data } = request.params![0] as { to: string; data: string };
      if (to.toLowerCase() === MULTICALL3.address) return res;
      const key = `${to.toLowerCase()}:${data.toLowerCase()}`;
      if (typeof body?.result === 'string') {
        calls.set(key, { to: to.toLowerCase(), data: data.toLowerCase(), result: body.result.toLowerCase() });
        failures.delete(key);
      } else if (body?.error?.message !== undefined && isRevert(body.error.message)) {
        calls.set(key, { to: to.toLowerCase(), data: data.toLowerCase(), revert: true });
        failures.delete(key);
      } else {
        failures.set(key, body?.error?.message ?? `HTTP ${res.status}`);
      }
      return res;
    }
    const [address, slot] = request.params as [string, string];
    const key = `${address.toLowerCase()}:${slot.toLowerCase()}`;
    storage.set(key, typeof body?.result === 'string' ? body.result.toLowerCase() : 'unsupported');
    return res;
  };
  return { fetch: recording as typeof fetch, calls, storage, failures };
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(path.join(ROOT, file), 'utf8')) as T;
}

const laneSelectors = (row: RowReading) => (row.status === 'read' && 'value' in row.settings.lanes ? row.settings.lanes.value.map((l) => l.remoteChainSelector) : []);

/** Reads one token on one chain through the Passport reader, one call at a time, and writes every answer it needed. */
async function main(): Promise<void> {
  const [chainName, token, name] = process.argv.slice(2);
  if (!chainName || !token || !name) throw new Error(USAGE);
  const directory = await readJson<Directory>('config/ccip-directory.json');
  const endpoints = await readJson<Endpoints>('config/endpoints.json');
  const [selector, chain] = Object.entries(directory.chains).find(([, c]) => c.name === chainName) ?? [];
  const rpcUrl = endpoints.rpc[chainName];
  if (!selector || !chain || !rpcUrl) throw new Error(`${chainName} needs an entry in config/ccip-directory.json and config/endpoints.json`);

  const lanes = await getJson<LanesAnswer>(LANES_URL);
  const onRamps = Object.fromEntries(lanes.lanes.filter((l) => l.sourceChainSelector === selector).map((l) => [l.destChainSelector, l.onRampAddress.toLowerCase()]));

  const recorder = recordingFetch();
  const deps: HttpDeps = { fetch: recorder.fetch, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), clock: () => Date.now() };
  const pinned = await openChain(deps, rpcUrl, { chainId: chain.chainId });
  const [row] = await readPassportChain(deps, { ...pinned, multicall3: false }, { registry: chain.tokenAdminRegistry, onRamps, tokens: [token] });
  if (recorder.failures.size > 0) throw new Error(`calls that failed, so nothing was written:\n${[...recorder.failures].map(([k, v]) => `  ${k}: ${v}`).join('\n')}`);

  const usedOnRamps = Object.fromEntries(laneSelectors(row!).filter((s) => s in onRamps).map((s) => [s, onRamps[s]!]));
  const fixture = {
    recorded: `answers from ${rpcUrl} on ${new Date().toISOString().slice(0, 10)}, every call at block ${pinned.block} (0x${pinned.block.toString(16)}); OnRamps from ${LANES_URL}`,
    chain: chainName,
    selector,
    chainId: chain.chainId,
    block: pinned.block,
    blockHash: pinned.blockHash,
    timestamp: pinned.timestamp,
    registry: chain.tokenAdminRegistry,
    token: token.toLowerCase(),
    pool: row!.status === 'read' ? row!.settings.pool : null,
    poolType: row!.status === 'read' && 'value' in row!.settings.poolType ? row!.settings.poolType.value.typeAndVersion : null,
    onRamps: usedOnRamps,
    calls: [...recorder.calls.values()],
    storage: Object.fromEntries(recorder.storage),
  };
  const file = path.join(FIXTURE_DIR, `${name}.json`);
  await writeFile(file, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`${path.relative(ROOT, file)}: ${fixture.poolType ?? 'no pool'} at ${fixture.pool}, block ${pinned.block}, ${fixture.calls.length} calls`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
