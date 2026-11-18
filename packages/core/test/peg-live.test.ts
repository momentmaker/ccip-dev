// packages/core/test/peg-live.test.ts
import { describe, expect, it } from 'vitest';
import { curveDepth, decodePegReading, mintInstant, PEG_LADDER, pegCalls, pegLiveBody, profitAt, readPegLive, redeemInstant, type PegReading } from '../src/peg-live';
import { fakeFetch, jsonResponse, PEG_LIVE_WORDS, PEG_WORD, pegAmountWord, pegRpc } from '../src/testing';

const words = PEG_LIVE_WORDS.map((w) => BigInt(w));
const LIVE = decodePegReading(words);

describe('readPegLive', () => {
  it('reads the pool, both routes and the queues in one batch', async () => {
    const f = fakeFetch(pegRpc());
    const r = await readPegLive({ fetch: f }, ['https://rpc.one']);
    expect(f.calls).toHaveLength(1);
    expect(pegCalls()).toHaveLength(28);
    expect(r.spot).toBeCloseTo(0.999751, 6);
    expect(r.ema).toBeCloseTo(0.99975, 6);
    expect(r.buySt[0]).toBeCloseTo(1000.138942, 6);
    expect(r.sellSt[0]).toBeCloseTo(999.641245, 6);
    expect(r).toMatchObject({ poolStatus: 0, totalQueued: 0, canDeposit: 0, allowInstantWithdrawals: false, claimPeriodActive: true, lastWithdrawalAt: '2026-11-15T15:50:11.000Z', minWithdrawalGapS: 259_200 });
    expect(r.queuedWithdrawals).toBeCloseTo(1541.044687, 6);
  });

  it('tries the next endpoint when one fails', async () => {
    const f = fakeFetch((url) => (url === 'https://rpc.one' ? new Response('', { status: 503 }) : undefined), pegRpc());
    expect((await readPegLive({ fetch: f }, ['https://rpc.one', 'https://rpc.two'])).spot).toBeCloseTo(0.999751, 6);
  });
});

describe('readPegLive with a failing call', () => {
  const revertOn = (failId: number) => (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body)) as { id: number }[];
    return jsonResponse(body.map(({ id }) => (id === failId ? { jsonrpc: '2.0', id, error: { message: 'execution reverted' } } : { jsonrpc: '2.0', id, result: PEG_LIVE_WORDS[id] })));
  };

  it('reads a reverted ladder rung as nothing out', async () => {
    const r = await readPegLive({ fetch: fakeFetch(revertOn(8)) }, ['https://rpc.one']);
    expect(r.buySt.at(-1)).toBe(0);
    expect(curveDepth(r.buySt)?.size).toBe(10_000);
  });

  it('fails the endpoint when the spot call reverts', async () => {
    await expect(readPegLive({ fetch: fakeFetch(revertOn(0)) }, ['https://rpc.one'])).rejects.toThrow(/every RPC endpoint/);
  });
});

describe('curveDepth and profitAt', () => {
  it('finds the largest rung that beats 1:1, and nothing on the losing side', () => {
    expect(curveDepth(LIVE.buySt)).toEqual({ size: 10_000, profit: expect.closeTo(0.533019, 5) });
    expect(curveDepth(LIVE.sellSt)).toBeNull();
  });

  it('interpolates profit between rungs, from zero below the first', () => {
    expect(profitAt(LIVE.buySt, 500)).toBeCloseTo(0.069471, 5);
    expect(profitAt(LIVE.buySt, 3_000)).toBeCloseTo(0.321304, 5);
    expect(profitAt(LIVE.buySt, PEG_LADDER.at(-1)! * 2)).toBeCloseTo(LIVE.buySt.at(-1)! - PEG_LADDER.at(-1)!, 3);
  });
});

describe('instant capacity', () => {
  const r = (over: Partial<PegReading>): PegReading => ({ ...LIVE, ...over });

  it('redeems instantly only against queued LINK while instant withdrawals are off', () => {
    expect(redeemInstant(r({ totalQueued: 17.88 }))).toBe(17.88);
  });

  it('adds the pool’s withdrawable LINK when instant withdrawals are on and nobody waits', () => {
    expect(redeemInstant(r({ totalQueued: 10, allowInstantWithdrawals: true, queuedWithdrawals: 0, canWithdraw: 500 }))).toBe(510);
    expect(redeemInstant(r({ totalQueued: 10, allowInstantWithdrawals: true, queuedWithdrawals: 1, canWithdraw: 500 }))).toBe(10);
  });

  it('redeems nothing while the pool is closed', () => {
    expect(redeemInstant(r({ poolStatus: 2, totalQueued: 17.88 }))).toBe(0);
  });

  it('mints instantly into the withdrawal queue, then into the room the pool has', () => {
    expect(mintInstant(LIVE)).toBeCloseTo(1541.044687, 6);
    expect(mintInstant(r({ canDeposit: 900, strategyDepositRoom: 400, unusedDeposits: 4_800, unusedDepositLimit: 5_000 }))).toBeCloseTo(1541.044687 + 600, 6);
  });

  it('mints nothing while LINK is queued or the pool is not open', () => {
    expect(mintInstant(r({ totalQueued: 1 }))).toBe(0);
    expect(mintInstant(r({ poolStatus: 1 }))).toBe(0);
  });
});

describe('pegLiveBody', () => {
  it('describes both routes from the mainnet reading', () => {
    const body = pegLiveBody(LIVE);
    expect(body.gap).toBeCloseTo(-0.000249, 6);
    expect(body.ladder).toHaveLength(PEG_LADDER.length);
    expect(body.discount).toEqual({
      depth: 10_000, profit: expect.closeTo(0.533019, 5), instant: 0, tradeable: 0, tradeable_profit: null,
      queued_ahead: expect.closeTo(1541.044687, 6), next_payout_after: '2026-11-18T15:50:11.000Z', claim_window_open: true,
    });
    expect(body.premium).toEqual({ depth: null, profit: null, instant: expect.closeTo(1541.044687, 6), tradeable: 0, tradeable_profit: null, queued_ahead: 0 });
    expect(body.routes).toEqual({ pool_status: 'open', instant_withdrawals: false });
  });

  it('trades the smaller of the Curve depth and the instant capacity', () => {
    const queued = decodePegReading(PEG_LIVE_WORDS.map((w, i) => BigInt(i === PEG_WORD.totalQueued ? pegAmountWord(17.88) : w)));
    const d = pegLiveBody(queued).discount;
    expect(d.tradeable).toBeCloseTo(17.88, 6);
    expect(d.tradeable_profit).toBeCloseTo(0.138942 * 0.01788, 6);
  });

  it('reads an unknown pool status as closed', () => {
    expect(pegLiveBody({ ...LIVE, poolStatus: 7 }).routes.pool_status).toBe('closed');
  });
});
