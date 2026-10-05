import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CcipClient } from '@ccip-dev/core';
import { crawl, createBackfillClient, loadState, writeFileAtomic, type CrawlClient, type SkippedMessage } from './crawl';

export type SourcesClient = Pick<CcipClient, 'listChains' | 'listMessages' | 'getMessageRaw'>;

export interface Source {
  selector: string;
  name: string;
}

export interface SourceSummary extends Source {
  done: boolean;
  stopped_at_depth_wall: boolean;
  coverage_from: string | null;
  messages: number;
  pages: number;
  skipped: SkippedMessage[];
  error?: string;
}

export interface SourcesSummary {
  complete: boolean;
  sources: SourceSummary[];
}

export interface CrawlSourcesOptions {
  dir: string;
  client: SourcesClient;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

/** Crawls every source chain's history into `<dir>/sources/<selector>/`, one filtered crawl per source. */
export async function crawlSources(opts: CrawlSourcesOptions): Promise<SourcesSummary> {
  const log = opts.log ?? (() => {});
  const sourcesDir = path.join(opts.dir, 'sources');
  await mkdir(sourcesDir, { recursive: true });
  const sources = await listSources(opts.dir, opts.client);
  await writeFileAtomic(path.join(sourcesDir, 'sources.json'), `${JSON.stringify(sources, null, 2)}\n`);
  const errors = new Map<string, string>();
  await writeSummary(sourcesDir, sources, errors);

  for (const source of sources) {
    const dir = path.join(sourcesDir, source.selector);
    const state = await loadState(dir);
    if (state.done && !state.stoppedAtDepthWall) {
      log(`source ${source.selector} (${source.name}): already done`);
      continue;
    }
    log(`source ${source.selector} (${source.name})`);
    try {
      await crawl({
        dir,
        client: filteredTo(opts.client, source.selector),
        limit: 1000,
        minLimit: 1,
        skipPoison: true,
        sleep: opts.sleep,
        log: (line) => log(`  ${source.name}: ${line}`),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.set(source.selector, message);
      log(`  ${source.name}: failed: ${message}`);
    }
  }
  return writeSummary(sourcesDir, sources, errors);
}

interface RawMessage {
  sourceNetworkInfo?: { chainSelector?: unknown; name?: string };
}

async function listSources(dir: string, client: SourcesClient): Promise<Source[]> {
  const names = new Map<string, string>();
  for (const chain of await client.listChains()) names.set(chain.chainSelector, chain.name);
  for (const folder of ['pages', 'topup'].map((sub) => path.join(dir, sub))) {
    if (!existsSync(folder)) continue;
    for (const file of (await readdir(folder)).filter((f) => f.endsWith('.json'))) {
      const messages = JSON.parse(await readFile(path.join(folder, file), 'utf8')) as RawMessage[];
      for (const network of messages.map((m) => m.sourceNetworkInfo)) {
        if (typeof network?.chainSelector !== 'string') {
          throw new Error(`${path.join(folder, file)}: a message has no sourceNetworkInfo.chainSelector`);
        }
        if (!names.has(network.chainSelector)) names.set(network.chainSelector, network.name ?? network.chainSelector);
      }
    }
  }
  return [...names].map(([selector, name]) => ({ selector, name })).sort((a, b) => a.selector.localeCompare(b.selector));
}

function filteredTo(client: SourcesClient, sourceChainSelector: string): CrawlClient {
  return {
    listMessages: (opts) => client.listMessages({ ...opts, sourceChainSelector }),
    getMessageRaw: (messageId) => client.getMessageRaw(messageId),
  };
}

async function writeSummary(sourcesDir: string, sources: Source[], errors: Map<string, string>): Promise<SourcesSummary> {
  const entries: SourceSummary[] = [];
  for (const source of sources) {
    const state = await loadState(path.join(sourcesDir, source.selector));
    const error = errors.get(source.selector);
    entries.push({
      ...source,
      done: state.done,
      stopped_at_depth_wall: state.stoppedAtDepthWall,
      coverage_from: state.oldest,
      messages: state.messages,
      pages: state.pages,
      skipped: state.skipped,
      ...(error === undefined ? {} : { error }),
    });
  }
  const complete = entries.length > 0 && entries.every((s) => s.done && !s.stopped_at_depth_wall && s.error === undefined);
  const summary = { complete, sources: entries };
  await writeFileAtomic(path.join(sourcesDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

async function main(): Promise<void> {
  const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '.backfill';
  const summary = await crawlSources({ dir, client: createBackfillClient(), log: (line) => console.log(line) });
  for (const s of summary.sources) {
    const status = s.error ? `error: ${s.error}` : s.stopped_at_depth_wall ? 'walled' : s.done ? 'done' : 'unfinished';
    console.log(`${s.selector} ${s.name}: ${status}, ${s.messages} messages from ${s.coverage_from}, ${s.skipped.length} skipped`);
  }
  console.log(`complete: ${summary.complete} (${path.join(dir, 'sources', 'summary.json')})`);
  if (!summary.complete) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
