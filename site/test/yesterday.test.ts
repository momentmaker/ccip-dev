import type { DayTotals, TodayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { previousDay, rolloverSnapshot, yesterdayFor } from '../src/lib/yesterday';

const row = (day: string, messages: number) => ({ day, messages, usd_value: messages * 10 }) as DayTotals;
const days = [row('2026-10-05', 100), row('2026-10-06', 200)];

describe('yesterdayFor', () => {
  it('picks the day before today', () => {
    expect(yesterdayFor(days, '2026-10-07')?.messages).toBe(200);
  });

  it('follows today across midnight instead of staying on the build-time day', () => {
    expect(yesterdayFor(days, '2026-10-06')?.messages).toBe(100);
  });

  it('crosses month and year boundaries', () => {
    expect(yesterdayFor([row('2026-12-31', 7)], '2027-01-01')?.messages).toBe(7);
    expect(yesterdayFor([row('2026-02-28', 9)], '2026-03-01')?.messages).toBe(9);
  });

  it('is null when that day is not in history yet', () => {
    expect(yesterdayFor(days, '2026-10-08')).toBeNull();
  });
});

describe('previousDay', () => {
  it('steps back one UTC day', () => {
    expect(previousDay('2026-10-07')).toBe('2026-10-06');
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
  });
});

describe('rolloverSnapshot', () => {
  const polled = { day: '2026-10-07', totals: { messages: 321, usd_value: 4500 } } as unknown as TodayFile;

  it('keeps the totals of the day a live poll saw before the day changed', () => {
    expect(rolloverSnapshot(polled, '2026-10-08')).toEqual({ day: '2026-10-07', messages: 321, usd_value: 4500 });
  });

  it('has nothing without a previous live poll, so build-time partials are never shown as yesterday', () => {
    expect(rolloverSnapshot(null, '2026-10-08')).toBeNull();
  });

  it('has nothing while the day is unchanged', () => {
    expect(rolloverSnapshot(polled, '2026-10-07')).toBeNull();
  });
});
