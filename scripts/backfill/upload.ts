import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AwsClient } from 'aws4fetch';
import { d1Query, wrangler } from '../lib/d1';
import { writeFileAtomic } from './crawl';
import { feeUploadStarted } from './fees/upload';

export interface UploadDeps {
  runSqlFile(file: string): void;
  signedFetch(url: string, init: RequestInit): Promise<Response>;
}

export interface UploadResult {
  sqlApplied: number;
  sqlSkipped: number;
  archivesUploaded: number;
  archivesSkipped: number;
}

interface UploadState {
  build: string;
  applied: string[];
  archived: string[];
}

export async function upload(opts: {
  dir: string;
  archiveBaseUrl: string;
  deps: UploadDeps;
  allowFeeWipe?: boolean;
  log?: (line: string) => void;
}): Promise<UploadResult> {
  const log = opts.log ?? (() => {});
  const result: UploadResult = { sqlApplied: 0, sqlSkipped: 0, archivesUploaded: 0, archivesSkipped: 0 };
  const statePath = path.join(opts.dir, 'upload-state.json');
  const buildPath = path.join(opts.dir, 'sql', 'BUILD');
  if (!existsSync(buildPath)) throw new Error(`${buildPath} is missing: run pnpm backfill:build first`);
  const build = (await readFile(buildPath, 'utf8')).trim();
  const saved = existsSync(statePath) ? (JSON.parse(await readFile(statePath, 'utf8')) as Partial<UploadState>) : null;
  const state: UploadState =
    saved?.build === build
      ? { build, applied: saved.applied ?? [], archived: saved.archived ?? [] }
      : { build, applied: [], archived: [] };
  if (saved && saved.build !== build) log(`new build ${build.slice(0, 12)}: re-applying every SQL file and re-uploading every archive`);

  const sqlFiles = (await readdir(path.join(opts.dir, 'sql'))).filter((f) => f.endsWith('.sql')).sort();
  const pending = sqlFiles.filter((f) => !state.applied.includes(f));
  if (pending.length > 0 && !opts.allowFeeWipe && (await feeUploadStarted(opts.dir))) {
    throw new Error(
      'The fee backfill has been uploaded, and this SQL would reset daily fee totals and breakdowns to NULL. ' +
        'Rerun with --allow-fee-wipe only if you then rerun pnpm backfill:fees:upload (see docs/runbook.md, "Fee backfill").',
    );
  }
  for (const file of sqlFiles) {
    if (state.applied.includes(file)) {
      result.sqlSkipped += 1;
      continue;
    }
    opts.deps.runSqlFile(path.join(opts.dir, 'sql', file));
    state.applied.push(file);
    await writeFileAtomic(statePath, JSON.stringify(state));
    result.sqlApplied += 1;
    log(`applied ${file}`);
  }

  const archiveDir = path.join(opts.dir, 'archive');
  const archives = (await readdir(archiveDir, { recursive: true }))
    .map((p) => p.split(path.sep).join('/'))
    .filter((p) => p.endsWith('.jsonl.gz'))
    .sort();
  for (const key of archives) {
    if (state.archived.includes(key)) {
      result.archivesSkipped += 1;
      continue;
    }
    const put = await opts.deps.signedFetch(`${opts.archiveBaseUrl}/${key}`, {
      method: 'PUT',
      body: await readFile(path.join(archiveDir, key)),
      headers: { 'content-type': 'application/gzip' },
    });
    if (!put.ok) throw new Error(`PUT ${key} returned HTTP ${put.status}`);
    state.archived.push(key);
    await writeFileAtomic(statePath, JSON.stringify(state));
    result.archivesUploaded += 1;
    log(`uploaded ${key}`);
  }
  return result;
}

async function main(): Promise<void> {
  const { CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, CF_BACKFILL_TOKEN } = process.env;
  if (!CLOUDFLARE_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('Set CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in .env (see docs/runbook.md)');
  }
  const [registry] = d1Query<{ n: number }>('SELECT COUNT(*) AS n FROM tokens');
  if (!registry || registry.n === 0) {
    throw new Error(
      "The Worker's first hourly run hasn't snapshotted the token registry yet; deploy the Worker and wait for the top of the hour.",
    );
  }
  const aws = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' });
  const result = await upload({
    dir: '.backfill',
    allowFeeWipe: process.argv.includes('--allow-fee-wipe'),
    archiveBaseUrl: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/ccip-dev-archive`,
    deps: {
      runSqlFile: (file) => {
        wrangler(['d1', 'execute', 'ccip-dev', '--remote', '--yes', `--file=${path.resolve(file)}`], { token: CF_BACKFILL_TOKEN, inherit: true });
      },
      signedFetch: (url, init) => aws.fetch(url, init),
    },
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
