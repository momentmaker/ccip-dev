import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { UpstreamHttpError, type CcipClient } from '@ccip-dev/core';
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
  /** The API refused this selector as a source filter (HTTP 404 on the first page); it does not count against `complete`. */
  unsupported?: true;
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

interface SourceRun {
  client: SourcesClient;
  sourcesDir: string;
  sleep?: (ms: number) => Promise<void>;
  log: (line: string) => void;
  errors: Map<string, string>;
  unsupported: Set<string>;
}

/** Crawls every source chain's history into `<dir>/sources/<selector>/`, one filtered crawl per source. */
export async function crawlSources(opts: CrawlSourcesOptions): Promise<SourcesSummary> {
  const sourcesDir = path.join(opts.dir, 'sources');
  await mkdir(sourcesDir, { recursive: true });
  const run: SourceRun = { ...opts, sourcesDir, log: opts.log ?? (() => {}), errors: new Map(), unsupported: new Set() };
  const global = await networksIn([path.join(opts.dir, 'pages'), path.join(opts.dir, 'topup')]);
  const listed = (await opts.client.listChains()).map((chain) => ({ selector: chain.chainSelector, name: chain.name }));
  // Keeping the previous list keeps sources found as destinations in earlier runs in the summary from the start.
  let sources = mergeSources(listed, await previousSources(sourcesDir), global.sources);
  await saveSourceList(sourcesDir, sources);
  await writeSummary(run, sources);

  for (let batch = sources; batch.length > 0; ) {
    for (const source of batch) await crawlSource(run, source);
    const seen = await networksIn(batch.map((source) => path.join(sourcesDir, source.selector, 'pages')));
    const known = new Set(sources.map((source) => source.selector));
    batch = mergeSources(global.destinations, seen.destinations).filter((source) => !known.has(source.selector));
    if (batch.length > 0) {
      run.log(`destinations missing from the source list: ${batch.map((s) => `${s.selector} (${s.name})`).join(', ')}`);
      sources = mergeSources(sources, batch);
      await saveSourceList(sourcesDir, sources);
    }
  }
  return writeSummary(run, sources);
}

async function crawlSource(run: SourceRun, source: Source): Promise<void> {
  const dir = path.join(run.sourcesDir, source.selector);
  const state = await loadState(dir);
  if (state.done && !state.stoppedAtDepthWall) {
    run.log(`source ${source.selector} (${source.name}): already done`);
    return;
  }
  run.log(`source ${source.selector} (${source.name})`);
  try {
    await crawl({
      dir,
      client: filteredTo(run.client, source.selector),
      limit: 1000,
      minLimit: 1,
      skipPoison: true,
      sleep: run.sleep,
      log: (line) => run.log(`  ${source.name}: ${line}`),
    });
  } catch (err) {
    if (err instanceof UpstreamHttpError && err.status === 404 && (await loadState(dir)).pages === 0) {
      run.unsupported.add(source.selector);
      run.log(`  ${source.name}: not supported as a source (HTTP 404 on the first page)`);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    run.errors.set(source.selector, message);
    run.log(`  ${source.name}: failed: ${message}`);
  }
}

interface RawNetwork {
  chainSelector?: unknown;
  name?: string;
}

interface RawMessage {
  sourceNetworkInfo?: RawNetwork;
  destNetworkInfo?: RawNetwork;
}

async function networksIn(folders: string[]): Promise<{ sources: Source[]; destinations: Source[] }> {
  const sources = new Map<string, string>();
  const destinations = new Map<string, string>();
  for (const folder of folders.filter((f) => existsSync(f))) {
    for (const file of (await readdir(folder)).filter((f) => f.endsWith('.json'))) {
      const where = path.join(folder, file);
      for (const message of JSON.parse(await readFile(where, 'utf8')) as RawMessage[]) {
        addNetwork(sources, message.sourceNetworkInfo, `${where}: a message has no sourceNetworkInfo.chainSelector`);
        addNetwork(destinations, message.destNetworkInfo, `${where}: a message has no destNetworkInfo.chainSelector`);
      }
    }
  }
  const listOf = (names: Map<string, string>) => [...names].map(([selector, name]) => ({ selector, name }));
  return { sources: listOf(sources), destinations: listOf(destinations) };
}

function addNetwork(names: Map<string, string>, network: RawNetwork | undefined, missing: string): void {
  if (typeof network?.chainSelector !== 'string') throw new Error(missing);
  if (!names.has(network.chainSelector)) names.set(network.chainSelector, network.name ?? network.chainSelector);
}

/** Sources by selector, sorted; for a selector in several lists the first list's name wins. */
function mergeSources(...lists: Source[][]): Source[] {
  const names = new Map<string, string>();
  for (const source of lists.flat()) if (!names.has(source.selector)) names.set(source.selector, source.name);
  return [...names].map(([selector, name]) => ({ selector, name })).sort((a, b) => a.selector.localeCompare(b.selector));
}

async function previousSources(sourcesDir: string): Promise<Source[]> {
  const file = path.join(sourcesDir, 'sources.json');
  return existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as Source[]) : [];
}

async function saveSourceList(sourcesDir: string, sources: Source[]): Promise<void> {
  await writeFileAtomic(path.join(sourcesDir, 'sources.json'), `${JSON.stringify(sources, null, 2)}\n`);
}

function filteredTo(client: SourcesClient, sourceChainSelector: string): CrawlClient {
  return {
    listMessages: (opts) => client.listMessages({ ...opts, sourceChainSelector }),
    getMessageRaw: (messageId) => client.getMessageRaw(messageId),
  };
}

async function writeSummary(run: SourceRun, sources: Source[]): Promise<SourcesSummary> {
  const entries: SourceSummary[] = [];
  for (const source of sources) {
    const state = await loadState(path.join(run.sourcesDir, source.selector));
    const error = run.errors.get(source.selector);
    entries.push({
      ...source,
      done: state.done,
      stopped_at_depth_wall: state.stoppedAtDepthWall,
      coverage_from: state.oldest,
      messages: state.messages,
      pages: state.pages,
      skipped: state.skipped,
      ...(error === undefined ? {} : { error }),
      ...(run.unsupported.has(source.selector) ? { unsupported: true as const } : {}),
    });
  }
  const supported = entries.filter((s) => !s.unsupported);
  const complete = supported.length > 0 && supported.every((s) => s.done && !s.stopped_at_depth_wall && s.error === undefined);
  const summary = { complete, sources: entries };
  await writeFileAtomic(path.join(run.sourcesDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

async function main(): Promise<void> {
  const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '.backfill';
  const summary = await crawlSources({ dir, client: createBackfillClient(), log: (line) => console.log(line) });
  for (const s of summary.sources) {
    const finished = s.stopped_at_depth_wall ? 'walled' : s.done ? 'done' : 'unfinished';
    const status = s.unsupported ? 'unsupported' : s.error ? `error: ${s.error}` : finished;
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
