import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { parse } from 'smol-toml';
import { z } from 'zod';
import { isAddressShape } from './chain-map';
import { normalizeAddress } from './normalize';

const XHandle = z.string().regex(/^[A-Za-z0-9_]{1,15}$/);
const Source = z.string().regex(/^https:\/\/\S+$/, 'must be an https URL');

export const LabelProject = z.strictObject({
  name: z.string().min(1).max(64),
  x: XHandle.optional(),
  url: z.url().optional(),
  kind: z.enum(['protocol', 'app', 'institution', 'exchange', 'issuer', 'unknown']),
  verified: z.boolean(),
  /** false keeps the project's EVM addresses from being credited to it on chains its file does not list. */
  spread: z.boolean().default(true),
  addresses: z
    .array(z.strictObject({ chain: z.string(), address: z.string(), note: z.string().max(120).optional() }))
    .default([]),
  /** Tokens the project issues. One entry covers every chain in the token's CCIP registry group. */
  tokens: z.array(z.strictObject({ chain: z.string(), address: z.string(), source: Source })).default([]),
});
export type LabelProject = z.output<typeof LabelProject>;

export const ChainHandles = z.record(z.string(), z.strictObject({ x: XHandle, source: Source }));
export type ChainHandles = z.output<typeof ChainHandles>;

export interface TokenHandle {
  chain: string;
  address: string;
  project: string;
  x: string;
}

export interface Handles {
  chains: Record<string, string>;
  tokens: TokenHandle[];
}

export interface LabelFile {
  file: string;
  text: string;
}

export interface Label {
  name: string;
  x?: string;
  kind: LabelProject['kind'];
  /** The label file's name: the project's identity is `project:<slug>` and its page `/projects/<slug>/`. */
  slug: string;
  /** Present, as false, only for a project that turns label spread off. */
  spread?: false;
}

export type RegistryProject = LabelProject & { slug: string; source: string | null };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SOURCE_LINE = /^#\s*Source:\s*(.+)$/m;

export function projectSlug(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1).replace(/\.toml$/, '');
}

export type LabelIndex = Record<string, Label>;

export function labelKey(chainName: string, address: string): string {
  return `${chainName}:${normalizeAddress(address)}`;
}

export function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, '');
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i]!;
  }
  return out;
}

function hasMixedCase(address: string): boolean {
  const hex = address.slice(2);
  return hex !== hex.toLowerCase() && hex !== hex.toUpperCase();
}

export function validateRegistry(
  files: LabelFile[],
  chainNames: ReadonlySet<string>,
): { projects: RegistryProject[]; errors: string[] } {
  const errors: string[] = [];
  const projects: RegistryProject[] = [];
  const claimedBy = new Map<string, string>();
  const tokenClaimedBy = new Map<string, string>();

  for (const { file, text } of files) {
    let data: unknown;
    try {
      data = parse(text);
    } catch (err) {
      errors.push(`${file}: invalid TOML: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const result = LabelProject.safeParse(data);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push(`${file}: ${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`);
      }
      continue;
    }
    for (const { chain, address } of result.data.addresses) {
      if (!chainNames.has(chain)) errors.push(`${file}: unknown CCIP chain "${chain}"`);
      if (isAddressShape('EVM', address) && hasMixedCase(address) && toChecksumAddress(address) !== address) {
        errors.push(`${file}: bad EIP-55 checksum for ${address}`);
      }
      const key = labelKey(chain, address);
      const owner = claimedBy.get(key);
      if (owner) errors.push(`${file}: ${chain} ${normalizeAddress(address)} is already labeled in ${owner}`);
      else claimedBy.set(key, file);
    }
    for (const { chain, address } of result.data.tokens) {
      if (!chainNames.has(chain)) errors.push(`${file}: unknown CCIP chain "${chain}" for a token`);
      if (isAddressShape('EVM', address) && hasMixedCase(address) && toChecksumAddress(address) !== address) {
        errors.push(`${file}: bad EIP-55 checksum for token ${address}`);
      }
      const key = labelKey(chain, address);
      const owner = tokenClaimedBy.get(key);
      if (owner) errors.push(`${file}: token ${chain} ${normalizeAddress(address)} already belongs to ${owner}`);
      else tokenClaimedBy.set(key, file);
    }
    const slug = projectSlug(file);
    if (result.data.verified && !SLUG.test(slug)) errors.push(`${file}: a verified project needs a file name of lowercase letters, digits and dashes`);
    projects.push({ ...result.data, slug, source: SOURCE_LINE.exec(text)?.[1]?.trim() ?? null });
  }
  return { projects, errors };
}

export function buildLabelIndex(projects: readonly RegistryProject[]): LabelIndex {
  const index: LabelIndex = {};
  for (const p of projects) {
    if (!p.verified) continue;
    const label: Label = { name: p.name, ...(p.x ? { x: p.x } : {}), kind: p.kind, slug: p.slug, ...(p.spread ? {} : { spread: false as const }) };
    for (const { chain, address } of p.addresses) index[labelKey(chain, address)] = label;
  }
  return index;
}

export function validateChainHandles(
  text: string,
  chainNames: ReadonlySet<string>,
  file = 'labels/chain-x.json',
): { handles: ChainHandles; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { handles: {}, errors: [`${file}: invalid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const result = ChainHandles.safeParse(data);
  if (!result.success) {
    return { handles: {}, errors: result.error.issues.map((i) => `${file}: ${i.path.map(String).join('.') || '(root)'}: ${i.message}`) };
  }
  const errors = Object.keys(result.data).filter((name) => !chainNames.has(name)).map((name) => `${file}: unknown CCIP chain "${name}"`);
  return { handles: result.data, errors };
}

/** Only a verified project with a handle tags its tokens; anything else is written as its plain name. */
export function buildHandles(projects: LabelProject[], chains: ChainHandles): Handles {
  return {
    chains: Object.fromEntries(Object.entries(chains).map(([name, handle]) => [name, handle.x])),
    tokens: projects.flatMap((p) => {
      const x = p.x;
      if (!p.verified || !x) return [];
      return p.tokens.map((t) => ({ chain: t.chain, address: normalizeAddress(t.address), project: p.name, x }));
    }),
  };
}
