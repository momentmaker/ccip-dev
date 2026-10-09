import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPricesClient, feePriceAlias, sqlLiteral, valueFee, type ChainRef, type HttpDeps, type PricesClient } from '@ccip-dev/core';
import { PriceCache } from '../build';
import { writeFileAtomic } from '../crawl';

export interface Candidate {
  message_id: string;
  day: string;
  src_chain: string;
  chain_id: string;
  family: string;
  fee_token: string;
  fee_amount: string;
}

export interface Priced {
  id: string;
  day: string;
  chain: string;
  usd: number;
}

export interface Unpriced {
  id: string;
  day: string;
  reason: string;
}

export interface Subtotal {
  count: number;
  usd: number;
}

export interface RepriceResult {
  sqlFile: string | null;
  priced: Priced[];
  unpriced: Unpriced[];
  byDay: Record<string, Subtotal>;
  byChain: Record<string, Subtotal>;
  totalUsd: number;
}

const COLUMNS = ['message_id', 'day', 'src_chain', 'chain_id', 'family', 'fee_token', 'fee_amount'] as const;

/** Wrangler's `--json` output is one `{ results }` object per statement; a plain array of rows is accepted too. */
export function parseCandidates(json: unknown): Candidate[] {
  if (!Array.isArray(json)) throw new Error('candidates must be a JSON array');
  const rows = json.flatMap((item: unknown) => {
    const results = (item as { results?: unknown } | null)?.results;
    return Array.isArray(results) ? results : [item];
  });
  return rows.map((row: unknown, i) => {
    const record = (row ?? {}) as Record<string, unknown>;
    for (const column of COLUMNS) {
      if (typeof record[column] !== 'string') throw new Error(`candidate ${i} has no string ${column}`);
    }
    return Object.fromEntries(COLUMNS.map((c) => [c, record[c]])) as unknown as Candidate;
  });
}

function addTo(totals: Record<string, Subtotal>, key: string, usd: number): void {
  const t = (totals[key] ??= { count: 0, usd: 0 });
  t.count += 1;
  t.usd += usd;
}

export async function repriceLive(opts: { from: string; rows: Candidate[]; prices: PricesClient; outDir: string }): Promise<RepriceResult> {
  const chainOf = (r: Candidate): ChainRef => ({ selector: r.src_chain, name: '', chainId: r.chain_id, family: r.family });
  const aliased = opts.rows.flatMap((row) => {
    const alias = feePriceAlias({ selector: row.src_chain }, row.fee_token);
    return alias && row.day >= opts.from ? [{ row, alias }] : [];
  });
  const result: RepriceResult = { sqlFile: null, priced: [], unpriced: [], byDay: {}, byChain: {}, totalUsd: 0 };
  if (aliased.length === 0) return result;

  const lastDay = aliased.map((a) => a.row.day).sort().at(-1)!;
  const scratch = await mkdtemp(path.join(tmpdir(), 'reprice-live-cache-'));
  try {
    const cache = await PriceCache.open(opts.prices, path.join(scratch, 'cache.json'), opts.from, lastDay);
    await cache.ensure(aliased.map((a) => a.alias.key));
    const statements: string[] = [];
    for (const { row, alias } of aliased) {
      const usd = valueFee({ token: row.fee_token, amount: row.fee_amount }, chainOf(row), cache.lookupOn(row.day));
      if (usd === null) {
        result.unpriced.push({ id: row.message_id, day: row.day, reason: `no ${alias.key} price for ${row.day}` });
        continue;
      }
      result.priced.push({ id: row.message_id, day: row.day, chain: row.src_chain, usd });
      addTo(result.byDay, row.day, usd);
      addTo(result.byChain, row.src_chain, usd);
      result.totalUsd += usd;
      statements.push(
        `UPDATE messages SET fee_usd = ${sqlLiteral(usd)} WHERE message_id = ${sqlLiteral(row.message_id)} AND source = 'live' AND fee_usd IS NULL ` +
          `AND src_chain = ${sqlLiteral(row.src_chain)} AND fee_token = ${sqlLiteral(row.fee_token)} AND fee_amount = ${sqlLiteral(row.fee_amount)};`,
      );
    }
    if (statements.length > 0) {
      await mkdir(opts.outDir, { recursive: true });
      result.sqlFile = path.join(opts.outDir, `reprice-live-${opts.from}.sql`);
      await writeFileAtomic(result.sqlFile, `${statements.join('\n')}\n`);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return result;
}

function report(result: RepriceResult): string[] {
  const money = (t: Subtotal) => `${t.count} rows, $${t.usd.toFixed(2)}`;
  return [
    ...Object.entries(result.byDay).sort().map(([day, t]) => `day ${day}: ${money(t)}`),
    ...Object.entries(result.byChain).sort().map(([chain, t]) => `chain ${chain}: ${money(t)}`),
    `total: ${result.priced.length} rows, $${result.totalUsd.toFixed(2)}`,
    `unpriced: ${result.unpriced.length}`,
    ...result.unpriced.map((u) => `  ${u.id} (${u.day}): ${u.reason}`),
    result.sqlFile === null ? 'nothing to apply; no SQL file written' : `sql: ${result.sqlFile}`,
  ];
}

function argOf(flag: string): string {
  const i = process.argv.indexOf(flag);
  const value = i === -1 ? undefined : process.argv[i + 1];
  if (!value) throw new Error(`usage: pnpm backfill:fees:reprice-live --from <first live day> --in <candidates.json>; missing ${flag}`);
  return value;
}

async function main(): Promise<void> {
  const from = argOf('--from');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error(`--from must be a day like 2026-10-05, got ${from}`);
  const rows = parseCandidates(JSON.parse(await readFile(argOf('--in'), 'utf8')));
  const deps: HttpDeps = {
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(60_000) }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    clock: () => Date.now(),
  };
  const result = await repriceLive({ from, rows, prices: createPricesClient(deps), outDir: path.join('.backfill', 'fees') });
  for (const line of report(result)) console.log(line);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
