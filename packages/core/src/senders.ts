import { isAddressShape } from './chain-map';
import type { Label, LabelIndex, LabelProject } from './labels';
import { byName } from './roster';

export type LabelKind = LabelProject['kind'];

/** A chain as the chains table holds it: its CCIP name, as label files write it, and its family. */
export interface SenderChain {
  name: string;
  family: string;
}

/** Chains by selector. */
export type SenderChains = ReadonlyMap<string, SenderChain>;

/**
 * Who sent a message: the verified project behind its (chain, address), or else the address itself across chains.
 * Every ranking of senders goes through this, so the site, the posts and the cards credit activity the same way.
 */
export interface SenderIdentity {
  /** `project:<slug>` for a verified project, `address:<address>` for any other sender. */
  key: string;
  project: Label | null;
  /** The project's label names this address on another EVM chain, not on this one. */
  inferred: boolean;
}

export type IdentityResolver = (selector: string, address: string) => SenderIdentity;

const PROJECT_PREFIX = 'project:';
const ADDRESS_PREFIX = 'address:';

export const projectKey = (slug: string): string => `${PROJECT_PREFIX}${slug}`;
export const addressKey = (address: string): string => `${ADDRESS_PREFIX}${address}`;

/** As messages store senders: EVM lowercased, any other address as it is. */
export function senderAddress(address: string): string {
  return isAddressShape('EVM', address) ? address.toLowerCase() : address;
}

/** What follows the first colon: the address of a `<selector>:<address>` or `address:` key, the slug of a `project:` key. */
export function senderKeyAddress(key: string): string {
  return key.slice(key.indexOf(':') + 1);
}

export type ParsedSenderKey =
  | { kind: 'project'; slug: string }
  | { kind: 'address'; address: string }
  | { kind: 'legacy'; chain: string; address: string };

/** An identity key, or a `<selector>:<address>` key from a file published before identities. */
export function parseSenderKey(key: string): ParsedSenderKey {
  if (key.startsWith(PROJECT_PREFIX)) return { kind: 'project', slug: key.slice(PROJECT_PREFIX.length) };
  if (key.startsWith(ADDRESS_PREFIX)) return { kind: 'address', address: key.slice(ADDRESS_PREFIX.length) };
  const at = key.indexOf(':');
  return { kind: 'legacy', chain: at < 0 ? '' : key.slice(0, at), address: key.slice(at + 1) };
}

/** Every address a label names, once each and sorted: the store splits sender rows into labeled and not by this list. */
export function labeledAddresses(labels: LabelIndex): string[] {
  return [...new Set(Object.keys(labels).map(senderKeyAddress))].sort();
}

/** The addresses one project's label names, on any chain. */
export function projectAddresses(labels: LabelIndex, slug: string): string[] {
  return [...new Set(Object.entries(labels).filter(([, label]) => label.slug === slug).map(([key]) => senderKeyAddress(key)))].sort();
}

/**
 * EVM addresses labeled on an EVM chain, for the projects that allow spreading. An address two projects label is left
 * out: whose it is on a third chain is unknown.
 */
function spreadIndex(labels: LabelIndex, chains: SenderChains): Map<string, Label> {
  const evmChains = new Set([...chains.values()].filter((c) => c.family === 'EVM').map((c) => c.name));
  const claimants = new Map<string, Set<string>>();
  const spreadable = new Map<string, Label>();
  for (const [key, label] of Object.entries(labels)) {
    const chain = key.slice(0, key.indexOf(':'));
    const address = senderKeyAddress(key);
    if (!evmChains.has(chain) || !isAddressShape('EVM', address)) continue;
    claimants.set(address, (claimants.get(address) ?? new Set()).add(label.slug));
    if (label.spread !== false) spreadable.set(address, label);
  }
  return new Map([...spreadable].filter(([address]) => claimants.get(address)!.size === 1));
}

/** The sender's own label on its chain, else a label spread from the same EVM address on another EVM chain, else the address. */
export function identityResolver(labels: LabelIndex, chains: SenderChains): IdentityResolver {
  const spread = spreadIndex(labels, chains);
  return (selector, address) => {
    const normalized = senderAddress(address);
    const chain = chains.get(selector);
    const own = chain === undefined ? undefined : labels[`${chain.name}:${normalized}`];
    if (own !== undefined) return { key: projectKey(own.slug), project: own, inferred: false };
    const spreadLabel = chain?.family === 'EVM' ? spread.get(normalized) : undefined;
    if (spreadLabel !== undefined) return { key: projectKey(spreadLabel.slug), project: spreadLabel, inferred: true };
    return { key: addressKey(normalized), project: null, inferred: false };
  };
}

export interface SenderRow {
  /** `<selector>:<address>`, as daily_breakdown keys senders. */
  key: string;
  messages: number;
  usd_value: number;
  fee_usd: number | null;
}

export interface IdentityTotals {
  key: string;
  label: string | null;
  slug: string | null;
  x: string | null;
  kind: LabelKind | null;
  /** Every row of the project came through a spread label. */
  inferred: boolean;
  messages: number;
  usd_value: number;
  fee_usd: number | null;
  /** Source chain selectors, busiest first. */
  chains: string[];
  /** Distinct addresses. */
  addresses: number;
  /** The `<selector>:<address>` keys merged in, each once, in the order first seen. */
  keys: string[];
}

interface Group {
  identity: SenderIdentity;
  allInferred: boolean;
  messages: number;
  usd: number;
  fee: number;
  anyFee: boolean;
  chains: Map<string, number>;
  addresses: Set<string>;
  keys: Set<string>;
}

/** Sums sender rows by identity; one key's rows from several days add up. */
export function mergeIdentities(rows: readonly SenderRow[], resolve: IdentityResolver): IdentityTotals[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const selector = row.key.slice(0, row.key.indexOf(':'));
    const address = senderKeyAddress(row.key);
    const identity = resolve(selector, address);
    let group = groups.get(identity.key);
    if (group === undefined) {
      group = { identity, allInferred: true, messages: 0, usd: 0, fee: 0, anyFee: false, chains: new Map(), addresses: new Set(), keys: new Set() };
      groups.set(identity.key, group);
    }
    group.allInferred &&= identity.inferred;
    group.messages += row.messages;
    group.usd += row.usd_value;
    if (row.fee_usd !== null) {
      group.fee += row.fee_usd;
      group.anyFee = true;
    }
    group.chains.set(selector, (group.chains.get(selector) ?? 0) + row.messages);
    group.addresses.add(senderAddress(address));
    group.keys.add(row.key);
  }
  return [...groups.values()].map(totalsOf);
}

function totalsOf(g: Group): IdentityTotals {
  const project = g.identity.project;
  return {
    key: g.identity.key,
    label: project?.name ?? null,
    slug: project?.slug ?? null,
    x: project?.x ?? null,
    kind: project?.kind ?? null,
    inferred: project !== null && g.allInferred,
    messages: g.messages,
    usd_value: g.usd,
    fee_usd: g.anyFee ? g.fee : null,
    chains: [...g.chains].sort(([a, x], [b, y]) => y - x || byName(a, b)).map(([selector]) => selector),
    addresses: g.addresses.size,
    keys: [...g.keys],
  };
}

export type IdentityOrder = 'value' | 'fees' | 'messages';

/** Each order ends on the key, as the store's per-key rankings do, so ties always fall the same way. */
const ORDER: Record<IdentityOrder, (a: IdentityTotals, b: IdentityTotals) => number> = {
  value: (a, b) => b.usd_value - a.usd_value || b.messages - a.messages || byName(a.key, b.key),
  fees: (a, b) => (b.fee_usd ?? 0) - (a.fee_usd ?? 0) || b.usd_value - a.usd_value || byName(a.key, b.key),
  messages: (a, b) => b.messages - a.messages || b.usd_value - a.usd_value || byName(a.key, b.key),
};

/** The first `limit` identities in `order`. By fees, an identity with no fee data has nothing to rank by, so it is left out. */
export function rankIdentities(identities: readonly IdentityTotals[], order: IdentityOrder, limit: number): IdentityTotals[] {
  return identities.filter((i) => order !== 'fees' || i.fee_usd !== null).sort(ORDER[order]).slice(0, limit);
}

/** `part` as a percentage of `total`, to one decimal; null when there is no total to share. */
export function sharePct(part: number, total: number | null): number | null {
  return total === null || total <= 0 ? null : Math.round((part / total) * 1000) / 10;
}
