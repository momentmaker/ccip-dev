import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UpstreamHttpError, UpstreamSchemaError } from '@ccip-dev/core';
import { fakeCcip, fakeKeysetApi, listMessage, NETWORKS } from '@ccip-dev/core/testing';
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
    expect(await readJson(path.join(dir, 'coverage.json'))).toMatchObject({ pages: 1, messages: 2, complete: false });
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

  it('ends on a final empty page even when it carries an empty cursor', async () => {
    const dir = await tempDir();
    const client = {
      listMessages: async (opts: { limit: number; cursor?: string | null }) =>
        opts.cursor ? { messages: [], raw: [], cursor: '' } : { messages: [msgs[0]!], raw: [msgs[0]], cursor: 'c1' },
    };
    const state = await crawl({ dir, client, sleep: noSleep });
    expect(state.done).toBe(true);
    expect(await readJson(path.join(dir, 'coverage.json'))).toMatchObject({ complete: true, pages: 2, messages: 1 });
  });

  it('ends on an empty page even if the API claims more', async () => {
    const dir = await tempDir();
    const client = {
      listMessages: async () => ({ messages: [], raw: [], cursor: 'again' }),
    };
    const state = await crawl({ dir, client, sleep: noSleep });
    expect(state).toMatchObject({ done: true, pages: 1, messages: 0 });
  });

  describe('adaptive page size', () => {
    const chain: Record<string, { at: number; next: string | null }> = {
      start: { at: 0, next: 'X' },
      X: { at: 1, next: 'Y' },
      Y: { at: 2, next: 'Z' },
      Z: { at: 3, next: null },
    };
    const recordingClient = (failAt: (cursor: string | null, limit: number) => boolean) => {
      const calls: { cursor: string | null; limit: number }[] = [];
      return {
        calls,
        listMessages: async (opts: { limit: number; cursor?: string | null }) => {
          const cursor = opts.cursor ?? null;
          calls.push({ cursor, limit: opts.limit });
          if (failAt(cursor, opts.limit)) throw new UpstreamHttpError('GET /messages', 500);
          const page = chain[cursor ?? 'start']!;
          return { messages: [msgs[page.at]!], raw: [msgs[page.at]], cursor: page.next };
        },
      };
    };
    const limitsAt = (calls: { cursor: string | null; limit: number }[], cursor: string | null) =>
      calls.filter((c) => c.cursor === cursor).map((c) => c.limit);

    it('halves the page size on a timeout, keeps it for later pages, and persists it', async () => {
      const dir = await tempDir();
      const client = recordingClient((cursor, limit) => cursor === 'X' && limit > 2);
      const state = await crawl({ dir, client, limit: 8, minLimit: 2, sleep: noSleep });
      expect(state).toMatchObject({ done: true, stoppedAtDepthWall: false, messages: 4 });
      expect(limitsAt(client.calls, 'X')).toEqual([8, 4, 2]);
      expect(limitsAt(client.calls, 'Y')).toEqual([2]);
      expect(limitsAt(client.calls, 'Z')).toEqual([2]);
      expect(await readJson(path.join(dir, 'state.json'))).toMatchObject({ limit: 2 });
      expect(await readJson(path.join(dir, 'coverage.json'))).toMatchObject({ page_size: 2, stopped_at_depth_wall: false });
    });

    it('stops at the depth wall only after 3 failures at the floor size', async () => {
      const dir = await tempDir();
      const client = recordingClient((cursor) => cursor === 'X');
      const state = await crawl({ dir, client, limit: 8, minLimit: 2, sleep: noSleep });
      expect(limitsAt(client.calls, 'X')).toEqual([8, 4, 2, 2, 2]);
      expect(state.stoppedAtDepthWall).toBe(true);
      expect(await readJson(path.join(dir, 'coverage.json'))).toMatchObject({
        coverage_from: msgs[0]!.sendTimestamp,
        stopped_at_depth_wall: true,
        page_size: 2,
      });
    });

    it('resumes with the saved page size instead of the configured one', async () => {
      const dir = await tempDir();
      const first = recordingClient((cursor, limit) => cursor === 'X' && limit > 2);
      await crawl({ dir, client: first, limit: 8, minLimit: 2, maxPages: 2, sleep: noSleep });
      const second = recordingClient(() => false);
      await crawl({ dir, client: second, limit: 8, minLimit: 2, sleep: noSleep });
      expect(second.calls[0]).toEqual({ cursor: 'Y', limit: 2 });
    });
  });
});

describe('crawl with skipPoison', () => {
  const at = (seed: string, sendTs: string) =>
    listMessage({ id: `0x${createHash('sha256').update(seed).digest('hex')}`, sendTs, src: NETWORKS.ethereum });
  const history = [
    at('h1', '2026-01-15T03:00:00.000Z'),
    at('h2', '2026-01-15T02:10:00.000Z'),
    at('h3', '2026-01-15T01:28:06.000Z'),
    at('h4', '2026-01-14T20:00:00.000Z'),
    at('h5', '2026-01-12T00:00:00.000Z'),
    at('h6', '2026-01-11T23:59:59.000Z'),
  ];
  const poison = history[2]!;
  const skipOf = (m: { messageId: string; sendTimestamp: string }) => ({ messageId: m.messageId, sendTimestamp: m.sendTimestamp });
  const idsOf = (messages: { messageId: string }[]) => messages.map((m) => m.messageId);
  const crawledIds = async (dir: string) => {
    const files = (await readdir(path.join(dir, 'pages'))).sort();
    const pages = await Promise.all(files.map((f) => readJson(path.join(dir, 'pages', f))));
    return idsOf(pages.flat());
  };

  it('skips exactly the poison message, keeps every other message and records the skip', async () => {
    const dir = await tempDir();
    const api = fakeKeysetApi({ messages: history, poison: [poison.messageId] });
    const state = await crawl({ dir, client: api, limit: 4, minLimit: 1, skipPoison: true, sleep: noSleep });
    expect(state).toMatchObject({ done: true, stoppedAtDepthWall: false, messages: 5 });
    expect(await crawledIds(dir)).toEqual(idsOf(history.filter((m) => m !== poison)));
    expect(state.skipped).toEqual([skipOf(poison)]);
    expect(await readJson(path.join(dir, 'coverage.json'))).toMatchObject({ complete: true, skipped: [skipOf(poison)] });
  });

  it('skips a poison message that shares the timestamp of the cursor message', async () => {
    const dir = await tempDir();
    const second = '2026-01-15T01:28:06.000Z';
    const [newest, sameSecondPoison, oldest] = [at('s1', second), at('s2', second), at('s3', second)].sort((a, b) =>
      BigInt(b.messageId) > BigInt(a.messageId) ? 1 : -1,
    );
    const messages = [at('before', '2026-01-15T02:00:00.000Z'), newest!, sameSecondPoison!, oldest!, at('after', '2026-01-15T01:00:00.000Z')];
    const api = fakeKeysetApi({ messages, poison: [sameSecondPoison!.messageId] });
    const state = await crawl({ dir, client: api, limit: 2, minLimit: 1, skipPoison: true, sleep: noSleep });
    expect(state).toMatchObject({ done: true, stoppedAtDepthWall: false });
    expect(await crawledIds(dir)).toEqual(idsOf(messages.filter((m) => m !== sameSecondPoison)));
    expect(state.skipped).toEqual([skipOf(sameSecondPoison!)]);
  });

  it('skips adjacent poison messages as one run, keeping the messages around it and recording the oldest', async () => {
    const dir = await tempDir();
    const api = fakeKeysetApi({ messages: history, poison: [history[2]!.messageId, history[3]!.messageId] });
    const state = await crawl({ dir, client: api, limit: 4, minLimit: 1, skipPoison: true, sleep: noSleep });
    expect(await crawledIds(dir)).toEqual(idsOf([history[0]!, history[1]!, history[4]!, history[5]!]));
    expect(state.skipped).toEqual([skipOf(history[3]!)]);
  });

  it('goes back to the configured page size after the skip', async () => {
    const dir = await tempDir();
    const api = fakeKeysetApi({ messages: history, poison: [poison.messageId] });
    const state = await crawl({ dir, client: api, limit: 4, minLimit: 1, skipPoison: true, sleep: noSleep });
    expect(state.limit).toBe(4);
    expect(api.listCalls.at(-1)!.limit).toBe(4);
  });

  it('saves the poison message detail when the API returns it', async () => {
    const dir = await tempDir();
    const api = fakeKeysetApi({ messages: history, poison: [poison.messageId] });
    const detail = { messageId: poison.messageId, version: '1.6' };
    const client = {
      listMessages: api.listMessages,
      getMessageRaw: async (id: string) => (id === poison.messageId ? detail : api.getMessageRaw(id)),
    };
    await crawl({ dir, client, limit: 4, minLimit: 1, skipPoison: true, sleep: noSleep });
    expect(await readJson(path.join(dir, 'poison', `${poison.messageId}.json`))).toEqual(detail);
  });

  it('only logs when the poison message detail is not available', async () => {
    const dir = await tempDir();
    const lines: string[] = [];
    const api = fakeKeysetApi({ messages: history, poison: [poison.messageId] });
    const state = await crawl({ dir, client: api, limit: 4, minLimit: 1, skipPoison: true, sleep: noSleep, log: (l) => lines.push(l) });
    expect(state).toMatchObject({ done: true, stoppedAtDepthWall: false });
    expect(existsSync(path.join(dir, 'poison'))).toBe(false);
    expect(lines.some((l) => l.includes(poison.messageId) && l.includes('HTTP 404'))).toBe(true);
  });

  it('stops at the depth wall when the search runs out of probes', async () => {
    const dir = await tempDir();
    const api = fakeKeysetApi({ messages: history, poison: [poison.messageId] });
    const state = await crawl({ dir, client: api, limit: 1, minLimit: 1, skipPoison: true, maxPoisonProbes: 20, sleep: noSleep });
    expect(state).toMatchObject({ done: true, stoppedAtDepthWall: true, skipped: [], messages: 2 });
    expect(api.listCalls).toHaveLength(2 + 3 + 20);
  });

  it('stops at the depth wall instead of guessing when the poison message timestamp has milliseconds', async () => {
    const dir = await tempDir();
    const subSecond = at('ms', '2026-01-15T01:28:06.500Z');
    const messages = [history[0]!, history[1]!, subSecond, history[3]!];
    const api = fakeKeysetApi({ messages, poison: [subSecond.messageId] });
    const state = await crawl({ dir, client: api, limit: 1, minLimit: 1, skipPoison: true, sleep: noSleep });
    expect(state).toMatchObject({ stoppedAtDepthWall: true, skipped: [], messages: 2 });
  });

  it('stops at the depth wall when a probe fails 3 times with something other than HTTP 500', async () => {
    const dir = await tempDir();
    const api = fakeKeysetApi({ messages: history, poison: [poison.messageId] });
    const pageCursors = new Set<string | null>([null]);
    let calls = 0;
    const client = {
      listMessages: async (opts: { limit: number; cursor?: string | null }) => {
        calls += 1;
        if (!pageCursors.has(opts.cursor ?? null)) throw new UpstreamHttpError('GET /messages', 503);
        const page = await api.listMessages(opts);
        pageCursors.add(page.cursor);
        return page;
      },
    };
    const state = await crawl({ dir, client, limit: 1, minLimit: 1, skipPoison: true, sleep: noSleep });
    expect(state).toMatchObject({ stoppedAtDepthWall: true, skipped: [] });
    expect(calls).toBe(2 + 3 + 3);
  });

  it('leaves a poison message as a depth wall without skipPoison', async () => {
    const dir = await tempDir();
    const api = fakeKeysetApi({ messages: history, poison: [poison.messageId] });
    const state = await crawl({ dir, client: api, limit: 1, minLimit: 1, sleep: noSleep });
    expect(state).toMatchObject({ stoppedAtDepthWall: true, skipped: [] });
    expect(api.listCalls).toHaveLength(2 + 3);
  });

  it('refuses skipPoison unless the page-size floor is 1', async () => {
    const dir = await tempDir();
    await expect(crawl({ dir, client: fakeKeysetApi({ messages: history }), skipPoison: true })).rejects.toThrow('minLimit: 1');
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
    expect(existsSync(path.join(dir, 'topup.partial'))).toBe(false);
  });

  it('waits out a 429 while paging', async () => {
    const dir = await tempDir();
    await crawl({ dir, client: fakeCcip({ messages: msgs }), limit: 2, sleep: noSleep });
    const inner = fakeCcip({ messages: msgs });
    let calls = 0;
    const client = {
      listMessages: async (opts: { limit: number; cursor?: string | null }) => {
        calls += 1;
        if (calls === 1) throw new UpstreamHttpError('GET /messages', 429);
        return inner.listMessages(opts);
      },
    };
    const sleeps: number[] = [];
    const result = await topUp({ dir, client, limit: 2, sleep: async (ms) => { sleeps.push(ms); } });
    expect(result.reachedCrawl).toBe(true);
    expect(sleeps).toEqual([30_000]);
  });

  it('fails loudly when the API runs out before reaching the crawl', async () => {
    const dir = await tempDir();
    await crawl({ dir, client: fakeCcip({ messages: msgs }), limit: 2, sleep: noSleep });
    const unrelated = [listMessage({ id: 'x1', sendTs: '2026-10-08T10:00:00.000Z' })];
    await expect(topUp({ dir, client: fakeCcip({ messages: unrelated }), limit: 2, sleep: noSleep })).rejects.toThrow(
      'without reaching the crawl',
    );
    expect(existsSync(path.join(dir, 'topup'))).toBe(false);
  });

  it('keeps the previous complete top-up when a new one fails partway', async () => {
    const dir = await tempDir();
    await crawl({ dir, client: fakeCcip({ messages: msgs }), limit: 2, sleep: noSleep });
    const newer = [listMessage({ id: 'm5', sendTs: '2026-10-06T10:00:00.000Z' })];
    await topUp({ dir, client: fakeCcip({ messages: [...newer, ...msgs] }), limit: 2 });
    const unrelated = [listMessage({ id: 'x1', sendTs: '2026-10-08T10:00:00.000Z' })];
    await expect(topUp({ dir, client: fakeCcip({ messages: unrelated }), limit: 2, sleep: noSleep })).rejects.toThrow(
      'without reaching the crawl',
    );
    expect(await readdir(path.join(dir, 'topup'))).toEqual(['00000.json']);
    expect((await readJson(path.join(dir, 'topup', '00000.json'))).map((m: { messageId: string }) => m.messageId)).toEqual(['m5']);
  });
});
