import { existsSync } from 'node:fs';
import { appendFile, mkdir, open, readdir, readFile, rename, rm, truncate } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { writeFileAtomic } from '../crawl';

export type DetailRecord =
  | {
      id: string;
      kind: 'ok';
      fetchedAt: string;
      version: string | null;
      fee: { token: string; amount: string } | null;
      feeShapeUnknown: boolean;
      tokens: { token: string; amount: string }[];
    }
  | { id: string; kind: 'skip'; fetchedAt: string; status: number | null; reason: string };

const DAY_FILE = /^(\d{4})\/(\d{2})\/(\d{2})\.jsonl\.gz$/;

const dayFile = (root: string, day: string, suffix: string) => path.join(root, day.slice(0, 4), day.slice(5, 7), `${day.slice(8, 10)}${suffix}`);
const archiveRoot = (dir: string) => path.join(dir, 'archive', 'messages');
const detailsRoot = (dir: string) => path.join(dir, 'fees', 'details');

async function daysIn(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const files = (await readdir(root, { recursive: true })).map((p) => p.split(path.sep).join('/'));
  return files
    .map((p) => DAY_FILE.exec(p))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => `${m[1]}-${m[2]}-${m[3]}`)
    .sort()
    .reverse();
}

/** The sealed file of a day; the fee build hashes it to tell when a day changed. */
export const sealedFile = (dir: string, day: string) => dayFile(detailsRoot(dir), day, '.jsonl.gz');

export const listArchiveDays = (dir: string) => daysIn(archiveRoot(dir));
export const listSealedDays = (dir: string) => daysIn(detailsRoot(dir));

export async function readArchiveDay(dir: string, day: string): Promise<unknown[]> {
  return readLines(dayFile(archiveRoot(dir), day, '.jsonl.gz'), { gzipped: true, tolerateCutLastLine: false });
}

// Appends for a day must be serialized: a concurrent append would see an in-flight write as a torn tail.
export async function appendRecords(dir: string, day: string, records: DetailRecord[]): Promise<void> {
  if (records.length === 0) return;
  const file = dayFile(detailsRoot(dir), day, '.partial.jsonl');
  await mkdir(path.dirname(file), { recursive: true });
  await dropTornTail(file);
  await appendFile(file, records.map((r) => `${JSON.stringify(r)}\n`).join(''));
}

/** A crash mid-append leaves a last line without its newline; cut it so the next append starts on a clean line. */
async function dropTornTail(file: string): Promise<void> {
  if (!existsSync(file)) return;
  const text = await readFile(file, 'utf8');
  if (text.length === 0 || text.endsWith('\n')) return;
  await truncate(file, Buffer.byteLength(text.slice(0, text.lastIndexOf('\n') + 1)));
}

/** A day's records so far. A last line cut short by a crash is dropped, so its message is fetched again. */
export async function readPartial(dir: string, day: string): Promise<DetailRecord[]> {
  const file = dayFile(detailsRoot(dir), day, '.partial.jsonl');
  return existsSync(file) ? ((await readLines(file, { gzipped: false, tolerateCutLastLine: true })) as DetailRecord[]) : [];
}

export async function sealDay(dir: string, day: string): Promise<number> {
  const partial = dayFile(detailsRoot(dir), day, '.partial.jsonl');
  const sealed = dayFile(detailsRoot(dir), day, '.jsonl.gz');
  // A resumed run may seal a day it already sealed; with no partial left there is nothing new to write.
  if (!existsSync(partial) && existsSync(sealed)) return (await readSealedDay(dir, day)).length;

  const byId = new Map<string, DetailRecord>();
  for (const r of await readPartial(dir, day)) byId.set(r.id, r);
  await mkdir(path.dirname(sealed), { recursive: true });
  const tmp = `${sealed}.tmp`;
  const fh = await open(tmp, 'w');
  try {
    await fh.writeFile(gzipSync([...byId.values()].map((r) => `${JSON.stringify(r)}\n`).join('')));
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, sealed);
  await rm(partial, { force: true });
  return byId.size;
}

export async function readSealedDay(dir: string, day: string): Promise<DetailRecord[]> {
  return (await readLines(sealedFile(dir, day), { gzipped: true, tolerateCutLastLine: false })) as DetailRecord[];
}

export async function saveUnparsed(dir: string, id: string, body: unknown): Promise<void> {
  const file = path.join(dir, 'fees', 'unparsed', `${id}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, JSON.stringify(body));
}

/** A decode error alone (a zlib code, a line number) leaves the owner guessing which of ~1,200 day files to restore. */
async function readLines(file: string, opts: { gzipped: boolean; tolerateCutLastLine: boolean }): Promise<unknown[]> {
  const raw = await readFile(file);
  try {
    return parseLines((opts.gzipped ? gunzipSync(raw) : raw).toString('utf8'), opts.tolerateCutLastLine);
  } catch (err) {
    throw new Error(`${file}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

function parseLines(text: string, tolerateCutLastLine: boolean): unknown[] {
  const tornTail = tolerateCutLastLine && !text.endsWith('\n');
  const complete = tornTail ? text.slice(0, text.lastIndexOf('\n') + 1) : text;
  const lines = complete.split('\n').filter((l) => l.length > 0);
  return lines.flatMap((line, i) => {
    try {
      return [JSON.parse(line) as unknown];
    } catch (err) {
      throw new Error(`line ${i + 1} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
  });
}
