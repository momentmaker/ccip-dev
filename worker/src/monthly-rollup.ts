import { monthBounds, nextMonth } from '@ccip-dev/core/month';
import type { RunContext } from './context';
import { LATE_FINALIZE_HOUR_UTC } from './schedule';
import * as store from './store';

export { ROLLED_THROUGH_KEY } from './store';

/** Months the hourly run rolls a run: the ~28 months of history roll forward within about ten hours of a reset. */
export const MONTHS_PER_RUN = 3;

/**
 * Rolls the months after the pointer, oldest first, while each month's last day is finalized, and advances the pointer
 * after each one. It skips the hours a finalize rewrites days (00:07 and 06:00), and advances only from the month before
 * (store.advanceRolledThrough), so a rewind that moved the pointer back meanwhile is rolled again on a later run.
 */
export async function rollForwardMonths(c: RunContext): Promise<void> {
  const hour = c.deps.now().getUTCHours();
  if (hour === 0 || hour === LATE_FINALIZE_HOUR_UTC) return;
  const db = c.env.DB;
  const finalized = await store.getMeta(db, 'last_finalize_day');
  if (finalized === null) return;
  const through = await store.rolledThrough(db);
  let month = through === null ? (await store.firstBreakdownDay(db))?.slice(0, 7) : nextMonth(through);
  for (let rolled = 0; month !== undefined && rolled < MONTHS_PER_RUN && monthBounds(month).last <= finalized; rolled++) {
    await store.rollMonth(db, month);
    if (!(await store.advanceRolledThrough(db, month))) return;
    month = nextMonth(month);
  }
}
