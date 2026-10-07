import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export const BUDGETS = [
  { page: 'index.html', maxGzipBytes: 150 * 1024 },
  { page: 'replay/index.html', maxGzipBytes: 200 * 1024 },
];

export function entryScripts(html: string): string[] {
  const found: string[] = [];
  const patterns = [
    /<script[^>]*type="module"[^>]*src="([^"]+)"/g,
    /<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g,
    /component-url="([^"]+)"/g,
    /renderer-url="([^"]+)"/g,
  ];
  for (const re of patterns) for (const m of html.matchAll(re)) if (m[1]!.startsWith('/_astro/') && !found.includes(m[1]!)) found.push(m[1]!);
  return found;
}

export function staticImports(code: string): string[] {
  return [...code.matchAll(/\b(?:from|import)\s*["']([^"']+\.js)["']/g)].map((m) => m[1]!);
}

export async function reachableBytes(entries: string[], read: (path: string) => Promise<string>): Promise<{ files: string[]; gzipBytes: number }> {
  const seen = new Set<string>();
  const queue = [...entries];
  let gzipBytes = 0;
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = await read(file);
    gzipBytes += gzipSync(code).length;
    for (const spec of staticImports(code)) queue.push(spec.startsWith('/') ? spec : posix.join(posix.dirname(file), spec));
  }
  return { files: [...seen], gzipBytes };
}

async function main(): Promise<void> {
  const dist = join(import.meta.dirname, '..', 'dist');
  const read = (path: string) => readFile(join(dist, path), 'utf8');
  let failed = false;
  for (const budget of BUDGETS) {
    const { files, gzipBytes } = await reachableBytes(entryScripts(await read(budget.page)), read);
    const kb = (gzipBytes / 1024).toFixed(1);
    const line = `${budget.page}: ${kb} KB gzipped JavaScript in ${files.length} files (budget ${budget.maxGzipBytes / 1024} KB)`;
    if (gzipBytes > budget.maxGzipBytes) {
      failed = true;
      console.error(`OVER BUDGET ${line}`);
    } else {
      console.log(line);
    }
  }
  if (failed) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
