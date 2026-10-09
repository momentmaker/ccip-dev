import type { DayTotals } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { addDays } from '../src/lib/days';
import { dayFeeMix, feesBesideDeposits, linkDemandTiles, mixCoverageNote, mixWeeks, weeklyFees, weeksInRange } from '../src/lib/fee-mix';

interface Groups { link: number; native: number; stable: number; amount: number }
const day = (d: string, fee: number | null, groups: Groups | null = null): DayTotals => ({
  day: d, messages: 10, token_messages: 0, usd_value: 0, fee_usd: fee, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0,
  fee_link_usd: groups ? groups.link : null,
  ...(groups ? { fee_native_usd: groups.native, fee_stable_usd: groups.stable, fee_link_amount: groups.amount } : {}),
});
const week = (monday: string, fee: number | null, groups: Groups | null = null) => Array.from({ length: 7 }, (_, i) => day(addDays(monday, i), fee, groups));
const G: Groups = { link: 2, native: 5, stable: 1, amount: 0.5 };

describe('weeklyFees', () => {
  it('sums complete Monday-to-Sunday weeks and leaves a partial week out', () => {
    // #given one full week and the first four days of the next
    const days = [...week('2026-09-28', 10, G), ...week('2026-10-05', 10, G).slice(0, 4)];
    // #when, #then
    expect(weeklyFees(days)).toEqual([{ week: '2026-09-28', fee_usd: 70, mix: { link: 14, native: 35, stable: 7, other: 14 } }]);
  });

  it('leaves out a week with a day that has no fee data', () => {
    const days = week('2026-09-28', 10, G).map((d, i) => (i === 3 ? { ...d, fee_usd: null } : d));
    expect(weeklyFees(days)).toEqual([]);
  });

  it('has no mix for a week whose days lack the fee group columns', () => {
    expect(weeklyFees(week('2026-09-28', 10))[0]?.mix).toBeNull();
  });

  it('never makes other negative when the rounded groups add up to more than the fees', () => {
    // #given $1.00 days whose groups round to $1.01
    const days = week('2026-09-28', 1, { link: 0.34, native: 0.33, stable: 0.34, amount: 0.02 });
    // #when, #then
    expect(weeklyFees(days)[0]?.mix?.other).toBe(0);
  });
});

describe('mixWeeks', () => {
  it('keeps the weeks that have a mix, flattened', () => {
    const weeks = weeklyFees([...week('2026-09-21', 10), ...week('2026-09-28', 10, G)]);
    expect(mixWeeks(weeks)).toEqual([{ week: '2026-09-28', link: 14, native: 35, stable: 7, other: 14 }]);
  });
});

describe('feesBesideDeposits', () => {
  it('pairs weekly fees with the Reserve deposits of the same week, over the weeks both cover', () => {
    // #given fee weeks of 09-21 and 09-28, and deposit weeks of 09-28 and 10-05
    const weeks = weeklyFees([...week('2026-09-21', 10), ...week('2026-09-28', 20)]);
    const deposits = [{ week: '2026-09-28', deposits: 1, link: 1000, usd: 15000 }, { week: '2026-10-05', deposits: 0, link: 0, usd: 0 }];
    // #when, #then
    expect(feesBesideDeposits(weeks, deposits)).toEqual([{ week: '2026-09-28', fees_usd: 140, deposits_usd: 15000 }]);
  });
});

describe('weeksInRange', () => {
  const weeks = Array.from({ length: 60 }, (_, i) => ({ week: addDays('2025-08-04', 7 * i) }));

  it.each([['90d', 13], ['1y', 52], ['all', 60]] as const)('shows %s as the last %i weeks', (range, n) => {
    expect(weeksInRange(weeks, range)).toHaveLength(n);
  });
});

describe('mixCoverageNote', () => {
  it("names the first mix week when the mix starts after history's first full week", () => {
    const days = [...week('2026-09-21', 10), ...week('2026-09-28', 10, G)];
    expect(mixCoverageNote(days, weeklyFees(days))).toBe('2026-09-28');
  });

  it("has no note when the mix starts at history's first full week", () => {
    // #given history starting on a Thursday, with the mix from the next Monday
    const days = [...['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'].map((d) => day(d, 10, G)), ...week('2026-09-28', 10, G)];
    // #when, #then
    expect(mixCoverageNote(days, weeklyFees(days))).toBeNull();
  });
});

describe('linkDemandTiles', () => {
  const L: Groups = { link: 2, native: 4, stable: 1, amount: 0.5 };

  it('sums LINK paid all-time and over the last 30 days, and the share of fees paid in LINK', () => {
    // #given 10 days without group columns, then 30 days of $8 fees with $2 and 0.5 LINK paid in LINK
    const days = [...Array.from({ length: 10 }, (_, i) => day(addDays('2026-08-01', i), 8)), ...Array.from({ length: 30 }, (_, i) => day(addDays('2026-08-11', i), 8, L))];
    // #when, #then
    expect(linkDemandTiles(days)).toEqual({ allTimeLink: 15, linkSince: '2026-08-11', last30Link: 15, last30Note: null, last30SharePct: 25 });
  });

  it('notes the first day with LINK amounts when it falls inside the last 30 days', () => {
    // #given
    const days = [...Array.from({ length: 20 }, (_, i) => day(addDays('2026-08-01', i), 8)), ...Array.from({ length: 10 }, (_, i) => day(addDays('2026-08-21', i), 8, L))];
    // #when
    const tiles = linkDemandTiles(days);
    // #then
    expect({ last30Link: tiles.last30Link, last30Note: tiles.last30Note }).toEqual({ last30Link: 5, last30Note: 'since 2026-08-21' });
  });

  it('has no LINK figures before any day carries them', () => {
    expect(linkDemandTiles(week('2026-09-28', 8))).toMatchObject({ allTimeLink: null, linkSince: null, last30Link: null });
  });
});

describe('dayFeeMix', () => {
  it('splits a day into the four groups of the weekly mix, as shares of its fees', () => {
    // #given $10 of fees: $2 in LINK, $5 in gas tokens and $1 in stablecoins, so $2 other
    const mix = dayFeeMix(day('2026-10-07', 10, G));
    // #then
    expect(mix?.map((p) => [p.key, p.label, p.className, p.usd, p.pct])).toEqual([
      ['link', 'LINK', 'series-link', 2, 20],
      ['native', 'Gas tokens', 'series-native', 5, 50],
      ['stable', 'Stablecoins', 'series-stable', 1, 10],
      ['other', 'Other', 'series-other', 2, 20],
    ]);
  });

  it('has no mix for a day without the group columns, as on days before them', () => {
    expect(dayFeeMix(day('2026-09-01', 10))).toBeNull();
  });

  it('has no mix for a day without fees', () => {
    expect(dayFeeMix(day('2026-09-01', null))).toBeNull();
  });

  it('keeps other at zero and the shares at 100% when the rounded groups add up to more than the fees', () => {
    // #given a $1.00 day whose groups round to $1.01
    const mix = dayFeeMix(day('2026-10-07', 1, { link: 0.34, native: 0.33, stable: 0.34, amount: 0 }))!;
    // #then
    expect({ other: mix[3]!.usd, total: Math.round(mix.reduce((sum, p) => sum + p.pct, 0)) }).toEqual({ other: 0, total: 100 });
  });
});
