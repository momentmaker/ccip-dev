import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildRows, createPricesClient, linkFeeKeys, linkFeeMatcher, linkFeeUsd, ListMessage, llamaKey, normalizeList, normalizeRegistryToken, rollupDay,
  sqlLiteral, valueFee, type HttpDeps, type NormalizedMessage, type PricesClient, type RegistryToken,
} from '@ccip-dev/core';
import { PriceCache, SqlWriter } from '../build';
import { writeFileAtomic } from '../crawl';
import { listArchiveDays, listSealedDays, readArchiveDay, readSealedDay, sealedFile, type DetailRecord } from './store';

export const FEE_DIMS = new Set(['src_chain', 'dst_chain', 'lane', 'sender']);

export interface FeeDayCheck {
  day: string;
  messages: number;
  withFee: number;
  priced: number;
  feeUsd: number | null;
  perMessage: number | null;
}

export interface FeeBuildResult {
  batch: string | null;
  days: string[];
  messagesUpdated: number;
  sqlFiles: number;
  outlierDays: string[];
  lowPricedDays: string[];
  largest: { id: string; day: string; usd: number; token: string }[];
}

interface BuildState {
  built: Record<string, string>;
  batches: number;
}

const sealedHash = async (dir: string, day: string) => createHash('sha256').update(await readFile(sealedFile(dir, day))).digest('hex');

export async function buildFees(opts: { dir: string; prices: PricesClient; chunkSize?: number; log?: (line: string) => void }): Promise<FeeBuildResult> {
  const log = opts.log ?? (() => {});
  const statePath = path.join(opts.dir, 'fees', 'build-state.json');
  const state: BuildState = existsSync(statePath) ? (JSON.parse(await readFile(statePath, 'utf8')) as BuildState) : { built: {}, batches: 0 };
  const hashes = new Map<string, string>();
  for (const day of await listSealedDays(opts.dir)) {
    const hash = await sealedHash(opts.dir, day);
    if (state.built[day] !== hash) hashes.set(day, hash);
  }
  const days = [...hashes.keys()];
  const result: FeeBuildResult = { batch: null, days: [], messagesUpdated: 0, sqlFiles: 0, outlierDays: [], lowPricedDays: [], largest: [] };
  if (days.length === 0) return result;

  const archiveDays = await listArchiveDays(opts.dir);
  if (archiveDays.length === 0) throw new Error(`no archive days under ${path.join(opts.dir, 'archive', 'messages')}`);
  const prices = await PriceCache.openExisting(opts.prices, path.join(opts.dir, 'prices', 'cache.json'), archiveDays.at(-1)!, archiveDays[0]!);
  const registry = JSON.parse(await readFile(path.join(opts.dir, 'registry', 'tokens.json'), 'utf8')) as RegistryToken[];
  const isLinkFee = linkFeeMatcher(linkFeeKeys(registry.map(normalizeRegistryToken)));
  const batch = `B${String(state.batches + 1).padStart(4, '0')}`;
  const batchDir = path.join(opts.dir, 'fees', 'sql', batch);
  await rm(batchDir, { recursive: true, force: true });
  const writer = new SqlWriter(batchDir, opts.chunkSize ?? 20_000);
  const checks: FeeDayCheck[] = [];

  for (const day of days) {
    const byId = new Map<string, DetailRecord>((await readSealedDay(opts.dir, day)).map((r) => [r.id, r]));
    const archived = (await readArchiveDay(opts.dir, day)).map((raw) => normalizeList(ListMessage.parse(raw)));
    const missing = archived.filter((m) => !byId.has(m.messageId)).length;
    if (missing > 0) throw new Error(`fee build: ${day} has ${missing} archived messages with no detail record; its sealed file is incomplete`);
    const messages: NormalizedMessage[] = archived.map((m) => {
      const rec = byId.get(m.messageId);
      return rec?.kind === 'ok' ? { ...m, fee: rec.fee } : m;
    });
    await prices.ensure(messages.flatMap((m) => (m.fee ? [llamaKey(m.src, m.fee.token)] : [])).filter((k): k is string => k !== null));
    const lookup = prices.lookupOn(day);
    const { rows } = buildRows(messages, lookup, (m) => {
      const rec = byId.get(m.messageId);
      return { source: 'backfill', feeUsd: valueFee(m.fee, m.src, lookup), detailFetchedAt: rec?.kind === 'ok' ? rec.fetchedAt : null };
    });
    const filled = rows.filter((r) => byId.get(r.message_id)?.kind === 'ok');
    const statements = filled.map(
      (r) =>
        `UPDATE messages SET fee_token = ${sqlLiteral(r.fee_token)}, fee_amount = ${sqlLiteral(r.fee_amount)}, fee_usd = ${sqlLiteral(r.fee_usd)}, ` +
        `detail_fetched_at = ${sqlLiteral(r.detail_fetched_at)} WHERE message_id = ${sqlLiteral(r.message_id)} AND source = 'backfill' AND detail_fetched_at IS NULL;`,
    );
    const { totals, breakdown } = rollupDay(day, rows, []);
    statements.push(`UPDATE daily_totals SET fee_usd = ${sqlLiteral(totals.fee_usd)}, fee_link_usd = ${sqlLiteral(linkFeeUsd(rows, day, isLinkFee))} WHERE day = ${sqlLiteral(day)};`);
    for (const b of breakdown) {
      if (!FEE_DIMS.has(b.dim)) continue;
      statements.push(`UPDATE daily_breakdown SET fee_usd = ${sqlLiteral(b.fee_usd)} WHERE day = ${sqlLiteral(day)} AND dim = ${sqlLiteral(b.dim)} AND key = ${sqlLiteral(b.key)};`);
    }
    await writer.add(statements);

    const withFee = rows.filter((r) => r.fee_token !== null);
    checks.push({
      day,
      messages: rows.length,
      withFee: withFee.length,
      priced: withFee.filter((r) => r.fee_usd !== null).length,
      feeUsd: totals.fee_usd,
      perMessage: totals.fee_usd === null || rows.length === 0 ? null : totals.fee_usd / rows.length,
    });
    for (const r of withFee) if (r.fee_usd !== null) result.largest.push({ id: r.message_id, day, usd: r.fee_usd, token: r.fee_token! });
    result.largest = result.largest.sort((a, b) => b.usd - a.usd).slice(0, 10);
    result.messagesUpdated += filled.length;
    result.days.push(day);
    log(`${day}: ${filled.length}/${rows.length} messages with details, fees $${(totals.fee_usd ?? 0).toFixed(2)}`);
  }

  const written = await writer.finish();
  result.batch = batch;
  result.sqlFiles = written.files;
  result.outlierDays = flagFeeOutliers([...(await earlierChecks(opts.dir, batch)).filter((c) => !result.days.includes(c.day)), ...checks]).filter((d) => result.days.includes(d));
  result.lowPricedDays = checks.filter((c) => c.withFee > 0 && c.priced / c.withFee < 0.9).map((c) => c.day);
  for (const day of result.days) state.built[day] = hashes.get(day)!;
  state.batches += 1;
  await mkdir(path.join(opts.dir, 'fees', 'checks'), { recursive: true });
  await writeFileAtomic(path.join(opts.dir, 'fees', 'checks', `${batch}.json`), `${JSON.stringify({ checks, outlierDays: result.outlierDays, lowPricedDays: result.lowPricedDays, largest: result.largest }, null, 2)}\n`);
  await writeFileAtomic(statePath, JSON.stringify(state));
  for (const day of result.outlierDays) log(`check: ${day} has fees per message more than 5x its neighbours' median`);
  for (const day of result.lowPricedDays) log(`check: ${day} has fee tokens without a price on more than 10% of its fee messages`);
  for (const l of result.largest) log(`largest fee: ${l.day} ${l.id} $${l.usd.toFixed(2)} (${l.token})`);
  return result;
}

/** The checks of every batch before this one, so a small rebuild batch still has neighbours to compare with. */
async function earlierChecks(dir: string, batch: string): Promise<FeeDayCheck[]> {
  const checksDir = path.join(dir, 'fees', 'checks');
  if (!existsSync(checksDir)) return [];
  const files = (await readdir(checksDir)).filter((f) => f.endsWith('.json') && f !== `${batch}.json`).sort();
  const perBatch = await Promise.all(files.map(async (f) => (JSON.parse(await readFile(path.join(checksDir, f), 'utf8')) as { checks: FeeDayCheck[] }).checks));
  const latest = new Map<string, FeeDayCheck>();
  for (const checks of perBatch) for (const c of checks) latest.set(c.day, c);
  return [...latest.values()];
}

/** Days whose fees per message are more than 5x the median of the days within a week of them; a sign of a price or decimals error. */
export function flagFeeOutliers(checks: FeeDayCheck[]): string[] {
  const dated = checks.filter((c) => c.perMessage !== null).sort((a, b) => (a.day < b.day ? -1 : 1));
  return dated
    .filter((c) => {
      const t = Date.parse(c.day);
      const near = dated.filter((o) => o !== c && Math.abs(Date.parse(o.day) - t) <= 7 * 86_400_000).map((o) => o.perMessage!);
      if (near.length < 3) return false;
      const sorted = near.sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)]!;
      return c.perMessage! > 5 * median;
    })
    .map((c) => c.day);
}

async function main(): Promise<void> {
  const deps: HttpDeps = {
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(60_000) }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    clock: () => Date.now(),
  };
  const result = await buildFees({ dir: '.backfill', prices: createPricesClient(deps), log: (line) => console.log(line) });
  console.log(JSON.stringify({ ...result, days: result.days.length }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
