import { describe, expect, it } from 'vitest';
import { linkAmount, payoutWhen, utcStamp } from '../src/peg-format';

describe('utcStamp', () => {
  it('writes a UTC month, day and minute', () => {
    expect(utcStamp('2026-11-18T15:50:11.000Z')).toBe('Nov 18 15:50 UTC');
  });
});

describe('linkAmount', () => {
  it('keeps one decimal under 100 and whole numbers from 100', () => {
    expect([linkAmount(17.88), linkAmount(99.94), linkAmount(38_000)]).toEqual(['17.9', '99.9', '38,000']);
  });

  it('writes an amount that rounds up to 100 as a whole number', () => {
    expect(linkAmount(99.96)).toBe('100');
  });
});

describe('payoutWhen', () => {
  const AFTER = '2026-11-18T15:50:00.000Z';
  const before = new Date('2026-11-18T03:20:00.000Z');
  const past = new Date('2026-11-18T16:00:00.000Z');

  it('names the payout time while it is ahead', () => {
    expect(payoutWhen({ next_payout_after: AFTER, claim_window_open: true }, before)).toBe('next payout after Nov 18 15:50 UTC');
  });

  it('adds that no claim window is open to a payout time ahead', () => {
    expect(payoutWhen({ next_payout_after: AFTER, claim_window_open: false }, before)).toBe('next payout after Nov 18 15:50 UTC (no claim window open)');
  });

  it('says a payout is possible now once its time has passed inside an open window', () => {
    expect(payoutWhen({ next_payout_after: AFTER, claim_window_open: true }, past)).toBe('next payout possible now');
  });

  it('waits on the next claim window once its time has passed outside one', () => {
    expect(payoutWhen({ next_payout_after: AFTER, claim_window_open: false }, past)).toBe('payout possible in the next claim window');
  });
});
