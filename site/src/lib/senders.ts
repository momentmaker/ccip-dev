import type { ChainsFile, DayLeaders, TopEntry, TopFile } from '@ccip-dev/core/public';
import { parseSenderKey } from '@ccip-dev/core/senders';
import { REPO_URL } from '../config';
import type { TopOrder, Window } from './card-paths';
import { chainName, senderLabel, shortAddress, type ChainNames } from './names';
import { addressExplorerUrl, projectHref } from './projects';
import { topEntries, type TopRow } from './top';

/** CCIP chain names by selector, as label files and the issue form name chains. */
export type RegistryNames = ReadonlyMap<string, string>;

export const registryNames = (chains: ChainsFile['chains']): RegistryNames => new Map(chains.map((c) => [c.selector, c.name]));

/** The ranking by identity when the file has it, already ordered by the Worker; a file published before identities has only its per-chain entries. */
export function senderEntries(top: TopFile, window: Window, order: TopOrder): TopEntry[] {
  const identities = order === 'fees' ? top.identities_by_fees : top.identities;
  return identities ? identities[window] : topEntries(top, window, order);
}

/** The label issue form, with the chain and address filled in. */
export function suggestLabelUrl(chain: string | null, address: string): string {
  const params = new URLSearchParams({ template: 'label.yml', title: `Label: ${shortAddress(address)}`, address, ...(chain === null ? {} : { chain }) });
  return `${REPO_URL}/issues/new?${params}`;
}

export interface SenderView {
  primary: string;
  secondary: string | null;
  verified: boolean;
  inferred: boolean;
  chains: string[];
  href: string | null;
  suggestUrl: string | null;
}

const counted = (n: number, word: string, plural: string) => `${n.toLocaleString('en-US')} ${n === 1 ? word : plural}`;

type SenderFields = Pick<TopEntry, 'key' | 'label' | 'inferred' | 'chains' | 'addresses'>;

/** How the site names a sender: a project by its label, an address by its short form, and an older per-chain key as before. */
export function senderView(e: SenderFields, names: ChainNames, registry: RegistryNames): SenderView {
  const parsed = parseSenderKey(e.key);
  if (parsed.kind === 'legacy') {
    const { primary, secondary, verified } = senderLabel(names, e.key, e.label);
    return {
      primary, secondary, verified, inferred: false,
      chains: parsed.chain ? [parsed.chain] : [],
      href: verified ? null : addressExplorerUrl(parsed.address),
      suggestUrl: verified ? null : suggestLabelUrl(registry.get(parsed.chain) ?? null, parsed.address),
    };
  }
  const chains = e.chains ?? [];
  if (parsed.kind === 'project') {
    const inferred = e.inferred ?? false;
    return {
      primary: e.label ?? parsed.slug,
      secondary: `${counted(e.addresses ?? 0, 'address', 'addresses')} · ${counted(chains.length, 'chain', 'chains')}`,
      verified: !inferred,
      inferred,
      chains,
      href: projectHref(parsed.slug),
      suggestUrl: null,
    };
  }
  const shown = chains.slice(0, 3).map((s) => chainName(names, s));
  const more = chains.length - shown.length;
  return {
    primary: shortAddress(parsed.address),
    secondary: shown.length === 0 ? null : `${shown.join(' · ')}${more > 0 ? ` +${more} more` : ''}`,
    verified: false,
    inferred: false,
    chains,
    href: addressExplorerUrl(parsed.address),
    suggestUrl: suggestLabelUrl(chains[0] === undefined ? null : (registry.get(chains[0]) ?? null), parsed.address),
  };
}

/** Top › Senders rows; Share is of the listed total, as on the other tabs. */
export function senderRows(entries: readonly TopEntry[], names: ChainNames, registry: RegistryNames, order: TopOrder = 'value'): TopRow[] {
  const measure = (e: TopEntry) => (order === 'fees' ? (e.fee_usd ?? null) : e.usd);
  const total = entries.reduce((sum, e) => sum + (measure(e) ?? 0), 0);
  return entries.map((e, i) => {
    const m = measure(e);
    return {
      rank: i + 1,
      ...senderView(e, names, registry),
      messages: e.messages,
      usd: e.usd,
      fee: e.fee_usd ?? null,
      typicalFee: null,
      sharePct: total > 0 && m !== null ? (m / total) * 100 : null,
    };
  });
}

export interface DaySender extends SenderView {
  messages: number;
  sharePct: number | null;
}

/** A day's top sender for its page, from day-leaders.json; null for a day it does not list. */
export function daySender(leaders: DayLeaders | undefined, names: ChainNames, registry: RegistryNames): DaySender | null {
  const s = leaders?.sender;
  return s ? { ...senderView(s, names, registry), messages: s.messages, sharePct: s.share_pct ?? null } : null;
}
