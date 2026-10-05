import { describe, expect, it } from 'vitest';
import { addDays, dayOf, dayStartIso, daysBetween, toIsoUtc } from '../src/time';

describe('dayOf', () => {
  it('keeps the last millisecond of a day on that day', () => {
    expect(dayOf('2026-10-05T23:59:59.999Z')).toBe('2026-10-05');
  });
  it('puts midnight on the new day', () => {
    expect(dayOf('2026-10-06T00:00:00Z')).toBe('2026-10-06');
  });
  it('converts offsets to UTC before taking the date', () => {
    expect(dayOf('2026-10-05T20:00:00-05:00')).toBe('2026-10-06');
  });
  it('throws on an unparseable timestamp', () => {
    expect(() => dayOf('not a date')).toThrow('Invalid timestamp: not a date');
  });
});

describe('day arithmetic', () => {
  it('adds and subtracts days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });
  it('lists days inclusively and returns nothing for an inverted range', () => {
    expect(daysBetween('2026-10-04', '2026-10-06')).toEqual(['2026-10-04', '2026-10-05', '2026-10-06']);
    expect(daysBetween('2026-10-07', '2026-10-06')).toEqual([]);
  });
  it('formats day starts and normalizes timestamps to ISO UTC', () => {
    expect(dayStartIso('2026-10-05')).toBe('2026-10-05T00:00:00.000Z');
    expect(toIsoUtc('2026-10-05T11:14:53Z')).toBe('2026-10-05T11:14:53.000Z');
  });
});
