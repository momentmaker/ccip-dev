import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCcipClient, cursorAt, dayOf, decodeCursor, UpstreamHttpError } from '@ccip-dev/core';

export interface CrawlState {
  cursor: string | null;
  pages: number;
  messages: number;
  done: boolean;
  stoppedAtDepthWall: boolean;
  oldest: string | null;
  perDay: Record<string, number>;
  limit?: number;
  skipped: SkippedMessage[];
}

export interface SkippedMessage {
  messageId: string;
  sendTimestamp: string;
}

export interface CrawlClient {
  listMessages(opts: { limit: number; cursor?: string | null }): Promise<{
    messages: { messageId: string; sendTimestamp: string }[];
    raw: unknown[];
    cursor: string | null;
  }>;
  getMessageRaw?(messageId: string): Promise<unknown>;
}

export interface CrawlOptions {
  dir: string;
  client: CrawlClient;
  limit?: number;
  minLimit?: number;
  maxPages?: number;
  maxConsecutiveFailures?: number;
  /** Search for and skip a message that fails every page holding it, instead of stopping at a depth wall there. */
  skipPoison?: boolean;
  maxPoisonProbes?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

const RATE_LIMIT_WAIT_MS = 30_000;
const MAX_POISON_PROBES = 400;

const initialState = (): CrawlState => ({
  cursor: null, pages: 0, messages: 0, done: false, stoppedAtDepthWall: false, oldest: null, perDay: {}, skipped: [],
});

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function crawl(opts: CrawlOptions): Promise<CrawlState> {
  const configuredLimit = opts.limit ?? 1000;
  const floor = Math.min(opts.minLimit ?? 10, configuredLimit);
  if (opts.skipPoison && floor !== 1) {
    throw new Error('skipPoison needs minLimit: 1, so that a page failing at the floor holds only the poison message');
  }
  const maxFailures = opts.maxConsecutiveFailures ?? 3;
  const sleep = opts.sleep ?? defaultSleep;
  const log = opts.log ?? (() => {});
  const search = { budget: opts.maxPoisonProbes ?? MAX_POISON_PROBES, maxFailures, sleep, log };
  await mkdir(path.join(opts.dir, 'pages'), { recursive: true });
  const state = await loadState(opts.dir);
  state.limit ??= configuredLimit;
  if (state.stoppedAtDepthWall) {
    log(`retrying the depth wall at cursor ${state.cursor}`);
    state.done = false;
    state.stoppedAtDepthWall = false;
  }

  for (let fetched = 0; !state.done && (opts.maxPages === undefined || fetched < opts.maxPages); fetched++) {
    let page = null;
    while (page === null) {
      const size = state.limit;
      const atFloor = size <= floor;
      page = await fetchPage(opts.client, state.cursor, size, atFloor ? maxFailures : 1, sleep, log);
      if (page !== null) break;
      if (atFloor) {
        if (opts.skipPoison && (await skipPoison(opts, state, configuredLimit, search))) continue;
        break;
      }
      state.limit = Math.max(floor, Math.floor(size / 2));
      log(`page fetch failed at limit ${size}; retrying with ${state.limit}`);
    }
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
  const partialDir = path.join(opts.dir, 'topup.partial');
  await rm(partialDir, { recursive: true, force: true });
  await mkdir(partialDir, { recursive: true });

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
    await writeFile(path.join(partialDir, `${String(page).padStart(5, '0')}.json`), JSON.stringify(fresh));
    messages += fresh.length;
    log(`top-up page ${page + 1}: ${fresh.length} new messages`);
    if (reachedCrawl) {
      await rm(outDir, { recursive: true, force: true });
      await rename(partialDir, outDir);
      return { pages: page + 1, messages, reachedCrawl };
    }
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

interface PoisonSearch {
  budget: number;
  maxFailures: number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

async function skipPoison(opts: CrawlOptions, state: CrawlState, configuredLimit: number, search: PoisonSearch): Promise<boolean> {
  const cursor = state.cursor;
  if (cursor === null) return false;
  const poison = await findPoison(opts.client, cursor, search);
  if (poison === null) return false;
  const skipped = { messageId: poison.messageId, sendTimestamp: new Date(poison.timestampMs).toISOString() };
  state.skipped.push(skipped);
  state.cursor = cursorAt(cursor, poison.timestampMs, poison.messageId);
  // The poison message, not the depth, made the pages fail, so the full page size is worth trying again.
  state.limit = configuredLimit;
  await saveState(opts.dir, state);
  search.log(`skipped poison message ${skipped.messageId} sent at ${skipped.sendTimestamp}`);
  await savePoisonDetail(opts, skipped.messageId, search.log);
  return true;
}

async function savePoisonDetail(opts: CrawlOptions, messageId: string, log: (line: string) => void): Promise<void> {
  if (!opts.client.getMessageRaw) return;
  try {
    const detail = await opts.client.getMessageRaw(messageId);
    await mkdir(path.join(opts.dir, 'poison'), { recursive: true });
    await writeFile(path.join(opts.dir, 'poison', `${messageId}.json`), JSON.stringify(detail));
  } catch (err) {
    log(`could not save the detail of poison message ${messageId}: ${errorText(err)}`);
  }
}

const ID_SPACE = 1n << 256n;
const MESSAGE_ID = /^0x[0-9a-fA-F]{64}$/;
const formatId = (id: bigint) => `0x${id.toString(16).padStart(64, '0')}`;

interface PoisonPosition {
  timestampMs: number;
  messageId: string;
}

interface Prober {
  /** True when the page at (timestampMs, id) holds the poison message, false when it is past it, null to give up. */
  holds(timestampMs: number, id: bigint): Promise<boolean | null>;
  count(): number;
}

/**
 * Finds the poison message right past `cursor` (where a `limit: 1` page fails) with crafted-cursor probes.
 * A probe at (T, I) holds the first message with `ts < T`, or `ts = T` and `id < I`. It fails exactly when
 * (T, I) is above the poison message, so the poison message's timestamp and then its id can be bisected.
 */
async function findPoison(client: CrawlClient, cursor: string, search: PoisonSearch): Promise<PoisonPosition | null> {
  const start = cursorPosition(cursor, search.log);
  if (start === null) return null;
  const prober = createProber(client, cursor, search);
  const timestampMs = await findPoisonTimestamp(prober, start.timestampMs, search.log);
  if (timestampMs === null) return null;
  // The cursor's own page holds the poison message, so at the cursor's timestamp its id is below the cursor's.
  const idBound = timestampMs === start.timestampMs ? start.id : ID_SPACE;
  const id = await findPoisonId(prober, timestampMs, idBound);
  if (id === null) return null;
  // Out of range when no probe confirmed the bound: a timestamp with milliseconds, or answers that contradict.
  if (id < 0n || id === ID_SPACE - 1n) {
    search.log(`poison search: no message id at ${new Date(timestampMs).toISOString()} holds the poison message`);
    return null;
  }
  search.log(`poison search: found it in ${prober.count()} probes`);
  return { timestampMs, messageId: formatId(id) };
}

function cursorPosition(cursor: string, log: (line: string) => void): { timestampMs: number; id: bigint } | null {
  let params: URLSearchParams;
  try {
    params = decodeCursor(cursor);
  } catch (err) {
    log(`poison search: cannot decode cursor ${cursor}: ${errorText(err)}`);
    return null;
  }
  const timestamp = params.get('oldestSeenTimestamp') ?? '';
  const id = params.get('oldestSeenMessageId') ?? '';
  if (!/^\d+$/.test(timestamp) || !MESSAGE_ID.test(id)) {
    log(`poison search: the cursor has no timestamp and message id (${params})`);
    return null;
  }
  return { timestampMs: Number(timestamp), id: BigInt(id) };
}

function createProber(client: CrawlClient, cursor: string, search: PoisonSearch): Prober {
  let probes = 0;
  return {
    count: () => probes,
    async holds(timestampMs, id) {
      const crafted = cursorAt(cursor, timestampMs, formatId(id));
      for (let failures = 0; ; ) {
        if (probes >= search.budget) {
          search.log(`poison search: no boundary found within ${search.budget} probes`);
          return null;
        }
        probes += 1;
        try {
          await client.listMessages({ limit: 1, cursor: crafted });
          return false;
        } catch (err) {
          if (err instanceof UpstreamHttpError && err.status === 500) return true;
          failures += 1;
          search.log(`poison probe failed (${failures}/${search.maxFailures}): ${errorText(err)}`);
          if (failures >= search.maxFailures) return null;
          await search.sleep(err instanceof UpstreamHttpError && err.status === 429 ? RATE_LIMIT_WAIT_MS : 5000 * failures);
        }
      }
    },
  };
}

/** Steps back 1 s, 2 s, 4 s, … from the cursor until a probe is past the poison message, then bisects whole seconds. */
async function findPoisonTimestamp(prober: Prober, startMs: number, log: (line: string) => void): Promise<number | null> {
  // One second ahead of the cursor holds the poison message without a probe: it is not newer than the cursor message.
  let holdingBack = -1;
  let clearBack: number | null = null;
  for (let back = 1; clearBack === null; back *= 2) {
    if (startMs - back * 1000 < 0) {
      log('poison search: every probe back to 1970 holds the poison message');
      return null;
    }
    const holds = await prober.holds(startMs - back * 1000, 0n);
    if (holds === null) return null;
    if (holds) holdingBack = back;
    else clearBack = back;
  }
  while (clearBack - holdingBack > 1) {
    const mid = Math.floor((clearBack + holdingBack) / 2);
    const holds = await prober.holds(startMs - mid * 1000, 0n);
    if (holds === null) return null;
    if (holds) holdingBack = mid;
    else clearBack = mid;
  }
  return startMs - clearBack * 1000;
}

/** Bisects ids in [0, bound) at the poison message's timestamp; the smallest holding id is the poison message's id + 1. */
async function findPoisonId(prober: Prober, timestampMs: number, bound: bigint): Promise<bigint | null> {
  let clearId = 0n;
  let holdingId = bound;
  while (holdingId - clearId > 1n) {
    const mid = (clearId + holdingId) / 2n;
    const holds = await prober.holds(timestampMs, mid);
    if (holds === null) return null;
    if (holds) holdingId = mid;
    else clearId = mid;
  }
  return holdingId - 1n;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isTransient(err: unknown): boolean {
  if (err instanceof UpstreamHttpError) return err.status >= 500;
  return err instanceof TypeError || (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'));
}

export function coverageOf(state: CrawlState) {
  return {
    coverage_from: state.oldest,
    complete: state.done,
    page_size: state.limit ?? null,
    stopped_at_depth_wall: state.stoppedAtDepthWall,
    pages: state.pages,
    messages: state.messages,
    skipped: state.skipped,
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
