import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { wrangler } from '../../lib/d1';
import { writeFileAtomic } from '../crawl';
import { readStateFile } from './store';

export interface FeeUploadDeps {
  runSqlFile(file: string): void;
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** The Worker finalizes at 00:10 and 06:00 UTC; D1 is unavailable while a file imports, so no file starts near either run. */
export function inFinalizeWindow(nowMs: number): boolean {
  const d = new Date(nowMs);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return m >= 23 * 60 + 55 || m < 30 || (m >= 5 * 60 + 50 && m < 6 * 60 + 20);
}

const statePath = (dir: string) => path.join(dir, 'fees', 'upload-state.json');
const batchOf = (appliedKey: string) => appliedKey.slice(0, appliedKey.indexOf('@'));

export async function feeUploadStarted(dir: string): Promise<boolean> {
  return ((await readStateFile<{ applied?: string[] }>(statePath(dir), {})).applied ?? []).length > 0;
}

export async function uploadFees(opts: { dir: string; deps: FeeUploadDeps; log?: (line: string) => void }): Promise<{ applied: number; skipped: number }> {
  const log = opts.log ?? (() => {});
  const sqlDir = path.join(opts.dir, 'fees', 'sql');
  const state = await readStateFile<{ applied: string[] }>(statePath(opts.dir), { applied: [] });
  const entries = (await readdir(sqlDir, { recursive: true })).map((p) => p.split(path.sep).join('/'));
  const batches = [...new Set(entries.map((p) => p.split('/')[0]!).filter((b) => /^B\d{4}$/.test(b)))].sort();
  const plan: { batch: string; files: { file: string; key: string }[] }[] = [];
  for (const batch of batches) {
    const buildPath = path.join(sqlDir, batch, 'BUILD');
    if (!existsSync(buildPath)) {
      log(`skipping ${batch}: no BUILD file (unfinished build)`);
      continue;
    }
    const buildId = (await readFile(buildPath, 'utf8')).trim();
    const files = entries
      .filter((p) => new RegExp(`^${batch}/\\d{5}\\.sql$`).test(p))
      .map((p) => p.slice(batch.length + 1))
      .sort();
    plan.push({ batch, files: files.map((file) => ({ file, key: `${batch}@${buildId}/${file}` })) });
  }

  // A message takes its fee from the first batch that fills it, but a day's rollup from the last one applied. An older batch applied
  // after newer ones would leave the two disagreeing, so it must be rebuilt as a new, higher batch instead.
  const lastUploaded = state.applied.map(batchOf).sort().at(-1);
  const stale = plan.find((b) => lastUploaded !== undefined && b.batch < lastUploaded && b.files.some((f) => !state.applied.includes(f.key)));
  if (stale) throw new Error(`${stale.batch} was built before batches already uploaded; delete it and rebuild its days instead (see docs/runbook.md, Fee backfill)`);

  const result = { applied: 0, skipped: 0 };
  for (const { batch, files } of plan) {
    for (const { file, key } of files) {
      if (state.applied.includes(key)) {
        result.skipped += 1;
        continue;
      }
      if (inFinalizeWindow(opts.deps.now())) log('waiting for the Worker finalize window to pass');
      while (inFinalizeWindow(opts.deps.now())) await opts.deps.sleep(60_000);
      opts.deps.runSqlFile(path.join(sqlDir, batch, file));
      state.applied.push(key);
      await writeFileAtomic(statePath(opts.dir), JSON.stringify(state));
      result.applied += 1;
      log(`applied ${key}`);
    }
  }
  return result;
}

async function main(): Promise<void> {
  const result = await uploadFees({
    dir: '.backfill',
    deps: {
      runSqlFile: (file) => {
        wrangler(['d1', 'execute', 'ccip-dev', '--remote', '--yes', `--file=${path.resolve(file)}`], { token: process.env.CF_BACKFILL_TOKEN, inherit: true });
      },
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
