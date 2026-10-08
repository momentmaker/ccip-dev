import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { PricesClient } from '@ccip-dev/core';
import { describe, expect, it } from 'vitest';
import listPage from '../../packages/core/test/fixtures/list-page.json';
import { buildFees, flagFeeOutliers } from '../backfill/fees/build';
import { appendRecords, readSealedDay, sealDay, type DetailRecord } from '../backfill/fees/store';

const DAY = '2026-10-04';
const BASE = '15971525489660198786';
const LINK = '0x88fb150bdc53a65fe94dea0c9ba0a6daf8c6e196';
const WETH = '0x4200000000000000000000000000000000000006';
const sample = listPage.data[0];

function message(id: string): unknown {
  const m = structuredClone(sample) as Record<string, unknown> & { sourceNetworkInfo: Record<string, unknown> };
  return { ...m, messageId: id, sendTimestamp: `${DAY}T12:00:00Z`, sourceNetworkInfo: { ...m.sourceNetworkInfo, chainSelector: BASE, chainId: '8453', chainFamily: 'EVM' } };
}

const ok = (id: string, token: string, amount: string): DetailRecord => ({ id, kind: 'ok', fetchedAt: '2026-10-08T00:00:00.000Z', version: '1.6.0', fee: { token, amount }, feeShapeUnknown: false, tokens: [] });
const unknownShape = (id: string): DetailRecord => ({ id, kind: 'ok', fetchedAt: '2026-10-08T00:00:00.000Z', version: '1.0.0', fee: null, feeShapeUnknown: true, tokens: [] });

const noPrices: PricesClient = {
  latest: async () => new Map(),
  dailyHistory: async () => [],
} as unknown as PricesClient;

async function backfill(opts: { range?: string; records: DetailRecord[] }): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fees-build-'));
  const archive = path.join(dir, 'archive', 'messages', '2026', '10', '04.jsonl.gz');
  await mkdir(path.dirname(archive), { recursive: true });
  await writeFile(archive, gzipSync(['0xlink', '0xweth', '0xgone'].map((id) => JSON.stringify(message(id))).join('\n') + '\n'));
  await mkdir(path.join(dir, 'prices'), { recursive: true });
  await writeFile(path.join(dir, 'prices', 'cache.json'), JSON.stringify({
    range: opts.range ?? `${DAY}..${DAY}`,
    history: { [`base:${LINK}`]: { [DAY]: 10 }, [`base:${WETH}`]: { [DAY]: 2000 } },
    decimals: { [`base:${LINK}`]: 18, [`base:${WETH}`]: 18 },
  }));
  await mkdir(path.join(dir, 'registry'), { recursive: true });
  await writeFile(path.join(dir, 'registry', 'tokens.json'), JSON.stringify([
    { chainSelector: '5009297550715157269', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK', name: 'ChainLink Token', decimals: 18, groupId: 'link' },
    { chainSelector: BASE, address: LINK, symbol: 'LINK', name: 'ChainLink Token', decimals: 18, groupId: 'link' },
  ]));
  await appendRecords(dir, DAY, opts.records);
  await sealDay(dir, DAY);
  return dir;
}

async function sqlOf(dir: string): Promise<string> {
  const batchDir = path.join(dir, 'fees', 'sql', 'B0001');
  const files = (await readdir(batchDir)).filter((f) => f.endsWith('.sql')).sort();
  return (await Promise.all(files.map((f) => readFile(path.join(batchDir, f), 'utf8')))).join('');
}

const records = [ok('0xlink', LINK, '100000000000000000'), ok('0xweth', WETH, '1000000000000000'), { id: '0xgone', kind: 'skip', fetchedAt: 't', status: 404, reason: 'HTTP 404' } as DetailRecord];

describe('buildFees', () => {
  it('updates only backfill rows not filled yet, valued at the send day price', async () => {
    // #given
    const dir = await backfill({ records });
    // #when
    await buildFees({ dir, prices: noPrices });
    // #then
    expect(await sqlOf(dir)).toContain(
      `UPDATE messages SET fee_token = '${WETH}', fee_amount = '1000000000000000', fee_usd = 2, detail_fetched_at = '2026-10-08T00:00:00.000Z' WHERE message_id = '0xweth' AND source = 'backfill' AND detail_fetched_at IS NULL;`,
    );
  });

  it('leaves a skipped message out of the message updates', async () => {
    // #given
    const dir = await backfill({ records });
    // #when
    await buildFees({ dir, prices: noPrices });
    // #then
    expect(await sqlOf(dir)).not.toMatch(/message_id = '0xgone'/);
  });

  it("writes the day's fee total and LINK-paid fees", async () => {
    // #given
    const dir = await backfill({ records });
    // #when
    await buildFees({ dir, prices: noPrices });
    // #then
    expect(await sqlOf(dir)).toContain(`UPDATE daily_totals SET fee_usd = 3, fee_link_usd = 1 WHERE day = '${DAY}';`);
  });

  it('writes the fee of each source chain, destination chain, lane and sender group', async () => {
    // #given
    const dir = await backfill({ records });
    // #when
    await buildFees({ dir, prices: noPrices });
    // #then
    const sql = await sqlOf(dir);
    expect(sql).toMatch(new RegExp(`UPDATE daily_breakdown SET fee_usd = 3 WHERE day = '${DAY}' AND dim = 'src_chain' AND key = '${BASE}';`));
    expect(sql).toMatch(new RegExp(`dim = 'lane' AND key = '${BASE}>\\d+';`));
    expect(sql).toMatch(new RegExp(`dim = 'sender' AND key = '${BASE}:0x[0-9a-fA-F]+';`));
    expect(sql).not.toMatch(/dim = 'token'/);
  });

  it('writes NULL fee aggregates for a day whose details were all skipped', async () => {
    // #given
    const dir = await backfill({ records: ['0xlink', '0xweth', '0xgone'].map((id) => ({ id, kind: 'skip', fetchedAt: 't', status: 404, reason: 'HTTP 404' }) as DetailRecord) });
    // #when
    await buildFees({ dir, prices: noPrices });
    // #then
    expect(await sqlOf(dir)).toContain(`UPDATE daily_totals SET fee_usd = NULL, fee_link_usd = NULL WHERE day = '${DAY}';`);
  });

  it('refuses a price cache built for another range', async () => {
    // #given
    const dir = await backfill({ records, range: '2023-07-06..2026-10-03' });
    // #when, #then
    await expect(buildFees({ dir, prices: noPrices })).rejects.toThrow(/refusing to start a new cache/);
  });

  it('builds a day only once', async () => {
    // #given
    const dir = await backfill({ records });
    await buildFees({ dir, prices: noPrices });
    // #when, #then
    expect((await buildFees({ dir, prices: noPrices })).days).toEqual([]);
  });
});

describe('rebuilding a changed day', () => {
  async function reseal(dir: string, extra: DetailRecord[]): Promise<void> {
    await appendRecords(dir, DAY, [...(await readSealedDay(dir, DAY)), ...extra]);
    await sealDay(dir, DAY);
  }

  it('builds again only the day whose sealed file changed, in a new batch', async () => {
    // #given
    const dir = await backfill({ records });
    await buildFees({ dir, prices: noPrices });
    await reseal(dir, [ok('0xgone', WETH, '1000000000000000')]);
    // #when
    const second = await buildFees({ dir, prices: noPrices });
    // #then
    expect([second.batch, second.days]).toEqual(['B0002', [DAY]]);
    expect(await readFile(path.join(dir, 'fees', 'sql', 'B0002', '00001.sql'), 'utf8')).toContain('UPDATE daily_totals SET fee_usd = 5, fee_link_usd = 1');
  });

  it('refuses a sealed day that lacks a record for an archived message', async () => {
    // #given
    const dir = await backfill({ records });
    await buildFees({ dir, prices: noPrices });
    await appendRecords(dir, DAY, [ok('0xweth', WETH, '1000000000000000')]);
    await sealDay(dir, DAY);
    // #when, #then
    await expect(buildFees({ dir, prices: noPrices })).rejects.toThrow('fee build: 2026-10-04 has 2 archived messages with no detail record; its sealed file is incomplete');
  });
});

describe('buildFees inputs', () => {
  it('refuses a missing price cache', async () => {
    // #given
    const dir = await backfill({ records });
    await rm(path.join(dir, 'prices', 'cache.json'));
    // #when, #then
    await expect(buildFees({ dir, prices: noPrices })).rejects.toThrow(/price cache/);
  });

  it('refuses an empty archive', async () => {
    // #given
    const dir = await backfill({ records });
    await rm(path.join(dir, 'archive'), { recursive: true });
    // #when, #then
    await expect(buildFees({ dir, prices: noPrices })).rejects.toThrow(`no archive days under ${path.join(dir, 'archive', 'messages')}`);
  });

  it('adds the price series of a new fee token and keeps the cached ones', async () => {
    // #given
    const NEW = '0x1111111111111111111111111111111111111111';
    const dir = await backfill({ records: [ok('0xlink', LINK, '100000000000000000'), ok('0xweth', NEW, '1000000000000000'), ok('0xgone', WETH, '1000000000000000')] });
    const client = {
      latest: async () => new Map([[`base:${NEW}`, { price: 1, decimals: 18 }]]),
      dailyHistory: async () => [[DAY, 4]],
    } as unknown as PricesClient;
    // #when
    await buildFees({ dir, prices: client });
    // #then
    const cache = JSON.parse(await readFile(path.join(dir, 'prices', 'cache.json'), 'utf8')) as { history: Record<string, unknown> };
    expect(Object.keys(cache.history).sort()).toEqual([`base:${LINK}`, `base:${NEW}`, `base:${WETH}`].sort());
  });

  it('flags a day whose fee tokens mostly lack a price', async () => {
    // #given
    const NEW = '0x1111111111111111111111111111111111111111';
    const dir = await backfill({ records: [ok('0xlink', LINK, '100000000000000000'), ok('0xweth', NEW, '1000000000000000'), ok('0xgone', NEW, '1000000000000000')] });
    const client = { latest: async () => new Map(), dailyHistory: async () => [] } as unknown as PricesClient;
    // #when
    const result = await buildFees({ dir, prices: client });
    // #then
    expect(result.lowPricedDays).toEqual([DAY]);
  });
});

describe('unknown fee shapes', () => {
  const withUnknown = [ok('0xlink', LINK, '100000000000000000'), unknownShape('0xweth'), { id: '0xgone', kind: 'skip', fetchedAt: 't', status: 404, reason: 'HTTP 404' } as DetailRecord];

  it('leaves a message with an unknown fee shape out of the message updates, so it stays unfilled', async () => {
    // #given
    const dir = await backfill({ records: withUnknown });
    // #when
    await buildFees({ dir, prices: noPrices });
    // #then
    expect(await sqlOf(dir)).not.toMatch(/message_id = '0xweth'/);
  });

  it('still counts a message with an unknown fee shape in the day rollup, with no fee', async () => {
    // #given
    const dir = await backfill({ records: withUnknown });
    // #when
    await buildFees({ dir, prices: noPrices });
    // #then
    expect(await sqlOf(dir)).toContain(`UPDATE daily_totals SET fee_usd = 1, fee_link_usd = 1 WHERE day = '${DAY}';`);
  });

  it('reports the days with unknown fee shapes', async () => {
    // #given
    const dir = await backfill({ records: withUnknown });
    // #when
    const result = await buildFees({ dir, prices: noPrices });
    // #then
    expect(result.unknownShapeDays).toEqual([DAY]);
  });

  it('logs a check line for a day with unknown fee shapes', async () => {
    // #given
    const dir = await backfill({ records: withUnknown });
    const lines: string[] = [];
    // #when
    await buildFees({ dir, prices: noPrices, log: (l) => lines.push(l) });
    // #then
    expect(lines).toContain(`check: ${DAY} has 1 messages with an unknown fee shape; hold this batch and inspect .backfill/fees/unparsed/`);
  });

  it('saves the count of unknown fee shapes in the day checks', async () => {
    // #given
    const dir = await backfill({ records: withUnknown });
    // #when
    await buildFees({ dir, prices: noPrices });
    // #then
    const saved = JSON.parse(await readFile(path.join(dir, 'fees', 'checks', 'B0001.json'), 'utf8')) as { checks: { unknownShapes: number }[] };
    expect(saved.checks.map((c) => c.unknownShapes)).toEqual([1]);
  });
});

describe('buildFees state', () => {
  it('names build-state.json when it is corrupt', async () => {
    // #given
    const dir = await backfill({ records });
    const statePath = path.join(dir, 'fees', 'build-state.json');
    await writeFile(statePath, '{"built": {');
    // #when, #then
    await expect(buildFees({ dir, prices: noPrices })).rejects.toThrow(`${statePath}: `);
  });

  it('numbers a new batch after every earlier one when build-state.json is gone', async () => {
    // #given
    const dir = await backfill({ records });
    await buildFees({ dir, prices: noPrices });
    await rm(path.join(dir, 'fees', 'build-state.json'));
    // #when
    const rebuilt = await buildFees({ dir, prices: noPrices });
    // #then
    expect(rebuilt.batch).toBe('B0002');
  });
});

describe('flagFeeOutliers', () => {
  it('flags a day whose fee per message is more than 5x its neighbours median', () => {
    // #given
    const checks = ['01', '02', '03', '04', '05', '06', '07'].map((d, i) => ({ day: `2026-01-${d}`, messages: 100, withFee: 100, priced: 100, feeUsd: i === 3 ? 600 : 100, perMessage: i === 3 ? 6 : 1 }));
    // #when, #then
    expect(flagFeeOutliers(checks)).toEqual(['2026-01-04']);
  });

  it('flags a day whose fee per message is less than a fifth of its neighbours median', () => {
    // #given
    const checks = ['01', '02', '03', '04', '05', '06', '07'].map((d, i) => ({ day: `2026-01-${d}`, messages: 100, withFee: 100, priced: 100, feeUsd: i === 3 ? 10 : 100, perMessage: i === 3 ? 0.1 : 1 }));
    // #when, #then
    expect(flagFeeOutliers(checks)).toEqual(['2026-01-04']);
  });
});
