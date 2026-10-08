import {
  addDays, archiveKey, dayOf, dayStartIso, daysBetween, dedupeRawById, gzipText, linkFeeMatcher, linkFeeUsd, rollupDay, toJsonl,
  type LinkFeeMatcher, type ListMessage,
} from '@ccip-dev/core';
import type { RunContext } from '../context';
import { publishHistoryFiles, retryPut } from '../publish';
import * as store from '../store';
import { fallbackLoader, type FallbackLoader } from '../price-fallback';
import { runDetails } from './details';
import { storeListMessages } from './ingest';

const PAGE_SIZE = 1000;
const MAX_PAGES = 200;
const MAX_DAYS_PER_RUN = 3;
const DETAIL_BUDGET_MS = 5 * 60_000;
const ANOMALY_FACTOR = 10;
const ANOMALY_WINDOW_DAYS = 30;

interface DayBucket {
  messages: ListMessage[];
  raw: unknown[];
}

interface RunShared {
  loader: FallbackLoader;
  isLinkFee: LinkFeeMatcher;
  deadline: number;
}

/**
 * Finalizes the oldest MAX_DAYS_PER_RUN due days, collecting each one just before it is finalized, so a long catch-up holds
 * one day of list pages at a time. A failing day is logged and the later days still run; history is published when any
 * day succeeded, and the run then fails so the job alert names the day.
 */
export async function runFinalize(c: RunContext, mode: 'early' | 'late'): Promise<void> {
  const db = c.env.DB;
  const now = c.deps.now();
  const liveStart = await store.getMeta(db, 'live_start_day');
  if (liveStart === null) return;

  const yesterday = addDays(dayOf(now), -1);
  const lastFinalized = (await store.getMeta(db, 'last_finalize_day')) ?? addDays(liveStart, -1);
  const lastArchived = (await store.getMeta(db, 'last_archived_day')) ?? addDays(liveStart, -1);
  const due =
    mode === 'early'
      ? daysBetween(addDays(lastFinalized, 1), yesterday)
      : [...new Set([yesterday, ...daysBetween(addDays(lastArchived, 1), yesterday)])]
          .filter((d) => d >= liveStart && d <= yesterday)
          .sort();
  if (due.length === 0) return;
  const days = due.slice(0, MAX_DAYS_PER_RUN);
  if (days.length < due.length) {
    console.warn(`finalize took the oldest ${days.length} of ${due.length} days; the rest wait for the next run`);
  }

  const shared: RunShared = {
    loader: fallbackLoader(c),
    isLinkFee: linkFeeMatcher(await store.linkFeeTokens(db)),
    deadline: now.getTime() + DETAIL_BUDGET_MS,
  };
  const failures: string[] = [];
  for (const day of days) {
    try {
      const raw = await finalizeDay(c, day, shared);
      const archive = mode === 'late' && day > lastArchived;
      if (archive) await writeArchive(c, day, raw);
      // A failed day is retried by the next run, so neither pointer may move past it.
      if (failures.length > 0) continue;
      if (mode === 'early') await store.setMeta(db, 'last_finalize_day', day);
      if (archive) await store.setMeta(db, 'last_archived_day', day);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`finalize of ${day} failed: ${message}`);
      failures.push(`${day}: ${message}`);
    }
  }
  if (failures.length < days.length) await publishHistoryFiles(c);
  if (failures.length > 0) throw new Error(`finalize failed for ${failures.length} day(s); the first: ${failures[0]}`);
}

/** Collects one day's list messages, stores them, fills details and rolls the day up; returns its raw list objects. */
async function finalizeDay(c: RunContext, day: string, shared: RunShared): Promise<unknown[]> {
  const db = c.env.DB;
  const bucket = await collectDay(c, day);
  await storeListMessages(c, bucket.messages, shared.loader);
  await runDetails(c, { day }, { deadline: shared.deadline, fallback: shared.loader });
  const messages = await store.messagesForDay(db, day);
  const { totals, breakdown } = rollupDay(day, messages, await store.tokensForDay(db, day));
  await store.replaceDaily(db, totals, breakdown, c.deps.now().toISOString());
  await alertOnUsdAnomaly(c, day, totals.usd_value);
  await store.setFeeLinkUsd(db, day, linkFeeUsd(messages, day, shared.isLinkFee));
  return bucket.raw;
}

async function alertOnUsdAnomaly(c: RunContext, day: string, usdValue: number): Promise<void> {
  const median = await store.trailingUsdMedian(c.env.DB, day, ANOMALY_WINDOW_DAYS);
  if (median !== null && usdValue > median * ANOMALY_FACTOR) {
    await c.alert(
      `daily-usd-anomaly:${day}`,
      `${day} moved $${Math.round(usdValue)} against a trailing ${ANOMALY_WINDOW_DAYS}-day median of $${Math.round(median)} (over ${ANOMALY_FACTOR}×)`,
    );
  }
}

/** Pages the list from the newest message back to the start of `day`, keeping only that day's messages and raw objects. */
async function collectDay(c: RunContext, day: string): Promise<DayBucket> {
  const floorMs = Date.parse(dayStartIso(day));
  const bucket: DayBucket = { messages: [], raw: [] };
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await c.ccip.listMessages({ limit: PAGE_SIZE, cursor });
    let reachedFloor = result.messages.length === 0;
    for (const [i, m] of result.messages.entries()) {
      if (Date.parse(m.sendTimestamp) < floorMs) {
        reachedFloor = true;
        break;
      }
      if (dayOf(m.sendTimestamp) !== day) continue;
      bucket.messages.push(m);
      bucket.raw.push(result.raw[i]);
    }
    if (reachedFloor || result.cursor === null) return bucket;
    cursor = result.cursor;
  }
  throw new Error(`finalize paged ${MAX_PAGES} pages without reaching ${day}`);
}

async function writeArchive(c: RunContext, day: string, raw: unknown[]): Promise<void> {
  const lines = dedupeRawById(raw);
  const body = await gzipText(toJsonl(lines));
  await retryPut(() => c.env.ARCHIVE.put(archiveKey(day), body, { httpMetadata: { contentType: 'application/gzip' } }));
  const stored = await store.countForDay(c.env.DB, day);
  if (stored !== lines.length) {
    await c.alert(`archive-count:${day}`, `Archive for ${day} has ${lines.length} messages but D1 has ${stored}`);
  }
}
