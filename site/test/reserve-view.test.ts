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

  it('says nothing without a price or a value', () => {
    expect(valueAtPriceText(1_234_567, null)).toBe('');
    expect(valueAtPriceText(1_234_567, undefined)).toBe('');
    expect(valueAtPriceText(null, 18.4)).toBe('');
  });
});
