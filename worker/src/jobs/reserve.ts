import { LINK_PRICE_KEY, RESERVE_FIRST_BLOCK, readBlockNumber, readLinkBalance, readReserveTransfers, toUnits, type ReserveTransfer } from '@ccip-dev/core';
import type { RunContext } from '../context';
import { logRpcUrls } from '../rpc';
import * as store from '../store';

export const CONFIRMATIONS = 12;
export const CHUNK_BLOCKS = 10_000;
export const MAX_CHUNKS_PER_RUN = 50;
export const SCAN_BUDGET_MS = 4 * 60_000;
const SCAN_ALERT_AFTER = 3;
const OUTFLOW_ALERT_WINDOW_MS = 24 * 3_600_000;
const PRICE_ROWS_PER_RUN = 200;

export async function runReserveTransfers(c: RunContext): Promise<void> {
  const scannedTo = await scanReserveTransfers(c);
  await priceReserveTransfers(c);
  if (scannedTo !== null) await reconcileReserve(c, scannedTo);
}

export function formatLink(raw: string | bigint): string {
  return (Math.round(toUnits(String(raw), 18) * 100) / 100).toLocaleString('en-US');
}

export async function scanReserveTransfers(c: RunContext): Promise<number | null> {
  const db = c.env.DB;
  try {
    const deadline = c.deps.now().getTime() + SCAN_BUDGET_MS;
    const urls = logRpcUrls(c.env);
    let cursor = Number((await store.getMeta(db, 'reserve_scan_block')) ?? RESERVE_FIRST_BLOCK - 1);
    const head = (await readBlockNumber(c.deps, urls)) - CONFIRMATIONS;
    for (let chunk = 0; chunk < MAX_CHUNKS_PER_RUN && cursor < head && c.deps.now().getTime() < deadline; chunk++) {
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

const unixSeconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export async function priceReserveTransfers(c: RunContext): Promise<void> {
  try {
    const rows = await store.unpricedReserveTransfers(c.env.DB, PRICE_ROWS_PER_RUN);
    if (rows.length === 0) return;
    const prices = await c.prices.historicalAt(LINK_PRICE_KEY, rows.map((r) => unixSeconds(r.ts)));
    await store.setReserveTransferPrices(
      c.env.DB,
      rows.flatMap((r) => {
        const linkUsd = prices.get(unixSeconds(r.ts));
        return linkUsd === undefined ? [] : [{ txHash: r.tx_hash, logIndex: r.log_index, linkUsd }];
      }),
    );
  } catch (err) {
    console.warn(`Reserve transfer pricing failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function reconcileReserve(c: RunContext, block: number): Promise<void> {
  try {
    const net = (await store.reserveTransfers(c.env.DB)).reduce(
      (total, r) => (r.direction === 'in' ? total + BigInt(r.amount) : total - BigInt(r.amount)),
      0n,
    );
    const balance = await readLinkBalance(c.deps, logRpcUrls(c.env), block);
    if (balance !== net) {
      await c.alert(
        'reserve-mismatch',
        `Reserve transfers net to ${formatLink(net)} LINK but balanceOf at block ${block} is ${formatLink(balance)} LINK`,
      );
    }
  } catch (err) {
    console.warn(`Reserve reconcile failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
