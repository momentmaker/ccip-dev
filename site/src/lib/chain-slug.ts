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
  const sorted = [...chains].sort((a, b) => (a.selector < b.selector ? -1 : a.selector > b.selector ? 1 : 0));
  const out = new Map<string, string>();
  const taken = new Set<string>();
  const duplicates: { selector: string; base: string }[] = [];
  for (const c of sorted) {
    const base = chainSlug(c);
    if (taken.has(base)) {
      duplicates.push({ selector: c.selector, base });
    } else {
      taken.add(base);
      out.set(c.selector, base);
    }
  }
  for (const { selector, base } of duplicates) {
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    taken.add(`${base}-${n}`);
    out.set(selector, `${base}-${n}`);
  }
  return out;
}
