import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CCIP_API_BASE, DetailMessage, issuePath, normalizeDetail, retryAfterMs, USER_AGENT } from '@ccip-dev/core';
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
  | { kind: 'refused'; status: number }
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

const RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 40_000, 80_000];
const REFUSED_STATUSES = new Set([401, 403, 451]);
const GONE_STATUSES = new Set([404, 410]);

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
    if (GONE_STATUSES.has(res.status)) return { kind: 'gone', status: res.status };
    if (REFUSED_STATUSES.has(res.status)) return { kind: 'refused', status: res.status };
    return { kind: 'error', status: res.status, message: `HTTP ${res.status}` };
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

const refusedError = (status: number) => new Error(`the CCIP API refused the crawl with HTTP ${status}; check access, then rerun to resume`);
const labelOf = (outcome: DetailOutcome) => (outcome.kind === 'ok' ? '200' : outcome.kind === 'throttled' ? '429' : String(outcome.status ?? 'network'));

/** Time of the last answer that proved the API alive; shared by a whole run so a day boundary cannot reset the stall clock. */
interface Heartbeat {
  at: number;
  lastOkId: string | null;
}

/**
 * Fetches every listed id with a shared pacer and a pool of workers.
 * A failed id waits 30 s, 60 s, 120 s ... before its next try, so the retries of one id outlast the stall window and an outage stops the run before any id is given up on.
 */
async function fetchAll(
  ids: string[],
  opts: Required<Pick<FetchOptions, 'deps' | 'baseUrl' | 'concurrency' | 'maxAttempts' | 'stallMs'>> & { dir: string; rate: AdaptiveRate; pacer: Pacer; heartbeat: Heartbeat },
  onRecords: (records: DetailRecord[]) => Promise<void>,
): Promise<{ statuses: Record<string, number> }> {
  const { deps, heartbeat } = opts;
  const queue = [...ids];
  const attempts = new Map<string, { failures: number; firstFailureAt: number; notBefore: number }>();
  const statuses: Record<string, number> = {};
  const buffer: DetailRecord[] = [];
  let flushing = Promise.resolve();
  let unresolved = ids.length;
  let stopped = false;
  const idle: (() => void)[] = [];
  const wakeIdle = () => idle.splice(0).forEach((wake) => wake());
  const flush = () => (flushing = flushing.then(() => onRecords(buffer.splice(0))));
  const iso = () => new Date(deps.now()).toISOString();
  const countStatus = (outcome: DetailOutcome) => {
    const label = labelOf(outcome);
    statuses[label] = (statuses[label] ?? 0) + 1;
  };
  let canary: Promise<void> | null = null;
  const stallError = () => new Error(`the CCIP API has answered nothing for ${Math.round(opts.stallMs / 60_000)} minutes; stopping, and a rerun resumes`);

  // One stubborn message must not look like an outage: ask for an id that already worked, and stop only if that fails too.
  const checkHealth = (): Promise<void> => {
    const known = heartbeat.lastOkId;
    if (known === null) throw stallError();
    canary ??= (async () => {
      try {
        await opts.pacer.acquire();
        const outcome = await fetchDetail(deps, opts.baseUrl, known);
        countStatus(outcome);
        if (outcome.kind === 'refused') throw refusedError(outcome.status);
        if (outcome.kind === 'throttled') opts.rate.record(outcome);
        else if (outcome.kind === 'error') opts.rate.record({ kind: 'error' });
        else opts.rate.record({ kind: 'ok', latencyMs: outcome.kind === 'ok' ? outcome.latencyMs : null });
        if (outcome.kind !== 'ok' && outcome.kind !== 'gone') throw stallError();
        heartbeat.at = deps.now();
      } finally {
        canary = null;
      }
    })();
    return canary;
  };
  const notBefore = (id: string) => attempts.get(id)?.notBefore ?? 0;

  const takeDue = (): { id: string } | { waitMs: number } | { idle: true } => {
    const now = deps.now();
    const index = queue.findIndex((id) => notBefore(id) <= now);
    if (index >= 0) return { id: queue.splice(index, 1)[0]! };
    if (queue.length === 0) return { idle: true };
    return { waitMs: Math.min(...queue.map(notBefore)) - now };
  };

  const settle = (record: DetailRecord) => {
    buffer.push(record);
    unresolved -= 1;
  };

  const step = async (id: string) => {
    await opts.pacer.acquire();
    const outcome = await fetchDetail(deps, opts.baseUrl, id);
    countStatus(outcome);
    if (outcome.kind === 'refused') throw refusedError(outcome.status);
    if (outcome.kind === 'ok') {
      opts.rate.record({ kind: 'ok', latencyMs: outcome.latencyMs });
      heartbeat.at = deps.now();
      heartbeat.lastOkId = id;
      const { record, keepRaw } = recordFromBody(id, outcome.body, iso());
      if (keepRaw) await saveUnparsed(opts.dir, id, outcome.body);
      settle(record);
    } else if (outcome.kind === 'gone') {
      opts.rate.record({ kind: 'ok', latencyMs: null });
      heartbeat.at = deps.now();
      settle({ id, kind: 'skip', fetchedAt: iso(), status: outcome.status, reason: `HTTP ${outcome.status}` });
    } else if (outcome.kind === 'throttled') {
      opts.rate.record(outcome);
      queue.unshift(id);
    } else {
      opts.rate.record({ kind: 'error' });
      const now = deps.now();
      const previous = attempts.get(id);
      const failures = (previous?.failures ?? 0) + 1;
      const firstFailureAt = previous?.firstFailureAt ?? now;
      if (failures >= opts.maxAttempts) {
        const minutes = Math.round((now - firstFailureAt) / 60_000);
        settle({ id, kind: 'skip', fetchedAt: iso(), status: outcome.status, reason: `failed ${failures} times over ${minutes} min: ${outcome.message}` });
      } else {
        attempts.set(id, { failures, firstFailureAt, notBefore: now + RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length) - 1]! });
        queue.push(id);
      }
    }
    if (buffer.length >= 50) await flush();
  };

  const worker = async () => {
    try {
      while (unresolved > 0 && !stopped) {
        if (deps.now() - heartbeat.at > opts.stallMs) await checkHealth();
        const next = takeDue();
        if ('id' in next) {
          try {
            await step(next.id);
          } finally {
            wakeIdle();
          }
        } else if ('waitMs' in next) await deps.sleep(Math.max(next.waitMs, 1));
        else await new Promise<void>((wake) => idle.push(wake));
      }
    } catch (err) {
      stopped = true;
      wakeIdle();
      throw err;
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
    heartbeat: { at: opts.deps.now(), lastOkId: null },
    pacer: new Pacer(rate, { now: opts.deps.now, sleep: opts.deps.sleep }),
  };
}

const isFailure = (r: DetailRecord) => r.kind === 'skip' && r.reason.startsWith('failed ');

function idsOf(raw: unknown[], day: string): string[] {
  return raw.map((m) => {
    const id = (m as { messageId?: unknown } | null)?.messageId;
    if (typeof id !== 'string' || id === '') throw new Error(`the archive for ${day} has a row without a messageId`);
    return id;
  });
}

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
  for (const day of days) perDay.set(day, idsOf(await readArchiveDay(opts.dir, day), day));
  const total = state.fetched + [...perDay.values()].reduce((n, ids) => n + ids.length, 0);
  const started = opts.deps.now();
  let fetchedThisRun = 0;

  for (const day of days) {
    const earlier = (await readPartial(opts.dir, day)).filter((r) => !isFailure(r));
    const known = new Set(earlier.map((r) => r.id));
    const dayIds = perDay.get(day)!;
    const ids = dayIds.filter((id) => !known.has(id));
    const skippedBefore = state.skipped;
    tally(earlier);
    const failures: string[] = [];
    await fetchAll(ids, s, async (records) => {
      tally(records);
      failures.push(...records.filter(isFailure).map((r) => (r as { reason: string }).reason));
      await appendRecords(opts.dir, day, records);
    });
    if (failures.length > Math.max(5, Math.ceil(0.05 * dayIds.length))) {
      throw new Error(`${day}: ${failures.length} of ${dayIds.length} messages kept failing (${failures[0]}); the CCIP API may be degraded. Rerun later to retry them`);
    }
    const count = await sealDay(opts.dir, day);
    state.fetched += count;
    fetchedThisRun += ids.length;
    state.done.push(day);
    await writeFileAtomic(statePath, JSON.stringify(state));
    const hours = (opts.deps.now() - started) / 3_600_000;
    const eta = fetchedThisRun > 0 ? ((total - state.fetched) * hours) / fetchedThisRun : null;
    log(`${day}: ${count} messages (${state.skipped - skippedBefore} skipped) · ${s.rate.rps} req/s · ${state.fetched}/${total} · unknown fee shapes ${state.unknownShapes} · ${histogram(state.versions)} · ETA ${eta === null ? '?' : eta.toFixed(1)}h`);
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
      out.push(...idsOf(await readArchiveDay(opts.dir, day), day).slice(0, count - out.length));
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

const histogram = (versions: Record<string, number>) =>
  Object.entries(versions).sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v}:${n}`).join(' ') || 'no versions';

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
