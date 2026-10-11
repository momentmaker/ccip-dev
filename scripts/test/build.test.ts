import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  archiveKey, BREAKDOWN_CONFLICT, buildCoingeckoIdIndex, buildRows, buildTokenGroupIndex, chainRef, COIN_PRICE_DECIMALS, groupFallback,
  gunzipText, insertSql, normalizeList, normalizeRegistryToken, rollupDay, tokenGroupEntry, TOTALS_CONFLICT, type NetworkInfo,
  type RegistryToken,
} from '@ccip-dev/core';
import { fakeCcip, fakeCoingecko, fakePrices, listMessage, NETWORKS, type FakePrices } from '@ccip-dev/core/testing';
import { describe, expect, it } from 'vitest';
import { build, DaySpool, PriceCache, SqlWriter } from '../backfill/build';

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

const GROUPED = '0xdddddddddddddddddddddddddddddddddddddddd';
const SIBLING = '0xcccccccccccccccccccccccccccccccccccccccc';
const SIBLING_KEY = `ethereum:${SIBLING}`;
const COINED = '0x9999999999999999999999999999999999999999';
const COINED_KEY = `base:${COINED}`;
const COIN_KEY = 'coingecko:coined';
const registryToken = (network: NetworkInfo, address: string, decimals: number): RegistryToken => ({
  chainSelector: network.chainSelector, address, symbol: 'TKN', name: 'Token', decimals, groupId: 'g',
});
/** A registry token without a group, which only CoinGecko's coin `coined` can price when it has no price of its own. */
const coinedToken = (): RegistryToken => ({ ...registryToken(NETWORKS.base, COINED, 6), groupId: null });
const coingeckoLists = () =>
  fakeCoingecko({ platforms: [{ id: 'base', chain_identifier: 8453 }], coins: [{ id: 'coined', platforms: { base: COINED } }] });

/** When the fixture pages were fetched: the build orders copies of a message, and checks source freshness, by page mtime. */
const CRAWLED_AT = new Date('2026-10-01T00:00:00.000Z');
const SOURCES_AT = new Date('2026-10-08T06:00:00.000Z');

async function writePage(file: string, messages: unknown[], fetchedAt: Date): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(messages));
  await utimes(file, fetchedAt, fetchedAt);
}

/** An empty CCIP token registry and CoinGecko id list, for builds that don't exercise the price fallback. */
const emptyRegistries = () => ({ registry: fakeCcip(), coingecko: fakeCoingecko() });

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

function tokenRows(sql: string, id: string): string[] {
  return sql.split('\n').filter((line) => line.startsWith('INSERT INTO message_tokens ') && line.includes(`VALUES ('${id}'`));
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
    const result = await build({ dir, liveStartDay: '2026-10-08', prices: prices(), chunkSize: 5, ...emptyRegistries(), now: () => NOW });
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
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
    const sql = await allSql(dir);
    expect(sql).toMatch(/INSERT INTO chains \([^)]*\) VALUES \('17529533435026248318', 'sui-mainnet', 'sui-mainnet', 'SUI'/);
  });

  it('writes the same daily totals the live path computes for the same messages (parity)', async () => {
    const tokens = [registryToken(NETWORKS.base, GROUPED, 6), registryToken(NETWORKS.ethereum, SIBLING, 18), coinedToken()];
    const grouped = listMessage({ id: 'a3', sendTs: '2026-10-06T18:00:00.000Z', token: { address: GROUPED, amount: '3000000' } });
    const coinPriced = listMessage({ id: 'a4', sendTs: '2026-10-06T20:00:00.000Z', token: { address: COINED, amount: '2000000' } });
    const dir = await crawlDir([[today1, coinPriced, grouped, a2, a1], [a1, b1, c1]]);
    const history = fakePrices({
      latest: { [KEY]: { price: 99, decimals: 6 }, [SIBLING_KEY]: { price: 99, decimals: 18 } },
      history: { [KEY]: { '2026-10-06': 2 }, [SIBLING_KEY]: { '2026-10-06': 3 }, [COIN_KEY]: { '2026-10-06': 4 } },
    });
    const registry = fakeCcip({ chains: [NETWORKS.base, NETWORKS.ethereum], tokens });
    const coingecko = coingeckoLists();
    await build({ dir, liveStartDay: '2026-10-08', prices: history, registry, coingecko, now: () => NOW });

    const dayPrices: Record<string, { price: number; decimals: number }> = {
      [KEY]: { price: 2, decimals: 6 },
      [SIBLING_KEY]: { price: 3, decimals: 18 },
      [COIN_KEY]: { price: 4, decimals: COIN_PRICE_DECIMALS },
    };
    const lookup = (key: string) => dayPrices[key];
    const chains = new Map([NETWORKS.base, NETWORKS.ethereum].map((n) => [n.chainSelector, chainRef(n)]));
    const groups = buildTokenGroupIndex(tokens.map(normalizeRegistryToken).map((t) => tokenGroupEntry(t, chains.get(t.chain))));
    const coingeckoIdOf = buildCoingeckoIdIndex(await coingecko.lists());
    const live = buildRows(
      [coinPriced, grouped, a2, a1].map(normalizeList),
      lookup,
      () => ({ source: 'live', nextCheckAt: '2026-10-06T00:00:00.000Z' }),
      groupFallback(groups, lookup, { coingeckoIdOf }),
    );
    expect(live.rows.find((r) => r.message_id === 'a3')).toMatchObject({ usd_value: 9, unpriced: 0 });
    expect(live.rows.find((r) => r.message_id === 'a4')).toMatchObject({ usd_value: 8, unpriced: 0 });
    const expected = insertSql(
      'daily_totals',
      { ...rollupDay('2026-10-06', live.rows, live.tokens).totals, computed_at: NOW.toISOString() },
      TOTALS_CONFLICT,
    );
    expect(await allSql(dir)).toContain(expected);
  });

  it('skips rollups for a partial oldest day, sets coverage_from to the first full day and seeds arrivals', async () => {
    const dir = await crawlDir();
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
    const sql = await allSql(dir);
    expect(sql).not.toMatch(/INSERT INTO daily_(totals|breakdown) \([^)]*\) VALUES \('2026-10-04'/);
    expect(sql).toContain("INSERT INTO meta (key, value) VALUES ('coverage_from', '2026-10-05')");
    expect(sql).toContain(
      `INSERT INTO arrivals (kind, key, first_seen, announced_at) VALUES ('lane', '${LANE}', '2026-10-04T23:00:00.000Z', '2026-10-04T23:00:00.000Z') ON CONFLICT`,
    );
  });

  it('writes one archive line per message and reuses the price cache only for the same day range', async () => {
    const dir = await crawlDir();
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
    const gz = await readFile(path.join(dir, 'archive', 'messages/2026/10/06.jsonl.gz'));
    const lines = (await gunzipText(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer)).trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).messageId).sort()).toEqual(['a1', 'a2']);

    const second = prices();
    await build({ dir, liveStartDay: '2026-10-08', prices: second, ...emptyRegistries(), now: () => NOW });
    expect(second.latestCalls).toEqual([]);

    const shorterRange = prices();
    await build({ dir, liveStartDay: '2026-10-07', prices: shorterRange, ...emptyRegistries(), now: () => NOW });
    expect(shorterRange.latestCalls).not.toEqual([]);
  });

  it('adds the top-up pages, whose copy of a message wins over the crawl pages', async () => {
    const dir = await crawlDir();
    const t1 = listMessage({ id: 't1', sendTs: '2026-10-09T01:00:00.000Z' });
    const t0 = listMessage({ id: 't0', sendTs: '2026-10-07T12:00:00.000Z' });
    await writePage(path.join(dir, 'topup', pageName(0)), [t1, t0, { ...a1, status: 'SUCCESS' }], new Date('2026-10-09T02:00:00.000Z'));
    const result = await build({ dir, liveStartDay: '2026-10-09', prices: prices(), ...emptyRegistries(), now: () => NOW });
    expect(result).toMatchObject({ days: 5, messages: 6 });
    const sql = await allSql(dir);
    expect(sql).toContain("'t0'");
    expect(sql).not.toContain("'t1'");
    expect(messageRows(sql, 'a1')).toEqual([expect.stringContaining("'SUCCESS'")]);
  });

  it('refuses to build when the crawl ends before live_start_day', async () => {
    const dir = await crawlDir([[a2, a1], [b1, c1]]);
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW })).rejects.toThrow(
      /before live_start_day 2026-10-08\. Run pnpm backfill:crawl --top-up/,
    );
  });

  it('refuses to build from a crawl that has not finished', async () => {
    const dir = await crawlDir();
    await writeCoverage(dir, false);
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW })).rejects.toThrow(
      'The crawl is not complete (coverage.json complete: false). Re-run pnpm backfill:crawl until it finishes.',
    );
  });

  it('builds a day whole even when a later page holds a message for it', async () => {
    const straggler = listMessage({ id: 'late', sendTs: '2026-10-06T08:00:00.000Z' });
    const dir = await crawlDir([[today1, a2, a1], [b1, c1], [straggler]]);
    const result = await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
    expect(result).toMatchObject({ days: 3, messages: 5 });
    expect(await archivedIds(dir, '2026-10-06')).toEqual(['a1', 'a2', 'late']);
  });

  it('names the file, index and field of an invalid message', async () => {
    const { sender: _sender, ...noSender } = b1;
    const dir = await crawlDir([[today1, a2, a1], [noSender, c1]]);
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW })).rejects.toThrow(
      'pages/00001.json[0] is not a valid CCIP list message (problem at sender)',
    );
  });

  it('seeds chains with their first and last message times, never overwriting registry fields', async () => {
    const dir = await crawlDir();
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
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
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
    expect(await allSql(dir)).toContain("VALUES ('15971525489660198786', 'base', 'Base Mainnet', 'EVM', '8453'");
  });

  it('writes daily_breakdown inserts that can be re-applied after a partial upload', async () => {
    const dir = await crawlDir();
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
    const inserts = (await allSql(dir)).split('\n').filter((line) => line.startsWith('INSERT INTO daily_breakdown'));
    expect(inserts.length).toBeGreaterThan(0);
    expect(inserts.filter((line) => !line.endsWith(` ${BREAKDOWN_CONFLICT};`))).toEqual([]);
  });

  it('names a corrupt price cache and tells the owner to delete it', async () => {
    const dir = await crawlDir();
    await mkdir(path.join(dir, 'prices'));
    const cacheFile = path.join(dir, 'prices', 'cache.json');
    await writeFile(cacheFile, '{"range":"2026-10-04..2026-10-07","hist');
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW })).rejects.toThrow(
      `The price cache ${cacheFile} is not valid JSON; delete it and run the build again`,
    );
  });
});

describe('build with the token-group price fallback', () => {
  // Three days before the token's only own price, so the near-day fill (two days at most) leaves b2 without one.
  const b2 = listMessage({ id: 'b2', sendTs: '2026-10-03T12:00:00.000Z', token: { address: TOKEN, amount: '5000000' } });
  const siblingPrices = () =>
    fakePrices({
      latest: { [KEY]: { price: 99, decimals: 6 }, [SIBLING_KEY]: { price: 99, decimals: 18 } },
      history: { [KEY]: { '2026-10-06': 2 }, [SIBLING_KEY]: { '2026-10-03': 3, '2026-10-06': 50 } },
    });
  const groupRegistry = () =>
    fakeCcip({
      chains: [NETWORKS.base, NETWORKS.ethereum],
      tokens: [registryToken(NETWORKS.base, TOKEN, 6), registryToken(NETWORKS.ethereum, SIBLING, 18)],
    });

  it('values a token on a day its own history lacks from a group sibling\'s price that day, with its own decimals', async () => {
    const dir = await crawlDir([[today1, a2, a1], [a1, b2, b1, c1]]);
    const result = await build({ dir, liveStartDay: '2026-10-08', prices: siblingPrices(), registry: groupRegistry(), coingecko: fakeCoingecko(), now: () => NOW });
    expect(tokenRows(await allSql(dir), 'b2')).toEqual([expect.stringContaining("'5000000', 15) ON CONFLICT")]);
    expect(result.unpricedMessages).toBe(0);
  });

  it('keeps the token\'s own price on a day its history has one', async () => {
    const dir = await crawlDir([[today1, a2, a1], [a1, b2, b1, c1]]);
    await build({ dir, liveStartDay: '2026-10-08', prices: siblingPrices(), registry: groupRegistry(), coingecko: fakeCoingecko(), now: () => NOW });
    expect(tokenRows(await allSql(dir), 'a2')).toEqual([expect.stringContaining("'5000000', 10) ON CONFLICT")]);
  });

  it('fetches a sibling\'s history only for a token that lacks a price', async () => {
    const dir = await crawlDir();
    const prices = siblingPrices();
    await build({ dir, liveStartDay: '2026-10-08', prices, registry: groupRegistry(), coingecko: fakeCoingecko(), now: () => NOW });
    expect(prices.latestCalls).toEqual([[KEY]]);
  });

  it('takes a registry chain\'s family and chain id from the crawled messages when /chains no longer lists it', async () => {
    const bscSibling = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const dir = await crawlDir([[today1, a2, a1], [a1, b2, b1, c1]]);
    const prices = fakePrices({ latest: { [`bsc:${bscSibling}`]: { price: 1, decimals: 18 } }, history: { [`bsc:${bscSibling}`]: { '2026-10-03': 4 } } });
    const registry = fakeCcip({ chains: [], tokens: [registryToken(NETWORKS.base, TOKEN, 6), registryToken(NETWORKS.bsc, bscSibling, 18)] });
    await build({ dir, liveStartDay: '2026-10-08', prices, registry, coingecko: fakeCoingecko(), now: () => NOW });
    expect(tokenRows(await allSql(dir), 'b2')).toEqual([expect.stringContaining("'5000000', 20) ON CONFLICT")]);
  });

  it('fails before spooling when the registry cannot be fetched, leaving the previous build intact', async () => {
    const dir = await crawlDir();
    const first = await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
    const down = { ...fakeCcip(), listTokens: async () => { throw new Error('GET /tokens failed with HTTP 503'); } };
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), registry: down, coingecko: fakeCoingecko(), now: () => NOW })).rejects.toThrow(
      'GET /tokens failed with HTTP 503',
    );
    expect((await readFile(path.join(dir, 'sql', 'BUILD'), 'utf8')).trim()).toBe(first.buildId);
    expect(existsSync(path.join(dir, 'days'))).toBe(false);
  });

  it('keeps the fetched registry in registry/tokens.json and registry/chains.json', async () => {
    const dir = await crawlDir();
    await build({ dir, liveStartDay: '2026-10-08', prices: siblingPrices(), registry: groupRegistry(), coingecko: fakeCoingecko(), now: () => NOW });
    const tokens = JSON.parse(await readFile(path.join(dir, 'registry', 'tokens.json'), 'utf8')) as RegistryToken[];
    const chains = JSON.parse(await readFile(path.join(dir, 'registry', 'chains.json'), 'utf8')) as NetworkInfo[];
    expect(tokens.map((t) => t.address)).toEqual([TOKEN, SIBLING]);
    expect(chains.map((c) => c.chainSelector)).toEqual([NETWORKS.base.chainSelector, NETWORKS.ethereum.chainSelector]);
  });
});

describe('build with the CoinGecko price fallback', () => {
  const coined = listMessage({ id: 'g1', sendTs: '2026-10-05T12:00:00.000Z', token: { address: COINED, amount: '5000000' } });
  const coinedDir = () => crawlDir([[today1, a2, a1], [a1, coined, b1, c1]]);
  const inRegistry = () => fakeCcip({ chains: [NETWORKS.base], tokens: [coinedToken()] });
  const withHistoryCalls = (prices: FakePrices) => {
    const historyCalls: string[] = [];
    const dailyHistory = prices.dailyHistory;
    return Object.assign(prices, {
      historyCalls,
      dailyHistory: (key: string, fromDay: string, toDay: string) => {
        historyCalls.push(key);
        return dailyHistory(key, fromDay, toDay);
      },
    });
  };

  it('fills a gap in the token\'s history from its coin\'s history that day, with its registry decimals', async () => {
    const dir = await coinedDir();
    const prices = fakePrices({ history: { [COIN_KEY]: { '2026-10-05': 4 } } });
    await build({ dir, liveStartDay: '2026-10-08', prices, registry: inRegistry(), coingecko: coingeckoLists(), now: () => NOW });
    expect(tokenRows(await allSql(dir), 'g1')).toEqual([expect.stringContaining("'5000000', 20) ON CONFLICT")]);
  });

  it('values a token outside the registry with the decimals DefiLlama gives its own key', async () => {
    const dir = await coinedDir();
    const prices = fakePrices({ latest: { [COINED_KEY]: { price: 99, decimals: 6 } }, history: { [COIN_KEY]: { '2026-10-05': 4 } } });
    await build({ dir, liveStartDay: '2026-10-08', prices, registry: fakeCcip(), coingecko: coingeckoLists(), now: () => NOW });
    expect(tokenRows(await allSql(dir), 'g1')).toEqual([expect.stringContaining("'5000000', 20) ON CONFLICT")]);
  });

  it('leaves a token unpriced when neither the registry nor DefiLlama knows its decimals', async () => {
    const dir = await coinedDir();
    const prices = fakePrices({ history: { [COIN_KEY]: { '2026-10-05': 4 } } });
    await build({ dir, liveStartDay: '2026-10-08', prices, registry: fakeCcip(), coingecko: coingeckoLists(), now: () => NOW });
    expect(tokenRows(await allSql(dir), 'g1')).toEqual([expect.stringContaining("'5000000', NULL) ON CONFLICT")]);
  });

  it('fetches a coin\'s history only for a token still unpriced after its own key and its group', async () => {
    const ownPriced = withHistoryCalls(
      fakePrices({ latest: { [COINED_KEY]: { price: 1, decimals: 6 } }, history: { [COINED_KEY]: { '2026-10-05': 1 } } }),
    );
    const unpriced = withHistoryCalls(fakePrices());
    for (const prices of [ownPriced, unpriced]) {
      const dir = await coinedDir();
      await build({ dir, liveStartDay: '2026-10-08', prices, registry: inRegistry(), coingecko: coingeckoLists(), now: () => NOW });
    }
    expect([ownPriced.historyCalls.includes(COIN_KEY), unpriced.historyCalls.includes(COIN_KEY)]).toEqual([false, true]);
  });

  it('fails before spooling when the CoinGecko lists cannot be fetched, leaving the previous build intact', async () => {
    const dir = await crawlDir();
    const first = await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
    const down = fakeCoingecko({}, { fail: new Error('GET /coins/list returned HTTP 429') });
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), registry: fakeCcip(), coingecko: down, now: () => NOW })).rejects.toThrow(
      'GET /coins/list returned HTTP 429',
    );
    expect((await readFile(path.join(dir, 'sql', 'BUILD'), 'utf8')).trim()).toBe(first.buildId);
    expect(existsSync(path.join(dir, 'days'))).toBe(false);
  });

  it('seeds the Worker\'s coingecko_ids with the registry tokens the lists map', async () => {
    const dir = await crawlDir();
    const registry = fakeCcip({ chains: [NETWORKS.base], tokens: [coinedToken(), registryToken(NETWORKS.base, GROUPED, 6)] });
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), registry, coingecko: coingeckoLists(), now: () => NOW });
    const seeds = (await allSql(dir)).split('\n').filter((line) => line.startsWith('INSERT INTO coingecko_ids '));
    expect(seeds).toEqual([
      "INSERT INTO coingecko_ids (chain, address, coin_id, updated_at) VALUES ('15971525489660198786', " +
        `'${COINED}', 'coined', '${NOW.toISOString()}') ON CONFLICT(chain, address) DO UPDATE SET coin_id = excluded.coin_id, ` +
        'updated_at = excluded.updated_at;',
    ]);
  });

  it('keeps the fetched CoinGecko lists in registry/', async () => {
    const dir = await crawlDir();
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), registry: fakeCcip(), coingecko: coingeckoLists(), now: () => NOW });
    const platforms = JSON.parse(await readFile(path.join(dir, 'registry', 'coingecko-platforms.json'), 'utf8')) as unknown[];
    const coins = JSON.parse(await readFile(path.join(dir, 'registry', 'coingecko-coins.json'), 'utf8')) as unknown[];
    expect({ platforms, coins }).toEqual({
      platforms: [{ id: 'base', chain_identifier: 8453 }],
      coins: [{ id: 'coined', platforms: { base: COINED } }],
    });
  });
});

describe('build near-day price fill', () => {
  const NEAR = '0x7777777777777777777777777777777777777777';
  const NEAR_KEY = `base:${NEAR}`;
  /** A data-only message that starts the build's price range on 10-02, so a gap on 10-04 can reach two days back. */
  const early = listMessage({ id: 'early', sendTs: '2026-10-02T12:00:00.000Z' });
  const sentOn = (id: string, sendTs: string) => listMessage({ id, sendTs, token: { address: NEAR, amount: '5000000' } });
  const pricesWith = (history: Record<string, number>) =>
    fakePrices({ latest: { [NEAR_KEY]: { price: 99, decimals: 6 } }, history: { [NEAR_KEY]: history } });
  const nearDir = (...messages: ReturnType<typeof listMessage>[]) => crawlDir([[today1, a2, a1], [a1, ...messages, b1, c1, early]]);
  const valueOf = async (message: ReturnType<typeof listMessage>, history: Record<string, number>) => {
    const dir = await nearDir(message);
    await build({ dir, liveStartDay: '2026-10-08', prices: pricesWith(history), ...emptyRegistries(), now: () => NOW });
    return tokenRows(await allSql(dir), message.messageId)[0]?.match(/'5000000', ([^)]*)\) ON CONFLICT/)?.[1];
  };

  it('fills a gap with points on both sides from the nearest one, the earlier on a tie', async () => {
    expect(await valueOf(sentOn('n5', '2026-10-05T12:00:00.000Z'), { '2026-10-04': 1, '2026-10-06': 9 })).toBe('5');
  });

  it('takes a nearer later point over a farther earlier one', async () => {
    expect(await valueOf(sentOn('n5', '2026-10-05T12:00:00.000Z'), { '2026-10-03': 1, '2026-10-06': 9 })).toBe('45');
  });

  it('reaches two days on each side', async () => {
    expect(await valueOf(sentOn('n4', '2026-10-04T23:30:00.000Z'), { '2026-10-02': 1, '2026-10-06': 9 })).toBe('5');
  });

  it('does not carry a series back before its first point', async () => {
    expect(await valueOf(sentOn('n4', '2026-10-04T23:30:00.000Z'), { '2026-10-05': 9, '2026-10-06': 9 })).toBe('NULL');
  });

  it('does not carry a series forward after its last point', async () => {
    expect(await valueOf(sentOn('n6', '2026-10-06T12:00:00.000Z'), { '2026-10-04': 1, '2026-10-05': 1 })).toBe('NULL');
  });

  it('leaves a gap unpriced when the point on one side is three days away', async () => {
    expect(await valueOf(sentOn('n5', '2026-10-05T12:00:00.000Z'), { '2026-10-02': 1, '2026-10-06': 9 })).toBe('NULL');
  });

  it('fills a sibling\'s and a coin\'s series the same way', async () => {
    const tokens = [registryToken(NETWORKS.base, NEAR, 6), registryToken(NETWORKS.ethereum, SIBLING, 18), coinedToken()];
    const viaSibling = sentOn('s5', '2026-10-05T12:00:00.000Z');
    const viaCoin = listMessage({ id: 'c5', sendTs: '2026-10-05T13:00:00.000Z', token: { address: COINED, amount: '5000000' } });
    const dir = await nearDir(viaSibling, viaCoin);
    const prices = fakePrices({
      latest: { [SIBLING_KEY]: { price: 99, decimals: 18 } },
      history: { [SIBLING_KEY]: { '2026-10-04': 3, '2026-10-06': 50 }, [COIN_KEY]: { '2026-10-03': 7, '2026-10-07': 70 } },
    });
    const registry = fakeCcip({ chains: [NETWORKS.base, NETWORKS.ethereum], tokens });
    await build({ dir, liveStartDay: '2026-10-08', prices, registry, coingecko: coingeckoLists(), now: () => NOW });
    const sql = await allSql(dir);
    expect([tokenRows(sql, 's5'), tokenRows(sql, 'c5')]).toEqual([
      [expect.stringContaining("'5000000', 15) ON CONFLICT")],
      [expect.stringContaining("'5000000', 35) ON CONFLICT")],
    ]);
  });

  it('prefers the token\'s own near-day price to a sibling\'s price that day', async () => {
    const dir = await nearDir(sentOn('s5', '2026-10-05T12:00:00.000Z'));
    const prices = fakePrices({
      latest: { [NEAR_KEY]: { price: 99, decimals: 6 }, [SIBLING_KEY]: { price: 99, decimals: 18 } },
      history: { [NEAR_KEY]: { '2026-10-04': 1, '2026-10-06': 9 }, [SIBLING_KEY]: { '2026-10-05': 50 } },
    });
    const tokens = [registryToken(NETWORKS.base, NEAR, 6), registryToken(NETWORKS.ethereum, SIBLING, 18)];
    const registry = fakeCcip({ chains: [NETWORKS.base, NETWORKS.ethereum], tokens });
    await build({ dir, liveStartDay: '2026-10-08', prices, registry, coingecko: fakeCoingecko(), now: () => NOW });
    expect(tokenRows(await allSql(dir), 's5')).toEqual([expect.stringContaining("'5000000', 5) ON CONFLICT")]);
  });
});

describe('build price sanity guards', () => {
  const ELIZA = '0x8888888888888888888888888888888888888888';
  const ELIZA_KEY = `base:${ELIZA}`;
  const sent = (id: string, sendTs: string, amount: string) => listMessage({ id, sendTs, token: { address: ELIZA, amount } });
  /** elizaOS's launch: one transfer on the bogus $125,176 first day of its DefiLlama history, one the day after. */
  const launch = sent('g1', '2026-10-04T12:00:00.000Z', '1000000000');
  const nextDay = sent('g2', '2026-10-05T12:00:00.000Z', '1000000000');

  async function buildWith(history: Record<string, number>, ...messages: ReturnType<typeof listMessage>[]) {
    const dir = await crawlDir([[today1, a2, a1], [a1, b1, c1, ...messages]]);
    await writeCoverage(dir, true, { stopped_at_depth_wall: false });
    const log: string[] = [];
    const prices = fakePrices({ latest: { [ELIZA_KEY]: { price: 0.00037, decimals: 6 } }, history: { [ELIZA_KEY]: history } });
    const result = await build({ dir, liveStartDay: '2026-10-08', prices, ...emptyRegistries(), now: () => NOW, log: (line) => log.push(line) });
    return { result, log, sql: await allSql(dir) };
  }

  function totalsOn(sql: string, day: string): Record<string, string> {
    const line = sql.split('\n').find((l) => l.startsWith('INSERT INTO daily_totals ') && l.includes(`VALUES ('${day}'`)) ?? '';
    const [, columns = '', values = ''] = /^INSERT INTO daily_totals \(([^)]*)\) VALUES \(([^)]*)\)/.exec(line) ?? [];
    return Object.fromEntries(columns.split(', ').map((column, i) => [column, values.split(', ')[i] ?? '']));
  }

  it('drops a glitched launch-day price, so the transfers that day stay unpriced and out of the day\'s total', async () => {
    const { sql } = await buildWith({ '2026-10-04': 125_176.45, '2026-10-05': 0.0101, '2026-10-06': 0.0092, '2026-10-07': 0.0095 }, launch, nextDay);
    expect([totalsOn(sql, '2026-10-04').usd_value, totalsOn(sql, '2026-10-04').unpriced_messages, tokenRows(sql, 'g1'), tokenRows(sql, 'g2')]).toEqual([
      '0',
      '1',
      [expect.stringContaining("'1000000000', NULL) ON CONFLICT")],
      [expect.stringContaining("'1000000000', 10.1) ON CONFLICT")],
    ]);
  });

  it('reports how many daily prices it dropped, per key, at the end of the build', async () => {
    const { result, log } = await buildWith({ '2026-10-04': 125_176.45, '2026-10-05': 0.0101, '2026-10-06': 0.0092, '2026-10-07': 0.0095 }, launch);
    expect([result.droppedPrices, log.slice(-2)]).toEqual([1, [`dropped 1 glitched daily price(s) in total`, `  ${ELIZA_KEY}: 1`]]);
  });

  it('leaves a transfer valued above MAX_TRANSFER_USD unpriced and counts it in priceOutliers', async () => {
    const flat = { '2026-10-04': 2, '2026-10-05': 2, '2026-10-06': 2, '2026-10-07': 2 };
    const { result, sql, log } = await buildWith(flat, sent('g1', '2026-10-04T12:00:00.000Z', '10000000000000000'), nextDay);
    expect([result.priceOutliers, result.droppedPrices, tokenRows(sql, 'g1'), totalsOn(sql, '2026-10-04').usd_value]).toEqual([
      1,
      0,
      [expect.stringContaining("'10000000000000000', NULL) ON CONFLICT")],
      '0',
    ]);
    expect(log).toContain('1 token amount(s) valued above $10,000,000,000 were left unpriced');
  });
});

describe('build from per-source crawls', () => {
  it('rolls up each day once when sources and the global crawl cover the same days', async () => {
    const dir = await sourcesDir();
    const result = await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
    expect(result).toMatchObject({ days: 3, messages: 7 });
    expect(totalsDays(await allSql(dir))).toEqual(['2026-10-04', '2026-10-05', '2026-10-06']);
  });

  it('stores a message found by the global crawl and a source once, as the source saw it', async () => {
    const dir = await sourcesDir();
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
    expect(messageRows(await allSql(dir), 'a2')).toEqual([expect.stringContaining("'SUCCESS'")]);
  });

  it('starts coverage at the earliest day when no source stopped at a depth wall', async () => {
    const dir = await sourcesDir();
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
    expect(await allSql(dir)).toContain("INSERT INTO meta (key, value) VALUES ('coverage_from', '2026-10-04')");
  });

  it('starts coverage the day after the latest walled source\'s oldest day', async () => {
    const dir = await crawlDir();
    await addSources(dir, [
      { network: NETWORKS.base, pages: [[today1, a2, a1], [b1, c1]], summary: { stopped_at_depth_wall: true, coverage_from: c1.sendTimestamp } },
      { network: NETWORKS.ethereum, pages: [[e2, e1]], summary: { stopped_at_depth_wall: true, coverage_from: e1.sendTimestamp } },
    ]);
    const result = await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
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
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW })).rejects.toThrow(
      'Source 5009297550715157269 (ethereum-mainnet) failed in the per-source crawl: HTTP 500',
    );
  });

  it('refuses a source that has not finished', async () => {
    const dir = await sourcesDir({ ethereum: { done: false } });
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW })).rejects.toThrow(
      'Source 5009297550715157269 (ethereum-mainnet) has not finished its per-source crawl',
    );
  });

  it('refuses a walled source with no coverage_from and names it', async () => {
    const dir = await sourcesDir({ ethereum: { stopped_at_depth_wall: true, coverage_from: null } });
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW })).rejects.toThrow(
      'Source 5009297550715157269 (ethereum-mainnet) stopped at a depth wall before it crawled any message',
    );
  });

  it('refuses a summary in which no source was crawled', async () => {
    const dir = await crawlDir();
    await addSources(dir, [{ network: NETWORKS.sui, pages: [], summary: { done: false, unsupported: true } }]);
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW })).rejects.toThrow(
      'sources/summary.json lists no source that was crawled',
    );
  });

  it('ignores a source the API does not support', async () => {
    const dir = await crawlDir();
    await addSources(dir, [
      { network: NETWORKS.base, pages: [[today1, a2, a1], [b1, c1]], summary: { coverage_from: c1.sendTimestamp } },
      { network: NETWORKS.sui, pages: [], summary: { done: false, unsupported: true } },
    ]);
    const result = await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
    expect(result).toMatchObject({ days: 3, messages: 4 });
  });

  it('still needs a complete global crawl when there are global pages', async () => {
    const dir = await sourcesDir();
    await writeCoverage(dir, false);
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW })).rejects.toThrow(
      'The crawl is not complete (coverage.json complete: false)',
    );
  });

  it('writes the skipped poison messages of every crawl to skipped.json once each', async () => {
    const p1 = { messageId: 'p1', sendTimestamp: '2026-10-05T03:00:00.000Z', after: { sendTimestamp: b1.sendTimestamp, messageId: 'b1' } };
    const p2 = { messageId: 'p2', sendTimestamp: '2026-10-04T03:00:00.000Z', after: { sendTimestamp: c1.sendTimestamp, messageId: 'c1' } };
    const p3 = { messageId: 'p3', sendTimestamp: '2026-10-06T03:00:00.000Z', after: { sendTimestamp: e2.sendTimestamp, messageId: 'e2' } };
    const dir = await sourcesDir({ base: { skipped: [p1, p2] }, ethereum: { skipped: [p3] } });
    await writeCoverage(dir, true, { skipped: [p1] });
    const result = await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
    expect(JSON.parse(await readFile(path.join(dir, 'skipped.json'), 'utf8'))).toEqual([p1, p2, p3]);
    expect(result.skippedMessages).toBe(3);
  });

  it('writes the global crawl\'s skipped messages to skipped.json without per-source crawls', async () => {
    const p1 = { messageId: 'p1', sendTimestamp: '2026-10-05T03:00:00.000Z', after: { sendTimestamp: '2026-10-05T04:00:00.000Z', messageId: 'b1' } };
    const dir = await crawlDir();
    await writeCoverage(dir, true, { skipped: [p1] });
    const result = await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
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
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
    expect(messageRows(await allSql(dir), 'a1')).toEqual([expect.stringContaining("'SUCCESS'")]);
  });

  it('keeps a source copy fetched after the top-up', async () => {
    const dir = await sourceAndTopUp(SOURCES_AT, new Date('2026-10-08T05:00:00.000Z'));
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
    expect(messageRows(await allSql(dir), 'a1')).toEqual([expect.stringContaining("'SENT'")]);
  });

  it('refuses messages from a source the API cannot back-fill', async () => {
    const dir = await crawlDir([[today1, a2, a1, e1], [b1, c1]]);
    await addSources(dir, [
      { network: NETWORKS.base, pages: [[today1, a2, a1], [b1, c1]], summary: { coverage_from: c1.sendTimestamp } },
      { network: NETWORKS.ethereum, pages: [], summary: { done: false, unsupported: true } },
    ]);
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW })).rejects.toThrow(
      /Source 5009297550715157269 \(ethereum-mainnet\) .*the API cannot back-fill it/,
    );
  });

  it('refuses a source whose crawl started before live_start_day and names it', async () => {
    const dir = await crawlDir();
    await addSources(dir, [
      { network: NETWORKS.base, pages: [[today1, a2, a1], [b1, c1]], summary: { coverage_from: c1.sendTimestamp } },
      { network: NETWORKS.ethereum, pages: [[e2, e1], [e0]], summary: { coverage_from: e0.sendTimestamp }, fetchedAt: new Date('2026-10-07T23:59:00.000Z') },
    ]);
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW })).rejects.toThrow(
      /started before 00:00 UTC of live_start_day 2026-10-08: 5009297550715157269 \(ethereum-mainnet\)\. Delete/,
    );
  });

  it('refuses when coverage_from would leave no complete day before live_start_day', async () => {
    const dir = await sourcesDir({ ethereum: { stopped_at_depth_wall: true, coverage_from: '2026-10-07T05:00:00.000Z' } });
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW })).rejects.toThrow(
      'No complete day to roll up: coverage_from would be 2026-10-08',
    );
  });

  it('refuses a sources directory without summary.json', async () => {
    const dir = await crawlDir();
    await writePage(path.join(dir, 'sources', NETWORKS.ethereum.chainSelector, 'pages', pageName(0)), [e2, e1], SOURCES_AT);
    await expect(build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW })).rejects.toThrow(
      'has no summary.json',
    );
  });

  it('removes the day spool after a successful build', async () => {
    const dir = await sourcesDir();
    await build({ dir, liveStartDay: '2026-10-08', prices: prices(), ...emptyRegistries(), now: () => NOW });
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

describe('PriceCache beforeTrading', () => {
  const COIN = 'coingecko:newcoin';
  const OLD = 'coingecko:oldcoin';
  const OTHER = 'coingecko:othercoin';
  const history = {
    [COIN]: { '2026-10-04': 4, '2026-10-05': 5, '2026-10-06': 6, '2026-10-11': 10, '2026-10-12': 10 },
    [OLD]: { '2026-10-01': 1.1, '2026-10-02': 1.2, '2026-10-03': 1.3 },
    [OTHER]: { '2026-10-04': 4 },
  };

  async function lookupOf(beforeTrading: Map<string, { predecessor?: string }>, day: string) {
    const dir = await mkdtemp(path.join(tmpdir(), 'price-cache-'));
    const cache = await PriceCache.open(fakePrices({ history }), path.join(dir, 'cache.json'), '2026-10-01', '2026-10-12', { beforeTrading });
    await cache.ensure([COIN, OLD, OTHER]);
    return cache.lookupOn(day);
  }

  it('values a day before the series starts at its first price', async () => {
    // #given, #when
    const lookup = await lookupOf(new Map([[COIN, {}]]), '2026-10-02');
    // #then
    expect(lookup(COIN)).toEqual({ price: 4, decimals: COIN_PRICE_DECIMALS });
  });

  it('values a day before the series starts at the predecessor\'s price that day', async () => {
    // #given, #when
    const lookup = await lookupOf(new Map([[COIN, { predecessor: OLD }]]), '2026-10-02');
    // #then
    expect(lookup(COIN)).toEqual({ price: 1.2, decimals: COIN_PRICE_DECIMALS });
  });

  it('leaves a gap after the series has started unpriced', async () => {
    // #given, #when
    const lookup = await lookupOf(new Map([[COIN, {}]]), '2026-10-08');
    // #then
    expect(lookup(COIN)).toBeUndefined();
  });

  it('leaves a key without a rule unpriced before its series starts', async () => {
    // #given, #when
    const lookup = await lookupOf(new Map([[COIN, {}]]), '2026-10-02');
    // #then
    expect(lookup(OTHER)).toBeUndefined();
  });

  it('prefers the normal price on a day the series has one', async () => {
    // #given, #when
    const lookup = await lookupOf(new Map([[COIN, {}]]), '2026-10-05');
    // #then
    expect(lookup(COIN)?.price).toBe(5);
  });
});
