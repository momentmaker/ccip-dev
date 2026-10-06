import { RESERVE_FIRST_BLOCK } from '@ccip-dev/core';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { CHUNK_BLOCKS, MAX_CHUNKS_PER_RUN, scanReserveTransfers } from '../src/jobs/reserve';
import * as store from '../src/store';
import { harness, resetStorage, rpcFake, transferLog } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-10-06T16:00:00.000Z';
const DEPOSITOR = '0x5680681ed3767b96914ce741a308155c7fb9171d';
const OUT_TO = '0x176c2ee163d764dcea38bc1340639b398b4fe713';
const FIRST = RESERVE_FIRST_BLOCK;

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

  it('stores a transfer once and alerts on its outflow once, even when the range is scanned again', async () => {
    const f = rpcFake({
      logs: ({ direction }) =>
        direction === 'out'
          ? [transferLog({ block: FIRST, index: 3, tx: '0xb1', direction: 'out', counterparty: OUT_TO, link: 1n, ts: '2026-10-06T15:00:00.000Z' })]
          : [],
    });
    const h = harness({ now: NOW, fetch: f });
    await scanReserveTransfers(h.c);
    await store.setMeta(env.DB, 'reserve_scan_block', String(FIRST - 1));
    await scanReserveTransfers(h.c);
    expect(await store.reserveTransfers(env.DB)).toEqual([
      { tx_hash: '0xb1', log_index: 3, block_number: FIRST, ts: '2026-10-06T15:00:00.000Z', direction: 'out', counterparty: OUT_TO, amount: '1000000000000000000', link_usd: null },
    ]);
    expect(h.alerts).toEqual([
      { signature: 'reserve-outflow:0xb1', text: `LINK left the Chainlink Reserve: 1 LINK to ${OUT_TO} (tx 0xb1)` },
    ]);
  });

  it('does not alert on an outflow older than 24 hours', async () => {
    const f = rpcFake({
      logs: ({ direction }) =>
        direction === 'out'
          ? [transferLog({ block: FIRST, index: 0, tx: '0xb2', direction: 'out', counterparty: OUT_TO, link: 1n, ts: '2025-08-02T19:02:47.000Z' })]
          : [],
    });
    const h = harness({ now: NOW, fetch: f });
    await scanReserveTransfers(h.c);
    expect(h.alerts).toEqual([]);
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
});
