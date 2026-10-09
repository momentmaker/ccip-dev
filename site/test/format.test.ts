import { describe, expect, it } from 'vitest';
import {
  DASH, formatAgo, formatBps, formatCompactCount, formatCount, formatCountdown, formatDuration, formatFee, formatLink, formatPct, formatPrice, formatShare, formatUsd, formatUsdFull, formatUtcDay, formatUtcTime, linkShareText,
} from '../src/lib/format';

describe('formatUsd', () => {
  it.each([
    [0, '$0'],
    [950, '$950'],
    [999.6, '$1.0K'],
    [1_234, '$1.2K'],
    [999_940, '$999.9K'],
    [999_960, '$1.0M'],
    [999_949, '$999.9K'],
    [999_999, '$1.0M'],
    [1_000_000, '$1.0M'],
    [999_949_999, '$999.9M'],
    [999_999_999, '$1.0B'],
    [999_999_999_999, '$1.0T'],
    [-999_999, '−$1.0M'],
    [1_200_000_000, '$1.2B'],
    [25_300_000_000, '$25.3B'],
    [-1_500_000, '−$1.5M'],
  ])('%s → %s', (value, text) => {
    expect(formatUsd(value)).toBe(text);
  });

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])('shows a dash for %s', (value) => {
    expect(formatUsd(value)).toBe(DASH);
  });
});

describe('other number formats', () => {
  it('formats full USD, counts and LINK with thousands separators', () => {
    expect(formatUsdFull(67_978_229.35)).toBe('$67,978,229');
    expect(formatUsdFull(-12.5)).toBe('−$13');
    expect(formatCount(1_565_729)).toBe('1,565,729');
    expect(formatCount(null)).toBe(DASH);
    expect(formatCompactCount(2_409)).toBe('2.4K');
    expect(formatLink(6_122_201.43)).toBe('6,122,201 LINK');
  });

  it('signs percentages with a true minus and shows zero unsigned', () => {
    expect(formatPct(26.28)).toBe('+26.3%');
    expect(formatPct(-1.65)).toBe('−1.7%');
    expect(formatPct(0)).toBe('0.0%');
    expect(formatPct(-0.01)).toBe('0.0%');
    expect(formatPct(0.6122, 2)).toBe('+0.61%');
    expect(formatPct(null)).toBe(DASH);
  });
});

describe('durations', () => {
  it.each([
    [45, '45s'],
    [62, '1m 2s'],
    [3_700, '1h 1m'],
    [90_000, '1d 1h'],
  ])('%s seconds → %s', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });

  it('counts down with padded fields', () => {
    expect(formatCountdown(2 * 86_400_000 + 14 * 3_600_000 + 5 * 60_000 + 9_000)).toBe('2d 14h 05m');
    expect(formatCountdown(14 * 3_600_000 + 5 * 60_000 + 9_000)).toBe('14h 05m 09s');
    expect(formatCountdown(-5)).toBe('0h 00m 00s');
  });
});

describe('dates are UTC whatever the visitor time zone', () => {
  it('formats days and times in UTC', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(formatUtcDay('2026-10-06')).toBe('Oct 6, 2026');
      expect(formatUtcDay('2026-10-07T03:00:00.000Z')).toBe('Oct 7, 2026');
      expect(formatUtcTime('2026-10-07T03:04:05.000Z')).toBe('03:04 UTC');
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it('describes ages', () => {
    const now = new Date('2026-10-07T12:00:00.000Z');
    expect(formatAgo('2026-10-07T11:59:48.000Z', now)).toBe('12 s ago');
    expect(formatAgo('2026-10-07T11:57:00.000Z', now)).toBe('3 min ago');
    expect(formatAgo('2026-10-07T10:00:00.000Z', now)).toBe('2 h ago');
    expect(formatAgo('2026-10-03T12:00:00.000Z', now)).toBe('4 d ago');
    expect(formatAgo('2026-10-07T12:00:05.000Z', now)).toBe('just now');
  });
});

describe('formatPrice', () => {
  it('prints a dollar price with cents, or a dash for none', () => {
    expect(formatPrice(18.456)).toBe('$18.46');
    expect(formatPrice(null)).toBe(DASH);
    expect(formatPrice(undefined)).toBe(DASH);
  });
});

describe('linkShareText', () => {
  it.each([
    [0, '0% paid in LINK'],
    [0.04, '<0.1% paid in LINK'],
    [0.39, '0.4% paid in LINK'],
    [9.94, '9.9% paid in LINK'],
    [12.6, '13% paid in LINK'],
  ])('shows a %s percent share as "%s"', (pct, expected) => {
    expect(linkShareText(pct)).toBe(expected);
  });
});

describe('formatFee', () => {
  it.each([
    [0.4234, '$0.42'],
    [12.3, '$12.30'],
    [0.004, '<$0.01'],
    [0, '$0.00'],
    [2500, '$2.5K'],
    [null, '—'],
  ])('formats a fee of %s as %s', (value, text) => {
    expect(formatFee(value)).toBe(text);
  });
});

describe('formatBps', () => {
  it.each([
    [0.2384, '0.24 bps'],
    [2.54, '2.5 bps'],
    [17.31, '17 bps'],
    [0.004, '<0.01 bps'],
    [null, '—'],
  ])('formats a take rate of %s as %s', (value, text) => {
    expect(formatBps(value)).toBe(text);
  });
});

describe('formatShare', () => {
  it.each([
    [20, '20%'],
    [0.4, '<1%'],
    [0, '0%'],
    [null, '—'],
  ])('formats a share of %s as %s', (value, text) => {
    expect(formatShare(value)).toBe(text);
  });
});
