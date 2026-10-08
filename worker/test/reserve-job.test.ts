import { LINK_PRICE_KEY, RESERVE_FIRST_BLOCK } from '@ccip-dev/core';
import { fakePrices } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { CHUNK_BLOCKS, MAX_CHUNKS_PER_RUN, priceReserveTransfers, reconcileReserve, runReserveTransfers, scanReserveTransfers } from '../src/jobs/reserve';
import * as store from '../src/store';
import { harness, resetStorage, rpcFake, transferLog } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-10-06T16:00:00.000Z';
const DEPOSITOR = '0x5680681ed3767b96914ce741a308155c7fb9171d';
const OUT_TO = '0x176c2ee163d764dcea38bc1340639b398b4fe713';
const FIRST = RESERVE_FIRST_BLOCK;
const outflowAlerts = (h: { alerts: { signature: string; text: string }[] }) =>
  h.alerts.filter((a) => a.signature.startsWith('reserve-outflow:'));

describe('scanReserveTransfers', () => {
  it('backfills in chunks across runs and resumes from the cursor', async () => {
    const perRun = MAX_CHUNKS_PER_RUN * CHUNK_BLOCKS;
    const head = FIRST - 1 + perRun + 5_000 + 12;
    const logs = rpcFake({
      head,
      logs: ({ fromBlock, toBlock, direction }) => [
        transferLog({ block: FIRST, index: 0, tx: '0xa1', direction: 'in', counterparty: DEPOSITOR, link: 100n, ts: '2025-07-31T14:00:23.000Z' }),
        transferLog({ block: FIRST + perRun + 10, index: 0, tx: '0xa2', direction: 'in', counterparty: DEPOSITOR, link: 50n, ts: '2025-09-10T00:00:00.000Z' }),
      ].filter((l) => direction === 'in' && Number(BigInt(l.blockNumber)) >= fromBlock && Number(BigInt(l.blockNumber)) <= toBlock),
    });

    const first = harness({ now: NOW, fetch: logs });
    await expect(scanReserveTransfers(first.c)).resolves.toBeNull();
    expect(await store.getMeta(env.DB, 'reserve_scan_block')).toBe(String(FIRST - 1 + perRun));
    expect(await store.getMeta(env.DB, 'reserve_scan_caught_up')).toBeNull();
    expect((await store.reserveTransfers(env.DB)).map((r) => r.tx_hash)).toEqual(['0xa1']);

    await expect(scanReserveTransfers(harness({ now: NOW, fetch: logs }).c)).resolves.toBe(head - 12);
    expect(await store.getMeta(env.DB, 'reserve_scan_caught_up')).toBe('1');
    expect((await store.reserveTransfers(env.DB)).map((r) => r.tx_hash)).toEqual(['0xa1', '0xa2']);
  });

  it('scans no more than 10,000 blocks per request', async () => {
    const f = rpcFake({ head: FIRST - 1 + 25_000 + 12 });
    await scanReserveTransfers(harness({ now: NOW, fetch: f }).c);
    const ranges = f.calls
      .map((call) => JSON.parse(String(call.init?.body)))
      .filter((body) => body.method === 'eth_getLogs')
      .map((body) => Number(BigInt(body.params[0].toBlock)) - Number(BigInt(body.params[0].fromBlock)) + 1);
    expect(Math.max(...ranges)).toBe(10_000);
    expect(ranges.reduce((a: number, b: number) => a + b, 0)).toBe(2 * 25_000);
  });

  it('stores a transfer once and does not alert again once its alert was delivered', async () => {
    const f = rpcFake({
      logs: ({ direction }) =>
        direction === 'out'
          ? [transferLog({ block: FIRST, index: 3, tx: '0xb1', direction: 'out', counterparty: OUT_TO, link: 1n, ts: '2026-10-06T15:00:00.000Z' })]
          : [],
    });
    const first = harness({ now: NOW, fetch: f });
    await runReserveTransfers(first.c);
    await store.setMeta(env.DB, 'alert:reserve-outflow:0xb1', NOW);
    await store.setMeta(env.DB, 'reserve_scan_block', String(FIRST - 1));
    const second = harness({ now: NOW, fetch: f });
    await runReserveTransfers(second.c);
    expect(await store.reserveTransfers(env.DB)).toEqual([
      { tx_hash: '0xb1', log_index: 3, block_number: FIRST, ts: '2026-10-06T15:00:00.000Z', direction: 'out', counterparty: OUT_TO, amount: '1000000000000000000', link_usd: null },
    ]);
    expect(outflowAlerts(first)).toEqual([
      { signature: 'reserve-outflow:0xb1', text: `LINK left the Chainlink Reserve: 1 LINK to ${OUT_TO} (tx 0xb1)` },
    ]);
    expect(outflowAlerts(second)).toEqual([]);
  });

  it('retries an outflow alert on every run until its alert key is recorded', async () => {
    const f = rpcFake({
      logs: ({ direction }) =>
        direction === 'out'
          ? [transferLog({ block: FIRST, index: 3, tx: '0xb1', direction: 'out', counterparty: OUT_TO, link: 1n, ts: '2026-10-06T15:00:00.000Z' })]
          : [],
    });
    const runs = [];
    for (let i = 0; i < 2; i++) {
      const h = harness({ now: NOW, fetch: f });
      await runReserveTransfers(h.c);
      runs.push(outflowAlerts(h).length);
    }
    expect(runs).toEqual([1, 1]);
    await store.setMeta(env.DB, 'alert:reserve-outflow:0xb1', NOW);
    const third = harness({ now: NOW, fetch: f });
    await runReserveTransfers(third.c);
    expect(outflowAlerts(third)).toEqual([]);
  });

  it('does not alert on an outflow older than 24 hours', async () => {
    const f = rpcFake({
      logs: ({ direction }) =>
        direction === 'out'
          ? [transferLog({ block: FIRST, index: 0, tx: '0xb2', direction: 'out', counterparty: OUT_TO, link: 1n, ts: '2025-08-02T19:02:47.000Z' })]
          : [],
    });
    const h = harness({ now: NOW, fetch: f });
    await runReserveTransfers(h.c);
    expect(outflowAlerts(h)).toEqual([]);
  });

  it.each([
    ['exactly 24 hours old (alerts)', '2026-10-05T16:00:00.000Z', 1],
    ['one second past 24 hours (is ignored)', '2026-10-05T15:59:59.000Z', 0],
  ])('alerts on an outflow %s', async (_name, ts, alerts) => {
    const f = rpcFake({
      logs: ({ direction }) =>
        direction === 'out'
          ? [transferLog({ block: FIRST, index: 0, tx: '0xb4', direction: 'out', counterparty: OUT_TO, link: 1n, ts })]
          : [],
    });
    const h = harness({ now: NOW, fetch: f });
    await runReserveTransfers(h.c);
    expect(outflowAlerts(h)).toHaveLength(alerts);
  });

  it('alerts on the third failed run in a row and resets after a good run', async () => {
    const signatures: string[] = [];
    for (let i = 0; i < 4; i++) {
      const h = harness({ now: NOW, fetch: rpcFake({ down: true }) });
      await expect(scanReserveTransfers(h.c)).resolves.toBeNull();
      signatures.push(...h.alerts.map((a) => a.signature));
    }
    expect(signatures).toEqual(['reserve-scan', 'reserve-scan']);
    expect(await store.getMeta(env.DB, 'reserve_scan_failures')).toBe('4');
    await scanReserveTransfers(harness({ now: NOW, fetch: rpcFake() }).c);
    expect(await store.getMeta(env.DB, 'reserve_scan_failures')).toBe('0');
  });

  it('treats a cursor at or past the head as caught up without asking for logs', async () => {
    await store.setMeta(env.DB, 'reserve_scan_block', String(FIRST + 5));
    const f = rpcFake();
    await expect(scanReserveTransfers(harness({ now: NOW, fetch: f }).c)).resolves.toBe(FIRST + 5);
    expect(f.calls.map((call) => JSON.parse(String(call.init?.body)).method)).toEqual(['eth_blockNumber']);
    expect(await store.getMeta(env.DB, 'reserve_scan_caught_up')).toBe('1');
  });

  it('treats a head block below the first Reserve block as a failed scan', async () => {
    await expect(scanReserveTransfers(harness({ now: NOW, fetch: rpcFake({ head: 0 }) }).c)).resolves.toBeNull();
    expect(await store.getMeta(env.DB, 'reserve_scan_caught_up')).toBeNull();
    expect(await store.getMeta(env.DB, 'reserve_scan_block')).toBeNull();
    expect(await store.getMeta(env.DB, 'reserve_scan_failures')).toBe('1');
  });
});

describe('scanReserveTransfers budget', () => {
  it('stops at the time budget, keeps the cursor and counts no failure', async () => {
    const h = harness({ now: NOW, fetch: rpcFake({ head: FIRST - 1 + 20 * CHUNK_BLOCKS + 12 }) });
    let t = Date.parse(NOW);
    h.c.deps.now = () => new Date((t += 91_000));
    await expect(scanReserveTransfers(h.c)).resolves.toBeNull();
    expect(await store.getMeta(env.DB, 'reserve_scan_block')).toBe(String(FIRST - 1 + 2 * CHUNK_BLOCKS));
    expect(await store.getMeta(env.DB, 'reserve_scan_failures')).toBe('0');
    expect(h.alerts).toEqual([]);
  });
});

const seconds = (iso: string) => Date.parse(iso) / 1000;
const T1 = '2025-08-07T10:14:59.000Z';
const T2 = '2026-10-01T15:35:47.000Z';

async function seedTwoDeposits(): Promise<void> {
  await store.insertReserveTransfers(env.DB, [
    { txHash: '0xc1', logIndex: 0, blockNumber: FIRST + 1, ts: T1, direction: 'in', counterparty: DEPOSITOR, amount: (100n * 10n ** 18n).toString() },
    { txHash: '0xc2', logIndex: 0, blockNumber: FIRST + 2, ts: T2, direction: 'in', counterparty: DEPOSITOR, amount: (50n * 10n ** 18n).toString() },
  ]);
}

describe('priceReserveTransfers', () => {
  it('prices transfers at their block time and leaves the ones DefiLlama lacks for the next run', async () => {
    await seedTwoDeposits();
    const prices = fakePrices({ historical: { [LINK_PRICE_KEY]: { [seconds(T1)]: 16.8 } } });
    await priceReserveTransfers(harness({ now: NOW, prices }).c);
    expect(prices.historicalCalls).toEqual([{ key: LINK_PRICE_KEY, timestamps: [seconds(T1), seconds(T2)] }]);
    expect((await store.reserveTransfers(env.DB)).map((r) => r.link_usd)).toEqual([16.8, null]);

    const later = fakePrices({ historical: { [LINK_PRICE_KEY]: { [seconds(T2)]: 14.2564 } } });
    await priceReserveTransfers(harness({ now: NOW, prices: later }).c);
    expect(later.historicalCalls[0]!.timestamps).toEqual([seconds(T2)]);
    expect((await store.reserveTransfers(env.DB)).map((r) => r.link_usd)).toEqual([16.8, 14.2564]);
  });

  it('does not throw when DefiLlama fails', async () => {
    await seedTwoDeposits();
    const prices = fakePrices({ failHistorical: new Error('llama down') });
    await expect(priceReserveTransfers(harness({ now: NOW, prices }).c)).resolves.toBeUndefined();
    expect((await store.reserveTransfers(env.DB)).map((r) => r.link_usd)).toEqual([null, null]);
  });

  it('asks DefiLlama nothing when every transfer is priced', async () => {
    const prices = fakePrices();
    await priceReserveTransfers(harness({ now: NOW, prices }).c);
    expect(prices.historicalCalls).toEqual([]);
  });
});

describe('reconcileReserve', () => {
  it('stays quiet when the transfers net to the balance at the given block', async () => {
    await seedTwoDeposits();
    const f = rpcFake({ balanceAt: () => 150n * 10n ** 18n });
    const h = harness({ now: NOW, fetch: f });
    await reconcileReserve(h.c, FIRST + 9);
    expect(h.alerts).toEqual([]);
    const call = JSON.parse(String(f.calls[0]!.init?.body));
    expect(call.params[1]).toBe(`0x${(FIRST + 9).toString(16)}`);
  });

  it('alerts with both amounts when they differ', async () => {
    await seedTwoDeposits();
    const h = harness({ now: NOW, fetch: rpcFake({ balanceAt: () => 149n * 10n ** 18n }) });
    await reconcileReserve(h.c, FIRST + 9);
    expect(h.alerts).toEqual([
      { signature: 'reserve-mismatch', text: `Reserve transfers net to 150 LINK but balanceOf at block ${FIRST + 9} is 149 LINK` },
    ]);
  });

  it('counts outflows against the balance', async () => {
    await store.insertReserveTransfers(env.DB, [
      { txHash: '0xe1', logIndex: 0, blockNumber: FIRST + 1, ts: T1, direction: 'in', counterparty: DEPOSITOR, amount: (100n * 10n ** 18n).toString() },
      { txHash: '0xe2', logIndex: 0, blockNumber: FIRST + 2, ts: T2, direction: 'out', counterparty: OUT_TO, amount: (10n ** 18n).toString() },
    ]);
    const matching = harness({ now: NOW, fetch: rpcFake({ balanceAt: () => 99n * 10n ** 18n }) });
    await reconcileReserve(matching.c, FIRST + 9);
    expect(matching.alerts).toEqual([]);
    const ignoringOutflow = harness({ now: NOW, fetch: rpcFake({ balanceAt: () => 100n * 10n ** 18n }) });
    await reconcileReserve(ignoringOutflow.c, FIRST + 9);
    expect(ignoringOutflow.alerts).toEqual([
      { signature: 'reserve-mismatch', text: `Reserve transfers net to 99 LINK but balanceOf at block ${FIRST + 9} is 100 LINK` },
    ]);
  });

  it('does not throw when the balance cannot be read', async () => {
    await expect(reconcileReserve(harness({ now: NOW, fetch: rpcFake({ down: true }) }).c, FIRST)).resolves.toBeUndefined();
  });
});

describe('runReserveTransfers', () => {
  it('does not reconcile before the scan has caught up', async () => {
    const f = rpcFake({ head: FIRST - 1 + MAX_CHUNKS_PER_RUN * CHUNK_BLOCKS + 100_000 });
    const h = harness({ now: NOW, fetch: f });
    await runReserveTransfers(h.c);
    const methods = f.calls.map((call) => JSON.parse(String(call.init?.body)).method);
    expect(methods).not.toContain('eth_call');
  });

  it('scans, prices and reconciles in one run once caught up', async () => {
    const f = rpcFake({
      logs: ({ direction }) =>
        direction === 'in'
          ? [transferLog({ block: FIRST, index: 0, tx: '0xd1', direction: 'in', counterparty: DEPOSITOR, link: 7n, ts: T2 })]
          : [],
      balanceAt: () => 7n * 10n ** 18n,
    });
    const prices = fakePrices({ historical: { [LINK_PRICE_KEY]: { [seconds(T2)]: 14 } } });
    const h = harness({ now: NOW, fetch: f, prices });
    await runReserveTransfers(h.c);
    expect((await store.reserveTransfers(env.DB)).map((r) => r.link_usd)).toEqual([14]);
    expect(h.alerts).toEqual([]);
  });
});
