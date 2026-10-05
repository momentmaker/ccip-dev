import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UpstreamHttpError, UpstreamSchemaError } from '@ccip-dev/core';
import { fakeCcip, listMessage } from '@ccip-dev/core/testing';
import { describe, expect, it } from 'vitest';
import { crawl, topUp } from '../backfill/crawl';

const msgs = [
  listMessage({ id: 'm4', sendTs: '2026-10-05T10:00:00.000Z' }),
  listMessage({ id: 'm3', sendTs: '2026-10-05T09:00:00.000Z' }),
  listMessage({ id: 'm2', sendTs: '2026-10-04T23:00:00.000Z' }),
  listMessage({ id: 'm1', sendTs: '2026-10-04T01:00:00.000Z' }),
];
const tempDir = () => mkdtemp(path.join(tmpdir(), 'crawl-'));
const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const noSleep = async () => {};

describe('crawl', () => {
  it('writes every page and a coverage report, then marks itself complete', async () => {
    const dir = await tempDir();
    const state = await crawl({ dir, client: fakeCcip({ messages: msgs }), limit: 2, sleep: noSleep });
    expect(state.done).toBe(true);
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(await readdir(path.join(dir, 'pages'))).toEqual(['00000.json', '00001.json']);
    const coverage = await readJson(path.join(dir, 'coverage.json'));
    expect(coverage).toMatchObject({
      coverage_from: '2026-10-04T01:00:00.000Z',
      complete: true,
      stopped_at_depth_wall: false,
      messages: 4,
      per_day: { '2026-10-04': 2, '2026-10-05': 2 },
    });
  });

  it('resumes from the saved cursor instead of starting over', async () => {
    const dir = await tempDir();
    await crawl({ dir, client: fakeCcip({ messages: msgs }), limit: 2, maxPages: 1, sleep: noSleep });
    const client = fakeCcip({ messages: msgs });
    await crawl({ dir, client, limit: 2, sleep: noSleep });
    expect(client.listCalls).toEqual(['2']);
  });

  it('stops at the depth wall after 3 server errors on one cursor, and a re-run retries that cursor', async () => {
    const dir = await tempDir();
    const failing = fakeCcip({ messages: msgs, failCursors: new Set(['2']) });
    const state = await crawl({ dir, client: failing, limit: 2, sleep: noSleep });
    expect(failing.listCalls).toEqual([null, '2', '2', '2']);
    expect(state.stoppedAtDepthWall).toBe(true);
    expect(await readJson(path.join(dir, 'coverage.json'))).toMatchObject({
      coverage_from: '2026-10-05T09:00:00.000Z',
      stopped_at_depth_wall: true,
    });

    const retry = await crawl({ dir, client: fakeCcip({ messages: msgs }), limit: 2, sleep: noSleep });
    expect(retry).toMatchObject({ done: true, stoppedAtDepthWall: false, messages: 4 });
  });

  it('waits out 429s without counting them toward the depth wall', async () => {
    const dir = await tempDir();
    let calls = 0;
    const client = {
      listMessages: async () => {
        calls += 1;
        if (calls <= 2) throw new UpstreamHttpError('GET /messages', 429);
        return { messages: [msgs[0]!], raw: [msgs[0]], cursor: null };
      },
    };
    const sleeps: number[] = [];
    const state = await crawl({ dir, client, sleep: async (ms) => { sleeps.push(ms); } });
    expect(state).toMatchObject({ done: true, stoppedAtDepthWall: false, messages: 1 });
    expect(sleeps).toEqual([30_000, 30_000]);
  });

  it('stops loudly on a schema error and resumes from the same cursor on a re-run', async () => {
    const dir = await tempDir();
    const good = fakeCcip({ messages: msgs });
    const broken = {
      listMessages: async (opts: { limit: number; cursor?: string | null }) => {
        if (opts.cursor === '2') throw new UpstreamSchemaError('GET /messages', 'data.0.sender', '{}');
        return good.listMessages(opts);
      },
    };
    await expect(crawl({ dir, client: broken, limit: 2, sleep: noSleep })).rejects.toBeInstanceOf(UpstreamSchemaError);
    const state = await crawl({ dir, client: fakeCcip({ messages: msgs }), limit: 2, sleep: noSleep });
    expect(state).toMatchObject({ done: true, stoppedAtDepthWall: false, messages: 4 });
  });

  it.each([
    ['repeats the cursor it was given', 'c1'],
    ['returns an empty cursor', ''],
  ])('stops loudly when the API %s, leaving the last good cursor saved', async (_name, badCursor) => {
    const dir = await tempDir();
    const client = {
      listMessages: async (opts: { limit: number; cursor?: string | null }) => {
        if (!opts.cursor) return { messages: [msgs[0]!], raw: [msgs[0]], cursor: 'c1' };
        return { messages: [msgs[1]!], raw: [msgs[1]], cursor: badCursor };
      },
    };
    await expect(crawl({ dir, client, sleep: noSleep })).rejects.toThrow('cursor did not advance at c1');
    const saved = await readJson(path.join(dir, 'state.json'));
    expect(saved).toMatchObject({ cursor: 'c1', pages: 1, done: false });
    expect(await readdir(path.join(dir, 'pages'))).toEqual(['00000.json']);
  });

  it('ends on an empty page even if the API claims more', async () => {
    const dir = await tempDir();
    const client = {
      listMessages: async () => ({ messages: [], raw: [], cursor: 'again' }),
    };
    const state = await crawl({ dir, client, sleep: noSleep });
    expect(state).toMatchObject({ done: true, pages: 1, messages: 0 });
  });
});

describe('topUp', () => {
  it('pages from the newest message back to the start of the original crawl', async () => {
    const dir = await tempDir();
    await crawl({ dir, client: fakeCcip({ messages: msgs }), limit: 2, sleep: noSleep });
    const newer = [
      listMessage({ id: 'm6', sendTs: '2026-10-07T10:00:00.000Z' }),
      listMessage({ id: 'm5', sendTs: '2026-10-06T10:00:00.000Z' }),
    ];
    const result = await topUp({ dir, client: fakeCcip({ messages: [...newer, ...msgs] }), limit: 2 });
    expect(result).toEqual({ pages: 2, messages: 2, reachedCrawl: true });
    expect(await readdir(path.join(dir, 'topup'))).toEqual(['00000.json', '00001.json']);
    expect((await readJson(path.join(dir, 'topup', '00000.json'))).map((m: { messageId: string }) => m.messageId)).toEqual(['m6', 'm5']);
    expect(await readJson(path.join(dir, 'topup', '00001.json'))).toEqual([]);
  });
});
