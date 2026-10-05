import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  addDays, archiveKey, BREAKDOWN_CONFLICT, buildRows, createPricesClient, dayOf, dayStartIso, gzipText, insertSql, issuePath,
  ListMessage, normalizeList, priceKeys, rollupDay, sanitize, sqlLiteral, toIsoUtc, toJsonl, TOTALS_CONFLICT,
  type NetworkInfo, type NormalizedMessage, type PriceLookup, type PricesClient,
} from '@ccip-dev/core';

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

export interface BuildOptions {
  dir: string;
  liveStartDay: string;
  prices: PricesClient;
  chunkSize?: number;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface BuildResult {
  days: number;
  messages: number;
  unpricedMessages: number;
  sqlFiles: number;
  buildId: string;
}

interface Coverage {
  coverage_from: string | null;
  complete: boolean;
  stopped_at_depth_wall?: boolean;
}

export async function build(opts: BuildOptions): Promise<BuildResult> {
  const log = opts.log ?? (() => {});
  const computedAt = (opts.now ?? (() => new Date()))().toISOString();
  const lastDay = addDays(opts.liveStartDay, -1);
  const coverage = JSON.parse(await readFile(path.join(opts.dir, 'coverage.json'), 'utf8')) as Coverage;
  if (coverage.complete !== true) {
    throw new Error(
      `The crawl is not complete (coverage.json complete: ${String(coverage.complete)}). Re-run pnpm backfill:crawl until it finishes.`,
    );
  }
  const oldestDay = coverage.coverage_from ? dayOf(coverage.coverage_from) : lastDay;
  const partialDay = coverage.stopped_at_depth_wall && coverage.coverage_from ? oldestDay : null;
  const pageFiles = [...(await jsonFiles(opts.dir, 'topup')), ...(await jsonFiles(opts.dir, 'pages'))];
  await assertReachesLiveStart(opts.dir, pageFiles, opts.liveStartDay);

  await rm(path.join(opts.dir, 'sql'), { recursive: true, force: true });
  await rm(path.join(opts.dir, 'archive'), { recursive: true, force: true });
  const writer = new SqlWriter(path.join(opts.dir, 'sql'), opts.chunkSize ?? 20_000);
  const prices = await PriceCache.open(opts.prices, path.join(opts.dir, 'prices', 'cache.json'), oldestDay, lastDay);
  const firstSeen = new FirstSeen();
  const chains = new ChainHistory();
  const buckets = new Map<string, Map<string, { raw: unknown; message: ListMessage }>>();
  const flushed = new Set<string>();
  const result: BuildResult = { days: 0, messages: 0, unpricedMessages: 0, sqlFiles: 0, buildId: '' };

  const flush = async (day: string) => {
    const entries = [...(buckets.get(day)?.values() ?? [])];
    buckets.delete(day);
    flushed.add(day);
    const normalized = entries.map((e) => normalizeList(e.message));
    const lookup = await prices.lookupFor(day, normalized.flatMap(priceKeys));
    const { rows, tokens } = buildRows(normalized, lookup, () => ({ source: 'backfill' }));
    normalized.forEach((m) => firstSeen.add(m));
    entries.forEach((e) => chains.add(e.message));
    const statements = [
      ...rows.map((r) => insertSql('messages', r, MESSAGE_CONFLICT)),
      ...tokens.map((t) => insertSql('message_tokens', t, TOKEN_CONFLICT)),
    ];
    if (day !== partialDay) {
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
    log(`${day}: ${rows.length} messages${day === partialDay ? ' (partial day, no rollup)' : ''}`);
  };

  for (const file of pageFiles) {
    const raws = JSON.parse(await readFile(path.join(opts.dir, file), 'utf8')) as unknown[];
    let pageOldest: string | null = null;
    for (const [index, raw] of raws.entries()) {
      const parsed = ListMessage.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`${file}[${index}] is not a valid CCIP list message (problem at ${issuePath(parsed.error)})`);
      }
      const day = dayOf(parsed.data.sendTimestamp);
      if (day > lastDay) continue;
      if (flushed.has(day)) {
        throw new Error(
          `${file}[${index}] (message ${parsed.data.messageId}) is on ${day}, a day the build already wrote. ` +
            "The pages are more than a day out of time order; stopping rather than overwrite that day's rows, archive and rollup.",
        );
      }
      if (pageOldest === null || day < pageOldest) pageOldest = day;
      const bucket = buckets.get(day) ?? new Map<string, { raw: unknown; message: ListMessage }>();
      bucket.set(parsed.data.messageId, { raw, message: parsed.data });
      buckets.set(day, bucket);
    }
    if (pageOldest !== null) {
      // The API is not strictly time-ordered, so the day after a page's oldest day stays open for stragglers.
      const newestOpenDay = addDays(pageOldest, 1);
      for (const day of [...buckets.keys()].filter((d) => d > newestOpenDay).sort().reverse()) await flush(day);
    }
  }
  for (const day of [...buckets.keys()].sort().reverse()) await flush(day);

  // Token rows are not seeded: list data has no symbol or decimals, so they come from the hourly registry snapshot.
  await writer.add([...firstSeen.statements(), ...chains.statements()]);
  if (coverage.coverage_from) {
    const coverageFrom = partialDay ? addDays(partialDay, 1) : oldestDay;
    await writer.add([insertSql('meta', { key: 'coverage_from', value: coverageFrom }, 'ON CONFLICT(key) DO UPDATE SET value = excluded.value')]);
  }
  const written = await writer.finish();
  result.sqlFiles = written.files;
  result.buildId = written.id;
  return result;
}

async function jsonFiles(dir: string, sub: string): Promise<string[]> {
  if (!existsSync(path.join(dir, sub))) return [];
  return (await readdir(path.join(dir, sub)))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(sub, f));
}

async function assertReachesLiveStart(dir: string, files: string[], liveStartDay: string): Promise<void> {
  for (const file of files) {
    const newest = (JSON.parse(await readFile(path.join(dir, file), 'utf8')) as { sendTimestamp?: string }[])[0]?.sendTimestamp;
    if (newest === undefined) continue;
    if (Date.parse(newest) < Date.parse(dayStartIso(liveStartDay))) {
      throw new Error(`The crawl ends at ${newest}, before live_start_day ${liveStartDay}. Run pnpm backfill:crawl --top-up first.`);
    }
    return;
  }
  throw new Error('No crawled messages found: run pnpm backfill:crawl first');
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

  async lookupFor(day: string, keys: string[]): Promise<PriceLookup> {
    const unique = [...new Set(keys)];
    let changed = false;
    const needDecimals = unique.filter((k) => !(k in this.data.decimals));
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
    return (key) => {
      const price = this.data.history[key]?.[day];
      const decimals = this.data.decimals[key];
      return price !== undefined && decimals !== null && decimals !== undefined ? { price, decimals } : undefined;
    };
  }
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
  const prices = createPricesClient({
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(60_000) }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    clock: () => Date.now(),
  });
  const result = await build({ dir: '.backfill', liveStartDay, prices, log: (line) => console.log(line) });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
