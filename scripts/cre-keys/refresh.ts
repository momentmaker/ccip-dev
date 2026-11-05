import { existsSync } from 'node:fs';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ethRpc, NO_RESULT, toHex, type CreChain, type CreKeyFile, type Fetcher } from '@ccip-dev/core';

const ROOT = path.resolve(import.meta.dirname, '../..');
const KEYS_FILE = path.join(ROOT, 'config/cre-keys.json');
const PR_BODY_FILE = path.join(ROOT, 'cre-keys-pr.md');
const SOURCE =
  'Built by pnpm cre-keys:refresh from KeystoneForwarder ReportProcessed logs; a key is the signer of a forwarder report() transaction. Keys are never removed.';

/** keccak256("ReportProcessed(address,bytes32,bytes2,bool)") */
export const REPORT_PROCESSED_TOPIC = '0x3617b009e9785c42daebadb6d3fb553243a4bf586d07ea72d65d80013ce116b5';

/** Production KeystoneForwarders from docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts (checked 2026-11-05); never the MockKeystoneForwarder simulation addresses. */
export const FORWARDERS: Readonly<Record<string, string>> = {
  'adi-mainnet': '0x76c9cf548b4179f8901cda1f8623568b58215e62',
  'avalanche-mainnet': '0x76c9cf548b4179f8901cda1f8623568b58215e62',
  'binance_smart_chain-mainnet': '0x76c9cf548b4179f8901cda1f8623568b58215e62',
  'celo-mainnet': '0x98b8335d29aca40840ed8426da1a0aaa8677d8d1',
  'ethereum-mainnet': '0x0b93082d9b3c7c97facd250082899bacf3af3885',
  'ethereum-mainnet-arbitrum-1': '0xf8344cfd5c43616a4366c34e3eee75af79a74482',
  'ethereum-mainnet-base-1': '0xf8344cfd5c43616a4366c34e3eee75af79a74482',
  'ethereum-mainnet-ink-1': '0x9ef6468c5f37b976e57d52054c693269479a784d',
  'ethereum-mainnet-linea-1': '0x9ef6468c5f37b976e57d52054c693269479a784d',
  'ethereum-mainnet-mantle-1': '0xb9f79d863261869b234c481d1f9a7af84aead192',
  'ethereum-mainnet-optimism-1': '0xf8344cfd5c43616a4366c34e3eee75af79a74482',
  'ethereum-mainnet-scroll-1': '0x98b8335d29aca40840ed8426da1a0aaa8677d8d1',
  'ethereum-mainnet-worldchain-1': '0x98b8335d29aca40840ed8426da1a0aaa8677d8d1',
  'ethereum-mainnet-xlayer-1': '0x76c9cf548b4179f8901cda1f8623568b58215e62',
  'ethereum-mainnet-zksync-1': '0x76c9cf548b4179f8901cda1f8623568b58215e62',
  'gnosis_chain-mainnet': '0x9ef6468c5f37b976e57d52054c693269479a784d',
  'hyperliquid-mainnet': '0x9ef6468c5f37b976e57d52054c693269479a784d',
  'jovay-mainnet': '0x76c9cf548b4179f8901cda1f8623568b58215e62',
  'megaeth-mainnet': '0x7bccafbd064cb3658476066cc33cee3f3414c04c',
  'monad-mainnet': '0x76c9cf548b4179f8901cda1f8623568b58215e62',
  'pharos-mainnet': '0x76c9cf548b4179f8901cda1f8623568b58215e62',
  'plasma-mainnet': '0x7bccafbd064cb3658476066cc33cee3f3414c04c',
  'polygon-mainnet': '0x76c9cf548b4179f8901cda1f8623568b58215e62',
  'sonic-mainnet': '0x98b8335d29aca40840ed8426da1a0aaa8677d8d1',
};

/** Keyless RPCs tried after config/endpoints.json's, for chains whose listed RPC refuses wide or old log ranges or rate-limits (Tenderly's public gateways serve old logs, 1,000 blocks a call). */
const FALLBACK_RPC: Readonly<Record<string, readonly string[]>> = {
  'avalanche-mainnet': ['https://avalanche-c-chain-rpc.publicnode.com', 'https://gateway.tenderly.co/public/avalanche'],
  'binance_smart_chain-mainnet': ['https://bsc-rpc.publicnode.com'],
  'ethereum-mainnet': ['https://ethereum-rpc.publicnode.com', 'https://gateway.tenderly.co/public/mainnet', 'https://rpc.mevblocker.io'],
  'ethereum-mainnet-arbitrum-1': ['https://arbitrum-one-rpc.publicnode.com'],
  'ethereum-mainnet-base-1': ['https://base-rpc.publicnode.com', 'https://gateway.tenderly.co/public/base'],
  'ethereum-mainnet-optimism-1': ['https://optimism-rpc.publicnode.com'],
  'hyperliquid-mainnet': ['https://rpc.purroofgroup.com', 'https://rpc.hyperlend.finance'],
  'polygon-mainnet': ['https://polygon-bor-rpc.publicnode.com', 'https://gateway.tenderly.co/public/polygon'],
};

const WINDOW_SECONDS = 86_400;
const START_BLOCKS = 5_000;
const MIN_BLOCKS = 100;
const MAX_LOG_CALLS = 200;
const TX_SAMPLE = 80;
const BLOCK_TIME_SPAN = 500;

const WEEK_SECONDS = 7 * 86_400;
const HISTORY_WINDOW_BLOCKS = 5_000;
const HISTORY_TX_SAMPLE = 5;
const HISTORY_CALL_CAP = 2_000;
const HISTORY_DEADLINE_MS = 25 * 60_000;
const BLOCK_SEARCH_STEPS = 6;
const BLOCK_SEARCH_TOLERANCE_SECONDS = 6 * 3_600;

export interface ChainClock {
  head: number;
  headTs: number;
  secondsPerBlock: number;
}

const blockTimestamp = async (deps: Fetcher, url: string, n: number) =>
  Number(((await ethRpc(deps, url, 'eth_getBlockByNumber', [toHex(n), false])) as { timestamp: string }).timestamp);

/** The head block, its time, and the average block time over the last BLOCK_TIME_SPAN blocks. */
async function chainClock(deps: Fetcher, url: string): Promise<ChainClock> {
  const head = Number(await ethRpc(deps, url, 'eth_blockNumber', []));
  const headTs = await blockTimestamp(deps, url, head);
  const span = Math.min(head, BLOCK_TIME_SPAN);
  const secondsPerBlock = span === 0 ? 1 : (headTs - (await blockTimestamp(deps, url, head - span))) / span;
  return { head, headTs, secondsPerBlock };
}

/** The forwarder's report() transaction hashes in blocks `from`..`to`, walking down from `to` and narrowing ranges the RPC refuses. */
async function reportHashes(deps: Fetcher, url: string, forwarder: string, from: number, to: number): Promise<string[]> {
  const hashes = new Set<string>();
  let step = START_BLOCKS;
  for (let calls = 0; to >= from && calls < MAX_LOG_CALLS; calls++) {
    const lo = Math.max(from, to - step + 1);
    try {
      const logs = (await ethRpc(deps, url, 'eth_getLogs', [{ address: forwarder, topics: [REPORT_PROCESSED_TOPIC], fromBlock: toHex(lo), toBlock: toHex(to) }])) as { transactionHash: string }[];
      for (const log of logs) hashes.add(log.transactionHash);
      to = lo - 1;
    } catch (err) {
      if (step <= MIN_BLOCKS) throw err;
      step = Math.max(MIN_BLOCKS, Math.floor(step / 4));
    }
  }
  return [...hashes];
}

/** A transaction's sender, or null when the RPC no longer holds the transaction. */
async function senderOf(deps: Fetcher, url: string, hash: string): Promise<string | null> {
  try {
    const tx = (await ethRpc(deps, url, 'eth_getTransactionByHash', [hash])) as { from?: unknown };
    return typeof tx.from === 'string' ? tx.from.toLowerCase() : null;
  } catch (err) {
    if (err instanceof Error && err.message === NO_RESULT) return null;
    throw err;
  }
}

/** The senders of up to `sample` of the transactions, spread evenly over them. */
async function sendersOf(deps: Fetcher, url: string, hashes: readonly string[], sample: number): Promise<string[]> {
  const stride = Math.max(1, Math.floor(hashes.length / sample));
  const senders = new Set<string>();
  for (const hash of hashes.filter((_, i) => i % stride === 0).slice(0, sample)) {
    const sender = await senderOf(deps, url, hash);
    if (sender !== null) senders.add(sender);
  }
  return [...senders].sort();
}

/** The node keys that signed the forwarder's report() transactions over about the last day, from up to TX_SAMPLE of them. */
export async function signersOf(deps: Fetcher, url: string, forwarder: string): Promise<string[]> {
  const { head, secondsPerBlock } = await chainClock(deps, url);
  const oldest = Math.max(0, head - Math.ceil(WINDOW_SECONDS / Math.max(secondsPerBlock, 0.05)));
  return sendersOf(deps, url, await reportHashes(deps, url, forwarder, oldest, head), TX_SAMPLE);
}

/** The start of each week from `since` up to `now` (unix seconds), one sampled window each. */
export function weekStarts(since: number, now: number): number[] {
  const starts: number[] = [];
  for (let t = since; t < now; t += WEEK_SECONDS) starts.push(t);
  return starts;
}

/**
 * A block within BLOCK_SEARCH_TOLERANCE_SECONDS of `target`, stepping from the head at the measured block time and
 * correcting by the time each step lands on; block 0 for a target before the chain began.
 */
export async function blockNear(timestampOf: (block: number) => Promise<number>, target: number, clock: ChainClock): Promise<number> {
  let block = clock.head;
  let ts = clock.headTs;
  let rate = clock.secondsPerBlock > 0 ? clock.secondsPerBlock : 1;
  for (let step = 0; step < BLOCK_SEARCH_STEPS && Math.abs(ts - target) > BLOCK_SEARCH_TOLERANCE_SECONDS; step++) {
    const next = Math.min(clock.head, Math.max(0, Math.round(block + (target - ts) / rate)));
    if (next === block) break;
    const nextTs = await timestampOf(next);
    const measured = (nextTs - ts) / (next - block);
    if (measured > 0) rate = measured;
    block = next;
    ts = nextTs;
  }
  return block;
}

/** `deps` that refuse every call after `maxCalls` calls or past `deadline` (epoch ms), so one slow chain cannot hold the run. */
export function budgeted(deps: Fetcher, maxCalls: number, deadline: number): Fetcher {
  let calls = 0;
  return {
    fetch: (input, init) => {
      if (calls >= maxCalls) return Promise.reject(new Error(`call budget of ${maxCalls} spent`));
      if (Date.now() > deadline) return Promise.reject(new Error('run deadline passed'));
      calls++;
      return deps.fetch(input, init);
    },
  };
}

/**
 * The signers of up to HISTORY_TX_SAMPLE report() transactions in a HISTORY_WINDOW_BLOCKS window at each week start. A
 * window is read on the first endpoint that serves it (archive refusals are common on free RPCs) and skipped when none does.
 */
export async function historicalScan(deps: Fetcher, urls: readonly string[], chain: string, forwarder: string, starts: readonly number[]): Promise<ChainScan> {
  const clocks = new Map<string, ChainClock>();
  const signers = new Set<string>();
  let order = [...urls];
  let read = 0;
  let lastErrors: string[] = [];
  const windowSigners = async (url: string, start: number) => {
    const clock = clocks.get(url) ?? (await chainClock(deps, url));
    clocks.set(url, clock);
    const from = await blockNear((n) => blockTimestamp(deps, url, n), start, clock);
    const hashes = await reportHashes(deps, url, forwarder, from, Math.min(clock.head, from + HISTORY_WINDOW_BLOCKS - 1));
    return sendersOf(deps, url, hashes, HISTORY_TX_SAMPLE);
  };
  for (const start of starts) {
    const errors: string[] = [];
    let served: string | null = null;
    for (const url of order) {
      try {
        for (const signer of await windowSigners(url, start)) signers.add(signer);
        served = url;
        break;
      } catch (err) {
        errors.push(endpointError(url, err));
      }
    }
    if (served === null) {
      lastErrors = errors;
      continue;
    }
    read++;
    order = [served, ...order.filter((u) => u !== served)];
  }
  const windows = { read, skipped: starts.length - read };
  if (read === 0) return { chain, signers: null, error: `no weekly window read (${lastErrors.join('; ') || 'no RPC'})`, windows };
  return { chain, signers: [...signers].sort(), error: null, windows };
}

const endpointError = (url: string, err: unknown) => `${new URL(url).hostname}: ${err instanceof Error ? err.message : String(err)}`;

export interface ChainScan {
  chain: string;
  /** null when every endpoint failed. */
  signers: string[] | null;
  error: string | null;
  /** Historical mode only: the weekly windows read and skipped. */
  windows?: { read: number; skipped: number };
}

export interface MergeResult {
  file: CreKeyFile;
  added: string[];
  failed: string[];
  skipped: string[];
  /** Historical mode only: per chain, how many weekly windows were read and skipped. */
  windows: string[];
}

export function mergeKeys(
  current: CreKeyFile | null,
  scans: readonly ChainScan[],
  forwarders: Readonly<Record<string, string>>,
  selectors: ReadonlyMap<string, string>,
  day: string,
): MergeResult {
  const chains: Record<string, CreChain> = structuredClone(current?.chains ?? {});
  const added: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  const windows: string[] = [];
  for (const [chain, forwarder] of Object.entries(forwarders)) {
    const selector = selectors.get(chain);
    if (selector === undefined) {
      skipped.push(chain);
      continue;
    }
    const scan = scans.find((s) => s.chain === chain);
    if (scan?.windows) {
      const { read, skipped: missed } = scan.windows;
      windows.push(`${chain}: ${read} of ${read + missed} weekly windows read, ${missed} skipped`);
    }
    if (!scan || scan.signers === null) {
      failed.push(`${chain}: ${scan?.error ?? 'not scanned'}`);
      continue;
    }
    const entry = chains[chain] ?? { selector, forwarder, keys: [] };
    entry.selector = selector;
    entry.forwarder = forwarder;
    const known = new Set(entry.keys.map((k) => k.address));
    for (const signer of scan.signers.map((s) => s.toLowerCase())) {
      if (known.has(signer)) continue;
      known.add(signer);
      entry.keys.push({ address: signer, first_seen: day });
      added.push(`${chain} ${signer}`);
    }
    entry.keys.sort((a, b) => a.address.localeCompare(b.address));
    chains[chain] = entry;
  }
  const sorted = Object.fromEntries(Object.entries(chains).sort(([a], [b]) => a.localeCompare(b)));
  return { file: { source: SOURCE, chains: sorted }, added, failed, skipped, windows };
}

export function prBody(r: MergeResult): string {
  const list = (items: string[]) => (items.length === 0 ? '- none' : items.map((i) => `- \`${i}\``).join('\n'));
  return [
    'New CRE node keys found in KeystoneForwarder report() transactions. Messages these keys signed will be tagged as sent by CRE workflows, and `retagCre` re-tags the last 30 days.',
    '',
    '## Added',
    list(r.added),
    '',
    '## Chains whose RPCs failed (keys kept as they were)',
    list(r.failed),
    '',
    ...(r.windows.length === 0 ? [] : ['## Historical scan: weekly windows read', list(r.windows), '']),
  ].join('\n');
}

async function scanChain(deps: Fetcher, urls: readonly string[], chain: string, forwarder: string): Promise<ChainScan> {
  const errors: string[] = [];
  for (const url of urls) {
    try {
      return { chain, signers: await signersOf(deps, url, forwarder), error: null };
    } catch (err) {
      errors.push(endpointError(url, err));
    }
  }
  return { chain, signers: null, error: errors.join('; ') || 'no RPC' };
}

/** The UTC day `since` as unix seconds; throws unless it is a YYYY-MM-DD day before now. */
export function sinceSeconds(since: string, now: number): number {
  const seconds = /^\d{4}-\d{2}-\d{2}$/.test(since) ? Date.parse(`${since}T00:00:00Z`) / 1000 : Number.NaN;
  if (!Number.isFinite(seconds) || seconds >= now) throw new Error(`--since wants a past UTC day as YYYY-MM-DD, got ${since}`);
  return seconds;
}

/** `current` plus every key only `other` holds (an open refresh PR's), each with its earliest first_seen. */
export function unionKeys(current: CreKeyFile | null, other: CreKeyFile | null): CreKeyFile | null {
  if (other === null) return current;
  const chains: Record<string, CreChain> = structuredClone(current?.chains ?? {});
  for (const [chain, theirs] of Object.entries(other.chains)) {
    const entry = chains[chain] ?? { selector: theirs.selector, forwarder: theirs.forwarder, keys: [] };
    for (const key of theirs.keys) {
      const known = entry.keys.find((k) => k.address === key.address);
      if (!known) entry.keys.push({ ...key });
      else if (key.first_seen < known.first_seen) known.first_seen = key.first_seen;
    }
    entry.keys.sort((a, b) => a.address.localeCompare(b.address));
    chains[chain] = entry;
  }
  return { source: current?.source ?? other.source, chains };
}

const readKeyFile = async (file: string) => (existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as CreKeyFile) : null);

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { since: { type: 'string' }, 'keep-from': { type: 'string' } } });
  const now = Date.now();
  const starts = values.since === undefined ? null : weekStarts(sinceSeconds(values.since, now / 1000), now / 1000);
  const deps: Fetcher = { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }) };
  const { rpc } = JSON.parse(await readFile(path.join(ROOT, 'config/endpoints.json'), 'utf8')) as { rpc: Record<string, string> };
  const current = unionKeys(await readKeyFile(KEYS_FILE), values['keep-from'] === undefined ? null : await readKeyFile(values['keep-from']));
  const res = await fetch('https://data.ccip.dev/v1/chains.json', { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`chains.json answered HTTP ${res.status}`);
  const { chains } = (await res.json()) as { chains: { selector: string; name: string }[] };
  const selectors = new Map(chains.map((c) => [c.name, c.selector]));
  const deadline = now + HISTORY_DEADLINE_MS;
  const scans = await Promise.all(
    Object.entries(FORWARDERS).map(([chain, forwarder]) => {
      const urls = [rpc[chain], ...(FALLBACK_RPC[chain] ?? [])].filter((u): u is string => typeof u === 'string');
      return starts === null ? scanChain(deps, urls, chain, forwarder) : historicalScan(budgeted(deps, HISTORY_CALL_CAP, deadline), urls, chain, forwarder, starts);
    }),
  );
  const result = mergeKeys(current, scans, FORWARDERS, selectors, new Date(now).toISOString().slice(0, 10));
  await writeFile(KEYS_FILE, `${JSON.stringify(result.file, null, 2)}\n`);
  await writeFile(PR_BODY_FILE, prBody(result));
  const failedChains = result.failed.map((f) => f.slice(0, f.indexOf(':')));
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `failed_count=${failedChains.length}\nfailed_chains=${failedChains.join(', ')}\n`);
  const total = Object.values(result.file.chains).reduce((n, c) => n + c.keys.length, 0);
  console.log(`cre keys: ${total} on ${Object.keys(result.file.chains).length} chains; ${result.added.length} added; failed: ${result.failed.join(', ') || 'none'}; skipped: ${result.skipped.join(', ') || 'none'}`);
  for (const line of result.windows) console.log(`  ${line}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
