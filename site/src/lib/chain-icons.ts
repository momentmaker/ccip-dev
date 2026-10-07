import manifest from '../data/chain-icons.json';

interface IconEntry {
  selector: string;
  file: string;
}

const bySelector = new Map<string, IconEntry>(Object.values(manifest.icons as Record<string, IconEntry>).map((e) => [e.selector, e]));

export function iconHref(selector: string): string | null {
  const entry = bySelector.get(selector);
  return entry ? `/chains/${entry.file}` : null;
}

export function iconHrefs(selectors: readonly string[]): string[] {
  return selectors.flatMap((s) => {
    const href = iconHref(s);
    return href ? [href] : [];
  });
}

export function hasIcon(selector: string): boolean {
  return bySelector.has(selector);
}

export function missingIcons(chains: readonly { selector: string; name: string | null }[]): string[] {
  return chains.filter((c) => !bySelector.has(c.selector)).map((c) => c.name ?? c.selector);
}

export function iconFiles(): string[] {
  return [...bySelector.values()].map((e) => e.file);
}
