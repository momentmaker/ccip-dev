import { describe, expect, it } from 'vitest';
import { addDays, dayStartMs, daysBetween, isDay } from '../src/lib/days';

describe('days', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-06', -7)).toBe('2026-09-29');
    expect(addDays('2023-12-31', 1)).toBe('2024-01-01');
  });

  it('accepts only real YYYY-MM-DD days', () => {
    expect(isDay('2026-10-06')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-10-6')).toBe(false);
    expect(isDay('../etc')).toBe(false);
  });

  it('gives the UTC midnight and inclusive ranges', () => {
    expect(dayStartMs('2026-10-06')).toBe(Date.parse('2026-10-06T00:00:00.000Z'));
    expect(daysBetween('2026-09-29', '2026-10-01')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
    expect(daysBetween('2026-10-02', '2026-10-01')).toEqual([]);
  });
});
