import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  archiveKey, BREAKDOWN_CONFLICT, buildRows, gunzipText, insertSql, normalizeList, rollupDay, TOTALS_CONFLICT, type NetworkInfo,
} from '@ccip-dev/core';
import { fakePrices, listMessage, NETWORKS } from '@ccip-dev/core/testing';
import { describe, expect, it } from 'vitest';
import { build, DaySpool, SqlWriter } from '../backfill/build';

const TOKEN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const KEY = `base:${TOKEN}`;
const NOW = new Date('2026-10-08T00:00:00.000Z');
const LANE = '15971525489660198786>11344663589394136015';

const today1 = listMessage({ id: 'today1', sendTs: '2026-10-08T01:00:00.000Z' });
const a2 = listMessage({ id: 'a2', sendTs: '2026-10-06T12:00:00.000Z', token: { address: TOKEN, amount: '5000000' } });
const a1 = listMessage({ id: 'a1', sendTs: '2026-10-06T01:00:00.000Z' });
const b1 = listMessage({ id: 'b1', sendTs: '2026-10-05T10:00:00.000Z' });
const c1 = listMessage({ id: 'c1', sendTs: '2026-10-04T23:00:00.000Z' });
const prices = () => fakePrices({ latest: { [KEY]: { price: 99, decimals: 6 } }, history: { [KEY]: { '2026-10-06': 2 } } });

/** When the fixture pages were fetched: the build orders copies of a message, and checks source freshness, by page mtime. */
const CRAWLED_AT = new Date('2026-10-01T00:00:00.000Z');
const SOURCES_AT = new Date('2026-10-08T06:00:00.000Z');

async function writePage(file: string, messages: unknown[], fetchedAt: Date): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(messages));
  await utimes(file, fetchedAt, fetchedAt);
}

const pageName = (i: number) => `${String(i).padStart(5, '0')}.json`;

async function crawlDir(pages: unknown[][] = [[today1, a2, a1], [a1, b1, c1]]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'build-'));
  for (const [i, page] of pages.entries()) await writePage(path.join(dir, 'pages', pageName(i)), page, CRAWLED_AT);
  await writeCoverage(dir, true);
  return dir;
}

async function writeCoverage(dir: string, complete: boolean, extra: object = {}): Promise<void> {
  const coverage = { coverage_from: c1.sendTimestamp, complete, stopped_at_depth_wall: true, ...extra };
  await writeFile(path.join(dir, 'coverage.json'), JSON.stringify(coverage));
}

interface SourceFixture {
  network: NetworkInfo;
  pages: unknown[][];
  summary?: object;
  fetchedAt?: Date;
}

/** Writes per-source crawls as `pnpm backfill:sources` leaves them: pages per selector plus summary.json. */
async function addSources(dir: string, sources: SourceFixture[]): Promise<void> {
  const entries: object[] = [];
  for (const { network, pages, summary, fetchedAt } of sources) {
    const pagesDir = path.join(dir, 'sources', network.chainSelector, 'pages');
    await mkdir(pagesDir, { recursive: true });
    for (const [i, page] of pages.entries()) await writePage(path.join(pagesDir, pageName(i)), page, fetchedAt ?? SOURCES_AT);
    entries.push({
      selector: network.chainSelector,
      name: network.name,
      done: true,
      stopped_at_depth_wall: false,
      coverage_from: null,
      messages: pages.flat().length,
      pages: pages.length,
      skipped: [],
      ...summary,
    });
  }
  await writeFile(path.join(dir, 'sources', 'summary.json'), JSON.stringify({ complete: false, sources: entries }));
}

const e2 = listMessage({ id: 'e2', sendTs: '2026-10-06T05:00:00.000Z', src: NETWORKS.ethereum });
const e1 = listMessage({ id: 'e1', sendTs: '2026-10-05T05:00:00.000Z', src: NETWORKS.ethereum });
const e0 = listMessage({ id: 'e0', sendTs: '2026-10-04T05:00:00.000Z', src: NETWORKS.ethereum });
const a2Delivered = { ...a2, status: 'SUCCESS' };

/** The global crawl plus two per-source crawls whose pages cover the same three days. */
async function sourcesDir(overrides: { base?: object; ethereum?: object } = {}): Promise<string> {
  const dir = await crawlDir();
  await addSources(dir, [
    { network: NETWORKS.base, pages: [[today1, a2Delivered, a1], [b1, c1]], summary: { coverage_from: c1.sendTimestamp, ...overrides.base } },
    { network: NETWORKS.ethereum, pages: [[e2, e1], [e0]], summary: { coverage_from: e0.sendTimestamp, ...overrides.ethereum } },
  ]);
  return dir;
}

function totalsDays(sql: string): string[] {
  return [...sql.matchAll(/^INSERT INTO daily_totals \([^)]*\) VALUES \('(\d{4}-\d{2}-\d{2})'/gm)].map((m) => m[1] ?? '');
}

function messageRows(sql: string, id: string): string[] {
  return sql.split('\n').filter((line) => line.startsWith('INSERT INTO messages ') && line.includes(`VALUES ('${id}'`));
}

async function archivedIds(dir: string, day: string): Promise<string[]> {
  const gz = await readFile(path.join(dir, 'archive', archiveKey(day)));
  const text = await gunzipText(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer);
  return text.trim().split('\n').map((l) => (JSON.parse(l) as { messageId: string }).messageId).sort();
}

async function sqlFiles(dir: string): Promise<string[]> {
  return (await readdir(path.join(dir, 'sql'))).filter((f) => f.endsWith('.sql')).sort();
}

async function allSql(dir: string): Promise<string> {
  const files = await sqlFiles(dir);
  return (await Promise.all(files.map((f) => readFile(path.join(dir, 'sql', f), 'utf8')))).join('');
}

describe('build', () => {
  it('writes deduplicated backfill rows only for days before live_start_day, plus a build id', async () => {
    const dir = await crawlDir();
    const result = await build({ dir, liveStartDay: '2026-10-08', prices: prices(), chunkSize: 5, now: () => NOW });
    expect(result).toMatchObject({ days: 3, messages: 4, unpricedMessages: 0 });
    expect(result.sqlFiles).toBe((await sqlFiles(dir)).length);
    expect(result.sqlFiles).toBeGreaterThan(1);
    const sql = await allSql(dir);
    expect(sql.match(/^INSERT INTO messages .* ON CONFLICT\(message_id\) DO UPDATE SET .* WHERE messages\.source = 'backfill';$/gm)).toHaveLength(4);
    expect(sql).not.toContain("'today1'");
    expect(result.buildId).toMatch(/^[0-9a-f]{64}$/);
    expect((await readFile(path.join(dir, 'sql', 'BUILD'), 'utf8')).trim()).toBe(result.buildId);
  });

  it('seeds a chain whose displayName is null with its name as display_name', async () => {
    const toSui = listMessage({ id: 'sui1', sendTs: '2026-10-06T02:00:00.000Z', dst: NETWORKS.sui });
    const dir = await crawlDir([[today1, toSui, a2, a1], [b1, c1]]);
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    const sql = await allSql(dir);
    expect(sql).toMatch(/INSERT INTO chains \([^)]*\) VALUES \('17529533435026248318', 'sui-mainnet', 'sui-mainnet', 'SUI'/);
  });

  it('writes the same daily totals the live path computes for the same messages (parity)', async () => {
    const dir = await crawlDir();
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    const lookup = (key: string) => (key === KEY ? { price: 2, decimals: 6 } : undefined);
    const live = buildRows([a2, a1].map(normalizeList), lookup, () => ({ source: 'live', nextCheckAt: '2026-10-06T00:00:00.000Z' }));
    const expected = insertSql(
      'daily_totals',
      { ...rollupDay('2026-10-06', live.rows, live.tokens).totals, computed_at: NOW.toISOString() },
      TOTALS_CONFLICT,
    );
    expect(await allSql(dir)).toContain(expected);
  });

  it('skips rollups for a partial oldest day, sets coverage_from to the first full day and seeds arrivals', async () => {
    const dir = await crawlDir();
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    const sql = await allSql(dir);
    expect(sql).not.toMatch(/INSERT INTO daily_(totals|breakdown) \([^)]*\) VALUES \('2026-10-04'/);
    expect(sql).toContain("INSERT INTO meta (key, value) VALUES ('coverage_from', '2026-10-05')");
    expect(sql).toContain(
      `INSERT INTO arrivals (kind, key, first_seen, announced_at) VALUES ('lane', '${LANE}', '2026-10-04T23:00:00.000Z', '2026-10-04T23:00:00.000Z') ON CONFLICT`,
    );
  });

  it('writes one archive line per message and reuses the price cache only for the same day range', async () => {
    const dir = await crawlDir();
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    const gz = await readFile(path.join(dir, 'archive', 'messages/2026/10/06.jsonl.gz'));
    const lines = (await gunzipText(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer)).trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).messageId).sort()).toEqual(['a1', 'a2']);

    const second = prices();
    await build({ dir, liveStartDay: '2026-10-08', prices: second, now: () => NOW });
    expect(second.latestCalls).toEqual([]);

    const shorterRange = prices();
    await build({ dir, liveStartDay: '2026-10-07', prices: shorterRange, now: () => NOW });
    expect(shorterRange.latestCalls).not.toEqual([]);
  });

  it('adds the top-up pages, whose copy of a message wins over the crawl pages', async () => {
    const dir = await crawlDir();
    const t1 = listMessage({ id: 't1', sendTs: '2026-10-09T01:00:00.000Z' });
    const t0 = listMessage({ id: 't0', sendTs: '2026-10-07T12:00:00.000Z' });
    await writePage(path.join(dir, 'topup', pageName(0)), [t1, t0, { ...a1, status: 'SUCCESS' }], new Date('2026-10-09T02:00:00.000Z'));
    const result = await build({ dir, liveStartDay: '2026-10-09', prices: prices(), now: () => NOW });
    expect(result).toMatchObject({ days: 5, messages: 6 });
    const sql = await allSql(dir);
    expect(sql).toContain("'t0'");
    expect(sql).not.toContain("'t1'");
    expect(messageRows(sql, 'a1')).toEqual([expect.stringContaining("'SUCCESS'")]);
  });

  it('refuses to build when the crawl ends before live_start_day', async () => {
    const dir = await crawlDir([[a2, a1], [b1, c1]]);
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW })).rejects.toThrow(
      /before live_start_day 2026-10-08\. Run pnpm backfill:crawl --top-up/,
    );
  });

  it('refuses to build from a crawl that has not finished', async () => {
    const dir = await crawlDir();
    await writeCoverage(dir, false);
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW })).rejects.toThrow(
      'The crawl is not complete (coverage.json complete: false). Re-run pnpm backfill:crawl until it finishes.',
    );
  });

  it('builds a day whole even when a later page holds a message for it', async () => {
    const straggler = listMessage({ id: 'late', sendTs: '2026-10-06T08:00:00.000Z' });
    const dir = await crawlDir([[today1, a2, a1], [b1, c1], [straggler]]);
    const result = await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    expect(result).toMatchObject({ days: 3, messages: 5 });
    expect(await archivedIds(dir, '2026-10-06')).toEqual(['a1', 'a2', 'late']);
  });

  it('names the file, index and field of an invalid message', async () => {
    const { sender: _sender, ...noSender } = b1;
    const dir = await crawlDir([[today1, a2, a1], [noSender, c1]]);
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW })).rejects.toThrow(
      'pages/00001.json[0] is not a valid CCIP list message (problem at sender)',
    );
  });

  it('seeds chains with their first and last message times, never overwriting registry fields', async () => {
    const dir = await crawlDir();
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    expect(await allSql(dir)).toContain(
      'INSERT INTO chains (selector, name, display_name, family, chain_id, first_seen, last_seen) ' +
        "VALUES ('15971525489660198786', 'ethereum-mainnet-base-1', 'Base Mainnet', 'EVM', '8453', " +
        "'2026-10-04T23:00:00.000Z', '2026-10-06T12:00:00.000Z') " +
        'ON CONFLICT(selector) DO UPDATE SET first_seen = MIN(chains.first_seen, excluded.first_seen), ' +
        'last_seen = MAX(chains.last_seen, excluded.last_seen);',
    );
  });

  it('strips control characters from seeded chain names', async () => {
    const spoofed = { ...NETWORKS.base, name: 'base\u202e', displayName: 'Base\u0000 Mainnet' };
    const dir = await crawlDir([[today1, listMessage({ id: 's1', sendTs: '2026-10-06T01:00:00.000Z', src: spoofed })]]);
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    expect(await allSql(dir)).toContain("VALUES ('15971525489660198786', 'base', 'Base Mainnet', 'EVM', '8453'");
  });

  it('writes daily_breakdown inserts that can be re-applied after a partial upload', async () => {
    const dir = await crawlDir();
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    const inserts = (await allSql(dir)).split('\n').filter((line) => line.startsWith('INSERT INTO daily_breakdown'));
    expect(inserts.length).toBeGreaterThan(0);
    expect(inserts.filter((line) => !line.endsWith(` ${BREAKDOWN_CONFLICT};`))).toEqual([]);
  });

  it('names a corrupt price cache and tells the owner to delete it', async () => {
    const dir = await crawlDir();
    await mkdir(path.join(dir, 'prices'));
    const cacheFile = path.join(dir, 'prices', 'cache.json');
    await writeFile(cacheFile, '{"range":"2026-10-04..2026-10-07","hist');
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW })).rejects.toThrow(
      `The price cache ${cacheFile} is not valid JSON; delete it and run the build again`,
    );
  });
});

describe('build from per-source crawls', () => {
  it('rolls up each day once when sources and the global crawl cover the same days', async () => {
    const dir = await sourcesDir();
    const result = await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    expect(result).toMatchObject({ days: 3, messages: 7 });
    expect(totalsDays(await allSql(dir))).toEqual(['2026-10-04', '2026-10-05', '2026-10-06']);
  });

  it('stores a message found by the global crawl and a source once, as the source saw it', async () => {
    const dir = await sourcesDir();
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    expect(messageRows(await allSql(dir), 'a2')).toEqual([expect.stringContaining("'SUCCESS'")]);
  });

  it('starts coverage at the earliest day when no source stopped at a depth wall', async () => {
    const dir = await sourcesDir();
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    expect(await allSql(dir)).toContain("INSERT INTO meta (key, value) VALUES ('coverage_from', '2026-10-04')");
  });

  it('starts coverage the day after the latest walled source\'s oldest day', async () => {
    const dir = await crawlDir();
    await addSources(dir, [
      { network: NETWORKS.base, pages: [[today1, a2, a1], [b1, c1]], summary: { stopped_at_depth_wall: true, coverage_from: c1.sendTimestamp } },
      { network: NETWORKS.ethereum, pages: [[e2, e1]], summary: { stopped_at_depth_wall: true, coverage_from: e1.sendTimestamp } },
    ]);
    const result = await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    const sql = await allSql(dir);
    expect(sql).toContain("INSERT INTO meta (key, value) VALUES ('coverage_from', '2026-10-06')");
    expect(totalsDays(sql)).toEqual(['2026-10-06']);
    expect(sql).not.toMatch(/INSERT INTO daily_breakdown \([^)]*\) VALUES \('2026-10-0[45]'/);
    expect(result).toMatchObject({ days: 3, messages: 6 });
    expect(await archivedIds(dir, '2026-10-05')).toEqual(['b1', 'e1']);
    expect(await archivedIds(dir, '2026-10-04')).toEqual(['c1']);
  });

  it('refuses a source that failed', async () => {
    const dir = await sourcesDir({ ethereum: { error: 'HTTP 500' } });
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW })).rejects.toThrow(
      'Source 5009297550715157269 (ethereum-mainnet) failed in the per-source crawl: HTTP 500',
    );
  });

  it('refuses a source that has not finished', async () => {
    const dir = await sourcesDir({ ethereum: { done: false } });
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW })).rejects.toThrow(
      'Source 5009297550715157269 (ethereum-mainnet) has not finished its per-source crawl',
    );
  });

  it('refuses a walled source with no coverage_from and names it', async () => {
    const dir = await sourcesDir({ ethereum: { stopped_at_depth_wall: true, coverage_from: null } });
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW })).rejects.toThrow(
      'Source 5009297550715157269 (ethereum-mainnet) stopped at a depth wall before it crawled any message',
    );
  });

  it('refuses a summary in which no source was crawled', async () => {
    const dir = await crawlDir();
    await addSources(dir, [{ network: NETWORKS.sui, pages: [], summary: { done: false, unsupported: true } }]);
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW })).rejects.toThrow(
      'sources/summary.json lists no source that was crawled',
    );
  });

  it('ignores a source the API does not support', async () => {
    const dir = await crawlDir();
    await addSources(dir, [
      { network: NETWORKS.base, pages: [[today1, a2, a1], [b1, c1]], summary: { coverage_from: c1.sendTimestamp } },
      { network: NETWORKS.sui, pages: [], summary: { done: false, unsupported: true } },
    ]);
    const result = await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    expect(result).toMatchObject({ days: 3, messages: 4 });
  });

  it('still needs a complete global crawl when there are global pages', async () => {
    const dir = await sourcesDir();
    await writeCoverage(dir, false);
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW })).rejects.toThrow(
      'The crawl is not complete (coverage.json complete: false)',
    );
  });

  it('writes the skipped poison messages of every crawl to skipped.json once each', async () => {
    const p1 = { messageId: 'p1', sendTimestamp: '2026-10-05T03:00:00.000Z', after: { sendTimestamp: b1.sendTimestamp, messageId: 'b1' } };
    const p2 = { messageId: 'p2', sendTimestamp: '2026-10-04T03:00:00.000Z', after: { sendTimestamp: c1.sendTimestamp, messageId: 'c1' } };
    const p3 = { messageId: 'p3', sendTimestamp: '2026-10-06T03:00:00.000Z', after: { sendTimestamp: e2.sendTimestamp, messageId: 'e2' } };
    const dir = await sourcesDir({ base: { skipped: [p1, p2] }, ethereum: { skipped: [p3] } });
    await writeCoverage(dir, true, { skipped: [p1] });
    const result = await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    expect(JSON.parse(await readFile(path.join(dir, 'skipped.json'), 'utf8'))).toEqual([p1, p2, p3]);
    expect(result.skippedMessages).toBe(3);
  });

  it('writes the global crawl\'s skipped messages to skipped.json without per-source crawls', async () => {
    const p1 = { messageId: 'p1', sendTimestamp: '2026-10-05T03:00:00.000Z', after: { sendTimestamp: '2026-10-05T04:00:00.000Z', messageId: 'b1' } };
    const dir = await crawlDir();
    await writeCoverage(dir, true, { skipped: [p1] });
    const result = await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    expect(result.skippedMessages).toBe(1);
  });
});

describe('build fix round 1', () => {
  const a1Delivered = { ...a1, status: 'SUCCESS', receiptTimestamp: '2026-10-06T01:20:00.000Z' };

  async function sourceAndTopUp(sourceAt: Date, topUpAt: Date): Promise<string> {
    const dir = await crawlDir();
    await addSources(dir, [
      { network: NETWORKS.base, pages: [[today1, a2, a1], [b1, c1]], summary: { coverage_from: c1.sendTimestamp }, fetchedAt: sourceAt },
    ]);
    await writePage(path.join(dir, 'topup', pageName(0)), [today1, a1Delivered], topUpAt);
    return dir;
  }

  it('keeps a top-up copy fetched after the source crawl', async () => {
    const dir = await sourceAndTopUp(SOURCES_AT, new Date('2026-10-08T07:00:00.000Z'));
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    expect(messageRows(await allSql(dir), 'a1')).toEqual([expect.stringContaining("'SUCCESS'")]);
  });

  it('keeps a source copy fetched after the top-up', async () => {
    const dir = await sourceAndTopUp(SOURCES_AT, new Date('2026-10-08T05:00:00.000Z'));
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    expect(messageRows(await allSql(dir), 'a1')).toEqual([expect.stringContaining("'SENT'")]);
  });

  it('refuses messages from a source the API cannot back-fill', async () => {
    const dir = await crawlDir([[today1, a2, a1, e1], [b1, c1]]);
    await addSources(dir, [
      { network: NETWORKS.base, pages: [[today1, a2, a1], [b1, c1]], summary: { coverage_from: c1.sendTimestamp } },
      { network: NETWORKS.ethereum, pages: [], summary: { done: false, unsupported: true } },
    ]);
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW })).rejects.toThrow(
      /Source 5009297550715157269 \(ethereum-mainnet\) .*the API cannot back-fill it/,
    );
  });

  it('refuses a source whose crawl started before live_start_day and names it', async () => {
    const dir = await crawlDir();
    await addSources(dir, [
      { network: NETWORKS.base, pages: [[today1, a2, a1], [b1, c1]], summary: { coverage_from: c1.sendTimestamp } },
      { network: NETWORKS.ethereum, pages: [[e2, e1], [e0]], summary: { coverage_from: e0.sendTimestamp }, fetchedAt: new Date('2026-10-07T23:59:00.000Z') },
    ]);
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW })).rejects.toThrow(
      /started before 00:00 UTC of live_start_day 2026-10-08: 5009297550715157269 \(ethereum-mainnet\)\. Delete/,
    );
  });

  it('refuses when coverage_from would leave no complete day before live_start_day', async () => {
    const dir = await sourcesDir({ ethereum: { stopped_at_depth_wall: true, coverage_from: '2026-10-07T05:00:00.000Z' } });
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW })).rejects.toThrow(
      'No complete day to roll up: coverage_from would be 2026-10-08',
    );
  });

  it('refuses a sources directory without summary.json', async () => {
    const dir = await crawlDir();
    await writePage(path.join(dir, 'sources', NETWORKS.ethereum.chainSelector, 'pages', pageName(0)), [e2, e1], SOURCES_AT);
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW })).rejects.toThrow(
      'has no summary.json',
    );
  });

  it('removes the day spool after a successful build', async () => {
    const dir = await sourcesDir();
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    expect(existsSync(path.join(dir, 'days'))).toBe(false);
  });
});

describe('DaySpool', () => {
  it('keeps each day\'s lines in input order across buffer flushes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'day-spool-'));
    const spool = new DaySpool(dir, { dayLines: 2, totalLines: 4 });
    const input: [string, string][] = [
      ['2026-10-06', '1'], ['2026-10-04', '2'], ['2026-10-06', '3'], ['2026-10-05', '4'], ['2026-10-04', '5'],
      ['2026-10-06', '6'], ['2026-10-06', '7'], ['2026-10-06', '8'], ['2026-10-05', '9'],
    ];
    for (const [day, line] of input) await spool.add(day, line);
    const days = await spool.finish();
    const files = Object.fromEntries(await Promise.all(days.map(async (d) => [d, await readFile(path.join(dir, `${d}.jsonl`), 'utf8')])));
    expect(files).toEqual({ '2026-10-04': '2\n5\n', '2026-10-05': '4\n9\n', '2026-10-06': '1\n3\n6\n7\n8\n' });
  });
});

describe('SqlWriter', () => {
  it('accepts a single day of more statements than a spread call can take', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sql-writer-'));
    const writer = new SqlWriter(dir, 20_000);
    await writer.add(Array.from({ length: 200_000 }, () => 'SELECT 1;'));
    expect(await writer.finish()).toMatchObject({ files: 10 });
  });
});
