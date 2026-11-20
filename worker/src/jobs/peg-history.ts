import { fetchPegBars, PEG_HISTORY_START, PEG_PAGE_S, pegHistoryBody, pegMarkerHours } from '@ccip-dev/core';
import type { RunContext } from '../context';
import { PEG_ATTRIBUTION, pegConfig } from '../peg-config';
import * as pegStore from '../peg-store';
import { putJson, TTL } from '../publish';
import * as store from '../store';

export const PEG_PAGES_PER_RUN = 10;
/** Curve may revise its latest bars, so every run re-reads the last 6 hours. */
export const PEG_REFRESH_S = 6 * 3_600;
const HISTORY_ALERT_AFTER = 6;
export const PEG_MARKER_BATCH = 5_000;
const MARKER_BATCHES_PER_RUN = 10;

/**
 * Hourly. The recent hours refresh first so a failing backfill page never leaves them stale; a failed fetch alerts after 6
 * hours in a row, and the bars already stored are published regardless. The marker scan fails on its own, loudly, since a
 * stuck scan is not a fetch problem and this job runs only hourly.
 */
export async function runPegHistory(c: RunContext): Promise<void> {
  let fetchFailure: unknown = null;
  for (const step of [refreshPeg, backfillPeg]) {
    try {
      await step(c);
    } catch (err) {
      fetchFailure ??= err;
    }
  }
  if (fetchFailure === null) await store.setMeta(c.env.DB, 'peg_history_failures', '0');
  else await recordHistoryFailure(c, fetchFailure);
  try {
    await scanPegMarkers(c);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Peg marker scan failed: ${message}`);
    await c.alert('peg-markers', `The stLINK peg marker scan failed: ${message}`);
  }
  await publishPegHistory(c);
}

export async function backfillPeg(c: RunContext): Promise<void> {
  const db = c.env.DB;
  if ((await store.getMeta(db, 'peg_backfill_done')) === '1') return;
  const startS = Date.parse(PEG_HISTORY_START) / 1000;
  const stored = await store.getMeta(db, 'peg_backfill_before');
  let before = stored === null ? Math.floor(c.deps.now().getTime() / 1000) : Number(stored);
  if (!Number.isFinite(before)) throw new Error(`peg_backfill_before is unreadable: ${stored}`);
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
  const body = pegHistoryBody({ bars, markers: await pegStore.pegMarkers(c.env.DB), thresholds, now });
  await putJson(c.env.PUBLIC, 'peg-history.json', { attribution: PEG_ATTRIBUTION, thresholds, ...body }, TTL.pegHistory, now);
}

/** Reads staking_events past a block cursor (the primary key), never by time, and only up to the classified block so a vault is never read as nobody's. */
export async function scanPegMarkers(c: RunContext): Promise<void> {
  const db = c.env.DB;
  const classifiedTo = await store.stakersClassifiedTo(db);
  if (classifiedTo === null) return;
  let cursor = Number((await store.getMeta(db, 'peg_marker_block')) ?? '0');
  for (let batch = 0; batch < MARKER_BATCHES_PER_RUN && cursor < classifiedTo; batch++) {
    const events = await pegStore.pegMarkerEvents(db, cursor, classifiedTo, PEG_MARKER_BATCH);
    if (events.length < PEG_MARKER_BATCH) {
      await pegStore.addPegMarkers(db, pegMarkerHours(events), classifiedTo);
      return;
    }
    // A full batch may end inside a block; that block is read whole next time.
    const last = events.at(-1)!.blockNumber;
    const whole = events.filter((e) => e.blockNumber < last);
    if (whole.length === 0) console.warn(`[peg] block ${last} alone fills a marker batch of ${PEG_MARKER_BATCH}; the rest of it is skipped`);
    const kept = whole.length > 0 ? whole : events;
    cursor = kept.at(-1)!.blockNumber;
    await pegStore.addPegMarkers(db, pegMarkerHours(kept), cursor);
  }
}

async function recordHistoryFailure(c: RunContext, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`Peg history fetch failed: ${message}`);
  const failures = Number((await store.getMeta(c.env.DB, 'peg_history_failures')) ?? '0') + 1;
  await store.setMeta(c.env.DB, 'peg_history_failures', String(failures));
  if (failures >= HISTORY_ALERT_AFTER) await c.alert('peg-history', `The stLINK peg history has not refreshed for ${failures} hours: ${message}`);
}
