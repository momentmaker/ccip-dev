import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCcipClient, dayOf, UpstreamHttpError } from '@ccip-dev/core';

export interface CrawlState {
  cursor: string | null;
  pages: number;
  messages: number;
  done: boolean;
  stoppedAtDepthWall: boolean;
  oldest: string | null;
  perDay: Record<string, number>;
}

export interface CrawlClient {
  listMessages(opts: { limit: number; cursor?: string | null }): Promise<{
    messages: { messageId: string; sendTimestamp: string }[];
    raw: unknown[];
    cursor: string | null;
  }>;
}

export interface CrawlOptions {
  dir: string;
  client: CrawlClient;
  limit?: number;
  maxPages?: number;
  maxConsecutiveFailures?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

const RATE_LIMIT_WAIT_MS = 30_000;

const initialState = (): CrawlState => ({
  cursor: null, pages: 0, messages: 0, done: false, stoppedAtDepthWall: false, oldest: null, perDay: {},
});

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function crawl(opts: CrawlOptions): Promise<CrawlState> {
  const limit = opts.limit ?? 1000;
  const maxFailures = opts.maxConsecutiveFailures ?? 3;
  const sleep = opts.sleep ?? defaultSleep;
  const log = opts.log ?? (() => {});
  await mkdir(path.join(opts.dir, 'pages'), { recursive: true });
  const state = await loadState(opts.dir);
  if (state.stoppedAtDepthWall) {
    log(`retrying the depth wall at cursor ${state.cursor}`);
    state.done = false;
    state.stoppedAtDepthWall = false;
  }

  for (let fetched = 0; !state.done && (opts.maxPages === undefined || fetched < opts.maxPages); fetched++) {
    const page = await fetchPage(opts.client, state.cursor, limit, maxFailures, sleep, log);
    if (page === null) {
      state.done = true;
      state.stoppedAtDepthWall = true;
      await saveState(opts.dir, state);
      log(`depth wall at cursor ${state.cursor}; coverage_from = ${state.oldest}`);
      break;
    }
    if (page.messages.length > 0 && page.cursor !== null && (page.cursor === '' || page.cursor === state.cursor)) {
      throw new Error(`cursor did not advance at ${state.cursor}: got "${page.cursor}"`);
    }
    await writeFile(path.join(opts.dir, 'pages', `${String(state.pages).padStart(5, '0')}.json`), JSON.stringify(page.raw));
    for (const m of page.messages) {
      const day = dayOf(m.sendTimestamp);
      state.perDay[day] = (state.perDay[day] ?? 0) + 1;
      if (state.oldest === null || Date.parse(m.sendTimestamp) < Date.parse(state.oldest)) state.oldest = m.sendTimestamp;
    }
    state.pages += 1;
    state.messages += page.messages.length;
    state.cursor = page.cursor;
    state.done = page.cursor === null || page.messages.length === 0;
    await saveState(opts.dir, state);
    log(`page ${state.pages}: ${page.messages.length} messages, oldest so far ${state.oldest}`);
  }
  return state;
}

export async function topUp(opts: {
  dir: string;
  client: CrawlClient;
  limit?: number;
  maxPages?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}): Promise<{ pages: number; messages: number; reachedCrawl: boolean }> {
  const limit = opts.limit ?? 1000;
  const maxPages = opts.maxPages ?? 500;
  const sleep = opts.sleep ?? defaultSleep;
  const log = opts.log ?? (() => {});
  const firstPage = path.join(opts.dir, 'pages', '00000.json');
  if (!existsSync(firstPage)) throw new Error('No crawl found: run pnpm backfill:crawl first');
  const known = new Set((JSON.parse(await readFile(firstPage, 'utf8')) as { messageId: string }[]).map((m) => m.messageId));
  const outDir = path.join(opts.dir, 'topup');
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  let cursor: string | null = null;
  let messages = 0;
  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(opts.client, cursor, limit, 3, sleep, log);
    if (result === null) throw new Error(`top-up page fetch kept failing at cursor ${cursor}`);
    const fresh: unknown[] = [];
    let reachedCrawl = false;
    for (const [i, m] of result.messages.entries()) {
      if (known.has(m.messageId)) {
        reachedCrawl = true;
        break;
      }
      fresh.push(result.raw[i]);
    }
    await writeFile(path.join(outDir, `${String(page).padStart(5, '0')}.json`), JSON.stringify(fresh));
    messages += fresh.length;
    log(`top-up page ${page + 1}: ${fresh.length} new messages`);
    if (reachedCrawl) return { pages: page + 1, messages, reachedCrawl };
    if (result.cursor === null || result.messages.length === 0) {
      throw new Error(`top-up ended at page ${page + 1} without reaching the crawl's first page; re-run pnpm backfill:crawl --top-up`);
    }
    cursor = result.cursor;
  }
  throw new Error(`top-up did not reach the original crawl within ${maxPages} pages`);
}

async function fetchPage(
  client: CrawlClient,
  cursor: string | null,
  limit: number,
  maxFailures: number,
  sleep: (ms: number) => Promise<void>,
  log: (line: string) => void,
) {
  for (let failures = 0; ; ) {
    try {
      return await client.listMessages({ limit, cursor });
    } catch (err) {
      if (err instanceof UpstreamHttpError && err.status === 429) {
        log(`rate limited (429); waiting ${RATE_LIMIT_WAIT_MS / 1000} s`);
        await sleep(RATE_LIMIT_WAIT_MS);
        continue;
      }
      if (!isTransient(err)) throw err;
      failures += 1;
      log(`page fetch failed (${failures}/${maxFailures}): ${err instanceof Error ? err.message : String(err)}`);
      if (failures >= maxFailures) return null;
      await sleep(5000 * failures);
    }
  }
}

function isTransient(err: unknown): boolean {
  if (err instanceof UpstreamHttpError) return err.status >= 500;
  return err instanceof TypeError || (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'));
}

export function coverageOf(state: CrawlState) {
  return {
    coverage_from: state.oldest,
    complete: state.done,
    stopped_at_depth_wall: state.stoppedAtDepthWall,
    pages: state.pages,
    messages: state.messages,
    per_day: Object.fromEntries(Object.entries(state.perDay).sort(([a], [b]) => a.localeCompare(b))),
  };
}

async function loadState(dir: string): Promise<CrawlState> {
  const file = path.join(dir, 'state.json');
  if (!existsSync(file)) return initialState();
  return { ...initialState(), ...(JSON.parse(await readFile(file, 'utf8')) as Partial<CrawlState>) };
}

async function saveState(dir: string, state: CrawlState): Promise<void> {
  await writeFileAtomic(path.join(dir, 'state.json'), JSON.stringify(state));
  await writeFileAtomic(path.join(dir, 'coverage.json'), `${JSON.stringify(coverageOf(state), null, 2)}\n`);
}

async function writeFileAtomic(file: string, contents: string): Promise<void> {
  const temp = `${file}.tmp`;
  await writeFile(temp, contents);
  await rename(temp, file);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--')) ?? '.backfill';
  const client = createCcipClient(
    {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(60_000) }),
      sleep: defaultSleep,
      clock: () => Date.now(),
    },
    { maxRetries: 0, minIntervalMs: 1000 },
  );
  if (args.includes('--top-up')) {
    console.log(JSON.stringify(await topUp({ dir, client, log: (line) => console.log(line) }), null, 2));
    return;
  }
  const state = await crawl({ dir, client, log: (line) => console.log(line) });
  const { per_day: _perDay, ...summary } = coverageOf(state);
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
