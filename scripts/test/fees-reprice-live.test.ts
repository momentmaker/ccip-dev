import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PricesClient } from '@ccip-dev/core';
import { describe, expect, it } from 'vitest';
import { parseCandidates, repriceLive } from '../backfill/fees/reprice-live';

const BITLAYER = '7937294810946806131';
const BASE = '15971525489660198786';
const WBTC = '0xff204e2681a6fa0e2c3fade68a1b28fb90e4fc5f';
const WETH = '0x4200000000000000000000000000000000000006';
const DAY = '2026-10-06';

interface Candidate {
  message_id: string;
  day: string;
  src_chain: string;
  chain_id: string;
  family: string;
  fee_token: string;
  fee_amount: string;
}

const bitlayerRow = (id: string, day = DAY, amount = '2000000000000000000'): Candidate => ({
  message_id: id, day, src_chain: BITLAYER, chain_id: '200901', family: 'EVM', fee_token: WBTC, fee_amount: amount,
});
const baseWeth: Candidate = { message_id: '0xbase', day: DAY, src_chain: BASE, chain_id: '8453', family: 'EVM', fee_token: WETH, fee_amount: '1000000000000000000' };

function fakePrices(series: Record<string, Record<string, number>>): { client: PricesClient; asked: string[] } {
  const asked: string[] = [];
  const client = {
    latest: async () => new Map(),
    dailyHistory: async (key: string) => {
      asked.push(key);
      return new Map(Object.entries(series[key] ?? {}));
    },
  } as unknown as PricesClient;
  return { client, asked };
}

const BTC = { 'coingecko:bitcoin': { '2026-10-05': 60000, '2026-10-06': 62000, '2026-10-07': 64000 } };

async function run(rows: Candidate[], series: Record<string, Record<string, number>> = BTC) {
  const outDir = await mkdtemp(path.join(tmpdir(), 'reprice-live-'));
  const { client, asked } = fakePrices(series);
  const result = await repriceLive({ from: '2026-10-05', rows, prices: client, outDir });
  return { result, asked, outDir };
}

describe('repriceLive', () => {
  it("prices a Bitlayer WBTC fee at its day's BTC price times the amount over 10^18", async () => {
    // #given
    const rows = [bitlayerRow('0xa')];
    // #when
    const { result } = await run(rows);
    // #then
    expect(result.priced).toEqual([{ id: '0xa', day: DAY, chain: BITLAYER, usd: 124000 }]);
  });

  it('ignores a WETH fee on Base, which is not aliased', async () => {
    // #given
    const rows = [baseWeth, bitlayerRow('0xa')];
    // #when
    const { result } = await run(rows);
    // #then
    expect(result.priced.map((p) => p.id)).toEqual(['0xa']);
  });

  it('lists a row whose day has no price and leaves it out of the SQL', async () => {
    // #given
    const rows = [bitlayerRow('0xa'), bitlayerRow('0xlate', '2026-10-20')];
    // #when
    const { result, outDir } = await run(rows);
    // #then
    expect(result.unpriced).toEqual([{ id: '0xlate', day: '2026-10-20', reason: 'no coingecko:bitcoin price for 2026-10-20' }]);
    expect(await readFile(path.join(outDir, 'reprice-live-2026-10-05.sql'), 'utf8')).not.toContain('0xlate');
  });

  it('writes each update with the full guard predicate', async () => {
    // #given
    const rows = [bitlayerRow('0xa')];
    // #when
    const { outDir } = await run(rows);
    // #then
    expect(await readFile(path.join(outDir, 'reprice-live-2026-10-05.sql'), 'utf8')).toBe(
      `UPDATE messages SET fee_usd = 124000 WHERE message_id = '0xa' AND source = 'live' AND fee_usd IS NULL AND src_chain = '${BITLAYER}' AND fee_token = '${WBTC}' AND fee_amount = '2000000000000000000';\n`,
    );
  });

  it('fetches each alias key once however many rows use it', async () => {
    // #given
    const rows = [bitlayerRow('0xa'), bitlayerRow('0xb', '2026-10-07')];
    // #when
    const { asked } = await run(rows);
    // #then
    expect(asked).toEqual(['coingecko:bitcoin']);
  });

  it('totals the USD per day and per chain', async () => {
    // #given
    const rows = [bitlayerRow('0xa'), bitlayerRow('0xb', DAY, '1000000000000000000'), bitlayerRow('0xc', '2026-10-07', '1000000000000000000')];
    // #when
    const { result } = await run(rows);
    // #then
    expect({ byDay: result.byDay, byChain: result.byChain, total: result.totalUsd }).toEqual({
      byDay: { [DAY]: { count: 2, usd: 186000 }, '2026-10-07': { count: 1, usd: 64000 } },
      byChain: { [BITLAYER]: { count: 3, usd: 250000 } },
      total: 250000,
    });
  });

  it('writes no file when nothing can be priced', async () => {
    // #given
    const rows = [baseWeth];
    // #when
    const { result } = await run(rows);
    // #then
    expect(result.sqlFile).toBeNull();
  });
});

describe('parseCandidates', () => {
  const row = bitlayerRow('0xa');

  it("reads wrangler's --json output", () => {
    expect(parseCandidates([{ results: [row], success: true, meta: {} }])).toEqual([row]);
  });

  it('reads a plain array', () => {
    expect(parseCandidates([row])).toEqual([row]);
  });

  it('rejects a row missing a column', () => {
    expect(() => parseCandidates([{ ...row, fee_amount: undefined }])).toThrow(/fee_amount/);
  });
});
