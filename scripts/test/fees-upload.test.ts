import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { feeUploadStarted, inFinalizeWindow, uploadFees } from '../backfill/fees/upload';

async function writeBatch(dir: string, batch: string, files: string[], buildId: string | null, content = 'SELECT 1;\n'): Promise<void> {
  const batchDir = path.join(dir, 'fees', 'sql', batch);
  await mkdir(batchDir, { recursive: true });
  for (const f of files) await writeFile(path.join(batchDir, f), content);
  if (buildId) await writeFile(path.join(batchDir, 'BUILD'), `${buildId}\n`);
}

async function feeSql(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fees-upload-'));
  await writeBatch(dir, 'B0001', ['00001.sql', '00002.sql'], 'id-1');
  await writeBatch(dir, 'B0002', ['00001.sql'], 'id-2');
  return dir;
}

function deps(at: string, fail?: string) {
  let t = Date.parse(at);
  const runs: string[] = [];
  return {
    runs,
    deps: {
      runSqlFile: (file: string) => {
        const rel = file.split(`${path.sep}sql${path.sep}`)[1]!.split(path.sep).join('/');
        if (rel === fail) throw new Error('wrangler failed');
        runs.push(rel);
      },
      now: () => t,
      sleep: async (ms: number) => { t += ms; },
    },
  };
}

describe('inFinalizeWindow', () => {
  it.each([
    ['2026-10-08T23:56:00Z', true],
    ['2026-10-09T00:20:00Z', true],
    ['2026-10-09T00:31:00Z', false],
    ['2026-10-09T06:00:00Z', true],
    ['2026-10-09T06:21:00Z', false],
    ['2026-10-09T12:00:00Z', false],
  ])('at %s is %s', (at, expected) => {
    expect(inFinalizeWindow(Date.parse(at))).toBe(expected);
  });
});

describe('uploadFees', () => {
  it('applies every batch file once, in order', async () => {
    // #given
    const dir = await feeSql();
    const d = deps('2026-10-09T12:00:00Z');

    // #when
    await uploadFees({ dir, deps: d.deps });
    await uploadFees({ dir, deps: d.deps });

    // #then
    expect(d.runs).toEqual(['B0001/00001.sql', 'B0001/00002.sql', 'B0002/00001.sql']);
  });

  it('waits out a finalize window before the next file', async () => {
    const dir = await feeSql();
    const d = deps('2026-10-09T00:10:00Z');
    await uploadFees({ dir, deps: d.deps });
    expect(new Date(d.deps.now()).toISOString() >= '2026-10-09T00:30:00.000Z').toBe(true);
  });

  it('leaves a file unapplied when wrangler fails, so a rerun applies it', async () => {
    const dir = await feeSql();
    await expect(uploadFees({ dir, deps: deps('2026-10-09T12:00:00Z', 'B0001/00002.sql').deps })).rejects.toThrow('wrangler failed');
    const rerun = deps('2026-10-09T12:00:00Z');
    await uploadFees({ dir, deps: rerun.deps });
    expect(rerun.runs).toEqual(['B0001/00002.sql', 'B0002/00001.sql']);
  });

  it('reports a started fee upload', async () => {
    const dir = await feeSql();
    const before = await feeUploadStarted(dir);
    await uploadFees({ dir, deps: deps('2026-10-09T12:00:00Z').deps });
    expect([before, await feeUploadStarted(dir)]).toEqual([false, true]);
  });

  it('skips a batch folder without a BUILD file and logs it', async () => {
    // #given
    const dir = await feeSql();
    await writeBatch(dir, 'B0003', ['00001.sql'], null);
    const d = deps('2026-10-09T12:00:00Z');
    const lines: string[] = [];

    // #when
    await uploadFees({ dir, deps: d.deps, log: (l) => lines.push(l) });

    // #then
    expect(d.runs).not.toContain('B0003/00001.sql');
    expect(lines).toContain('skipping B0003: no BUILD file (unfinished build)');
  });

  it('applies a rebuilt batch again once its BUILD id changes', async () => {
    // #given
    const dir = await feeSql();
    await uploadFees({ dir, deps: deps('2026-10-09T12:00:00Z').deps });
    await writeBatch(dir, 'B0002', ['00001.sql'], 'id-2b', 'SELECT 2;\n');
    const rerun = deps('2026-10-09T12:00:00Z');

    // #when
    await uploadFees({ dir, deps: rerun.deps });

    // #then
    expect(rerun.runs).toEqual(['B0002/00001.sql']);
  });

  it('does not reapply a batch whose BUILD id is unchanged', async () => {
    const dir = await feeSql();
    await uploadFees({ dir, deps: deps('2026-10-09T12:00:00Z').deps });
    const rerun = deps('2026-10-09T12:00:00Z');
    expect(await uploadFees({ dir, deps: rerun.deps })).toEqual({ applied: 0, skipped: 3 });
  });

  it('keys each applied file on its batch and build id', async () => {
    const dir = await feeSql();
    await uploadFees({ dir, deps: deps('2026-10-09T12:00:00Z').deps });
    const state = JSON.parse(await readFile(path.join(dir, 'fees', 'upload-state.json'), 'utf8')) as { applied: string[] };
    expect(state.applied).toEqual(['B0001@id-1/00001.sql', 'B0001@id-1/00002.sql', 'B0002@id-2/00001.sql']);
  });

  it('refuses a batch built before batches already uploaded, without applying anything', async () => {
    // #given
    const dir = await mkdtemp(path.join(tmpdir(), 'fees-upload-'));
    await writeBatch(dir, 'B0002', ['00001.sql'], 'id-2');
    await uploadFees({ dir, deps: deps('2026-10-09T12:00:00Z').deps });
    await writeBatch(dir, 'B0001', ['00001.sql'], 'id-1');
    const rerun = deps('2026-10-09T12:00:00Z');

    // #when
    const run = uploadFees({ dir, deps: rerun.deps });

    // #then
    await expect(run).rejects.toThrow('B0001 was built before batches already uploaded; delete it and rebuild its days instead (see docs/runbook.md, Fee backfill)');
    expect(rerun.runs).toEqual([]);
  });

  it('names upload-state.json when it is corrupt', async () => {
    // #given
    const dir = await feeSql();
    const statePath = path.join(dir, 'fees', 'upload-state.json');
    await writeFile(statePath, '{"applied": [');

    // #when, #then
    await expect(uploadFees({ dir, deps: deps('2026-10-09T12:00:00Z').deps })).rejects.toThrow(`${statePath}: `);
  });

  it('names upload-state.json when the original upload finds it corrupt', async () => {
    // #given
    const dir = await feeSql();
    const statePath = path.join(dir, 'fees', 'upload-state.json');
    await writeFile(statePath, '{"applied": [');

    // #when, #then
    await expect(feeUploadStarted(dir)).rejects.toThrow(`${statePath}: `);
  });
});
