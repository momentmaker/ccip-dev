import {
  addDays, buildRows, dayOf, dayStartIso, firstCheckAt, normalizeList, priceKeys, type ListMessage,
} from '@ccip-dev/core';
import type { RunContext } from '../context';
import { publishLiveFiles } from '../publish';
import * as store from '../store';
import { fallbackLoader, priceFallback, type FallbackLoader } from '../price-fallback';
import { alertPriceOutliers } from '../price-outliers';

export interface IngestOptions {
  maxPages?: number;
  pageSize?: number;
}

type StopRule = { kind: 'known' } | { kind: 'id'; id: string | null };

interface WalkResult {
  messages: ListMessage[];
  pagesUsed: number;
  exhausted: boolean;
  nextCursor: string | null;
}

export async function runIngest(c: RunContext, options: IngestOptions = {}): Promise<void> {
  const db = c.env.DB;
  const now = c.deps.now();
  const maxPages = options.maxPages ?? 20;
  const pageSize = options.pageSize ?? 200;
  const floorMs = Date.parse(dayStartIso(await ensureLiveStart(db, now)));
  const newestBefore = await store.newestLiveId(db);
  const resumeCursor = await store.getMeta(db, 'ingest_resume_cursor');
  const resumeStopId = await store.getMeta(db, 'ingest_resume_stop_id');

  const head = await walk(c, null, { kind: 'known' }, floorMs, pageSize, maxPages);
  const collected = [...head.messages];
  const resumeUpdates: [key: string, value: string | null][] = [];

  if (head.exhausted && resumeCursor === null) {
    resumeUpdates.push(['ingest_resume_cursor', head.nextCursor], ['ingest_resume_stop_id', newestBefore]);
  } else if (resumeCursor !== null && maxPages - head.pagesUsed > 0) {
    try {
      const tail = await walk(c, resumeCursor, { kind: 'id', id: resumeStopId }, floorMs, pageSize, maxPages - head.pagesUsed);
      collected.push(...tail.messages);
      resumeUpdates.push(['ingest_resume_cursor', tail.exhausted ? tail.nextCursor : null]);
      if (!tail.exhausted) resumeUpdates.push(['ingest_resume_stop_id', null]);
    } catch (error) {
      await c.alert('ingest-resume', `ingest resume walk failed and was dropped: ${error instanceof Error ? error.message : String(error)}`);
      resumeUpdates.push(['ingest_resume_cursor', null], ['ingest_resume_stop_id', null]);
    }
  }

  await storeListMessages(c, collected, fallbackLoader(c));
  for (const [key, value] of resumeUpdates) await store.setMeta(db, key, value);
  await store.setMeta(db, 'last_ingest_ok_at', now.toISOString());
  await publishLiveFiles(c);
}

async function walk(
  c: RunContext,
  startCursor: string | null,
  stop: StopRule,
  floorMs: number,
  pageSize: number,
  maxPages: number,
): Promise<WalkResult> {
  const messages: ListMessage[] = [];
  let cursor = startCursor;
  for (let pages = 1; pages <= maxPages; pages++) {
    const page = await c.ccip.listMessages({ limit: pageSize, cursor });
    const known = stop.kind === 'known' ? await store.knownIds(c.env.DB, page.messages.map((m) => m.messageId)) : new Set<string>();
    let stopped = false;
    for (const m of page.messages) {
      const reachedStop = stop.kind === 'known' ? known.has(m.messageId) : m.messageId === stop.id;
      if (reachedStop || Date.parse(m.sendTimestamp) < floorMs) {
        stopped = true;
        break;
      }
      messages.push(m);
    }
    if (stopped || page.cursor === null || page.messages.length === 0) {
      return { messages, pagesUsed: pages, exhausted: false, nextCursor: null };
    }
    cursor = page.cursor;
  }
  return { messages, pagesUsed: maxPages, exhausted: true, nextCursor: cursor };
}

export async function storeListMessages(c: RunContext, messages: ListMessage[], loader: FallbackLoader): Promise<void> {
  const db = c.env.DB;
  const unique = [...new Map(messages.map((m) => [m.messageId, m])).values()].map(normalizeList);
  const prices = await store.getPrices(db, [...new Set(unique.flatMap(priceKeys))]);
  const fallback = await priceFallback(loader, unique.flatMap((m) => m.tokens), prices, (keys) => store.getPrices(db, keys));
  const { rows, tokens, outliers } = buildRows(
    unique,
    (key) => prices.get(key),
    (m) => ({ source: 'live', nextCheckAt: firstCheckAt(m.sendTs) }),
    fallback,
  );
  await store.upsertListRows(db, rows, tokens);
  await alertPriceOutliers(c, outliers);
}

export async function ensureLiveStart(db: D1Database, now: Date): Promise<string> {
  const existing = await store.getMeta(db, 'live_start_day');
  if (existing !== null) return existing;
  const today = dayOf(now);
  const before = addDays(today, -1);
  await store.setMeta(db, 'live_start_day', today);
  await store.setMeta(db, 'last_finalize_day', before);
  await store.setMeta(db, 'last_archived_day', before);
  return today;
}
