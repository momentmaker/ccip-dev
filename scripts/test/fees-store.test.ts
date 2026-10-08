import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { appendRecords, listArchiveDays, listSealedDays, readArchiveDay, readPartial, readSealedDay, sealDay, type DetailRecord } from '../backfill/fees/store';

async function backfill(days: Record<string, unknown[]>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fees-store-'));
  for (const [day, messages] of Object.entries(days)) {
    const file = path.join(dir, 'archive', 'messages', day.slice(0, 4), day.slice(5, 7), `${day.slice(8, 10)}.jsonl.gz`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, gzipSync(messages.map((m) => JSON.stringify(m)).join('\n') + '\n'));
  }
  return dir;
}

const ok = (id: string): DetailRecord => ({ id, kind: 'ok', fetchedAt: '2026-10-08T00:00:00.000Z', version: '1.6.0', fee: { token: '0xabc', amount: '1' }, feeShapeUnknown: false, tokens: [] });

describe('archive', () => {
  it('lists archive days newest first', async () => {
    const dir = await backfill({ '2023-07-06': [], '2026-10-04': [], '2025-01-31': [] });
    expect(await listArchiveDays(dir)).toEqual(['2026-10-04', '2025-01-31', '2023-07-06']);
  });

  it("reads a day's raw messages", async () => {
    const dir = await backfill({ '2026-10-04': [{ messageId: '0x1' }, { messageId: '0x2' }] });
    expect(await readArchiveDay(dir, '2026-10-04')).toEqual([{ messageId: '0x1' }, { messageId: '0x2' }]);
  });

  it('names the archive file whose gzip is corrupt', async () => {
    // #given
    const dir = await backfill({});
    const file = path.join(dir, 'archive', 'messages', '2026', '10', '04.jsonl.gz');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'not gzip');

    // #when / #then
    await expect(readArchiveDay(dir, '2026-10-04')).rejects.toThrow(`${file}: incorrect header check`);
  });
});

describe('detail records', () => {
  it('keeps appended records in the partial file until the day is sealed', async () => {
    // #given
    const dir = await backfill({});

    // #when
    await appendRecords(dir, '2026-10-04', [ok('0x1')]);
    await appendRecords(dir, '2026-10-04', [ok('0x2')]);

    // #then
    expect((await readPartial(dir, '2026-10-04')).map((r) => r.id)).toEqual(['0x1', '0x2']);
  });

  it('drops a last line cut short by a crash, so that message is fetched again', async () => {
    // #given
    const dir = await backfill({});
    await appendRecords(dir, '2026-10-04', [ok('0x1')]);
    const partial = path.join(dir, 'fees', 'details', '2026', '10', '04.partial.jsonl');
    await writeFile(partial, `${await readFile(partial, 'utf8')}{"id":"0x2","kind":"o`);

    // #when
    const records = await readPartial(dir, '2026-10-04');

    // #then
    expect(records.map((r) => r.id)).toEqual(['0x1']);
  });

  it('seals a day into one gzipped file, keeps the last record per id, and removes the partial', async () => {
    // #given
    const dir = await backfill({});
    await appendRecords(dir, '2026-10-04', [ok('0x1'), { id: '0x2', kind: 'skip', fetchedAt: 't', status: 404, reason: 'HTTP 404' }, ok('0x2')]);

    // #when
    const count = await sealDay(dir, '2026-10-04');

    // #then
    expect({
      count,
      ids: (await readSealedDay(dir, '2026-10-04')).map((r) => `${r.id}:${r.kind}`),
      partialLeft: existsSync(path.join(dir, 'fees', 'details', '2026', '10', '04.partial.jsonl')),
      sealed: await listSealedDays(dir),
    }).toEqual({ count: 2, ids: ['0x1:ok', '0x2:ok'], partialLeft: false, sealed: ['2026-10-04'] });
  });

  it('seals an empty day', async () => {
    const dir = await backfill({});
    expect(await sealDay(dir, '2026-10-03')).toBe(0);
  });

  it('keeps an already sealed day intact when a resumed run seals it again without a partial file', async () => {
    // #given
    const dir = await backfill({});
    await appendRecords(dir, '2026-10-04', [ok('0x1'), ok('0x2')]);
    await sealDay(dir, '2026-10-04');

    // #when
    const count = await sealDay(dir, '2026-10-04');

    // #then
    expect({ count, ids: (await readSealedDay(dir, '2026-10-04')).map((r) => r.id) }).toEqual({ count: 2, ids: ['0x1', '0x2'] });
  });

  it('appends after a torn tail without gluing onto the fragment', async () => {
    // #given
    const dir = await backfill({});
    await appendRecords(dir, '2026-10-04', [ok('0x1'), ok('0x2')]);
    const partial = path.join(dir, 'fees', 'details', '2026', '10', '04.partial.jsonl');
    await writeFile(partial, `${await readFile(partial, 'utf8')}{"id":"0x3","kind":"o`);

    // #when
    await appendRecords(dir, '2026-10-04', [ok('0x3'), ok('0x4')]);

    // #then
    expect((await readPartial(dir, '2026-10-04')).map((r) => r.id)).toEqual(['0x1', '0x2', '0x3', '0x4']);
  });

  it('throws on a corrupt line in the middle of a partial file', async () => {
    // #given
    const dir = await backfill({});
    const partial = path.join(dir, 'fees', 'details', '2026', '10', '04.partial.jsonl');
    await mkdir(path.dirname(partial), { recursive: true });
    await writeFile(partial, `${JSON.stringify(ok('0x1'))}\nnot json\n${JSON.stringify(ok('0x2'))}\n`);

    // #when / #then
    await expect(readPartial(dir, '2026-10-04')).rejects.toThrow('line 2');
  });

  it('throws on a corrupt last line that ends in a newline', async () => {
    // #given
    const dir = await backfill({});
    const partial = path.join(dir, 'fees', 'details', '2026', '10', '04.partial.jsonl');
    await mkdir(path.dirname(partial), { recursive: true });
    await writeFile(partial, `${JSON.stringify(ok('0x1'))}\nnot json\n`);

    // #when / #then
    await expect(readPartial(dir, '2026-10-04')).rejects.toThrow('line 2');
  });

  it('treats a complete but unterminated last line as torn, so that message is fetched again', async () => {
    // #given
    const dir = await backfill({});
    const partial = path.join(dir, 'fees', 'details', '2026', '10', '04.partial.jsonl');
    await mkdir(path.dirname(partial), { recursive: true });
    await writeFile(partial, `${JSON.stringify(ok('0x1'))}\n${JSON.stringify(ok('0x2'))}`);

    // #when
    const before = (await readPartial(dir, '2026-10-04')).map((r) => r.id);
    await appendRecords(dir, '2026-10-04', [ok('0x3')]);
    const afterAppend = (await readPartial(dir, '2026-10-04')).map((r) => r.id);
    await appendRecords(dir, '2026-10-04', [ok('0x2')]);
    const afterRefetch = (await readPartial(dir, '2026-10-04')).map((r) => r.id);

    // #then
    expect({ before, afterAppend, afterRefetch }).toEqual({ before: ['0x1'], afterAppend: ['0x1', '0x3'], afterRefetch: ['0x1', '0x3', '0x2'] });
  });

  it('names the sealed file that holds a line of bad JSON', async () => {
    // #given
    const dir = await backfill({});
    const sealed = path.join(dir, 'fees', 'details', '2026', '10', '04.jsonl.gz');
    await mkdir(path.dirname(sealed), { recursive: true });
    await writeFile(sealed, gzipSync(`${JSON.stringify(ok('0x1'))}\nnot json\n`));

    // #when / #then
    await expect(readSealedDay(dir, '2026-10-04')).rejects.toThrow(`${sealed}: line 2 is not valid JSON`);
  });

  it('names the partial file that holds a line of bad JSON', async () => {
    // #given
    const dir = await backfill({});
    const partial = path.join(dir, 'fees', 'details', '2026', '10', '04.partial.jsonl');
    await mkdir(path.dirname(partial), { recursive: true });
    await writeFile(partial, `not json\n${JSON.stringify(ok('0x1'))}\n`);

    // #when / #then
    await expect(readPartial(dir, '2026-10-04')).rejects.toThrow(`${partial}: line 1 is not valid JSON`);
  });

  it('keeps the original read error as the cause', async () => {
    // #given
    const dir = await backfill({});
    const file = path.join(dir, 'archive', 'messages', '2026', '10', '04.jsonl.gz');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'not gzip');

    // #when
    const err = await readArchiveDay(dir, '2026-10-04').catch((e: unknown) => e);

    // #then
    expect((err as Error).cause).toMatchObject({ code: 'Z_DATA_ERROR' });
  });

  it('reads a partial file holding only a fragment as empty, and appends cleanly after it', async () => {
    // #given
    const dir = await backfill({});
    const partial = path.join(dir, 'fees', 'details', '2026', '10', '04.partial.jsonl');
    await mkdir(path.dirname(partial), { recursive: true });
    await writeFile(partial, '{"id":"0x1","kind":"o');

    // #when
    const before = await readPartial(dir, '2026-10-04');
    await appendRecords(dir, '2026-10-04', [ok('0x2')]);

    // #then
    expect({ before, after: (await readPartial(dir, '2026-10-04')).map((r) => r.id) }).toEqual({ before: [], after: ['0x2'] });
  });
});
