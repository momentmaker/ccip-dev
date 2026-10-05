import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BREAKDOWN_CONFLICT, buildRows, gunzipText, insertSql, normalizeList, rollupDay, TOTALS_CONFLICT } from '@ccip-dev/core';
import { fakePrices, listMessage, NETWORKS } from '@ccip-dev/core/testing';
import { describe, expect, it } from 'vitest';
import { build, SqlWriter } from '../backfill/build';

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

async function crawlDir(pages: unknown[][] = [[today1, a2, a1], [a1, b1, c1]]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'build-'));
  await mkdir(path.join(dir, 'pages'));
  for (const [i, page] of pages.entries()) {
    await writeFile(path.join(dir, 'pages', `${String(i).padStart(5, '0')}.json`), JSON.stringify(page));
  }
  await writeCoverage(dir, true);
  return dir;
}

async function writeCoverage(dir: string, complete: boolean): Promise<void> {
  const coverage = { coverage_from: c1.sendTimestamp, complete, stopped_at_depth_wall: true };
  await writeFile(path.join(dir, 'coverage.json'), JSON.stringify(coverage));
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

  it('reads the top-up pages before the crawl pages', async () => {
    const dir = await crawlDir();
    await mkdir(path.join(dir, 'topup'));
    const t1 = listMessage({ id: 't1', sendTs: '2026-10-09T01:00:00.000Z' });
    const t0 = listMessage({ id: 't0', sendTs: '2026-10-07T12:00:00.000Z' });
    await writeFile(path.join(dir, 'topup', '00000.json'), JSON.stringify([t1, t0]));
    const result = await build({ dir, liveStartDay: '2026-10-09', prices: prices(), now: () => NOW });
    expect(result).toMatchObject({ days: 5, messages: 6 });
    const sql = await allSql(dir);
    expect(sql).toContain("'t0'");
    expect(sql).not.toContain("'t1'");
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

  it('accepts a message that arrives one day out of order across pages', async () => {
    const dir = await crawlDir([[today1, a2], [b1], [a1, c1]]);
    const result = await build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW });
    expect(result).toMatchObject({ days: 3, messages: 4 });
  });

  it('refuses a message for a day it already wrote instead of overwriting that day', async () => {
    const straggler = listMessage({ id: 'late', sendTs: '2026-10-06T08:00:00.000Z' });
    const dir = await crawlDir([[today1, a2, a1], [b1, c1], [straggler]]);
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), now: () => NOW })).rejects.toThrow(
      'pages/00002.json[0] (message late) is on 2026-10-06, a day the build already wrote',
    );
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

describe('SqlWriter', () => {
  it('accepts a single day of more statements than a spread call can take', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sql-writer-'));
    const writer = new SqlWriter(dir, 20_000);
    await writer.add(Array.from({ length: 200_000 }, () => 'SELECT 1;'));
    expect(await writer.finish()).toMatchObject({ files: 10 });
  });
});
