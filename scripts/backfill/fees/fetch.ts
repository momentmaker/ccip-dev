import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CCIP_API_BASE, DetailMessage, issuePath, normalizeDetail, USER_AGENT } from '@ccip-dev/core';
import { writeFileAtomic } from '../crawl';
import { AdaptiveRate, Pacer } from './rate';
import { appendRecords, listArchiveDays, listSealedDays, readArchiveDay, readPartial, readSealedDay, saveUnparsed, sealDay, type DetailRecord } from './store';

export interface FetchDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export type DetailOutcome =
  | { kind: 'ok'; body: unknown; latencyMs: number }
  | { kind: 'gone'; status: number }
  | { kind: 'throttled'; retryAfterMs: number | null }
  | { kind: 'error'; status: number | null; message: string };

export interface FetchOptions {
  dir: string;
  deps: FetchDeps;
  baseUrl?: string;
  concurrency?: number;
  maxAttempts?: number;
  stallMs?: number;
  rate?: AdaptiveRate;
  log?: (line: string) => void;
}

export interface FetchState {
  done: string[];
  fetched: number;
  skipped: number;
  versions: Record<string, number>;
  unknownShapes: number;
}

export interface ProbeSummary {
  fetched: number;
  versions: Record<string, number>;
  feeNull: number;
  unknownShapes: number;
  schemaFailures: number;
  statuses: Record<string, number>;
}

const MAX_RETRY_AFTER_MS = 30_000;

export async function fetchDetail(deps: FetchDeps, baseUrl: string, id: string): Promise<DetailOutcome> {
  const started = deps.now();
  let res: Response;
  try {
    res = await deps.fetch(`${baseUrl}/messages/${encodeURIComponent(id)}`, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
  } catch (err) {
    return { kind: 'error', status: null, message: errorText(err) };
  }
  if (!res.ok) {
    // The body is not used; reading it to the end releases the connection for the next request. The status already decides the outcome.
    await res.arrayBuffer().catch((err: unknown) => console.warn(`could not read the body of HTTP ${res.status} for ${id}: ${errorText(err)}`));
    if (res.status === 429) return { kind: 'throttled', retryAfterMs: retryAfterMs(res) };
    if (res.status >= 500) return { kind: 'error', status: res.status, message: `HTTP ${res.status}` };
    return { kind: 'gone', status: res.status };
  }
  try {
    return { kind: 'ok', body: await res.json(), latencyMs: deps.now() - started };
  } catch (err) {
    return { kind: 'error', status: res.status, message: `invalid JSON: ${errorText(err)}` };
  }
}

export function recordFromBody(id: string, body: unknown, fetchedAt: string): { record: DetailRecord; keepRaw: boolean } {
  const parsed = DetailMessage.safeParse(body);
  if (!parsed.success) return { record: { id, kind: 'skip', fetchedAt, status: 200, reason: `schema: ${issuePath(parsed.error)}` }, keepRaw: true };
  const { message, version, feeShapeUnknown } = normalizeDetail(parsed.data);
  return {
    record: { id, kind: 'ok', fetchedAt, version, fee: message.fee, feeShapeUnknown, tokens: message.tokens.map((t) => ({ token: t.token, amount: t.amount })) },
    keepRaw: feeShapeUnknown,
  };
}

/** Fetches every listed id with a shared pacer and a pool of workers; resolves with the records in the order they were answered. */
async function fetchAll(
  ids: string[],
  opts: Required<Pick<FetchOptions, 'deps' | 'baseUrl' | 'concurrency' | 'maxAttempts' | 'stallMs'>> & { dir: string; rate: AdaptiveRate; pacer: Pacer },
  onRecords: (records: DetailRecord[]) => Promise<void>,
): Promise<{ statuses: Record<string, number> }> {
  const queue = [...ids];
  const attempts = new Map<string, number>();
  const statuses: Record<string, number> = {};
  const buffer: DetailRecord[] = [];
  let flushing = Promise.resolve();
  let lastAnswer = opts.deps.now();
  const flush = () => (flushing = flushing.then(() => onRecords(buffer.splice(0))));
  const iso = () => new Date(opts.deps.now()).toISOString();

  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (opts.deps.now() - lastAnswer > opts.stallMs) throw new Error('the CCIP API has answered nothing for 15 minutes; stopping, and a rerun resumes');
      await opts.pacer.acquire();
      const outcome = await fetchDetail(opts.deps, opts.baseUrl, id);
      const label = outcome.kind === 'ok' ? '200' : outcome.kind === 'throttled' ? '429' : String(outcome.status ?? 'network');
      statuses[label] = (statuses[label] ?? 0) + 1;
      if (outcome.kind === 'ok') {
        opts.rate.record({ kind: 'ok', latencyMs: outcome.latencyMs });
        lastAnswer = opts.deps.now();
        const { record, keepRaw } = recordFromBody(id, outcome.body, iso());
        if (keepRaw) await saveUnparsed(opts.dir, id, outcome.body);
        buffer.push(record);
      } else if (outcome.kind === 'gone') {
        opts.rate.record({ kind: 'ok', latencyMs: null });
        lastAnswer = opts.deps.now();
        buffer.push({ id, kind: 'skip', fetchedAt: iso(), status: outcome.status, reason: `HTTP ${outcome.status}` });
      } else if (outcome.kind === 'throttled') {
        opts.rate.record(outcome);
        queue.unshift(id);
      } else {
        opts.rate.record({ kind: 'error' });
        const n = (attempts.get(id) ?? 0) + 1;
        attempts.set(id, n);
        if (n >= opts.maxAttempts) buffer.push({ id, kind: 'skip', fetchedAt: iso(), status: outcome.status, reason: `failed ${n} times: ${outcome.message}` });
        else queue.push(id);
      }
      if (buffer.length >= 50) await flush();
    }
  };

  await Promise.all(Array.from({ length: opts.concurrency }, worker));
  await flush();
  return { statuses };
}

function settings(opts: FetchOptions) {
  const rate = opts.rate ?? new AdaptiveRate(opts.deps.now, opts.log);
  return {
    dir: opts.dir,
    deps: opts.deps,
    baseUrl: opts.baseUrl ?? CCIP_API_BASE,
    concurrency: opts.concurrency ?? 6,
    maxAttempts: opts.maxAttempts ?? 6,
    stallMs: opts.stallMs ?? 15 * 60_000,
    rate,
    pacer: new Pacer(rate, { now: opts.deps.now, sleep: opts.deps.sleep }),
  };
}

const idsOf = (raw: unknown[]) => raw.map((m) => (m as { messageId: string }).messageId);

export async function runFetch(opts: FetchOptions): Promise<FetchState> {
  const log = opts.log ?? (() => {});
  const s = settings(opts);
  await mkdir(path.join(opts.dir, 'fees'), { recursive: true });
  const statePath = path.join(opts.dir, 'fees', 'state.json');
  const state: FetchState = existsSync(statePath)
    ? (JSON.parse(await readFile(statePath, 'utf8')) as FetchState)
    : { done: [], fetched: 0, skipped: 0, versions: {}, unknownShapes: 0 };
  const tally = (records: DetailRecord[]) => {
    for (const r of records) {
      if (r.kind === 'skip') state.skipped += 1;
      else {
        state.versions[r.version ?? 'none'] = (state.versions[r.version ?? 'none'] ?? 0) + 1;
        if (r.feeShapeUnknown) state.unknownShapes += 1;
      }
    }
  };

  // A crash between sealing a day and saving the state leaves the day sealed but not done.
  const sealedUnrecorded = (await listSealedDays(opts.dir)).filter((d) => !state.done.includes(d));
  for (const day of sealedUnrecorded) {
    const records = await readSealedDay(opts.dir, day);
    tally(records);
    state.fetched += records.length;
    state.done.push(day);
  }
  if (sealedUnrecorded.length > 0) await writeFileAtomic(statePath, JSON.stringify(state));

  const days = (await listArchiveDays(opts.dir)).filter((d) => !state.done.includes(d));
  const perDay = new Map<string, string[]>();
  for (const day of days) perDay.set(day, idsOf(await readArchiveDay(opts.dir, day)));
  const total = state.fetched + [...perDay.values()].reduce((n, ids) => n + ids.length, 0);
  const started = opts.deps.now();
  let fetchedThisRun = 0;

  for (const day of days) {
    const earlier = await readPartial(opts.dir, day);
    const known = new Set(earlier.map((r) => r.id));
    const ids = perDay.get(day)!.filter((id) => !known.has(id));
    tally(earlier);
    const skippedBefore = state.skipped;
    await fetchAll(ids, s, async (records) => {
      tally(records);
      await appendRecords(opts.dir, day, records);
    });
    const count = await sealDay(opts.dir, day);
    state.fetched += count;
    fetchedThisRun += ids.length;
    state.done.push(day);
    await writeFileAtomic(statePath, JSON.stringify(state));
    const hours = (opts.deps.now() - started) / 3_600_000;
    const eta = fetchedThisRun > 0 ? ((total - state.fetched) * hours) / fetchedThisRun : null;
    log(`${day}: ${count} messages (${state.skipped - skippedBefore} skipped) · ${s.rate.rps} req/s · ${state.fetched}/${total} · ETA ${eta === null ? '?' : eta.toFixed(1)}h`);
  }
  return state;
}

export async function runProbe(opts: FetchOptions & { count?: number }): Promise<ProbeSummary> {
  const count = opts.count ?? 2000;
  await mkdir(path.join(opts.dir, 'fees'), { recursive: true });
  const s = settings(opts);
  const days = await listArchiveDays(opts.dir);
  const take = async (ordered: string[]) => {
    const out: string[] = [];
    for (const day of ordered) {
      if (out.length >= count) break;
      out.push(...idsOf(await readArchiveDay(opts.dir, day)).slice(0, count - out.length));
    }
    return out;
  };
  const ids = [...new Set([...(await take(days)), ...(await take([...days].reverse()))])];
  const summary: ProbeSummary = { fetched: 0, versions: {}, feeNull: 0, unknownShapes: 0, schemaFailures: 0, statuses: {} };
  const { statuses } = await fetchAll(ids, s, async (records) => {
    for (const r of records) {
      summary.fetched += 1;
      if (r.kind === 'skip') {
        if (r.reason.startsWith('schema:')) summary.schemaFailures += 1;
        continue;
      }
      summary.versions[r.version ?? 'none'] = (summary.versions[r.version ?? 'none'] ?? 0) + 1;
      if (r.fee === null) summary.feeNull += 1;
      if (r.feeShapeUnknown) summary.unknownShapes += 1;
    }
  });
  summary.statuses = statuses;
  await writeFileAtomic(path.join(opts.dir, 'fees', 'probe.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get('retry-after');
  if (header === null || header.trim() === '') return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : null;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  const deps: FetchDeps = {
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
  const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);
  const result = process.argv.includes('--probe') ? await runProbe({ dir: '.backfill', deps, log }) : await runFetch({ dir: '.backfill', deps, log });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
