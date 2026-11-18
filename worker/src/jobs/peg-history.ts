import { fetchPegBars, PEG_HISTORY_START, PEG_PAGE_S, pegHistoryBody } from '@ccip-dev/core';
import type { RunContext } from '../context';
import { PEG_ATTRIBUTION, pegConfig } from '../peg-config';
import * as pegStore from '../peg-store';
import { putJson, TTL } from '../publish';
import * as store from '../store';

export const PEG_PAGES_PER_RUN = 10;
/** Curve may revise its latest bars, so every run re-reads the last 6 hours. */
export const PEG_REFRESH_S = 6 * 3_600;
const HISTORY_ALERT_AFTER = 6;

/** Hourly: a failed fetch alerts after 6 hours in a row, and the bars already stored are published regardless. */
export async function runPegHistory(c: RunContext): Promise<void> {
  try {
    await backfillPeg(c);
    await refreshPeg(c);
    await store.setMeta(c.env.DB, 'peg_history_failures', '0');
  } catch (err) {
    await recordHistoryFailure(c, err);
  }
  await publishPegHistory(c);
}

export async function backfillPeg(c: RunContext): Promise<void> {
  const db = c.env.DB;
  if ((await store.getMeta(db, 'peg_backfill_done')) === '1') return;
  const startS = Date.parse(PEG_HISTORY_START) / 1000;
  let before = Number((await store.getMeta(db, 'peg_backfill_before')) ?? Math.floor(c.deps.now().getTime() / 1000));
  for (let page = 0; page < PEG_PAGES_PER_RUN && before > startS; page++) {
    const from = Math.max(startS, before - PEG_PAGE_S);
    await pegStore.upsertPegHours(db, await fetchPegBars(c.deps, from, before));
    before = from;
    await store.setMeta(db, 'peg_backfill_before', String(before));
  }
  if (before <= startS) await store.setMeta(db, 'peg_backfill_done', '1');
}

export async function refreshPeg(c: RunContext): Promise<void> {
  const nowS = Math.floor(c.deps.now().getTime() / 1000);
  await pegStore.upsertPegHours(c.env.DB, await fetchPegBars(c.deps, nowS - PEG_REFRESH_S, nowS));
}

export async function publishPegHistory(c: RunContext): Promise<void> {
  const bars = await pegStore.pegHours(c.env.DB);
  if (bars.length === 0) return;
  const now = c.deps.now();
  const { thresholds } = pegConfig(c.env);
  const body = pegHistoryBody({ bars, markers: [], thresholds, now });
  await putJson(c.env.PUBLIC, 'peg-history.json', { attribution: PEG_ATTRIBUTION, thresholds, ...body }, TTL.pegHistory, now);
}

async function recordHistoryFailure(c: RunContext, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`Peg history fetch failed: ${message}`);
  const failures = Number((await store.getMeta(c.env.DB, 'peg_history_failures')) ?? '0') + 1;
  await store.setMeta(c.env.DB, 'peg_history_failures', String(failures));
  if (failures >= HISTORY_ALERT_AFTER) await c.alert('peg-history', `The stLINK peg history has not refreshed for ${failures} hours: ${message}`);
}
