import type { Dim } from '@ccip-dev/core';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { MONTHS_PER_RUN, ROLLED_THROUGH_KEY, rollForwardMonths } from '../src/monthly-rollup';
import * as store from '../src/store';
import { harness, resetStorage } from './helpers';

beforeEach(resetStorage);

const HOUR = '2026-10-12T13:00:00.000Z';
const totals = (day: string) => ({ day, messages: 1, token_messages: 0, usd_value: 1, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 });
const row = (day: string, dim: Dim, key: string, messages: number, usd_value: number, fee_usd: number | null) => ({ day, dim, key, messages, usd_value, fee_usd });
const monthly = async (month: string) =>
  (await env.DB.prepare('SELECT dim, key, messages, usd_value, fee_usd, first_day FROM monthly_breakdown WHERE month = ? ORDER BY dim, key').bind(month).all()).results;
const pointer = () => store.getMeta(env.DB, ROLLED_THROUGH_KEY);

async function seedDays(days: Record<string, ReturnType<typeof row>[]>) {
  for (const [day, rows] of Object.entries(days)) await store.replaceDaily(env.DB, totals(day), rows, HOUR);
}

describe('rollMonth', () => {
  it("sums each dim and key over the month's days, with the first day it appeared", async () => {
    // #given two days of August and one of September
    await seedDays({
      '2025-08-03': [row('2025-08-03', 'lane', 'a>b', 2, 10, 1), row('2025-08-03', 'sender', '1:0xs', 1, 5, null)],
      '2025-08-20': [row('2025-08-20', 'lane', 'a>b', 3, 20, null), row('2025-08-20', 'lane', 'b>a', 1, 1, 0.5)],
      '2025-09-01': [row('2025-09-01', 'lane', 'a>b', 100, 100, 100)],
    });
    // #when
    await store.rollMonth(env.DB, '2025-08');
    // #then
    expect(await monthly('2025-08')).toEqual([
      { dim: 'lane', key: 'a>b', messages: 5, usd_value: 30, fee_usd: 1, first_day: '2025-08-03' },
      { dim: 'lane', key: 'b>a', messages: 1, usd_value: 1, fee_usd: 0.5, first_day: '2025-08-20' },
      { dim: 'sender', key: '1:0xs', messages: 1, usd_value: 5, fee_usd: null, first_day: '2025-08-03' },
    ]);
  });

  it('replaces the month when rolled again, so a second roll changes nothing', async () => {
    // #given
    await seedDays({ '2025-08-03': [row('2025-08-03', 'lane', 'a>b', 2, 10, 1)] });
    await store.rollMonth(env.DB, '2025-08');
    const first = await monthly('2025-08');
    // #when
    await store.rollMonth(env.DB, '2025-08');
    // #then
    expect(await monthly('2025-08')).toEqual(first);
  });
});

describe('rollForwardMonths', () => {
  beforeEach(async () => {
    // #given daily rows from 2025-01 to 2025-06, finalized through 2025-05-31
    for (const month of ['01', '02', '03', '04', '05', '06']) await seedDays({ [`2025-${month}-10`]: [row(`2025-${month}-10`, 'lane', 'a>b', 1, 1, null)] });
    await store.setMeta(env.DB, 'last_finalize_day', '2025-05-31');
  });

  it(`rolls the oldest months first, ${MONTHS_PER_RUN} a run, and advances the pointer`, async () => {
    // #when
    await rollForwardMonths(harness({ now: HOUR }).c);
    // #then
    expect({ pointer: await pointer(), rolled: (await env.DB.prepare('SELECT DISTINCT month FROM monthly_breakdown ORDER BY month').all()).results }).toEqual({
      pointer: '2025-03',
      rolled: [{ month: '2025-01' }, { month: '2025-02' }, { month: '2025-03' }],
    });
  });

  it('stops at the month whose last day is not finalized yet', async () => {
    // #when two runs
    await rollForwardMonths(harness({ now: HOUR }).c);
    await rollForwardMonths(harness({ now: HOUR }).c);
    // #then May is the last complete month; June is still open
    expect(await pointer()).toBe('2025-05');
  });

  it('leaves the finalize hours alone, so it never rolls a month a finalize is rewriting', async () => {
    // #when at 00:00 and at 06:00
    await rollForwardMonths(harness({ now: '2026-10-12T00:00:00.000Z' }).c);
    await rollForwardMonths(harness({ now: '2026-10-12T06:00:00.000Z' }).c);
    // #then
    expect(await pointer()).toBeNull();
  });

  it('does not advance the pointer past a month rewound while it rolled', async () => {
    // #given the pointer at February
    await store.setMeta(env.DB, ROLLED_THROUGH_KEY, '2025-02');
    // #when March is rolled, but the pointer was moved back to January meanwhile
    await store.rollMonth(env.DB, '2025-03');
    await store.setMeta(env.DB, ROLLED_THROUGH_KEY, '2025-01');
    const advanced = await store.advanceRolledThrough(env.DB, '2025-03');
    // #then
    expect({ advanced, pointer: await pointer() }).toEqual({ advanced: false, pointer: '2025-01' });
  });
});

describe('rewriting a rolled day', () => {
  beforeEach(async () => {
    await seedDays({ '2025-03-10': [row('2025-03-10', 'lane', 'a>b', 1, 1, null)], '2025-05-10': [row('2025-05-10', 'lane', 'a>b', 1, 1, null)] });
    await store.setMeta(env.DB, ROLLED_THROUGH_KEY, '2025-04');
  });

  it("moves the pointer back before the day's month, so readers take its daily rows until it is re-rolled", async () => {
    // #when a day of March is finalized again
    await seedDays({ '2025-03-10': [row('2025-03-10', 'lane', 'a>b', 9, 9, null)] });
    // #then
    expect(await pointer()).toBe('2025-02');
  });

  it('leaves the pointer for a day after it', async () => {
    // #when
    await seedDays({ '2025-05-10': [row('2025-05-10', 'lane', 'a>b', 9, 9, null)] });
    // #then
    expect(await pointer()).toBe('2025-04');
  });

  it('moves it back when the via-token backfill rewrites a rolled day too', async () => {
    // #when
    await store.backfillViaTokenDay(env.DB, '2025-03-10');
    // #then
    expect(await pointer()).toBe('2025-02');
  });
});
