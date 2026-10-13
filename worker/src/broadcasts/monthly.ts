import { monthlySummaryKey, parseMonthlySummary, type MonthSummary } from '@ccip-dev/core/month';
import type { RunContext } from '../context';

export interface MonthlyFacts {
  kind: 'monthly';
  month: string;
  summary: MonthSummary;
}

/**
 * The month summary the workflow recorded with the video, which its end card was drawn from. The caption is written from
 * it, not from D1, so it matches the video even after the 06:00 late finalize or a backfill rewrites the month's rows.
 */
export async function loadMonthlyFacts(c: RunContext, month: string): Promise<MonthlyFacts | { problem: string }> {
  const key = monthlySummaryKey(month);
  const object = await c.env.ARCHIVE.get(key);
  if (object === null) return { problem: `${key} is not in the archive bucket` };
  const parsed = parseMonthlySummary(await object.text(), month);
  return 'problem' in parsed ? { problem: `${key} ${parsed.problem}` } : { kind: 'monthly', month, summary: parsed.summary };
}
