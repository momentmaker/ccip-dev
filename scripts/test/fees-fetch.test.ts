import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import detailToken from '../../packages/core/test/fixtures/detail-token.json';
import { fetchDetail, recordFromBody, runFetch, runProbe, type FetchDeps } from '../backfill/fees/fetch';
import { readSealedDay, sealDay } from '../backfill/fees/store';

type Reply = { status: number; body?: string; headers?: Record<string, string> };

function fakeApi(replies: Record<string, Reply | Reply[]>) {
  let t = Date.parse('2026-10-08T00:00:00Z');
  const calls: string[] = [];
  const deps: FetchDeps = {
    now: () => t,
    sleep: async (ms) => { t += ms; },
    fetch: (async (input: string | URL) => {
      const id = decodeURIComponent(String(input).split('/messages/')[1]!);
      calls.push(id);
      const entry = replies[id] ?? { status: 404 };
      const reply = Array.isArray(entry) ? entry.shift() ?? { status: 404 } : entry;
      t += 50;
      return new Response(reply.body ?? '', { status: reply.status, headers: reply.headers });
    }) as typeof fetch,
  };
  return { deps, calls };
}

const detail = (id: string) => JSON.stringify({ ...detailToken, messageId: id });

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

  it('gives up on a message after six failures and records why', async () => {
    const dir = await backfill({ '2026-10-04': ['0xa', '0xb'] });
    const { deps } = fakeApi({ '0xa': { status: 200, body: detail('0xa') }, '0xb': { status: 502 } });
    await runFetch({ dir, deps, baseUrl: 'https://api.test' });
    const skip = (await readSealedDay(dir, '2026-10-04')).find((r) => r.id === '0xb');
    expect(skip).toMatchObject({ kind: 'skip', reason: expect.stringMatching(/^failed 6 times/) });
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
