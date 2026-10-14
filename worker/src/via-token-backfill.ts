import { dayOf } from '@ccip-dev/core';
import type { RunContext } from './context';
import * as store from './store';

export const VIA_TOKEN_BACKFILL_DAYS_PER_RUN = 60;

const CURSOR = 'via_token_backfill:before';
const DONE = 'done';

/**
 * Fills the via_token rows of the days rolled up before the dimension existed, newest first, `maxDays` a run, one
 * statement a day: the whole history in one request times D1 out. Finalize writes every day from today on through the
 * rollup, so the cursor starts at today and only walks back; a day both write gets the same upserted rows.
 */
export async function backfillViaToken(c: RunContext, maxDays = VIA_TOKEN_BACKFILL_DAYS_PER_RUN): Promise<void> {
  const db = c.env.DB;
  const before = (await store.getMeta(db, CURSOR)) ?? dayOf(c.deps.now());
  if (before === DONE) return;
  const days = await store.rolledUpDaysBefore(db, before, maxDays);
  for (const day of days) await store.backfillViaTokenDay(db, day);
  await store.setMeta(db, CURSOR, days.at(-1) ?? DONE);
}
