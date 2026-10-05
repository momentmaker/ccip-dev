import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { parse } from 'smol-toml';
import { z } from 'zod';
import { isAddressShape } from './chain-map';
import { normalizeAddress } from './normalize';

export const LabelProject = z.strictObject({
  name: z.string().min(1).max(64),
  x: z.string().regex(/^[A-Za-z0-9_]{1,15}$/).optional(),
  url: z.url().optional(),
  kind: z.enum(['protocol', 'app', 'institution', 'exchange', 'issuer', 'unknown']),
  verified: z.boolean(),
  addresses: z
    .array(z.strictObject({ chain: z.string(), address: z.string(), note: z.string().max(120).optional() }))
    .default([]),
  tokens: z.array(z.strictObject({ group: z.string() })).default([]),
});
export type LabelProject = z.output<typeof LabelProject>;

export interface LabelFile {
  file: string;
  text: string;
}

export interface Label {
  name: string;
  x?: string;
  kind: LabelProject['kind'];
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
): { projects: LabelProject[]; errors: string[] } {
  const errors: string[] = [];
  const projects: LabelProject[] = [];
  const claimedBy = new Map<string, string>();

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
    projects.push(result.data);
  }
  return { projects, errors };
}

export function buildLabelIndex(projects: LabelProject[]): LabelIndex {
  const index: LabelIndex = {};
  for (const p of projects) {
    if (!p.verified) continue;
    for (const { chain, address } of p.addresses) {
      index[labelKey(chain, address)] = p.x ? { name: p.name, x: p.x, kind: p.kind } : { name: p.name, kind: p.kind };
    }
  }
  return index;
}
