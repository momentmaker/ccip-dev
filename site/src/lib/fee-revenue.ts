import { FEE_DATA_START, feesSince } from './records';

export const RUN_RATE_DAYS = 30;

type FeeDay = { day: string; fee_usd: number | null };

export interface FeeHistoryTotals {
  usd: number;
  through: string;
  since: string;
  runRateUsd: number | null;
}

export interface HeroFees {
  usd: number;
  runRateUsd: number | null;
  since: string | null;
}

export function feeHistoryTotals(days: readonly FeeDay[]): FeeHistoryTotals | null {
  const since = feesSince(days);
  if (since === null) return null;
  const sorted = [...days].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const window = sorted.slice(-RUN_RATE_DAYS);
  const full = window.length === RUN_RATE_DAYS && window.every((d) => d.fee_usd !== null);
  return {
    usd: sorted.reduce((sum, d) => sum + (d.fee_usd ?? 0), 0),
    through: sorted.at(-1)!.day,
    since,
    runRateUsd: full ? (window.reduce((sum, d) => sum + d.fee_usd!, 0) * 365) / RUN_RATE_DAYS : null,
  };
}

/** Adds the live days history.json does not hold yet: today, and yesterday between midnight and the next site build. */
export function heroFees(totals: FeeHistoryTotals | null, live: readonly (FeeDay | null)[]): HeroFees | null {
  if (totals === null) return null;
  const extra = live.reduce((sum, d) => sum + (d !== null && d.day > totals.through ? d.fee_usd ?? 0 : 0), 0);
  return { usd: totals.usd + extra, runRateUsd: totals.runRateUsd, since: totals.since > FEE_DATA_START ? totals.since : null };
}
