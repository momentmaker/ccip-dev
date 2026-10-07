export interface IconChain {
  name: string;
  display_name: string | null;
}

export type Overrides = Record<string, string | null>;
export type MatchRule = 'override' | 'exact' | 'child' | 'stem' | 'display' | 'none';

export interface IconMatch {
  slug: string | null;
  rule: MatchRule;
}

const CHILD = /^.+?-mainnet-(.+?)(?:-\d+)?$/;
const STEM = /^(.+)-mainnet$/;

export function displaySlug(displayName: string): string {
  return displayName.trim().toLowerCase().replace(/ mainnet$/, '').replace(/\s+/g, '-');
}

export function matchIcon(chain: IconChain, slugs: ReadonlySet<string>, overrides: Overrides): IconMatch {
  if (Object.hasOwn(overrides, chain.name)) {
    const slug = overrides[chain.name] ?? null;
    if (slug === null) return { slug: null, rule: 'none' };
    if (!slugs.has(slug)) throw new Error(`override for ${chain.name} names ${slug}, which the docs do not have`);
    return { slug, rule: 'override' };
  }
  const candidates: [MatchRule, string | undefined][] = [
    ['exact', chain.name],
    ['child', CHILD.exec(chain.name)?.[1]],
    ['stem', STEM.exec(chain.name)?.[1]],
    ['display', chain.display_name ? displaySlug(chain.display_name) : undefined],
  ];
  for (const [rule, slug] of candidates) {
    if (slug && slugs.has(slug)) return { slug, rule };
  }
  return { slug: null, rule: 'none' };
}
