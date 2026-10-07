import { existsSync, readdirSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isOgImageUrl } from '../src/lib/card-paths';
import { iconFiles } from '../src/lib/chain-icons';
import { METRIC_ANCHORS } from '../src/lib/metric-anchors';

export interface PageFacts {
  path: string;
  title: string | null;
  ogImage: string | null;
  canonical: string | null;
}

const first = (re: RegExp, html: string) => re.exec(html)?.[1] ?? null;

export function pageFacts(path: string, html: string): PageFacts {
  return {
    path,
    title: first(/<title>([^<]*)<\/title>/, html),
    ogImage: first(/<meta property="og:image" content="([^"]*)"/, html)?.replaceAll('&amp;', '&') ?? null,
    canonical: first(/<link rel="canonical" href="([^"]*)"/, html),
  };
}

export function htmlIds(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
}

export function isRedirectPage(html: string): boolean {
  return /<meta http-equiv="refresh"/i.test(html);
}

export function checkPages(pages: PageFacts[], methodologyIds: Set<string>, anchors: string[]): string[] {
  const problems: string[] = [];
  const titles = new Map<string, string>();
  for (const p of pages) {
    if (!p.title) problems.push(`${p.path}: missing <title>`);
    else if (titles.has(p.title)) problems.push(`${p.path}: title "${p.title}" repeats ${titles.get(p.title)}`);
    else titles.set(p.title, p.path);
    if (!p.ogImage || !isOgImageUrl(p.ogImage)) problems.push(`${p.path}: og:image ${p.ogImage ?? '(missing)'} is not an allowed card URL`);
    if (!p.canonical?.startsWith('https://ccip.dev/')) problems.push(`${p.path}: canonical ${p.canonical ?? '(missing)'} is not on https://ccip.dev/`);
  }
  for (const anchor of new Set(anchors)) {
    if (!methodologyIds.has(anchor)) problems.push(`/methodology/: no element with id "${anchor}"`);
  }
  return problems;
}

export function checkIconFiles(files: readonly string[], present: ReadonlySet<string>): string[] {
  return files.filter((f) => !present.has(f)).map((f) => `/chains/${f}: icon listed in the manifest is missing from the build`);
}

async function main(): Promise<void> {
  const dist = join(import.meta.dirname, '..', 'dist');
  const entries = await readdir(dist, { withFileTypes: true, recursive: true });
  const pages: PageFacts[] = [];
  let methodologyIds = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const file = join(entry.parentPath, entry.name);
    const html = await readFile(file, 'utf8');
    if (isRedirectPage(html)) continue;
    const path = `/${relative(dist, file).replace(/index\.html$/, '')}`;
    if (path === '/methodology/') methodologyIds = htmlIds(html);
    pages.push(pageFacts(path, html));
  }
  const chainsDir = join(dist, 'chains');
  const iconsPresent = new Set(existsSync(chainsDir) ? readdirSync(chainsDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name) : []);
  const problems = [...checkPages(pages, methodologyIds, Object.values(METRIC_ANCHORS)), ...checkIconFiles(iconFiles(), iconsPresent)];
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`check-build: ${pages.length} pages OK`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
