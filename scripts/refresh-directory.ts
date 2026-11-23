import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeAddress } from '@ccip-dev/core';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIRECTORY_FILE = path.join(ROOT, 'config/ccip-directory.json');
const CHAINS_URL = 'https://docs.chain.link/api/ccip/v1/chains?environment=mainnet';
const VERIFIERS_URL = 'https://api.ccip.chain.link/v2/verifiers';
const SOURCE = 'Built by pnpm directory:refresh from docs.chain.link/api/ccip/v1/chains (mainnet) and api.ccip.chain.link/v2/verifiers; reviewed in the endpoints pull request';

export interface DirectoryChain {
  chainId: number;
  displayName: string;
  selector: string;
  internalId: string;
  router: string;
  tokenAdminRegistry?: string;
}

export interface DirectoryAnswer {
  data: { evm: Record<string, DirectoryChain> };
  ignored?: { networkId: string; reason: string; missingFields?: string[] }[];
}

export interface VerifiersAnswer {
  verifiers: { addresses: { chainSelector: string; address: string }[]; metadata: { name: string } }[];
}

export interface DirectoryEntry {
  chainId: number;
  name: string;
  router: string;
  tokenAdminRegistry: string;
}

export interface CcipDirectory {
  source: string;
  chains: Record<string, DirectoryEntry>;
  verifiers: Record<string, Record<string, string>>;
}

function sortedRecord<T>(entries: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function buildDirectory(answer: DirectoryAnswer, verifierAnswer: VerifiersAnswer): { directory: CcipDirectory; omitted: string[] } {
  const chains: Record<string, DirectoryEntry> = {};
  const omitted = (answer.ignored ?? []).map((i) => i.networkId);
  for (const chain of Object.values(answer.data.evm)) {
    if (!chain.tokenAdminRegistry) {
      omitted.push(chain.internalId);
      continue;
    }
    chains[chain.selector] = {
      chainId: chain.chainId,
      name: chain.internalId,
      router: normalizeAddress(chain.router),
      tokenAdminRegistry: normalizeAddress(chain.tokenAdminRegistry),
    };
  }

  const verifiers: Record<string, Record<string, string>> = {};
  for (const verifier of verifierAnswer.verifiers) {
    for (const { chainSelector, address } of verifier.addresses) {
      (verifiers[chainSelector] ??= {})[normalizeAddress(address)] = verifier.metadata.name;
    }
  }

  return {
    directory: {
      source: SOURCE,
      chains: sortedRecord(chains),
      verifiers: sortedRecord(Object.fromEntries(Object.entries(verifiers).map(([selector, names]) => [selector, sortedRecord(names)]))),
    },
    omitted: omitted.sort(),
  };
}

async function getJson<T>(fetchFn: typeof fetch, url: string): Promise<T> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`GET ${url} failed with HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Fetches both answers before writing, so a failed fetch leaves the current file as it was. */
export async function refreshDirectoryFile(input: { fetch: typeof fetch; file: string }): Promise<{ directory: CcipDirectory; omitted: string[] }> {
  const answer = await getJson<DirectoryAnswer>(input.fetch, CHAINS_URL);
  const verifierAnswer = await getJson<VerifiersAnswer>(input.fetch, VERIFIERS_URL);
  const built = buildDirectory(answer, verifierAnswer);
  await writeFile(input.file, `${JSON.stringify(built.directory, null, 2)}\n`);
  return built;
}

async function main(): Promise<void> {
  const { directory, omitted } = await refreshDirectoryFile({ fetch, file: DIRECTORY_FILE });
  const verifierAddresses = Object.values(directory.verifiers).reduce((n, names) => n + Object.keys(names).length, 0);
  console.log(`config/ccip-directory.json: ${Object.keys(directory.chains).length} chains, ${verifierAddresses} verifier addresses`);
  console.log(omitted.length > 0 ? `left out with no registry address: ${omitted.join(', ')}` : 'left out with no registry address: none');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
