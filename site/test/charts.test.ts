import type { DayTotals } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { chartGeometry, chartSeries, nearestIndex, pointX, rangeRows, rangeTotals } from '../src/lib/charts';

const row = (day: string, messages: number, usd: number, fee: number | null): DayTotals => ({
  day, messages, token_messages: messages, usd_value: usd, fee_usd: fee, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null,
});
const DAYS = [row('2026-09-01', 5, 50, null), row('2026-10-04', 10, 100, null), row('2026-10-05', 20, 200, 2), row('2026-10-06', 30, 300, 3)];

describe('history charts', () => {
  it('selects the rows inside a range ending on the last day', () => {
    expect(rangeRows(DAYS, '30d', '2026-10-06').map((d) => d.day)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06']);
    expect(rangeRows(DAYS, 'all', '2026-10-06')).toHaveLength(4);
  });

  it('builds daily and cumulative series, cumulating only additive metrics', () => {
    expect(chartSeries(DAYS.slice(1), 'messages', true).map((p) => p.value)).toEqual([10, 30, 60]);
    expect(chartSeries(DAYS.slice(1), 'fee_usd', true).map((p) => p.value)).toEqual([null, 2, 5]);
    expect(chartSeries(DAYS.slice(1), 'median_delivery_s', true).map((p) => p.value)).toEqual([60, 60, 60]);
  });

  it('draws a line and an area from zero', () => {
    const g = chartGeometry([{ day: 'a', value: 0 }, { day: 'b', value: 10 }], 100, 50, 0);
    expect(g.line).toBe('M0,50L100,0');
    expect(g.area).toBe('M0,50L100,0L100,50L0,50Z');
    expect(g).toMatchObject({ min: 0, max: 10, last: { day: 'b', value: 10 } });
  });

  it('breaks the line where values are missing', () => {
    const g = chartGeometry([{ day: 'a', value: 1 }, { day: 'b', value: null }, { day: 'c', value: 2 }], 100, 50, 0);
    expect(g.line.match(/M/g)).toHaveLength(2);
    expect(g.last).toEqual({ day: 'c', value: 2 });
  });

  it('maps pointer positions to the nearest point', () => {
    expect(pointX(1, 3, 100, 0)).toBe(50);
    expect(nearestIndex(49, 100, 3, 0)).toBe(1);
    expect(nearestIndex(-20, 100, 3, 0)).toBe(0);
    expect(nearestIndex(500, 100, 3, 0)).toBe(2);
  });

  it('totals a range, with null fees when none were collected', () => {
    expect(rangeTotals(DAYS)).toEqual({ messages: 65, usd_value: 650, fee_usd: 5 });
    expect(rangeTotals(DAYS.slice(0, 2))).toEqual({ messages: 15, usd_value: 150, fee_usd: null });
  });
});
