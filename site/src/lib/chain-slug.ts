import { shortChainName } from './names';

interface SlugChain {
  selector: string;
  name: string | null;
  display_name: string | null;
}

export function chainSlug(chain: SlugChain): string {
  const slug = shortChainName(chain)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s-]+mainnet$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || chain.selector;
}

export function slugMap(chains: readonly SlugChain[]): Map<string, string> {
  const used = new Map<string, number>();
  const out = new Map<string, string>();
  for (const c of [...chains].sort((a, b) => (a.selector < b.selector ? -1 : a.selector > b.selector ? 1 : 0))) {
    const base = chainSlug(c);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    out.set(c.selector, n === 1 ? base : `${base}-${n}`);
  }
  return out;
}
