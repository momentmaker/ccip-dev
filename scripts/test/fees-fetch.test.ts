import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { USER_AGENT } from '@ccip-dev/core';
import detailToken from '../../packages/core/test/fixtures/detail-token.json';
import { fetchDetail, parseAcceptFailures, recordFromBody, runFetch, runProbe, type FetchDeps } from '../backfill/fees/fetch';
import { appendRecords, listSealedDays, readSealedDay, sealDay } from '../backfill/fees/store';

type Reply = { status: number; body?: string; headers?: Record<string, string> };

function fakeApi(replies: Record<string, Reply | Reply[]>) {
  let t = Date.parse('2026-10-08T00:00:00Z');
  const calls: string[] = [];
  const userAgents: (string | null)[] = [];
  const deps: FetchDeps = {
    now: () => t,
    sleep: async (ms) => { t += ms; },
    fetch: (async (input: string | URL, init?: RequestInit) => {
      userAgents.push(new Headers(init?.headers).get('user-agent'));
      const id = decodeURIComponent(String(input).split('/messages/')[1]!);
      calls.push(id);
      const entry = replies[id] ?? { status: 404 };
      const reply = Array.isArray(entry) ? entry.shift() ?? { status: 404 } : entry;
      t += 50;
      return new Response(reply.body ?? '', { status: reply.status, headers: reply.headers });
    }) as typeof fetch,
  };
  return { deps, calls, userAgents, elapsed: () => t - Date.parse('2026-10-08T00:00:00Z') };
}

const detail = (id: string) => JSON.stringify({ ...detailToken, messageId: id });
const unknownShape = (id: string) => JSON.stringify({ ...detailToken, messageId: id, fees: { weird: 1 } });
const schemaFailure = JSON.stringify({ nope: true });

async function backfill(days: Record<string, string[]>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fees-fetch-'));
  for (const [day, ids] of Object.entries(days)) {
    const file = path.join(dir, 'archive', 'messages', day.slice(0, 4), day.slice(5, 7), `${day.slice(8, 10)}.jsonl.gz`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, gzipSync(ids.map((id) => JSON.stringify({ messageId: id })).join('\n') + '\n'));
  }
  return dir;
}

describe('fetchDetail', () => {
  it('retries a 200 whose body is not JSON', async () => {
    const { deps } = fakeApi({ '0x1': { status: 200, body: '<html>oops' } });
    expect((await fetchDetail(deps, 'https://api.test', '0x1')).kind).toBe('error');
  });

  it('reads a 429 with its Retry-After', async () => {
    const { deps } = fakeApi({ '0x1': { status: 429, headers: { 'retry-after': '7' } } });
    expect(await fetchDetail(deps, 'https://api.test', '0x1')).toEqual({ kind: 'throttled', retryAfterMs: 7000 });
  });

  it('sends the curl user agent', async () => {
    const { deps, userAgents } = fakeApi({ '0x1': { status: 200, body: detail('0x1') } });
    await fetchDetail(deps, 'https://api.test', '0x1');
    expect(userAgents).toEqual([USER_AGENT]);
  });

  it('maps 403 to refused, 410 to gone and 400 to a retryable error', async () => {
    const { deps } = fakeApi({ '0x1': { status: 403 }, '0x2': { status: 410 }, '0x3': { status: 400 } });
    const outcomes = [await fetchDetail(deps, 'https://api.test', '0x1'), await fetchDetail(deps, 'https://api.test', '0x2'), await fetchDetail(deps, 'https://api.test', '0x3')];
    expect(outcomes.map((o) => o.kind)).toEqual(['refused', 'gone', 'error']);
  });

  it('turns a rejected fetch into a network error', async () => {
    const deps: FetchDeps = { now: () => 0, sleep: async () => {}, fetch: (async () => { throw new Error('socket hang up'); }) as typeof fetch };
    expect(await fetchDetail(deps, 'https://api.test', '0x1')).toEqual({ kind: 'error', status: null, message: 'socket hang up' });
  });

  it('treats a 404 as gone', async () => {
    const { deps } = fakeApi({});
    expect(await fetchDetail(deps, 'https://api.test', '0x1')).toEqual({ kind: 'gone', status: 404 });
  });
});

describe('recordFromBody', () => {
  it('keeps the fee, version and tokens of a valid detail', () => {
    const { record } = recordFromBody('0x1', JSON.parse(detail('0x1')), 't');
    expect(record).toMatchObject({ id: '0x1', kind: 'ok', fee: { token: expect.any(String), amount: expect.any(String) }, feeShapeUnknown: false });
  });

  it('records a schema failure as a skip and keeps the raw body', () => {
    const out = recordFromBody('0x1', { nope: true }, 't');
    expect({ kind: out.record.kind, keepRaw: out.keepRaw }).toEqual({ kind: 'skip', keepRaw: true });
  });
});

describe('runFetch', () => {
  it('fetches days newest first and seals each one', async () => {
    // #given
    const dir = await backfill({ '2026-10-03': ['0xa'], '2026-10-04': ['0xb'] });
    const { deps, calls } = fakeApi({ '0xa': { status: 200, body: detail('0xa') }, '0xb': { status: 200, body: detail('0xb') } });

    // #when
    const state = await runFetch({ dir, deps, baseUrl: 'https://api.test' });

    // #then
    expect({ calls, done: state.done }).toEqual({ calls: ['0xb', '0xa'], done: ['2026-10-04', '2026-10-03'] });
  });

  it('resumes a day without fetching what its partial file already holds', async () => {
    // #given
    const dir = await backfill({ '2026-10-04': ['0xa', '0xb'] });
    const partial = path.join(dir, 'fees', 'details', '2026', '10', '04.partial.jsonl');
    await mkdir(path.dirname(partial), { recursive: true });
    await writeFile(partial, `${JSON.stringify(recordFromBody('0xa', JSON.parse(detail('0xa')), 't').record)}\n`);
    const { deps, calls } = fakeApi({ '0xb': { status: 200, body: detail('0xb') } });

    // #when
    await runFetch({ dir, deps, baseUrl: 'https://api.test' });

    // #then
    expect({ calls, sealed: (await readSealedDay(dir, '2026-10-04')).map((r) => r.id).sort() }).toEqual({ calls: ['0xb'], sealed: ['0xa', '0xb'] });
  });

  it('retries a throttled message after its pause and records a 404 as a skip', async () => {
    const dir = await backfill({ '2026-10-04': ['0xa', '0xgone'] });
    const { deps } = fakeApi({ '0xa': [{ status: 429, headers: { 'retry-after': '1' } }, { status: 200, body: detail('0xa') }] });
    await runFetch({ dir, deps, baseUrl: 'https://api.test' });
    const sealed = await readSealedDay(dir, '2026-10-04');
    expect(sealed.map((r) => `${r.id}:${r.kind}`).sort()).toEqual(['0xa:ok', '0xgone:skip']);
  });

  it('stops when nothing has been answered for fifteen minutes', async () => {
    const dir = await backfill({ '2026-10-04': Array.from({ length: 400 }, (_, i) => `0x${i}`) });
    const { deps } = fakeApi(Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`0x${i}`, { status: 429, headers: { 'retry-after': '30' } }])));
    await expect(runFetch({ dir, deps, baseUrl: 'https://api.test' })).rejects.toThrow(/answered nothing for 15 minutes/);
  });
});

describe('runProbe', () => {
  it('fetches the newest and oldest messages and summarizes versions without sealing days', async () => {
    const dir = await backfill({ '2023-07-06': ['0xold'], '2026-10-04': ['0xnew'] });
    const { deps } = fakeApi({ '0xold': { status: 200, body: detail('0xold') }, '0xnew': { status: 200, body: detail('0xnew') } });
    const summary = await runProbe({ dir, deps, baseUrl: 'https://api.test', count: 1 });
    expect({ fetched: summary.fetched, versions: Object.values(summary.versions).reduce((a, b) => a + b, 0) }).toEqual({ fetched: 2, versions: 2 });
    expect(JSON.parse(await readFile(path.join(dir, 'fees', 'probe.json'), 'utf8')).fetched).toBe(2);
    expect(await listSealedDays(dir)).toEqual([]);
  });
});

describe('runFetch crash recovery', () => {
  it('counts a day sealed just before a crash as done without fetching it again', async () => {
    // #given
    const dir = await backfill({ '2026-10-04': ['0xa'], '2026-10-03': ['0xb'] });
    const partial = path.join(dir, 'fees', 'details', '2026', '10', '04.partial.jsonl');
    await mkdir(path.dirname(partial), { recursive: true });
    await writeFile(partial, `${JSON.stringify(recordFromBody('0xa', JSON.parse(detail('0xa')), 't').record)}\n`);
    await sealDay(dir, '2026-10-04');
    const { deps, calls } = fakeApi({ '0xb': { status: 200, body: detail('0xb') } });

    // #when
    const state = await runFetch({ dir, deps, baseUrl: 'https://api.test' });

    // #then
    expect({ calls, done: [...state.done].sort(), fetched: state.fetched }).toEqual({ calls: ['0xb'], done: ['2026-10-03', '2026-10-04'], fetched: 2 });
  });
});

describe('runFetch outages and refusals', () => {
  it('stops instead of sealing days as skips when every request fails', async () => {
    // #given
    const ids = Array.from({ length: 10 }, (_, i) => `0x${i}`);
    const dir = await backfill(Object.fromEntries(['2026-10-01', '2026-10-02', '2026-10-03'].map((d) => [d, ids])));
    const { deps } = fakeApi(Object.fromEntries(ids.map((id) => [id, { status: 502 }])));

    // #when
    const run = runFetch({ dir, deps, baseUrl: 'https://api.test' });

    // #then
    await expect(run).rejects.toThrow(/answered nothing for 15 minutes/);
    expect(await listSealedDays(dir)).toEqual([]);
  });

  it('records a message that fails twice and then succeeds as ok', async () => {
    const dir = await backfill({ '2026-10-04': ['0xa'] });
    const { deps } = fakeApi({ '0xa': [{ status: 502 }, { status: 502 }, { status: 200, body: detail('0xa') }] });
    await runFetch({ dir, deps, baseUrl: 'https://api.test' });
    expect((await readSealedDay(dir, '2026-10-04')).map((r) => r.kind)).toEqual(['ok']);
  });

  it('skips a lone stubborn message once the canary shows the API is answering', async () => {
    // #given
    const dir = await backfill({ '2026-10-04': ['0xa', '0xb'] });
    const { deps } = fakeApi({ '0xa': { status: 200, body: detail('0xa') }, '0xb': { status: 502 } });

    // #when
    const state = await runFetch({ dir, deps, baseUrl: 'https://api.test' });

    // #then
    const skip = (await readSealedDay(dir, '2026-10-04')).find((r) => r.id === '0xb');
    expect({ done: state.done, skip }).toMatchObject({ done: ['2026-10-04'], skip: { kind: 'skip', reason: expect.stringMatching(/^failed \d+ times over/) } });
  });

  it('stops when the API goes down after some answers and the canary fails too', async () => {
    const dir = await backfill({ '2026-10-04': ['0xa', '0xb'] });
    const down = Array.from({ length: 50 }, () => ({ status: 502 }));
    const { deps } = fakeApi({ '0xa': [{ status: 200, body: detail('0xa') }, ...down], '0xb': { status: 502 } });
    await expect(runFetch({ dir, deps, baseUrl: 'https://api.test', stallMs: 60_000 })).rejects.toThrow(/answered nothing for 1 minutes/);
    expect(await listSealedDays(dir)).toEqual([]);
  });

  it('stops with the refusal when the API answers 403', async () => {
    const dir = await backfill({ '2026-10-04': ['0xa', '0xb'] });
    const { deps } = fakeApi({ '0xa': { status: 403 }, '0xb': { status: 403 } });
    await expect(runFetch({ dir, deps, baseUrl: 'https://api.test' })).rejects.toThrow(/refused the crawl with HTTP 403/);
    expect(await listSealedDays(dir)).toEqual([]);
  });

  it('stops every worker once one has thrown', async () => {
    const dir = await backfill({ '2026-10-04': Array.from({ length: 60 }, (_, i) => `0x${i}`) });
    const { deps, calls } = fakeApi(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`0x${i}`, { status: 403 }])));
    await expect(runFetch({ dir, deps, baseUrl: 'https://api.test' })).rejects.toThrow();
    expect(calls.length).toBeLessThanOrEqual(6);
  });

  it('names the day of an archive row without a message id', async () => {
    const dir = await backfill({ '2026-10-04': [] });
    const file = path.join(dir, 'archive', 'messages', '2026', '10', '04.jsonl.gz');
    await writeFile(file, gzipSync(`${JSON.stringify({ nope: 1 })}\n`));
    const { deps } = fakeApi({});
    await expect(runFetch({ dir, deps, baseUrl: 'https://api.test' })).rejects.toThrow(/2026-10-04/);
  });

  it('keeps the raw body of a schema failure under fees/unparsed', async () => {
    const dir = await backfill({ '2026-10-04': ['0xa'] });
    const { deps } = fakeApi({ '0xa': { status: 200, body: JSON.stringify({ nope: true }) } });
    await runFetch({ dir, deps, baseUrl: 'https://api.test' });
    expect(await readdir(path.join(dir, 'fees', 'unparsed'))).toEqual(['0xa.json']);
  });

  it('logs skips, unknown fee shapes and the version histogram for a day', async () => {
    const dir = await backfill({ '2026-10-04': ['0xa', '0xgone'] });
    const { deps } = fakeApi({ '0xa': { status: 200, body: detail('0xa') } });
    const lines: string[] = [];
    await runFetch({ dir, deps, baseUrl: 'https://api.test', log: (l) => lines.push(l) });
    expect(lines.at(-1)).toMatch(/^2026-10-04: 2 messages \(1 skipped\) · .* · unknown fee shapes 0 · /);
  });
});

/** A fake clock whose sleeps resolve in wake-time order, so the call times it records are the real schedule. */
async function runTimed<T>(start: () => Promise<T>, clock: { drain: () => Promise<void> }): Promise<T> {
  const run = start();
  let finished = false;
  const settled = run.then(() => { finished = true; }, () => { finished = true; });
  while (!finished) {
    await new Promise((resolve) => setImmediate(resolve));
    await clock.drain();
  }
  await settled;
  return run;
}

function timedApi(replies: Record<string, Reply> | ((id: string, at: number) => Reply)) {
  let t = Date.parse('2026-10-08T00:00:00Z');
  const pending: { at: number; wake: () => void }[] = [];
  const times: Record<string, number[]> = {};
  const deps: FetchDeps = {
    now: () => t,
    sleep: (ms) => new Promise<void>((wake) => { pending.push({ at: t + ms, wake }); }),
    fetch: (async (input: string | URL) => {
      const id = decodeURIComponent(String(input).split('/messages/')[1]!);
      (times[id] ??= []).push(t);
      const reply = typeof replies === 'function' ? replies(id, t) : replies[id] ?? { status: 404 };
      return new Response(reply.body ?? '', { status: reply.status });
    }) as typeof fetch,
  };
  const clock = {
    async drain() {
      pending.sort((a, b) => a.at - b.at);
      const next = pending.shift();
      if (!next) return;
      t = Math.max(t, next.at);
      next.wake();
    },
  };
  return { deps, times, clock };
}

describe('runFetch retry spacing and degradation', () => {
  it('retries a failing message after 5, 10, 20, 40 and 80 seconds', async () => {
    // #given
    const dir = await backfill({ '2026-10-04': ['0xb', '0xa'] });
    const { deps, times, clock } = timedApi({ '0xa': { status: 200, body: detail('0xa') }, '0xb': { status: 502 } });

    // #when
    await runTimed(() => runFetch({ dir, deps, baseUrl: 'https://api.test' }), clock);

    // #then
    const gaps = times['0xb']!.slice(1).map((at, i) => Math.round((at - times['0xb']![i]!) / 1000));
    expect(gaps).toEqual([5, 10, 20, 40, 80]);
  });

  it('refuses to seal a day in which most messages kept failing', async () => {
    // #given
    const ids = Array.from({ length: 10 }, (_, i) => `0x${i}`);
    const dir = await backfill({ '2026-10-04': ids });
    const { deps } = fakeApi(Object.fromEntries(ids.map((id, i) => [id, i < 2 ? { status: 200, body: detail(id) } : { status: 502 }])));

    // #when
    const run = runFetch({ dir, deps, baseUrl: 'https://api.test' });

    // #then
    await expect(run).rejects.toThrow(/2026-10-04: 8 of 10 messages kept failing \(failed \d+ times.*\); the CCIP API may be degraded\. Rerun later to retry them/);
    expect(await listSealedDays(dir)).toEqual([]);
  });

  it('refetches the failed messages of a stopped day on the next run and then seals it', async () => {
    // #given
    const ids = Array.from({ length: 10 }, (_, i) => `0x${i}`);
    const dir = await backfill({ '2026-10-04': ids });
    const degraded = fakeApi(Object.fromEntries(ids.map((id, i) => [id, i < 2 ? { status: 200, body: detail(id) } : { status: 502 }])));
    await expect(runFetch({ dir, deps: degraded.deps, baseUrl: 'https://api.test' })).rejects.toThrow(/degraded/);
    const healed = fakeApi(Object.fromEntries(ids.map((id) => [id, { status: 200, body: detail(id) }])));

    // #when
    await runFetch({ dir, deps: healed.deps, baseUrl: 'https://api.test' });

    // #then
    const sealed = await readSealedDay(dir, '2026-10-04');
    expect({ calls: healed.calls.sort(), kinds: [...new Set(sealed.map((r) => r.kind))], count: sealed.length }).toEqual({ calls: ids.slice(2).sort(), kinds: ['ok'], count: 10 });
  });

  it('counts the skips of a resumed partial file in the day line', async () => {
    const dir = await backfill({ '2026-10-04': ['0xg', '0xa'] });
    const partial = path.join(dir, 'fees', 'details', '2026', '10', '04.partial.jsonl');
    await mkdir(path.dirname(partial), { recursive: true });
    await writeFile(partial, `${JSON.stringify({ id: '0xg', kind: 'skip', fetchedAt: 't', status: 404, reason: 'HTTP 404' })}\n`);
    const { deps, calls } = fakeApi({ '0xa': { status: 200, body: detail('0xa') } });
    const lines: string[] = [];
    await runFetch({ dir, deps, baseUrl: 'https://api.test', log: (l) => lines.push(l) });
    expect({ calls, line: lines.at(-1) }).toMatchObject({ calls: ['0xa'], line: expect.stringContaining('2 messages (1 skipped)') });
  });

  it('reports a refused canary as a refusal, not a stall', async () => {
    const dir = await backfill({ '2026-10-04': ['0xa', '0xb'] });
    const down = Array.from({ length: 50 }, () => ({ status: 403 }));
    const { deps } = fakeApi({ '0xa': [{ status: 200, body: detail('0xa') }, ...down], '0xb': { status: 502 } });
    await expect(runFetch({ dir, deps, baseUrl: 'https://api.test', stallMs: 60_000 })).rejects.toThrow(/refused the crawl with HTTP 403/);
  });
});

describe('runFetch schema failures and unknown fee shapes', () => {
  it('stops with the degraded message when every response fails the schema', async () => {
    // #given
    const ids = Array.from({ length: 10 }, (_, i) => `0x${i}`);
    const dir = await backfill({ '2026-10-04': ids });
    const { deps } = fakeApi(Object.fromEntries(ids.map((id) => [id, { status: 200, body: schemaFailure }])));

    // #when
    const run = runFetch({ dir, deps, baseUrl: 'https://api.test' });

    // #then
    await expect(run).rejects.toThrow(/^2026-10-04: 10 of 10 messages kept failing \(schema: .*\); the CCIP API may be degraded/);
  });

  it('stops with the degraded message when most responses have an unknown fee shape', async () => {
    // #given
    const ids = Array.from({ length: 10 }, (_, i) => `0x${i}`);
    const dir = await backfill({ '2026-10-04': ids });
    const { deps } = fakeApi(Object.fromEntries(ids.map((id) => [id, { status: 200, body: unknownShape(id) }])));

    // #when
    const run = runFetch({ dir, deps, baseUrl: 'https://api.test' });

    // #then
    await expect(run).rejects.toThrow(/^2026-10-04: 10 of 10 messages kept failing \(unknown fee shape/);
  });

  it('refetches a schema failure from the partial file on resume', async () => {
    // #given
    const dir = await backfill({ '2026-10-04': ['0xa', '0xb'] });
    const partial = path.join(dir, 'fees', 'details', '2026', '10', '04.partial.jsonl');
    await mkdir(path.dirname(partial), { recursive: true });
    const earlier = [recordFromBody('0xa', { nope: true }, 't').record, recordFromBody('0xb', JSON.parse(detail('0xb')), 't').record];
    await writeFile(partial, earlier.map((r) => `${JSON.stringify(r)}\n`).join(''));
    const { deps, calls } = fakeApi({ '0xa': { status: 200, body: detail('0xa') } });

    // #when
    await runFetch({ dir, deps, baseUrl: 'https://api.test' });

    // #then
    expect(calls).toEqual(['0xa']);
  });

  it('keeps the unknown fee shapes of a resumed day without refetching them, and still counts them', async () => {
    // #given
    const ids = Array.from({ length: 6 }, (_, i) => `0x${i}`);
    const dir = await backfill({ '2026-10-04': ids });
    const partial = path.join(dir, 'fees', 'details', '2026', '10', '04.partial.jsonl');
    await mkdir(path.dirname(partial), { recursive: true });
    await writeFile(partial, ids.map((id) => `${JSON.stringify(recordFromBody(id, JSON.parse(unknownShape(id)), 't').record)}\n`).join(''));
    const { deps, calls } = fakeApi(Object.fromEntries(ids.map((id) => [id, { status: 200, body: detail(id) }])));

    // #when
    const run = runFetch({ dir, deps, baseUrl: 'https://api.test' });

    // #then
    await expect(run).rejects.toThrow(/6 of 6 messages kept failing \(unknown fee shape/);
    expect(calls).toEqual([]);
  });
});

describe('runFetch outages on small days', () => {
  it('keeps retrying a 5-message day through a 5-minute outage instead of sealing it as skips', async () => {
    // #given
    const ids = ['0x1', '0x2', '0x3', '0x4', '0x5'];
    const dir = await backfill({ '2026-10-04': ids });
    const start = Date.parse('2026-10-08T00:00:00Z');
    const { deps, clock } = timedApi((id, at) => (at - start < 300_000 ? { status: 502 } : { status: 200, body: detail(id) }));

    // #when
    await runTimed(() => runFetch({ dir, deps, baseUrl: 'https://api.test' }), clock);

    // #then
    expect([...new Set((await readSealedDay(dir, '2026-10-04')).map((r) => r.kind))]).toEqual(['ok']);
  });

  it('stops with the stall error when a small day never gets an answer', async () => {
    // #given
    const ids = ['0x1', '0x2', '0x3'];
    const dir = await backfill({ '2026-10-04': ids });
    const { deps, clock } = timedApi(() => ({ status: 502 }));

    // #when
    const run = runTimed(() => runFetch({ dir, deps, baseUrl: 'https://api.test' }), clock);

    // #then
    await expect(run).rejects.toThrow(/answered nothing for 15 minutes/);
  });

  it('gives up on a stubborn message after its retries while other messages are answered', async () => {
    // #given
    const dir = await backfill({ '2026-10-04': ['0xb', '0xa'] });
    const { deps, clock } = timedApi({ '0xa': { status: 200, body: detail('0xa') }, '0xb': { status: 502 } });

    // #when
    await runTimed(() => runFetch({ dir, deps, baseUrl: 'https://api.test' }), clock);

    // #then
    expect((await readSealedDay(dir, '2026-10-04')).find((r) => r.id === '0xb')).toMatchObject({ kind: 'skip', reason: expect.stringMatching(/^failed 6 times over 3 min: HTTP 502/) });
  });
});

describe('runFetch accepted failures', () => {
  it('seals a day over the failure ceiling and marks it done when the day is listed in acceptFailures', async () => {
    // #given
    const ids = Array.from({ length: 10 }, (_, i) => `0x${i}`);
    const dir = await backfill({ '2026-10-04': ids });
    const { deps } = fakeApi(Object.fromEntries(ids.map((id, i) => [id, i < 2 ? { status: 200, body: detail(id) } : { status: 502 }])));

    // #when
    const state = await runFetch({ dir, deps, baseUrl: 'https://api.test', acceptFailures: ['2026-10-04'] });

    // #then
    expect({ done: state.done, sealed: await listSealedDays(dir) }).toEqual({ done: ['2026-10-04'], sealed: ['2026-10-04'] });
  });

  it('reads every --accept-failures day from the command line', () => {
    expect(parseAcceptFailures(['--accept-failures', '2024-01-05', '--probe', '--accept-failures', '2024-01-06'])).toEqual(['2024-01-05', '2024-01-06']);
  });

  it('refuses an --accept-failures day not written as YYYY-MM-DD', () => {
    expect(() => parseAcceptFailures(['--accept-failures', '2024-1-5'])).toThrow('--accept-failures takes a day as YYYY-MM-DD, not 2024-1-5');
  });
});

describe('runFetch state file', () => {
  it('names state.json when it is corrupt', async () => {
    // #given
    const dir = await backfill({ '2026-10-04': ['0xa'] });
    const statePath = path.join(dir, 'fees', 'state.json');
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, '{"done": [');
    const { deps } = fakeApi({});

    // #when
    const run = runFetch({ dir, deps, baseUrl: 'https://api.test' });

    // #then
    await expect(run).rejects.toThrow(`${statePath}: `);
  });
});

describe('runFetch rerun after a ceiling stop', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `0x${i}`);
  const degradedReplies = () => Object.fromEntries(ids.map((id, i) => [id, i < 2 ? { status: 200, body: detail(id) } : { status: 502 }]));

  async function stoppedAtCeiling(): Promise<string> {
    const dir = await backfill({ '2026-10-04': ids });
    await expect(runFetch({ dir, deps: fakeApi(degradedReplies()).deps, baseUrl: 'https://api.test' })).rejects.toThrow(/kept failing/);
    return dir;
  }

  it('stops at the ceiling message again on a plain rerun, not the stall message', async () => {
    // #given
    const dir = await stoppedAtCeiling();

    // #when
    const rerun = runFetch({ dir, deps: fakeApi(degradedReplies()).deps, baseUrl: 'https://api.test' });

    // #then
    await expect(rerun).rejects.toThrow(/^2026-10-04: 8 of 10 messages kept failing \(failed \d+ times/);
  });

  it('seals the day on a rerun with acceptFailures, keeping the earlier ok records and the failed skips', async () => {
    // #given
    const dir = await stoppedAtCeiling();

    // #when
    const state = await runFetch({ dir, deps: fakeApi(degradedReplies()).deps, baseUrl: 'https://api.test', acceptFailures: ['2026-10-04'] });

    // #then
    const sealed = await readSealedDay(dir, '2026-10-04');
    const kinds = Object.fromEntries(sealed.map((r) => [r.id, r.kind === 'skip' && r.reason.startsWith('failed ') ? 'failed' : r.kind]));
    expect({ done: state.done, kinds }).toEqual({ done: ['2026-10-04'], kinds: Object.fromEntries(ids.map((id, i) => [id, i < 2 ? 'ok' : 'failed'])) });
  });

  it('uses an ok message of the newest sealed day as the canary when the day being fetched has none', async () => {
    // #given
    const failing = Array.from({ length: 6 }, (_, i) => `0xf${i}`);
    const dir = await backfill({ '2026-10-04': ['0xa'], '2026-10-03': failing });
    await appendRecords(dir, '2026-10-04', [recordFromBody('0xa', JSON.parse(detail('0xa')), 't').record]);
    await sealDay(dir, '2026-10-04');
    const { deps } = fakeApi({ '0xa': { status: 200, body: detail('0xa') }, ...Object.fromEntries(failing.map((id) => [id, { status: 502 }])) });

    // #when
    const state = await runFetch({ dir, deps, baseUrl: 'https://api.test', acceptFailures: ['2026-10-03'] });

    // #then
    expect([...state.done].sort()).toEqual(['2026-10-03', '2026-10-04']);
  });
});
