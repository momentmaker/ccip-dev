import { describe, expect, it } from 'vitest';
import { countdown, DEPOSIT_PAST_DUE, depositCoins, MAX_COINS, valueAtPriceText, vaultFill } from '../src/lib/reserve-view';

const HOUR = 3_600_000;
const DUE = '2026-10-08T15:35:00.000Z';
const due = Date.parse(DUE);

describe('vaultFill', () => {
  it('fills toward the next round million', () => {
    expect(vaultFill(6_122_201.43)).toEqual({ target: 7_000_000, fraction: expect.closeTo(0.8746, 4) });
    expect(vaultFill(7_000_000)).toEqual({ target: 8_000_000, fraction: 0.875 });
    expect(vaultFill(null)).toBeNull();
  });
});

describe('countdown', () => {
  it('counts down to the expected deposit', () => {
    expect(countdown(DUE, false, due - (2 * 24 + 14) * HOUR - 5 * 60_000 - 9_000)).toEqual({ kind: 'counting', text: '2d 14h 05m' });
  });

  it('watches once the time has passed, then reports overdue after 24 h or when flagged', () => {
    expect(countdown(DUE, false, due + HOUR)).toEqual({ kind: 'expected', text: DEPOSIT_PAST_DUE });
    expect(countdown(DUE, false, due + 25 * HOUR)).toEqual({ kind: 'overdue', text: 'Overdue by 25 h' });
    expect(countdown(DUE, true, due + 30 * HOUR)).toEqual({ kind: 'overdue', text: 'Overdue by 30 h' });
  });

  it('has nothing to show without a schedule', () => {
    expect(countdown(null, false, due)).toEqual({ kind: 'none' });
  });
});

describe('the 24 h deposit grace', () => {
  it('counts down to the last millisecond before the expected time, then watches from the moment it is due', () => {
    expect(countdown(DUE, false, due - 1).kind).toBe('counting');
    expect(countdown(DUE, false, due)).toEqual({ kind: 'expected', text: DEPOSIT_PAST_DUE });
  });

  it('still only watches at exactly 24 h past due', () => {
    expect(countdown(DUE, false, due + 24 * HOUR)).toEqual({ kind: 'expected', text: DEPOSIT_PAST_DUE });
  });

  it('turns overdue, saying 24 h, one millisecond later', () => {
    expect(countdown(DUE, false, due + 24 * HOUR + 1)).toEqual({ kind: 'overdue', text: 'Overdue by 24 h' });
  });

  it('shows an overdue flag raised before the due time as at least 1 h', () => {
    expect(countdown(DUE, true, due - 5 * HOUR)).toEqual({ kind: 'overdue', text: 'Overdue by 1 h' });
  });
});

describe('vaultFill at a milestone', () => {
  it('starts the next million at empty when the reserve sits exactly on a million', () => {
    expect(vaultFill(1_000_000)).toEqual({ target: 2_000_000, fraction: 0.5 });
    expect(vaultFill(0)).toEqual({ target: 1_000_000, fraction: 0 });
    expect(vaultFill(999_999)).toEqual({ target: 1_000_000, fraction: 0.999999 });
  });
});

describe('depositCoins', () => {
  it('keeps only weeks with deposits, newest last, capped', () => {
    const weekly = Array.from({ length: 30 }, (_, i) => ({ week: `w${String(i).padStart(2, '0')}`, deposits: i === 3 ? 0 : 1, link: 10 * i, usd: 100 * i }));
    const coins = depositCoins(weekly);
    expect(coins).toHaveLength(MAX_COINS);
    expect(coins.at(-1)).toEqual({ week: 'w29', link: 290, usd: 2900 });
    expect(coins.some((c) => c.week === 'w03')).toBe(false);
  });
});

describe('valueAtPriceText', () => {
  it('states the value at the LINK price', () => {
    expect(valueAtPriceText(1_234_567, 18.456)).toBe('≈ $1.2M at $18.46 per LINK');
  });

  it('states a LINK price of zero rather than hiding it', () => {
    expect(valueAtPriceText(0, 0)).toBe('≈ $0 at $0.00 per LINK');
  });

  it('says nothing without a price or a value', () => {
    expect(valueAtPriceText(1_234_567, null)).toBe('');
    expect(valueAtPriceText(1_234_567, undefined)).toBe('');
    expect(valueAtPriceText(null, 18.4)).toBe('');
  });
});
