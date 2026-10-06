import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  addDays, archiveKey, BREAKDOWN_CONFLICT, buildCoingeckoIdIndex, buildRows, buildTokenGroupIndex, chainRef, COIN_PRICE_DECIMALS,
  coingeckoKeys, createCcipClient, createCoingeckoClient, createPricesClient, dayOf, dayStartIso, fallbackKeys, groupFallback, gzipText,
  insertSql, isCoingeckoKey, issuePath, listAllTokens, ListMessage, MAX_TRANSFER_USD, normalizeList, normalizeRegistryToken, priceKeys, rollupDay, sanitize,
  sqlLiteral, toIsoUtc, toJsonl, tokenGroupEntry, TOTALS_CONFLICT, type CcipClient, type CoingeckoClient, type CoingeckoIdIndex,
  type CoingeckoLists, type HttpDeps, type NetworkInfo, type NormalizedMessage, type PriceLookup, type PricesClient, type RegistryToken,
  type TokenGroupIndex,
} from '@ccip-dev/core';
import type { SkippedMessage } from './crawl';
import { dropPriceOutliers } from './price-outliers';
import type { Source, SourceSummary, SourcesSummary } from './sources';

export const MESSAGE_CONFLICT =
  'ON CONFLICT(message_id) DO UPDATE SET status = excluded.status, receipt_ts = excluded.receipt_ts, ' +
  'token_count = excluded.token_count, usd_value = excluded.usd_value, unpriced = excluded.unpriced ' +
  "WHERE messages.source = 'backfill'";
export const TOKEN_CONFLICT =
  'ON CONFLICT(message_id, idx) DO UPDATE SET chain = excluded.chain, token = excluded.token, amount = excluded.amount, ' +
  "usd_value = excluded.usd_value WHERE (SELECT source FROM messages WHERE messages.message_id = excluded.message_id) = 'backfill'";
export const ARRIVAL_CONFLICT =
  'ON CONFLICT(kind, key) DO UPDATE SET first_seen = MIN(arrivals.first_seen, excluded.first_seen), ' +
  'announced_at = COALESCE(arrivals.announced_at, excluded.announced_at)';
export const CHAIN_CONFLICT =
  'ON CONFLICT(selector) DO UPDATE SET first_seen = MIN(chains.first_seen, excluded.first_seen), ' +
  'last_seen = MAX(chains.last_seen, excluded.last_seen)';
export const COINGECKO_ID_CONFLICT =
  'ON CONFLICT(chain, address) DO UPDATE SET coin_id = excluded.coin_id, updated_at = excluded.updated_at';

/** A day's spool buffer goes to disk once it holds more lines than this. */
const DAY_BUFFER_LINES = 5_000;
/** Every buffer goes to disk once they hold more lines than this together, so memory stays bounded however many days there are. */
const SPOOL_BUFFER_LINES = 100_000;

export type RegistryClient = Pick<CcipClient, 'listChains' | 'listTokens'>;

export interface BuildOptions {
  dir: string;
  liveStartDay: string;
  prices: PricesClient;
  /** The CCIP token registry, fetched once per build for the token-group price fallback the Worker also uses. */
  registry: RegistryClient;
  /** CoinGecko's coin id lists, fetched once per build for the fallback's CoinGecko step the Worker also uses. Ids only. */
  coingecko: CoingeckoClient;
  chunkSize?: number;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface BuildResult {
  days: number;
  messages: number;
  unpricedMessages: number;
  skippedMessages: number;
  sqlFiles: number;
  buildId: string;
  /** Token amounts valued above MAX_TRANSFER_USD, which were left unpriced. */
  priceOutliers: number;
  /** Glitched points dropped from the daily price series, over every key (see `dropPriceOutliers`). */
  droppedPrices: number;
}

interface Coverage {
  coverage_from: string | null;
  complete: boolean;
  stopped_at_depth_wall?: boolean;
  skipped?: SkippedMessage[];
}

interface CoveragePlan {
  /** Days before this one get messages and archives but no rollups; null when every crawled day is complete. */
  rollupFrom: string | null;
  skipped: SkippedMessage[];
  /** Sources the API refuses as a filter: their history comes only from the global crawl. */
  unsupported: Source[];
}

interface Registry {
  chains: NetworkInfo[];
  tokens: RegistryToken[];
}

interface DayEntry {
  raw: unknown;
  message: ListMessage;
}

export async function build(opts: BuildOptions): Promise<BuildResult> {
  const log = opts.log ?? (() => {});
  const computedAt = (opts.now ?? (() => new Date()))().toISOString();
  const lastDay = addDays(opts.liveStartDay, -1);
  const plan = await planCoverage(opts.dir, opts.liveStartDay);
  // Before the spool, which can take minutes at full history, so an unreachable CCIP API or CoinGecko fails the build early.
  const registry = await fetchRegistry(opts.registry, path.join(opts.dir, 'registry'));
  const coingeckoIdOf = buildCoingeckoIdIndex(await fetchCoingeckoLists(opts.coingecko, path.join(opts.dir, 'registry')));
  const daysDir = path.join(opts.dir, 'days');
  const spooled = await spoolDays(opts.dir, daysDir, lastDay);
  log(`spooled ${spooled.days.length} days into ${daysDir}`);
  assertReachesLiveStart(spooled.newest, opts.liveStartDay);
  assertNoUnsupportedSource(plan.unsupported, spooled.sources);
  const earliestDay = spooled.days[0];
  const coverageFrom = plan.rollupFrom ?? earliestDay;
  assertCompleteDayLeft(coverageFrom, opts.liveStartDay);
  const networks = networksOf(registry, spooled.networks);
  const groups = tokenGroupsOf(registry.tokens, networks);

  await rm(path.join(opts.dir, 'sql'), { recursive: true, force: true });
  await rm(path.join(opts.dir, 'archive'), { recursive: true, force: true });
  const writer = new SqlWriter(path.join(opts.dir, 'sql'), opts.chunkSize ?? 20_000);
  const prices = await PriceCache.open(opts.prices, path.join(opts.dir, 'prices', 'cache.json'), earliestDay ?? lastDay, lastDay);
  const firstSeen = new FirstSeen();
  const chains = new ChainHistory();
  const result: BuildResult = {
    days: 0, messages: 0, unpricedMessages: 0, skippedMessages: plan.skipped.length, sqlFiles: 0, buildId: '', priceOutliers: 0, droppedPrices: 0,
  };

  const buildDay = async (day: string) => {
    const entries = await readDay(path.join(daysDir, `${day}.jsonl`));
    const rollup = plan.rollupFrom === null || day >= plan.rollupFrom;
    const normalized = entries.map((e) => normalizeList(e.message));
    const amounts = normalized.flatMap((m) => m.tokens);
    await prices.ensure(normalized.flatMap(priceKeys));
    const lookup = prices.lookupOn(day);
    await prices.ensure(fallbackKeys(groups, amounts, lookup));
    await prices.ensure(coingeckoKeys(groups, amounts, lookup, coingeckoIdOf));
    const fallback = groupFallback(groups, lookup, { coingeckoIdOf, decimalsOf: (key) => prices.decimalsOf(key) });
    const { rows, tokens, outliers } = buildRows(normalized, lookup, () => ({ source: 'backfill' }), fallback);
    normalized.forEach((m) => firstSeen.add(m));
    entries.forEach((e) => chains.add(e.message));
    const statements = [
      ...rows.map((r) => insertSql('messages', r, MESSAGE_CONFLICT)),
      ...tokens.map((t) => insertSql('message_tokens', t, TOKEN_CONFLICT)),
    ];
    if (rollup) {
      const { totals, breakdown } = rollupDay(day, rows, tokens);
      statements.push(
        insertSql('daily_totals', { ...totals, computed_at: computedAt }, TOTALS_CONFLICT),
        `DELETE FROM daily_breakdown WHERE day = ${sqlLiteral(day)};`,
      );
      for (const b of breakdown) statements.push(insertSql('daily_breakdown', b, BREAKDOWN_CONFLICT));
    }
    await writer.add(statements);
    const archivePath = path.join(opts.dir, 'archive', archiveKey(day));
    await mkdir(path.dirname(archivePath), { recursive: true });
    await writeFile(archivePath, Buffer.from(await gzipText(toJsonl(entries.map((e) => e.raw)))));
    result.days += 1;
    result.messages += rows.length;
    result.unpricedMessages += rows.filter((r) => r.unpriced === 1).length;
    result.priceOutliers += outliers.length;
    log(`${day}: ${rows.length} messages${rollup ? '' : ' (before coverage_from, no rollup)'}`);
  };

  for (const day of spooled.days) await buildDay(day);

  // Token rows are not seeded: list data has no symbol or decimals, so they come from the hourly registry snapshot.
  await writer.add([
    ...firstSeen.statements(),
    ...chains.statements(),
    ...coingeckoSeeds(registry.tokens, networks, coingeckoIdOf, computedAt),
  ]);
  await writer.add([insertSql('meta', { key: 'coverage_from', value: coverageFrom }, 'ON CONFLICT(key) DO UPDATE SET value = excluded.value')]);
  await writeFileAtomic(path.join(opts.dir, 'skipped.json'), `${JSON.stringify(plan.skipped, null, 2)}\n`);
  const written = await writer.finish();
  result.sqlFiles = written.files;
  result.buildId = written.id;
  // At full history the spool holds several GB, and every build makes a new one.
  await rm(daysDir, { recursive: true, force: true });
  result.droppedPrices = reportPriceGuards(prices.droppedPoints(), result.priceOutliers, log);
  return result;
}

/** Logs what the price guards left out of the totals, and returns how many daily price points were dropped. */
function reportPriceGuards(droppedPoints: ReadonlyMap<string, number>, priceOutliers: number, log: (line: string) => void): number {
  const byKey = [...droppedPoints].sort(([ka, a], [kb, b]) => b - a || (ka < kb ? -1 : 1));
  const total = byKey.reduce((sum, [, n]) => sum + n, 0);
  log(`${priceOutliers} token amount(s) valued above $${MAX_TRANSFER_USD.toLocaleString('en-US')} were left unpriced`);
  log(`dropped ${total} glitched daily price(s) in total`);
  for (const [key, n] of byKey) log(`  ${key}: ${n}`);
  return total;
}

/** Per-source crawls decide coverage when `sources/summary.json` exists; otherwise the global crawl's coverage.json does. */
async function planCoverage(dir: string, liveStartDay: string): Promise<CoveragePlan> {
  const coverageFile = path.join(dir, 'coverage.json');
  const coverage = existsSync(coverageFile) ? (JSON.parse(await readFile(coverageFile, 'utf8')) as Coverage) : null;
  const sourcesDir = path.join(dir, 'sources');
  const summaryFile = path.join(sourcesDir, 'summary.json');
  if (existsSync(summaryFile)) {
    if ((await jsonFiles(dir, 'pages')).length > 0) assertCrawlComplete(coverage);
    const summary = JSON.parse(await readFile(summaryFile, 'utf8')) as SourcesSummary;
    const plan = planFromSources(summary, coverage?.skipped ?? []);
    await assertSourcesFresh(sourcesDir, summary.sources, liveStartDay);
    return plan;
  }
  if (existsSync(sourcesDir)) {
    throw new Error(
      `${sourcesDir} has no summary.json, so the build cannot tell whether the per-source crawl finished. ` +
        `Re-run pnpm backfill:sources, or remove ${sourcesDir} to build from the global crawl alone.`,
    );
  }
  assertCrawlComplete(coverage);
  const partialDay = coverage.stopped_at_depth_wall && coverage.coverage_from ? dayOf(coverage.coverage_from) : null;
  return {
    rollupFrom: partialDay === null ? null : addDays(partialDay, 1),
    skipped: uniqueSkipped(coverage.skipped ?? []),
    unsupported: [],
  };
}

function assertCrawlComplete(coverage: Coverage | null): asserts coverage is Coverage {
  if (coverage === null) throw new Error('No coverage.json found: run pnpm backfill:crawl first');
  if (coverage.complete !== true) {
    throw new Error(
      `The crawl is not complete (coverage.json complete: ${String(coverage.complete)}). Re-run pnpm backfill:crawl until it finishes.`,
    );
  }
}

function planFromSources(summary: SourcesSummary, globalSkipped: SkippedMessage[]): CoveragePlan {
  const crawled = summary.sources.filter((s) => !s.unsupported);
  if (crawled.length === 0) throw new Error('sources/summary.json lists no source that was crawled. Run pnpm backfill:sources first.');
  const wallDays = crawled.map(wallDayOf).filter((day) => day !== null).sort();
  const latestWallDay = wallDays.at(-1);
  return {
    rollupFrom: latestWallDay === undefined ? null : addDays(latestWallDay, 1),
    skipped: uniqueSkipped([...globalSkipped, ...summary.sources.flatMap((s) => s.skipped)]),
    unsupported: summary.sources.filter((s) => s.unsupported).map(({ selector, name }) => ({ selector, name })),
  };
}

/**
 * A finished source is not crawled again, so one whose crawl started before live start misses the messages sent between
 * then and live start. A source's first page is written when its crawl starts.
 */
async function assertSourcesFresh(sourcesDir: string, sources: SourceSummary[], liveStartDay: string): Promise<void> {
  const liveStart = Date.parse(dayStartIso(liveStartDay));
  const stale: SourceSummary[] = [];
  for (const source of sources.filter((s) => !s.unsupported)) {
    const firstPage = path.join(sourcesDir, source.selector, 'pages', '00000.json');
    if (!existsSync(firstPage) || (await stat(firstPage)).mtimeMs < liveStart) stale.push(source);
  }
  if (stale.length === 0) return;
  throw new Error(
    `These per-source crawls started before 00:00 UTC of live_start_day ${liveStartDay}: ` +
      `${stale.map((s) => `${s.selector} (${s.name})`).join(', ')}. ` +
      `Delete ${stale.map((s) => path.join(sourcesDir, s.selector)).join(', ')} and re-run pnpm backfill:sources ` +
      '(a re-run alone does not refresh a finished source); otherwise the messages sent between their crawl and live start are missing.',
  );
}

/** The oldest, possibly partial, day of a source that stopped at a depth wall; null for a source crawled to its start. */
function wallDayOf(source: SourceSummary): string | null {
  const name = `Source ${source.selector} (${source.name})`;
  const rerun = 'Re-run pnpm backfill:sources until every source finishes.';
  if (source.error !== undefined) throw new Error(`${name} failed in the per-source crawl: ${source.error}. ${rerun}`);
  if (!source.done) throw new Error(`${name} has not finished its per-source crawl (sources/summary.json done: false). ${rerun}`);
  if (!source.stopped_at_depth_wall) return null;
  if (source.coverage_from === null) {
    throw new Error(
      `${name} stopped at a depth wall before it crawled any message (coverage_from: null), so the days it covers are unknown. ${rerun}`,
    );
  }
  return dayOf(source.coverage_from);
}

function uniqueSkipped(skipped: SkippedMessage[]): SkippedMessage[] {
  const byId = new Map<string, SkippedMessage>();
  for (const s of skipped) if (!byId.has(s.messageId)) byId.set(s.messageId, s);
  return [...byId.values()];
}

/**
 * Sorts every crawled message before live_start_day into `<daysDir>/YYYY-MM-DD.jsonl`, one raw message per line, in the
 * order the pages were fetched. The last line for a message id is the most recently fetched copy. Also returns every
 * network the crawled messages name, by selector.
 */
async function spoolDays(
  dir: string,
  daysDir: string,
  lastDay: string,
): Promise<{ days: string[]; newest: string | null; sources: Set<string>; networks: Map<string, NetworkInfo> }> {
  await rm(daysDir, { recursive: true, force: true });
  await mkdir(daysDir, { recursive: true });
  const spool = new DaySpool(daysDir, { dayLines: DAY_BUFFER_LINES, totalLines: SPOOL_BUFFER_LINES });
  let newest: string | null = null;
  const sources = new Set<string>();
  const networks = new Map<string, NetworkInfo>();
  for (const file of await inputFiles(dir)) {
    const raws = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as unknown[];
    for (const [index, raw] of raws.entries()) {
      const message = parseListMessage(raw, `${file}[${index}]`);
      for (const network of [message.sourceNetworkInfo, message.destNetworkInfo]) networks.set(network.chainSelector, network);
      if (newest === null || Date.parse(message.sendTimestamp) > Date.parse(newest)) newest = message.sendTimestamp;
      const day = dayOf(message.sendTimestamp);
      if (day > lastDay) continue;
      await spool.add(day, JSON.stringify(raw));
      sources.add(message.sourceNetworkInfo.chainSelector);
    }
  }
  return { days: await spool.finish(), newest, sources, networks };
}

/** Fetches the whole CCIP token registry and keeps a copy in `registryDir`. */
async function fetchRegistry(client: RegistryClient, registryDir: string): Promise<Registry> {
  const chains = await client.listChains();
  const tokens = await listAllTokens(client);
  await mkdir(registryDir, { recursive: true });
  await writeFileAtomic(path.join(registryDir, 'chains.json'), `${JSON.stringify(chains, null, 2)}\n`);
  await writeFileAtomic(path.join(registryDir, 'tokens.json'), `${JSON.stringify(tokens, null, 2)}\n`);
  return { chains, tokens };
}

/** Fetches CoinGecko's platform and coin lists, coin ids only, and keeps a copy in `registryDir`. */
async function fetchCoingeckoLists(client: CoingeckoClient, registryDir: string): Promise<CoingeckoLists> {
  const lists = await client.lists();
  await mkdir(registryDir, { recursive: true });
  await writeFileAtomic(path.join(registryDir, 'coingecko-platforms.json'), `${JSON.stringify(lists.platforms, null, 2)}\n`);
  await writeFileAtomic(path.join(registryDir, 'coingecko-coins.json'), `${JSON.stringify(lists.coins, null, 2)}\n`);
  return lists;
}

/** Every chain by selector: from /chains, or from the crawled messages for a chain /chains no longer lists. */
function networksOf({ chains }: Registry, crawled: Map<string, NetworkInfo>): Map<string, NetworkInfo> {
  const networks = new Map(crawled);
  for (const chain of chains) networks.set(chain.chainSelector, chain);
  return networks;
}

/** Indexes the registry's token groups. */
function tokenGroupsOf(tokens: RegistryToken[], networks: Map<string, NetworkInfo>): TokenGroupIndex {
  return buildTokenGroupIndex(
    tokens.map(normalizeRegistryToken).map((t) => {
      const network = networks.get(t.chain);
      return tokenGroupEntry(t, network && chainRef(network));
    }),
  );
}

/**
 * Seeds the Worker's coingecko_ids with the registry tokens the CoinGecko lists map, so live pricing has the CoinGecko
 * step from the upload on, even before the Worker's own daily refresh first succeeds.
 */
function coingeckoSeeds(
  tokens: RegistryToken[],
  networks: Map<string, NetworkInfo>,
  coingeckoIdOf: CoingeckoIdIndex,
  updatedAt: string,
): string[] {
  return tokens.map(normalizeRegistryToken).flatMap((t) => {
    const network = networks.get(t.chain);
    const coinId = network && coingeckoIdOf(chainRef(network), t.address);
    if (!coinId) return [];
    const row = { chain: t.chain, address: t.address, coin_id: coinId, updated_at: updatedAt };
    return [insertSql('coingecko_ids', row, COINGECKO_ID_CONFLICT)];
  });
}

/** Every page file, least recently fetched (modified) first. */
async function inputFiles(dir: string): Promise<string[]> {
  const sourcesDir = path.join(dir, 'sources');
  const selectors = existsSync(sourcesDir)
    ? (await readdir(sourcesDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    : [];
  const files = [...(await jsonFiles(dir, 'pages')), ...(await jsonFiles(dir, 'topup'))];
  for (const selector of selectors) files.push(...(await jsonFiles(dir, path.join('sources', selector, 'pages'))));
  const fetched: { file: string; mtimeMs: number }[] = [];
  for (const file of files) fetched.push({ file, mtimeMs: (await stat(path.join(dir, file))).mtimeMs });
  // The sort is stable, so pages with the same mtime keep the order above: global pages, top-up, then each source.
  return fetched.sort((a, b) => a.mtimeMs - b.mtimeMs).map((f) => f.file);
}

async function jsonFiles(dir: string, sub: string): Promise<string[]> {
  if (!existsSync(path.join(dir, sub))) return [];
  return (await readdir(path.join(dir, sub)))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(sub, f));
}

function parseListMessage(raw: unknown, where: string): ListMessage {
  const parsed = ListMessage.safeParse(raw);
  if (!parsed.success) throw new Error(`${where} is not a valid CCIP list message (problem at ${issuePath(parsed.error)})`);
  return parsed.data;
}

/** One day's messages, deduplicated by id; the last line for an id wins. */
async function readDay(file: string): Promise<DayEntry[]> {
  const byId = new Map<string, DayEntry>();
  const lines = (await readFile(file, 'utf8')).split('\n').filter((line) => line !== '');
  for (const [index, line] of lines.entries()) {
    const raw: unknown = JSON.parse(line);
    const message = parseListMessage(raw, `${file}:${index + 1}`);
    byId.set(message.messageId, { raw, message });
  }
  return [...byId.values()];
}

function assertReachesLiveStart(newest: string | null, liveStartDay: string): void {
  if (newest === null) throw new Error('No crawled messages found: run pnpm backfill:sources or pnpm backfill:crawl first');
  if (Date.parse(newest) < Date.parse(dayStartIso(liveStartDay))) {
    throw new Error(`The crawl ends at ${newest}, before live_start_day ${liveStartDay}. Run pnpm backfill:crawl --top-up first.`);
  }
}

function assertNoUnsupportedSource(unsupported: Source[], spooledSources: Set<string>): void {
  const found = unsupported.find((s) => spooledSources.has(s.selector));
  if (found === undefined) return;
  throw new Error(
    `Source ${found.selector} (${found.name}) is unsupported as a source filter (sources/summary.json), yet the crawled pages ` +
      'hold messages sent from it before live_start_day: the API cannot back-fill it, so its history before the global ' +
      "crawl's depth wall is unavailable and coverage_from would claim days that miss its messages.",
  );
}

function assertCompleteDayLeft(coverageFrom: string | undefined, liveStartDay: string): asserts coverageFrom is string {
  const lastDay = addDays(liveStartDay, -1);
  if (coverageFrom === undefined) {
    throw new Error(`No complete day to roll up: no crawled message was sent before live_start_day ${liveStartDay}.`);
  }
  if (coverageFrom > lastDay) {
    throw new Error(
      `No complete day to roll up: coverage_from would be ${coverageFrom}, after ${lastDay}, the last day before live_start_day ${liveStartDay}.`,
    );
  }
}

/** Appends lines to one `YYYY-MM-DD.jsonl` file per day in `dir`, buffering in memory up to the given limits. */
export class DaySpool {
  private readonly buffers = new Map<string, string[]>();
  private readonly written = new Set<string>();
  private buffered = 0;

  constructor(private readonly dir: string, private readonly limits: { dayLines: number; totalLines: number }) {}

  async add(day: string, line: string): Promise<void> {
    const buffer = this.buffers.get(day) ?? [];
    buffer.push(line);
    this.buffers.set(day, buffer);
    this.buffered += 1;
    if (buffer.length > this.limits.dayLines) await this.flush(day);
    else if (this.buffered > this.limits.totalLines) await this.flushAll();
  }

  /** Writes what is still buffered and returns the spooled days, oldest first. */
  async finish(): Promise<string[]> {
    await this.flushAll();
    return [...this.written].sort();
  }

  private async flushAll(): Promise<void> {
    for (const day of [...this.buffers.keys()]) await this.flush(day);
  }

  private async flush(day: string): Promise<void> {
    const lines = this.buffers.get(day) ?? [];
    this.buffers.delete(day);
    this.buffered -= lines.length;
    await appendFile(path.join(this.dir, `${day}.jsonl`), lines.map((line) => `${line}\n`).join(''));
    this.written.add(day);
  }
}

export class SqlWriter {
  private pending: string[] = [];
  private files = 0;
  private readonly hash = createHash('sha256');

  constructor(private readonly dir: string, private readonly chunkSize: number) {}

  async add(statements: string[]): Promise<void> {
    for (const statement of statements) this.pending.push(statement);
    while (this.pending.length >= this.chunkSize) await this.write(this.pending.splice(0, this.chunkSize));
  }

  async finish(): Promise<{ files: number; id: string }> {
    if (this.pending.length > 0) await this.write(this.pending.splice(0));
    const id = this.hash.digest('hex');
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, 'BUILD'), `${id}\n`);
    return { files: this.files, id };
  }

  private async write(lines: string[]): Promise<void> {
    this.files += 1;
    const content = `${lines.join('\n')}\n`;
    this.hash.update(content);
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, `${String(this.files).padStart(5, '0')}.sql`), content);
  }
}

class FirstSeen {
  private readonly seen = { chain: new Map<string, string>(), token: new Map<string, string>(), lane: new Map<string, string>() };

  add(m: NormalizedMessage): void {
    this.keep('chain', m.src.selector, m.sendTs);
    this.keep('chain', m.dst.selector, m.sendTs);
    this.keep('lane', `${m.src.selector}>${m.dst.selector}`, m.sendTs);
    for (const t of m.tokens) this.keep('token', `${t.chain.selector}:${t.token}`, m.sendTs);
  }

  statements(): string[] {
    return (['chain', 'token', 'lane'] as const).flatMap((kind) =>
      [...this.seen[kind]].map(([key, ts]) => insertSql('arrivals', { kind, key, first_seen: ts, announced_at: ts }, ARRIVAL_CONFLICT)),
    );
  }

  private keep(kind: 'chain' | 'token' | 'lane', key: string, ts: string): void {
    const previous = this.seen[kind].get(key);
    if (previous === undefined || ts < previous) this.seen[kind].set(key, ts);
  }
}

class ChainHistory {
  private readonly chains = new Map<string, { info: NetworkInfo; firstSeen: string; lastSeen: string }>();

  add(m: ListMessage): void {
    const ts = toIsoUtc(m.sendTimestamp);
    this.keep(m.sourceNetworkInfo, ts);
    this.keep(m.destNetworkInfo, ts);
  }

  statements(): string[] {
    return [...this.chains.values()].map(({ info, firstSeen, lastSeen }) =>
      insertSql(
        'chains',
        {
          selector: info.chainSelector,
          name: sanitize(info.name),
          display_name: sanitize(info.displayName ?? info.name),
          family: info.chainFamily,
          chain_id: info.chainId,
          first_seen: firstSeen,
          last_seen: lastSeen,
        },
        CHAIN_CONFLICT,
      ),
    );
  }

  private keep(info: NetworkInfo, ts: string): void {
    const seen = this.chains.get(info.chainSelector);
    if (seen === undefined) {
      this.chains.set(info.chainSelector, { info, firstSeen: ts, lastSeen: ts });
      return;
    }
    if (ts < seen.firstSeen) seen.firstSeen = ts;
    if (ts > seen.lastSeen) {
      seen.lastSeen = ts;
      seen.info = info;
    }
  }
}

interface PriceCacheFile {
  range: string;
  history: Record<string, Record<string, number>>;
  decimals: Record<string, number | null>;
}

class PriceCache {
  /** Each key's series without its glitched points, filtered once, the first time it is read. */
  private readonly filtered = new Map<string, Record<string, number>>();
  private readonly dropped = new Map<string, number>();

  private constructor(
    private readonly client: PricesClient,
    private readonly file: string,
    private readonly fromDay: string,
    private readonly toDay: string,
    private readonly data: PriceCacheFile,
  ) {}

  static async open(client: PricesClient, file: string, fromDay: string, toDay: string): Promise<PriceCache> {
    const range = `${fromDay}..${toDay}`;
    const cached = existsSync(file) ? await readPriceCache(file) : null;
    const data = cached?.range === range ? cached : { range, history: {}, decimals: {} };
    return new PriceCache(client, file, fromDay, toDay, data);
  }

  /** Fetches and caches the daily history of every key not cached yet, and the decimals of every llama key among them. */
  async ensure(keys: string[]): Promise<void> {
    const unique = [...new Set(keys)];
    let changed = false;
    const needDecimals = unique.filter((k) => !isCoingeckoKey(k) && !(k in this.data.decimals));
    if (needDecimals.length > 0) {
      const latest = await this.client.latest(needDecimals);
      for (const k of needDecimals) this.data.decimals[k] = latest.get(k)?.decimals ?? null;
      changed = true;
    }
    for (const k of unique) {
      if (k in this.data.history) continue;
      this.data.history[k] = Object.fromEntries(await this.client.dailyHistory(k, this.fromDay, this.toDay));
      changed = true;
    }
    if (changed) {
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFileAtomic(this.file, JSON.stringify(this.data));
    }
  }

  /**
   * Prices on `day` from the cache, including keys ensured after this call, without the glitched points
   * `dropPriceOutliers` finds. A llama key counts only with decimals; a `coingecko:` key has none and needs only its price.
   */
  lookupOn(day: string): PriceLookup {
    const days = nearDays(day);
    return (key) => {
      const price = nearDayPrice(this.series(key), days);
      if (price === undefined) return undefined;
      if (isCoingeckoKey(key)) return { price, decimals: COIN_PRICE_DECIMALS };
      const decimals = this.decimalsOf(key);
      return decimals === undefined ? undefined : { price, decimals };
    };
  }

  /** How many glitched points were dropped from each key's series read so far; keys with none are left out. */
  droppedPoints(): ReadonlyMap<string, number> {
    return this.dropped;
  }

  /** The cached series stays raw, so a change to the filter needs no refetch. */
  private series(key: string): Record<string, number> | undefined {
    const known = this.filtered.get(key);
    if (known !== undefined) return known;
    const raw = this.data.history[key];
    if (raw === undefined) return undefined;
    const { kept, dropped } = dropPriceOutliers(raw);
    this.filtered.set(key, kept);
    if (dropped.length > 0) this.dropped.set(key, dropped.length);
    return kept;
  }

  /** DefiLlama's current decimals for a llama key, known even on a day its history has no price. */
  decimalsOf(key: string): number | undefined {
    return this.data.decimals[key] ?? undefined;
  }
}

/** A day and the days around it that a price series may take a point from when it has none that day. */
interface NearDays {
  day: string;
  earlier: string[];
  later: string[];
  nearestFirst: string[];
}

function nearDays(day: string): NearDays {
  const at = (offset: number) => addDays(day, offset);
  return { day, earlier: [at(-1), at(-2)], later: [at(1), at(2)], nearestFirst: [at(-1), at(1), at(-2), at(2)] };
}

/**
 * The series' price on the day. For a gap with a point at most two days away on each side, the nearest of those points,
 * the earlier on a tie. A gap at either end of a series stays empty, so a launch-day spike is not carried backwards and a
 * delisted token's last print is not carried forwards.
 */
function nearDayPrice(series: Record<string, number> | undefined, days: NearDays): number | undefined {
  if (series === undefined) return undefined;
  const exact = series[days.day];
  if (exact !== undefined) return exact;
  const has = (day: string) => series[day] !== undefined;
  if (!days.earlier.some(has) || !days.later.some(has)) return undefined;
  const nearest = days.nearestFirst.find(has);
  return nearest === undefined ? undefined : series[nearest];
}

async function readPriceCache(file: string): Promise<PriceCacheFile> {
  const text = await readFile(file, 'utf8');
  try {
    return JSON.parse(text) as PriceCacheFile;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`The price cache ${file} is not valid JSON; delete it and run the build again (${detail})`, { cause: err });
  }
}

async function writeFileAtomic(file: string, contents: string): Promise<void> {
  const temp = `${file}.tmp`;
  await writeFile(temp, contents);
  await rename(temp, file);
}

async function main(): Promise<void> {
  const flag = process.argv.indexOf('--live-start');
  const liveStartDay = flag > 0 ? process.argv[flag + 1] : undefined;
  if (!liveStartDay || !/^\d{4}-\d{2}-\d{2}$/.test(liveStartDay)) {
    throw new Error('usage: pnpm backfill:build --live-start YYYY-MM-DD (the Worker meta value live_start_day)');
  }
  const deps: HttpDeps = {
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(60_000) }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    clock: () => Date.now(),
  };
  const result = await build({
    dir: '.backfill',
    liveStartDay,
    prices: createPricesClient(deps),
    registry: createCcipClient(deps),
    coingecko: createCoingeckoClient(deps),
    log: (line) => console.log(line),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
