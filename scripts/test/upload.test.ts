import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { upload } from '../backfill/upload';

const BASE = 'https://r2.test/ccip-dev-archive';

async function backfillDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'upload-'));
  await mkdir(path.join(dir, 'sql'));
  await writeFile(path.join(dir, 'sql', '00001.sql'), 'SELECT 1;\n');
  await writeFile(path.join(dir, 'sql', '00002.sql'), 'SELECT 2;\n');
  await writeFile(path.join(dir, 'sql', 'BUILD'), 'build-1\n');
  await mkdir(path.join(dir, 'archive', 'messages', '2026', '10'), { recursive: true });
  await writeFile(path.join(dir, 'archive', 'messages', '2026', '10', '05.jsonl.gz'), 'a');
  await writeFile(path.join(dir, 'archive', 'messages', '2026', '10', '06.jsonl.gz'), 'b');
  return dir;
}

function deps() {
  const sqlRuns: string[] = [];
  const requests: string[] = [];
  return {
    sqlRuns,
    requests,
    deps: {
      runSqlFile: (file: string) => {
        sqlRuns.push(path.basename(file));
      },
      signedFetch: async (url: string, init: RequestInit) => {
        requests.push(`${init.method} ${url.replace(`${BASE}/`, '')}`);
        return new Response(null, { status: 200 });
      },
    },
  };
}

describe('upload', () => {
  it('applies SQL files in order, PUTs every archive and resumes without redoing either', async () => {
    const dir = await backfillDir();
    const first = deps();
    const result = await upload({ dir, archiveBaseUrl: BASE, deps: first.deps });
    expect(first.sqlRuns).toEqual(['00001.sql', '00002.sql']);
    expect(first.requests).toEqual(['PUT messages/2026/10/05.jsonl.gz', 'PUT messages/2026/10/06.jsonl.gz']);
    expect(result).toEqual({ sqlApplied: 2, sqlSkipped: 0, archivesUploaded: 2, archivesSkipped: 0 });

    const second = deps();
    expect(await upload({ dir, archiveBaseUrl: BASE, deps: second.deps })).toEqual({
      sqlApplied: 0, sqlSkipped: 2, archivesUploaded: 0, archivesSkipped: 2,
    });
    expect(second.sqlRuns).toEqual([]);
    expect(second.requests).toEqual([]);
  });

  it('re-applies every SQL file and replaces every archive after a rebuild changes the build id', async () => {
    const dir = await backfillDir();
    await upload({ dir, archiveBaseUrl: BASE, deps: deps().deps });
    await writeFile(path.join(dir, 'sql', 'BUILD'), 'build-2\n');
    const rerun = deps();
    expect(await upload({ dir, archiveBaseUrl: BASE, deps: rerun.deps })).toEqual({
      sqlApplied: 2, sqlSkipped: 0, archivesUploaded: 2, archivesSkipped: 0,
    });
    expect(rerun.sqlRuns).toEqual(['00001.sql', '00002.sql']);
    expect(rerun.requests).toEqual(['PUT messages/2026/10/05.jsonl.gz', 'PUT messages/2026/10/06.jsonl.gz']);
  });

  it('resumes an interrupted archive upload without repeating the PUTs that succeeded', async () => {
    const dir = await backfillDir();
    let puts = 0;
    const flaky = {
      runSqlFile: () => {},
      signedFetch: async () => new Response(null, { status: ++puts === 1 ? 200 : 500 }),
    };
    await expect(upload({ dir, archiveBaseUrl: BASE, deps: flaky })).rejects.toThrow('PUT messages/2026/10/06.jsonl.gz returned HTTP 500');
    const resumed = deps();
    expect(await upload({ dir, archiveBaseUrl: BASE, deps: resumed.deps })).toMatchObject({ archivesUploaded: 1, archivesSkipped: 1 });
    expect(resumed.requests).toEqual(['PUT messages/2026/10/06.jsonl.gz']);
  });

  it('replaces upload-state.json through a temp file, so a failed state write leaves the previous state whole', async () => {
    const dir = await backfillDir();
    await upload({ dir, archiveBaseUrl: BASE, deps: deps().deps });
    const statePath = path.join(dir, 'upload-state.json');
    const before = await readFile(statePath, 'utf8');
    await writeFile(path.join(dir, 'sql', 'BUILD'), 'build-2\n');
    await mkdir(`${statePath}.tmp`);
    await expect(upload({ dir, archiveBaseUrl: BASE, deps: deps().deps })).rejects.toThrow('EISDIR');
    expect(await readFile(statePath, 'utf8')).toBe(before);
  });

  it('stops with the file name when an upload fails', async () => {
    const dir = await backfillDir();
    const failing = {
      runSqlFile: () => {},
      signedFetch: async () => new Response(null, { status: 403 }),
    };
    await expect(upload({ dir, archiveBaseUrl: BASE, deps: failing })).rejects.toThrow('PUT messages/2026/10/05.jsonl.gz returned HTTP 403');
  });
});
