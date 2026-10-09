import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import type { PricesClient } from '@ccip-dev/core';
import { describe, expect, it } from 'vitest';
import listPage from '../../packages/core/test/fixtures/list-page.json';
import { buildFees, CURRENT_FEE_PRICING, FEE_BUILD_FORMAT, feePricingHash, flagFeeOutliers } from '../backfill/fees/build';
import { appendRecords, readSealedDay, sealDay, type DetailRecord } from '../backfill/fees/store';

const DAY = '2026-10-04';
const BASE = '15971525489660198786';
const LINK = '0x88fb150bdc53a65fe94dea0c9ba0a6daf8c6e196';
const WETH = '0x4200000000000000000000000000000000000006';
const sample = listPage.data[0];

interface SourceChain {
  chainSelector: string;
  chainId: string;
}

const ON_BASE: SourceChain = { chainSelector: BASE, chainId: '8453' };

function message(id: string, src: SourceChain): unknown {
  const m = structuredClone(sample) as Record<string, unknown> & { sourceNetworkInfo: Record<string, unknown> };
  return { ...m, messageId: id, sendTimestamp: `${DAY}T12:00:00Z`, sourceNetworkInfo: { ...m.sourceNetworkInfo, ...src, chainFamily: 'EVM' } };
}

const ok = (id: string, token: string, amount: string): DetailRecord => ({ id, kind: 'ok', fetchedAt: '2026-10-08T00:00:00.000Z', version: '1.6.0', fee: { token, amount }, feeShapeUnknown: false, tokens: [] });
const unknownShape = (id: string): DetailRecord => ({ id, kind: 'ok', fetchedAt: '2026-10-08T00:00:00.000Z', version: '1.0.0', fee: null, feeShapeUnknown: true, tokens: [] });

const noPrices: PricesClient = {
  latest: async () => new Map(),
  dailyHistory: async () => [],
} as unknown as PricesClient;

async function backfill(opts: { range?: string; records: DetailRecord[]; src?: SourceChain }): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fees-build-'));
  const archive = path.join(dir, 'archive', 'messages', '2026', '10', '04.jsonl.gz');
  await mkdir(path.dirname(archive), { recursive: true });
  await writeFile(archive, gzipSync(['0xlink', '0xweth', '0xgone'].map((id) => JSON.stringify(message(id, opts.src ?? ON_BASE))).join('\n') + '\n'));
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

const MIGRATIONS = path.resolve(import.meta.dirname, '../../worker/migrations');

const records = [ok('0xlink', LINK, '100000000000000000'), ok('0xweth', WETH, '1000000000000000'), { id: '0xgone', kind: 'skip', fetchedAt: 't', status: 404, reason: 'HTTP 404' } as DetailRecord];

describe('buildFees', () => {
  it('updates only backfill rows not filled yet, valued at the send day price', async () => {
    // #given
    const dir = await backfill({ records });
    // #when
    await buildFees({ dir, prices: noPrices });
    // #then
    expect(await sqlOf(dir)).toContain(
      `UPDATE messages SET fee_token = '${WETH}', fee_amount = '1000000000000000', fee_usd = 2, detail_fetched_at = '2026-10-08T00:00:00.000Z' WHERE message_id = '0xweth' AND source = 'backfill' AND (detail_fetched_at IS NULL OR fee_usd IS NULL);`,
    );
  });

  it('writes the fees paid in gas tokens and stablecoins, and the LINK paid in LINK units', async () => {
    // #given the Worker's finalize test day: 0.1 LINK worth $1, WETH worth $2 and GHO worth $3
    const GHO = '0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee';
    const dir = await backfill({ records: [ok('0xlink', LINK, '100000000000000000'), ok('0xweth', WETH, '1000000000000000'), ok('0xgone', GHO, '3000000000000000000')] });
    const prices = { latest: async () => new Map([[`base:${GHO}`, { price: 1, decimals: 18 }]]), dailyHistory: async () => [[DAY, 1]] } as unknown as PricesClient;
    // #when
    await buildFees({ dir, prices });
    // #then
    expect(await sqlOf(dir)).toContain(`UPDATE daily_totals SET fee_usd = 6, fee_link_usd = 1, fee_native_usd = 2, fee_stable_usd = 3, fee_link_amount = 0.1 WHERE day = '${DAY}';`);
  });

  it('fills the fee of a row an earlier batch filled without a price, and leaves a priced row alone', async () => {
    // #given
    const dir = await backfill({ records });
    const db = new DatabaseSync(':memory:');
    for (const file of (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort()) db.exec(await readFile(path.join(MIGRATIONS, file), 'utf8'));
    const filledEarlier = db.prepare(
      `INSERT INTO messages (message_id, day, send_ts, status, src_chain, dst_chain, sender, fee_token, fee_amount, fee_usd, detail_fetched_at, source)
       VALUES (?, '${DAY}', '${DAY}T12:00:00Z', 'SUCCESS', '${BASE}', '1', '0x1', ?, ?, ?, '2026-10-07T00:00:00.000Z', 'backfill')`,
    );
    filledEarlier.run('0xlink', LINK, '100000000000000000', 99);
    filledEarlier.run('0xweth', WETH, '1000000000000000', null);
    // #when
    await buildFees({ dir, prices: noPrices });
    db.exec(await sqlOf(dir));
    // #then
    expect(db.prepare('SELECT message_id, fee_usd FROM messages ORDER BY message_id').all()).toEqual([
      { message_id: '0xlink', fee_usd: 99 },
      { message_id: '0xweth', fee_usd: 2 },
    ]);
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
    expect(await sqlOf(dir)).toContain(`UPDATE daily_totals SET fee_usd = 3, fee_link_usd = 1, fee_native_usd = 2, fee_stable_usd = 0, fee_link_amount = 0.1 WHERE day = '${DAY}';`);
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
    expect(await sqlOf(dir)).toContain(`UPDATE daily_totals SET fee_usd = NULL, fee_link_usd = NULL, fee_native_usd = NULL, fee_stable_usd = NULL, fee_link_amount = NULL WHERE day = '${DAY}';`);
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

describe('fee price aliases', () => {
  const BITLAYER: SourceChain = { chainSelector: '7937294810946806131', chainId: '200901' };
  const WBTC = '0xff204e2681a6fa0e2c3fade68a1b28fb90e4fc5f';
  const bitlayerRecords = [ok('0xlink', WBTC, '500000000000000000'), ok('0xweth', WBTC, '1000000000000000'), { id: '0xgone', kind: 'skip', fetchedAt: 't', status: 404, reason: 'HTTP 404' } as DetailRecord];
  const bitcoinOnly = {
    latest: async () => new Map(),
    dailyHistory: async (key: string) => (key === 'coingecko:bitcoin' ? [[DAY, 80_000]] : []),
  } as unknown as PricesClient;

  it("adds the price series of an aliased fee token's coin", async () => {
    // #given
    const dir = await backfill({ records: bitlayerRecords, src: BITLAYER });
    // #when
    await buildFees({ dir, prices: bitcoinOnly });
    // #then
    const cache = JSON.parse(await readFile(path.join(dir, 'prices', 'cache.json'), 'utf8')) as { history: Record<string, unknown> };
    expect(cache.history['coingecko:bitcoin']).toEqual({ [DAY]: 80_000 });
  });

  it('values an aliased fee token as its coin', async () => {
    // #given
    const dir = await backfill({ records: bitlayerRecords, src: BITLAYER });
    // #when
    await buildFees({ dir, prices: bitcoinOnly });
    // #then
    expect(await sqlOf(dir)).toContain(`fee_usd = 40000, detail_fetched_at = '2026-10-08T00:00:00.000Z' WHERE message_id = '0xlink'`);
  });
});

describe('fee prices from CoinGecko history', () => {
  const MOVA: SourceChain = { chainSelector: '4215185756725900654', chainId: '61900' };
  const WMOVA = '0x911fcc80f48340864f5f94ae9a73d6296d5c2115';
  const movaRecords = [ok('0xlink', WMOVA, '2000000000000000000'), ok('0xweth', WMOVA, '2000000000000000000'), { id: '0xgone', kind: 'skip', fetchedAt: 't', status: 404, reason: 'HTTP 404' } as DetailRecord];
  const llamaHas = (series: Record<string, [string, number][]>) => ({
    latest: async () => new Map(),
    dailyHistory: async (key: string) => series[key] ?? [],
  }) as unknown as PricesClient;
  const coingeckoHistory = (points: [string, number][], asked: string[] = []) => ({
    dailyHistory: async (id: string) => {
      asked.push(id);
      return new Map(points);
    },
  });

  it('prices an aliased coin DefiLlama has no history for from CoinGecko, at the token decimals', async () => {
    // #given
    const dir = await backfill({ records: movaRecords, src: MOVA });
    // #when
    await buildFees({ dir, prices: llamaHas({}), coingecko: coingeckoHistory([[DAY, 0.5]]) });
    // #then
    expect(await sqlOf(dir)).toContain(`fee_usd = 1, detail_fetched_at = '2026-10-08T00:00:00.000Z' WHERE message_id = '0xlink'`);
  });

  it('stores the CoinGecko points by day in the price cache', async () => {
    // #given
    const dir = await backfill({ records: movaRecords, src: MOVA });
    // #when
    await buildFees({ dir, prices: llamaHas({}), coingecko: coingeckoHistory([[DAY, 0.5], ['2026-01-01', 9]]) });
    // #then
    const cache = JSON.parse(await readFile(path.join(dir, 'prices', 'cache.json'), 'utf8')) as { history: Record<string, unknown> };
    expect(cache.history['coingecko:mova-2']).toEqual({ [DAY]: 0.5 });
  });

  it('asks CoinGecko once per coin and logs it', async () => {
    // #given
    const dir = await backfill({ records: movaRecords, src: MOVA });
    const asked: string[] = [];
    const lines: string[] = [];
    // #when
    await buildFees({ dir, prices: llamaHas({}), coingecko: coingeckoHistory([[DAY, 0.5]], asked), log: (l) => lines.push(l) });
    // #then
    expect(asked).toEqual(['mova-2']);
    expect(lines).toContain('price history for coingecko:mova-2 from CoinGecko (DefiLlama has none)');
  });

  it('never asks CoinGecko for a coin DefiLlama has history for', async () => {
    // #given
    const dir = await backfill({ records: movaRecords, src: MOVA });
    const asked: string[] = [];
    // #when
    await buildFees({ dir, prices: llamaHas({ 'coingecko:mova-2': [[DAY, 0.25]] }), coingecko: coingeckoHistory([[DAY, 0.5]], asked) });
    // #then
    expect(asked).toEqual([]);
    expect(await sqlOf(dir)).toContain(`fee_usd = 0.5, detail_fetched_at`);
  });

  it('leaves the fee unpriced when neither source has the coin', async () => {
    // #given
    const dir = await backfill({ records: movaRecords, src: MOVA });
    // #when
    await buildFees({ dir, prices: llamaHas({}), coingecko: coingeckoHistory([]) });
    // #then
    expect(await sqlOf(dir)).toContain(`fee_usd = NULL, detail_fetched_at = '2026-10-08T00:00:00.000Z' WHERE message_id = '0xlink'`);
  });

  it('values Canton CC at 10 decimals through DefiLlama', async () => {
    // #given
    const cc = '0xd573c85e64a85bc81e99641d37b160febc1581c724255604ce45ef2f99f6628b';
    const records = [ok('0xlink', cc, '40000000000'), ok('0xweth', cc, '40000000000'), { id: '0xgone', kind: 'skip', fetchedAt: 't', status: 404, reason: 'HTTP 404' } as DetailRecord];
    const dir = await backfill({ records, src: { chainSelector: '2308837218439511688', chainId: 'canton' } });
    // #when
    await buildFees({ dir, prices: llamaHas({ 'coingecko:canton-network': [[DAY, 0.25]] }) });
    // #then
    expect(await sqlOf(dir)).toContain(`fee_usd = 1, detail_fetched_at = '2026-10-08T00:00:00.000Z' WHERE message_id = '0xlink'`);
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
    expect(await sqlOf(dir)).toContain(`UPDATE daily_totals SET fee_usd = 1, fee_link_usd = 1, fee_native_usd = 0, fee_stable_usd = 0, fee_link_amount = 0.1 WHERE day = '${DAY}';`);
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

  const editState = async (dir: string, edit: (state: Record<string, unknown>) => void) => {
    const statePath = path.join(dir, 'fees', 'build-state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, unknown>;
    edit(state);
    await writeFile(statePath, JSON.stringify(state));
  };

  it('stores the hash of the fee price table it priced with', async () => {
    // #given
    const dir = await backfill({ records });
    // #when
    await buildFees({ dir, prices: noPrices });
    // #then
    const state = JSON.parse(await readFile(path.join(dir, 'fees', 'build-state.json'), 'utf8')) as { pricing?: string };
    expect(state.pricing).toBe(feePricingHash());
  });

  it('builds every built day again when the fee price table changed', async () => {
    // #given
    const dir = await backfill({ records });
    await buildFees({ dir, prices: noPrices });
    await editState(dir, (state) => { state.pricing = 'an older table'; });
    // #when
    const rebuilt = await buildFees({ dir, prices: noPrices });
    // #then
    expect([rebuilt.batch, rebuilt.days]).toEqual(['B0002', [DAY]]);
  });

  it('builds every built day again when the state predates the fee price table', async () => {
    // #given
    const dir = await backfill({ records });
    await buildFees({ dir, prices: noPrices });
    await editState(dir, (state) => { delete state.pricing; });
    // #when
    const rebuilt = await buildFees({ dir, prices: noPrices });
    // #then
    expect(rebuilt.days).toEqual([DAY]);
  });

  it('logs why it rebuilds every day', async () => {
    // #given
    const dir = await backfill({ records });
    await buildFees({ dir, prices: noPrices });
    await editState(dir, (state) => { state.pricing = 'an older table'; });
    const lines: string[] = [];
    // #when
    await buildFees({ dir, prices: noPrices, log: (l) => lines.push(l) });
    // #then
    expect(lines).toContain('the fee price table, fee groups or build format changed since the last build; building every sealed day again');
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

describe('feePricingHash', () => {
  const aliases = { '1:0xa': { key: 'coingecko:a', decimals: 18 }, '2:0xb': { key: 'coingecko:b', decimals: 8 } };
  const base = { ...CURRENT_FEE_PRICING, aliases };

  it('changes when an alias changes', () => {
    expect(feePricingHash({ ...base, aliases: { ...aliases, '2:0xb': { key: 'coingecko:b', decimals: 18 } } })).not.toBe(feePricingHash(base));
  });

  it('does not depend on the order of the entries', () => {
    expect(feePricingHash({ ...base, aliases: { '2:0xb': { decimals: 8, key: 'coingecko:b' }, '1:0xa': { key: 'coingecko:a', decimals: 18 } } })).toBe(feePricingHash(base));
  });

  it('changes when a fee token changes group', () => {
    // #given the Base WETH entry moved to stable
    const groups = { ...CURRENT_FEE_PRICING.groups, '15971525489660198786:0x4200000000000000000000000000000000000006': { group: 'stable' as const, symbol: 'WETH' } };
    // #when, #then
    expect(feePricingHash({ ...base, groups })).not.toBe(feePricingHash(base));
  });

  it('changes when FEE_BUILD_FORMAT changes', () => {
    expect(feePricingHash({ ...base, format: FEE_BUILD_FORMAT + 1 })).not.toBe(feePricingHash(base));
  });

  it("changes when an unlisted LINK's decimals change", () => {
    // #given
    const unlistedLink = { ...CURRENT_FEE_PRICING.unlistedLink, '4949039107694359620': { address: '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', decimals: 8 } };
    // #when, #then
    expect(feePricingHash({ ...base, unlistedLink })).not.toBe(feePricingHash(base));
  });
});

describe('fee tokens with no group', () => {
  const NEW = '0x1111111111111111111111111111111111111111';
  const withNew = [ok('0xlink', LINK, '100000000000000000'), ok('0xweth', NEW, '1000000000000000'), ok('0xgone', NEW, '5')];

  it('logs a check line per fee token with no group, with its message count', async () => {
    // #given
    const dir = await backfill({ records: withNew });
    const lines: string[] = [];
    // #when
    await buildFees({ dir, prices: noPrices, log: (l) => lines.push(l) });
    // #then
    expect(lines).toContain(`check: 2 fee messages on ${NEW} (ethereum-mainnet-base-1) have no fee group`);
  });

  it('returns and saves the ungrouped fee tokens of the batch', async () => {
    // #given
    const dir = await backfill({ records: withNew });
    // #when
    const result = await buildFees({ dir, prices: noPrices });
    // #then
    const saved = JSON.parse(await readFile(path.join(dir, 'fees', 'checks', 'B0001.json'), 'utf8')) as { ungrouped: unknown };
    const expected = [{ chain: BASE, name: 'ethereum-mainnet-base-1', token: NEW, messages: 2 }];
    expect({ result: result.ungrouped, saved: saved.ungrouped }).toEqual({ result: expected, saved: expected });
  });

  it('logs nothing when every fee token has a group', async () => {
    // #given
    const dir = await backfill({ records });
    const lines: string[] = [];
    // #when
    await buildFees({ dir, prices: noPrices, log: (l) => lines.push(l) });
    // #then
    expect(lines.filter((l) => l.includes('no fee group'))).toEqual([]);
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
