import {
  addDays, archiveKey, dayOf, dayStartIso, daysBetween, dedupeRawById, gzipText, rollupDay, toJsonl, type ListMessage,
} from '@ccip-dev/core';
import type { RunContext } from '../context';
import { publishHistoryFiles } from '../publish';
import * as store from '../store';
import { runDetails } from './details';
import { storeListMessages } from './ingest';

const PAGE_SIZE = 1000;
const MAX_PAGES = 200;
const DETAIL_BUDGET_MS = 5 * 60_000;

interface DayBucket {
  messages: ListMessage[];
  raw: unknown[];
}

export async function runFinalize(c: RunContext, mode: 'early' | 'late'): Promise<void> {
  const db = c.env.DB;
  const now = c.deps.now();
  const liveStart = await store.getMeta(db, 'live_start_day');
  if (liveStart === null) return;

  const yesterday = addDays(dayOf(now), -1);
  const lastFinalized = (await store.getMeta(db, 'last_finalize_day')) ?? addDays(liveStart, -1);
  const lastArchived = (await store.getMeta(db, 'last_archived_day')) ?? addDays(liveStart, -1);
  const days =
    mode === 'early'
      ? daysBetween(addDays(lastFinalized, 1), yesterday)
      : [...new Set([yesterday, ...daysBetween(addDays(lastArchived, 1), yesterday)])]
          .filter((d) => d >= liveStart && d <= yesterday)
          .sort();
  if (days.length === 0) return;

  const buckets = await collectDays(c, days[0]!, yesterday);
  const deadline = now.getTime() + DETAIL_BUDGET_MS;
  for (const day of days) {
    const bucket = buckets.get(day) ?? { messages: [], raw: [] };
    await storeListMessages(c, bucket.messages);
    await runDetails(c, { day }, { deadline });
    const { totals, breakdown } = rollupDay(day, await store.messagesForDay(db, day), await store.tokensForDay(db, day));
    await store.replaceDaily(db, totals, breakdown, c.deps.now().toISOString());
    if (mode === 'early') await store.setMeta(db, 'last_finalize_day', day);
    if (mode === 'late' && day > lastArchived) await writeArchive(c, day, bucket.raw);
  }
  await publishHistoryFiles(c);
}

async function collectDays(c: RunContext, fromDay: string, toDay: string): Promise<Map<string, DayBucket>> {
  const floorMs = Date.parse(dayStartIso(fromDay));
  const buckets = new Map<string, DayBucket>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await c.ccip.listMessages({ limit: PAGE_SIZE, cursor });
    let reachedFloor = result.messages.length === 0;
    for (const [i, m] of result.messages.entries()) {
      if (Date.parse(m.sendTimestamp) < floorMs) {
        reachedFloor = true;
        break;
      }
      const day = dayOf(m.sendTimestamp);
      if (day > toDay) continue;
      const bucket = buckets.get(day) ?? { messages: [], raw: [] };
      bucket.messages.push(m);
      bucket.raw.push(result.raw[i]);
      buckets.set(day, bucket);
    }
    if (reachedFloor || result.cursor === null) return buckets;
    cursor = result.cursor;
  }
  throw new Error(`finalize paged ${MAX_PAGES} pages without reaching ${fromDay}`);
}

async function writeArchive(c: RunContext, day: string, raw: unknown[]): Promise<void> {
  const lines = dedupeRawById(raw);
  await c.env.ARCHIVE.put(archiveKey(day), await gzipText(toJsonl(lines)), { httpMetadata: { contentType: 'application/gzip' } });
  const stored = await store.countForDay(c.env.DB, day);
  if (stored !== lines.length) {
    await c.alert(`archive-count:${day}`, `Archive for ${day} has ${lines.length} messages but D1 has ${stored}`);
  }
  await store.setMeta(c.env.DB, 'last_archived_day', day);
}
