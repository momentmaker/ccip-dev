import { buildReplay, feeClassifier } from '@ccip-dev/core';
import { monthBounds, monthSummary, type MonthSummary } from '@ccip-dev/core/month';
import type { RunContext } from '../context';
import { historyDays, LARGEST_FEES_LIMIT, largestFeeEntries } from '../publish';
import * as store from '../store';

export interface MonthlyFacts {
  kind: 'monthly';
  month: string;
  summary: MonthSummary;
}

/**
 * The month's totals and highlights, from D1 through the functions that write history.json and replay.json, with the
 * largest fees as of the month's last day: the files the month page read when the video was recorded on the 1st. So the
 * caption and the video's end card agree.
 */
export async function loadMonthlyFacts(c: RunContext, month: string): Promise<MonthlyFacts> {
  const db = c.env.DB;
  const days = await historyDays(c);
  const largest = await largestFeeEntries(c, monthBounds(month).last, LARGEST_FEES_LIMIT, feeClassifier(await store.linkFeeTokens(db)));
  const replay = buildReplay(await store.laneHistory(db), await store.chainDisplayNames(db));
  return { kind: 'monthly', month, summary: monthSummary(month, { days, largest, replay }) };
}
