import { describe, expect, it } from 'vitest';
import { addDays } from '../src/lib/days';
import { feeHistoryTotals, heroFees } from '../src/lib/fee-revenue';

const run = (from: string, fees: (number | null)[]) => fees.map((fee_usd, i) => ({ day: addDays(from, i), fee_usd }));
const THIRTY = run('2026-09-01', Array(30).fill(100));

describe('feeHistoryTotals', () => {
  it('adds up every day with fees and annualizes the last 30 days', () => {
    expect(feeHistoryTotals(THIRTY)).toEqual({ usd: 3000, through: '2026-09-30', since: '2026-09-01', runRateUsd: 36500 });
  });

  it('has no run-rate while one of the last 30 days has no fees', () => {
    // #given 30 days whose first has no fee data
    const days = run('2026-08-31', [null, ...Array(29).fill(100)]);
    // #when, #then
    expect(feeHistoryTotals(days)?.runRateUsd).toBeNull();
  });

  it('has no run-rate with fewer than 30 days of history', () => {
    expect(feeHistoryTotals(THIRTY.slice(1))?.runRateUsd).toBeNull();
  });

  it('is null without fee data', () => {
    expect(feeHistoryTotals(run('2026-09-01', [null, null]))).toBeNull();
  });
});

describe('heroFees', () => {
  const totals = feeHistoryTotals(THIRTY);

  it("adds today's live fees to history", () => {
    expect(heroFees(totals, [null, { day: '2026-10-01', fee_usd: 40 }])?.usd).toBe(3040);
  });

  it("adds yesterday's fees when history.json does not hold that day yet", () => {
    // #given the page saw midnight pass before the next site build
    const live = [{ day: '2026-10-01', fee_usd: 250 }, { day: '2026-10-02', fee_usd: 40 }];
    // #when, #then
    expect(heroFees(totals, live)?.usd).toBe(3290);
  });

  it('never counts a day history.json already holds', () => {
    expect(heroFees(totals, [{ day: '2026-09-30', fee_usd: 100 }, { day: '2026-10-01', fee_usd: 40 }])?.usd).toBe(3040);
  });

  it('names no first fee day when fees start within a week of 2023-07-06', () => {
    // #given
    const early = feeHistoryTotals(run('2023-07-07', [100]));
    // #when, #then
    expect(heroFees(early, [])?.since).toBeNull();
  });

  it('names the first fee day while it is after 2023-07-06', () => {
    expect(heroFees(totals, [])?.since).toBe('2026-09-01');
  });

  it('drops the first fee day once fees reach back to 2023-07-06', () => {
    expect(heroFees(feeHistoryTotals(run('2023-07-06', [1, 2])), [])?.since).toBeNull();
  });

  it('is null without fee history', () => {
    expect(heroFees(null, [{ day: '2026-10-01', fee_usd: 40 }])).toBeNull();
  });
});
