import { RESERVE_FIRST_BLOCK, readBlockNumber, readReserveTransfers, toUnits, type ReserveTransfer } from '@ccip-dev/core';
import type { RunContext } from '../context';
import { logRpcUrls } from '../rpc';
import * as store from '../store';

export const CONFIRMATIONS = 12;
export const CHUNK_BLOCKS = 10_000;
export const MAX_CHUNKS_PER_RUN = 50;
const SCAN_ALERT_AFTER = 3;
const OUTFLOW_ALERT_WINDOW_MS = 24 * 3_600_000;

export async function runReserveTransfers(c: RunContext): Promise<void> {
  await scanReserveTransfers(c);
}

export function formatLink(raw: string | bigint): string {
  return (Math.round(toUnits(String(raw), 18) * 100) / 100).toLocaleString('en-US');
}

export async function scanReserveTransfers(c: RunContext): Promise<number | null> {
  const db = c.env.DB;
  try {
    const urls = logRpcUrls(c.env);
    let cursor = Number((await store.getMeta(db, 'reserve_scan_block')) ?? RESERVE_FIRST_BLOCK - 1);
    const head = (await readBlockNumber(c.deps, urls)) - CONFIRMATIONS;
    for (let chunk = 0; chunk < MAX_CHUNKS_PER_RUN && cursor < head; chunk++) {
      const to = Math.min(cursor + CHUNK_BLOCKS, head);
      const inserted = await store.insertReserveTransfers(db, await readReserveTransfers(c.deps, urls, cursor + 1, to));
      await alertOutflows(c, inserted);
      cursor = to;
      await store.setMeta(db, 'reserve_scan_block', String(cursor));
    }
    await store.setMeta(db, 'reserve_scan_failures', '0');
    if (cursor < head) return null;
    await store.setMeta(db, 'reserve_scan_caught_up', '1');
    return cursor;
  } catch (err) {
    await recordScanFailure(c, err);
    return null;
  }
}

async function alertOutflows(c: RunContext, inserted: ReserveTransfer[]): Promise<void> {
  const now = c.deps.now().getTime();
  for (const t of inserted) {
    if (t.direction !== 'out' || now - Date.parse(t.ts) > OUTFLOW_ALERT_WINDOW_MS) continue;
    await c.alert(`reserve-outflow:${t.txHash}`, `LINK left the Chainlink Reserve: ${formatLink(t.amount)} LINK to ${t.counterparty} (tx ${t.txHash})`);
  }
}

async function recordScanFailure(c: RunContext, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`Reserve transfer scan failed: ${message}`);
  try {
    const failures = Number((await store.getMeta(c.env.DB, 'reserve_scan_failures')) ?? '0') + 1;
    await store.setMeta(c.env.DB, 'reserve_scan_failures', String(failures));
    if (failures >= SCAN_ALERT_AFTER) {
      await c.alert('reserve-scan', `Reserve transfer scan failed ${failures} hours in a row: ${message}`);
    }
  } catch (metaErr) {
    console.warn(`Reserve scan failure could not be recorded: ${metaErr instanceof Error ? metaErr.message : String(metaErr)}`);
  }
}
