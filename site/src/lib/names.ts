export interface NamedChain {
  selector: string;
  name?: string | null;
  display_name?: string | null;
}

export type ChainNames = Map<string, string>;

function prettifyRegistryName(name: string): string {
  const tokens = name.split('-');
  const last = tokens.lastIndexOf('mainnet');
  let words = last < 0 ? tokens : tokens.slice(last + 1).filter((t) => !/^\d+$/.test(t));
  if (words.length === 0) words = tokens.slice(0, tokens.indexOf('mainnet'));
  const pretty = words
    .join(' ')
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
  return pretty || name;
}

export function shortChainName(chain: NamedChain): string {
  const display = chain.display_name?.replace(/ Mainnet$/, '');
  if (display) return display;
  return chain.name ? prettifyRegistryName(chain.name) : chain.selector;
}

export function chainNameMap(chains: NamedChain[]): ChainNames {
  return new Map(chains.map((c) => [c.selector, shortChainName(c)]));
}

export function chainName(names: ChainNames, selector: string): string {
  return names.get(selector) ?? selector;
}

export function laneLabel(names: ChainNames, key: string): string {
  const [src, dst, ...rest] = key.split('>');
  if (!src || !dst || rest.length > 0) return key;
  return `${chainName(names, src)} → ${chainName(names, dst)}`;
}

export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return address.startsWith('0x') ? `${address.slice(0, 6)}…${address.slice(-4)}` : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function splitKey(key: string): { chain: string; address: string } {
  const split = key.indexOf(':');
  return split < 0 ? { chain: '', address: key } : { chain: key.slice(0, split), address: key.slice(split + 1) };
}

export function tokenLabel(names: ChainNames, key: string, symbol: string | null | undefined): { primary: string; secondary: string } {
  const { chain, address } = splitKey(key);
  return { primary: symbol || shortAddress(address), secondary: chainName(names, chain) };
}

export function senderLabel(
  names: ChainNames,
  key: string,
  label: string | null | undefined,
): { primary: string; secondary: string; verified: boolean } {
  const { chain, address } = splitKey(key);
  return { primary: label || shortAddress(address), secondary: chainName(names, chain), verified: Boolean(label) };
}

export function keyChains(key: string): string[] {
  const ends = key.split('>');
  if (ends.length === 2 && ends[0] && ends[1]) return [ends[0], ends[1]];
  const split = key.indexOf(':');
  return split > 0 ? [key.slice(0, split)] : [];
}
