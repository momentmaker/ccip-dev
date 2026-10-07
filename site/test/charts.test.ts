import type { DayTotals } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { chartGeometry, chartSeries, chartSummary, linkShare, nearestIndex, pointX, rangeRows, rangeTotals, stepIndex } from '../src/lib/charts';

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

  describe('linkShare', () => {
    const link = (day: string, fee: number | null, feeLink: number | null): DayTotals => ({ ...row(day, 1, 1, fee), fee_link_usd: feeLink });
    const rows = [link('2026-10-05', 4, 1), link('2026-10-06', 6, 5)];

    it('uses the single day when not cumulative', () => {
      expect(linkShare(rows, '2026-10-06', false)).toBe(83.33333333333334);
    });

    it('sums up to the day when cumulative', () => {
      expect(linkShare(rows, '2026-10-06', true)).toBe(60);
      expect(linkShare(rows, '2026-10-05', true)).toBe(25);
    });

    it('is null without fees', () => {
      expect(linkShare([link('2026-10-05', null, null)], '2026-10-05', false)).toBeNull();
      expect(linkShare([link('2026-10-05', null, null)], '2026-10-05', true)).toBeNull();
    });

    it('is null on a zero fee sum or missing link fees', () => {
      expect(linkShare([link('2026-10-05', 0, 0)], '2026-10-05', true)).toBeNull();
      expect(linkShare([link('2026-10-05', 0, 0)], '2026-10-05', false)).toBeNull();
      expect(linkShare([link('2026-10-05', 3, null)], '2026-10-05', false)).toBeNull();
    });
  });

  describe('stepIndex', () => {
    it('moves by one and clamps at both ends', () => {
      expect(stepIndex(1, 'ArrowRight', 3)).toBe(2);
      expect(stepIndex(2, 'ArrowRight', 3)).toBe(2);
      expect(stepIndex(1, 'ArrowLeft', 3)).toBe(0);
      expect(stepIndex(0, 'ArrowLeft', 3)).toBe(0);
    });

    it('jumps with Home and End', () => {
      expect(stepIndex(1, 'Home', 3)).toBe(0);
      expect(stepIndex(1, 'End', 3)).toBe(2);
    });

    it('starts from the edges when nothing is selected', () => {
      expect(stepIndex(null, 'ArrowLeft', 3)).toBe(2);
      expect(stepIndex(null, 'ArrowRight', 3)).toBe(0);
    });

    it('ignores other keys', () => {
      expect(stepIndex(1, 'a', 3)).toBe(1);
      expect(stepIndex(null, 'Tab', 3)).toBeNull();
    });
  });

  describe('chartSummary', () => {
    const fmt = (v: number | null) => `#${v}`;
    const points = [{ day: '2026-10-04', value: 10 }, { day: '2026-10-05', value: 30 }, { day: '2026-10-06', value: 20 }, { day: '2026-10-07', value: null }];

    it('describes the range, latest and high', () => {
      expect(chartSummary('Messages', points, fmt, false)).toBe('Messages, Oct 4, 2026 to Oct 6, 2026: latest #20, high #30');
    });

    it('mentions cumulative', () => {
      expect(chartSummary('Messages', points, fmt, true)).toContain('Messages, cumulative, ');
    });

    it('reports no data', () => {
      expect(chartSummary('Fees', [{ day: '2026-10-04', value: null }], fmt, false)).toBe('Fees: no data');
    });
  });
});
