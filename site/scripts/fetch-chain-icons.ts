import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchPublic } from '../src/lib/data';
import { cleanIcon } from './chain-icons/clean';
import { lettermarkSvg } from './chain-icons/lettermark';
import { matchIcon, type MatchRule, type Overrides } from './chain-icons/match';
import { embedsRaster, rasterizeIcon } from './chain-icons/rasterize';
import { contactSheet, type SheetRow } from './chain-icons/sheet';

const SOURCE = 'https://github.com/smartcontractkit/documentation/tree/main/public/assets/chains';
const LISTING = 'https://api.github.com/repos/smartcontractkit/documentation/contents/public/assets/chains';
const iconUrl = (slug: string) => `https://docs.chain.link/assets/chains/${slug}.svg`;
const SITE = join(import.meta.dirname, '..');
const OUT_DIR = join(SITE, 'public', 'chains');
const MANIFEST = join(SITE, 'src', 'data', 'chain-icons.json');
const OVERRIDES = join(import.meta.dirname, 'chain-icon-overrides.json');
const SHEET = join(SITE, '.icons-review.html');
const SAFE_NAME = /^[a-z0-9_-]+$/;

interface ManifestEntry {
  selector: string;
  file: string;
  kind: 'logo' | 'lettermark';
  slug: string | null;
  rule: MatchRule;
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function main(): Promise<void> {
  const [{ chains }, listing, overrides] = await Promise.all([
    fetchPublic('chains.json'),
    getText(LISTING).then((t) => JSON.parse(t) as { name: string }[]),
    readFile(OVERRIDES, 'utf8').then((t) => JSON.parse(t) as Overrides),
  ]);
  const slugs = new Set(listing.filter((f) => f.name.endsWith('.svg')).map((f) => f.name.slice(0, -4)));
  const files = new Map<string, string | Uint8Array>();
  let rasterized = 0;
  const icons: Record<string, ManifestEntry> = {};
  const rows: SheetRow[] = [];
  for (const chain of [...chains].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!SAFE_NAME.test(chain.name)) throw new Error(`unsafe chain name for a file: ${chain.name}`);
    const match = matchIcon(chain, slugs, overrides);
    const displayName = chain.display_name ?? chain.name;
    const raw = match.slug ? await getText(iconUrl(match.slug)) : await lettermarkSvg(displayName);
    const raster = match.slug !== null && embedsRaster(raw);
    const file = `${chain.name}.${raster ? 'png' : 'svg'}`;
    files.set(file, raster ? await rasterizeIcon(raw) : cleanIcon(raw, chain.name));
    if (raster) rasterized++;
    icons[chain.name] = { selector: chain.selector, file, kind: match.slug ? 'logo' : 'lettermark', slug: match.slug, rule: match.rule };
    rows.push({ file, displayName, slug: match.slug, rule: match.rule });
  }
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  for (const [file, svg] of files) await writeFile(join(OUT_DIR, file), svg);
  await mkdir(join(SITE, 'src', 'data'), { recursive: true });
  await writeFile(MANIFEST, `${JSON.stringify({ source: SOURCE, icons }, null, 2)}\n`);
  await writeFile(SHEET, contactSheet(rows));
  const byRule = new Map<string, number>();
  for (const r of rows) byRule.set(r.rule, (byRule.get(r.rule) ?? 0) + 1);
  console.log(`icons: ${rows.length} chains · ${[...byRule].map(([rule, n]) => `${rule} ${n}`).join(' · ')} · rasterized ${rasterized}`);
  console.log(`lettermarks: ${rows.filter((r) => r.slug === null).map((r) => r.displayName).join(', ') || 'none'}`);
  console.log(`review: ${SHEET}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
