import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ethRpc, toHex, type CreChain, type CreKeyFile, type Fetcher } from '@ccip-dev/core';

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

/** Tried after config/endpoints.json's keyless RPC, for chains whose listed RPC refuses wide log ranges. */
const FALLBACK_RPC: Readonly<Record<string, readonly string[]>> = {
  'avalanche-mainnet': ['https://avalanche-c-chain-rpc.publicnode.com'],
  'binance_smart_chain-mainnet': ['https://bsc-rpc.publicnode.com'],
  'ethereum-mainnet': ['https://ethereum-rpc.publicnode.com'],
  'ethereum-mainnet-arbitrum-1': ['https://arbitrum-one-rpc.publicnode.com'],
  'ethereum-mainnet-base-1': ['https://base-rpc.publicnode.com'],
  'ethereum-mainnet-optimism-1': ['https://optimism-rpc.publicnode.com'],
  'polygon-mainnet': ['https://polygon-bor-rpc.publicnode.com'],
};

const WINDOW_SECONDS = 86_400;
const START_BLOCKS = 5_000;
const MIN_BLOCKS = 100;
const MAX_LOG_CALLS = 200;
const TX_SAMPLE = 80;
const BLOCK_TIME_SPAN = 500;

/** The node keys that signed the forwarder's report() transactions over about the last day, from up to TX_SAMPLE of them. */
export async function signersOf(deps: Fetcher, url: string, forwarder: string): Promise<string[]> {
  const head = Number(await ethRpc(deps, url, 'eth_blockNumber', []));
  const timestamp = async (n: number) => Number(((await ethRpc(deps, url, 'eth_getBlockByNumber', [toHex(n), false])) as { timestamp: string }).timestamp);
  const span = Math.min(head, BLOCK_TIME_SPAN);
  const secondsPerBlock = span === 0 ? 1 : ((await timestamp(head)) - (await timestamp(head - span))) / span;
  const oldest = Math.max(0, head - Math.ceil(WINDOW_SECONDS / Math.max(secondsPerBlock, 0.05)));

  const hashes = new Set<string>();
  let to = head;
  let step = START_BLOCKS;
  for (let calls = 0; to >= oldest && calls < MAX_LOG_CALLS; calls++) {
    const from = Math.max(oldest, to - step + 1);
    try {
      const logs = (await ethRpc(deps, url, 'eth_getLogs', [{ address: forwarder, topics: [REPORT_PROCESSED_TOPIC], fromBlock: toHex(from), toBlock: toHex(to) }])) as { transactionHash: string }[];
      for (const log of logs) hashes.add(log.transactionHash);
      to = from - 1;
    } catch (err) {
      if (step <= MIN_BLOCKS) throw err;
      step = Math.max(MIN_BLOCKS, Math.floor(step / 4));
    }
  }

  const all = [...hashes];
  const stride = Math.max(1, Math.floor(all.length / TX_SAMPLE));
  const signers = new Set<string>();
  for (const hash of all.filter((_, i) => i % stride === 0).slice(0, TX_SAMPLE)) {
    const tx = (await ethRpc(deps, url, 'eth_getTransactionByHash', [hash])) as { from: string };
    signers.add(tx.from.toLowerCase());
  }
  return [...signers].sort();
}

export interface ChainScan {
  chain: string;
  /** null when every endpoint failed. */
  signers: string[] | null;
  error: string | null;
}

export interface MergeResult {
  file: CreKeyFile;
  added: string[];
  failed: string[];
  skipped: string[];
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
  for (const [chain, forwarder] of Object.entries(forwarders)) {
    const selector = selectors.get(chain);
    if (selector === undefined) {
      skipped.push(chain);
      continue;
    }
    const scan = scans.find((s) => s.chain === chain);
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
  return { file: { source: SOURCE, chains: sorted }, added, failed, skipped };
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
  ].join('\n');
}

async function scanChain(deps: Fetcher, urls: readonly string[], chain: string, forwarder: string): Promise<ChainScan> {
  const errors: string[] = [];
  for (const url of urls) {
    try {
      return { chain, signers: await signersOf(deps, url, forwarder), error: null };
    } catch (err) {
      errors.push(`${new URL(url).hostname}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { chain, signers: null, error: errors.join('; ') || 'no RPC' };
}

async function main(): Promise<void> {
  const deps: Fetcher = { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }) };
  const { rpc } = JSON.parse(await readFile(path.join(ROOT, 'config/endpoints.json'), 'utf8')) as { rpc: Record<string, string> };
  const current = existsSync(KEYS_FILE) ? (JSON.parse(await readFile(KEYS_FILE, 'utf8')) as CreKeyFile) : null;
  const res = await fetch('https://data.ccip.dev/v1/chains.json', { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`chains.json answered HTTP ${res.status}`);
  const { chains } = (await res.json()) as { chains: { selector: string; name: string }[] };
  const selectors = new Map(chains.map((c) => [c.name, c.selector]));
  const scans = await Promise.all(
    Object.entries(FORWARDERS).map(([chain, forwarder]) =>
      scanChain(deps, [rpc[chain], ...(FALLBACK_RPC[chain] ?? [])].filter((u): u is string => typeof u === 'string'), chain, forwarder),
    ),
  );
  const result = mergeKeys(current, scans, FORWARDERS, selectors, new Date().toISOString().slice(0, 10));
  await writeFile(KEYS_FILE, `${JSON.stringify(result.file, null, 2)}\n`);
  await writeFile(PR_BODY_FILE, prBody(result));
  const total = Object.values(result.file.chains).reduce((n, c) => n + c.keys.length, 0);
  console.log(`cre keys: ${total} on ${Object.keys(result.file.chains).length} chains; ${result.added.length} added; failed: ${result.failed.join(', ') || 'none'}; skipped: ${result.skipped.join(', ') || 'none'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
