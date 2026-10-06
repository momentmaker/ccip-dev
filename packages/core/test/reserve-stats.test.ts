import { describe, expect, it } from 'vitest';
import { reserveStats, weekStart, type PricedTransfer } from '../src/reserve-stats';

const raw = (link: number) => (BigInt(Math.round(link * 100)) * 10n ** 16n).toString();
const D = '0x5680681ed3767b96914ce741a308155c7fb9171d';
const NOW = new Date('2026-10-06T16:00:00.000Z');

const t = (ts: string, tx: string, direction: 'in' | 'out', link: number, linkUsd: number | null, counterparty = D): PricedTransfer =>
  ({ ts, tx, direction, counterparty, amount: raw(link), linkUsd });

// Weeks start on Monday: 08-31, 09-07, 09-14, 09-21, 09-28, 10-05 (current).
const FIXTURE: PricedTransfer[] = [
  t('2026-09-01T10:00:00.000Z', '0x01', 'in', 100_000, 10),
  t('2026-09-02T12:00:00.000Z', '0x02', 'in', 5, 10, '0xgift'),
  t('2026-09-16T15:00:00.000Z', '0x03', 'in', 50_000, 20),
  t('2026-09-20T09:00:00.000Z', '0x04', 'out', 1, 18, '0xback'),
  t('2026-09-30T15:00:00.000Z', '0x05', 'in', 60_000, null),
  t('2026-10-06T10:00:00.000Z', '0x06', 'in', 40_000, 12.5),
];

describe('weekStart', () => {
  it('returns the UTC Monday of the week', () => {
    expect(weekStart('2026-10-06T16:00:00.000Z')).toBe('2026-10-05');
    expect(weekStart('2026-10-05T00:00:00.000Z')).toBe('2026-10-05');
    expect(weekStart('2026-10-04T23:59:59.000Z')).toBe('2026-09-28');
  });
});

describe('reserveStats', () => {
  const stats = reserveStats({ transfers: FIXTURE, linkPriceUsd: 15, now: NOW });

  it('computes cost at transfer-time prices and value at the current price', () => {
    // in 250,005, out 1, so net 250,004. Cost: 1,000,000 + 50 + 1,000,000 + 500,000 − 18 = 2,500,032 (0x05 is unpriced).
    expect(stats.cost_basis).toEqual({
      link_in: 250_005,
      link_out: 1,
      cost_usd: 2_500_032,
      value_usd: 3_750_060,
      change_usd: 1_250_028,
      change_pct: 50,
      avg_deposit_price_usd: 13.1579,
      unpriced_transfers: 1,
    });
  });

  it('buckets deposits by week, skipping gifts and keeping empty weeks', () => {
    expect(stats.weekly).toEqual([
      { week: '2026-08-31', deposits: 1, link: 100_000, usd: 1_000_000 },
      { week: '2026-09-07', deposits: 0, link: 0, usd: 0 },
      { week: '2026-09-14', deposits: 1, link: 50_000, usd: 1_000_000 },
      { week: '2026-09-21', deposits: 0, link: 0, usd: 0 },
      { week: '2026-09-28', deposits: 1, link: 60_000, usd: 0 },
      { week: '2026-10-05', deposits: 1, link: 40_000, usd: 500_000 },
    ]);
  });

  it('averages the last four complete weeks and projects the next million', () => {
    // Complete weeks 09-07 … 09-28: 110,000 LINK / 4 = 27,500; 1,000,000 USD / 4 = 250,000.
    // (1,000,000 − 250,004) / 27,500 = 27.2726 weeks after NOW, which lands on 2027-04-15.
    expect(stats.pace).toEqual({
      deposits: 4,
      last_deposit: { ts: '2026-10-06T10:00:00.000Z', tx: '0x06', link: 40_000, price_usd: 12.5, usd: 500_000 },
      days_since_last_deposit: 0.25,
      avg_weekly_link_4w: 27_500,
      avg_weekly_usd_4w: 250_000,
      annualized_link: 1_430_000,
      supply_share_pct: 0.025,
      next_milestone: { link: 1_000_000, eta: '2027-04-15' },
    });
  });

  it('ranks priced deposits by entry price against the current price', () => {
    expect(stats.performance).toEqual({
      best: { ts: '2026-09-01T10:00:00.000Z', tx: '0x01', price_usd: 10 },
      worst: { ts: '2026-09-16T15:00:00.000Z', tx: '0x03', price_usd: 20 },
      above: 2,
      below: 1,
    });
  });

  it('lists every transfer oldest first, with now-values only for inflows', () => {
    expect(stats.transfers).toHaveLength(6);
    expect(stats.transfers[0]).toEqual({
      ts: '2026-09-01T10:00:00.000Z', tx: '0x01', direction: 'in', counterparty: D, link: 100_000,
      price_usd: 10, usd: 1_000_000, value_now_usd: 1_500_000, change_pct: 50,
    });
    expect(stats.transfers[3]).toMatchObject({ direction: 'out', usd: 18, value_now_usd: null, change_pct: null });
    expect(stats.transfers[4]).toMatchObject({ price_usd: null, usd: null, value_now_usd: 900_000, change_pct: null });
    expect(stats.latest_transfer).toEqual(stats.transfers[5]);
  });

  it('sorts its input by time, so a shuffled list gives the same result', () => {
    expect(reserveStats({ transfers: [...FIXTURE].reverse(), linkPriceUsd: 15, now: NOW })).toEqual(stats);
  });

  it('nulls every value that needs the current price when the price is unavailable', () => {
    const noPrice = reserveStats({ transfers: FIXTURE, linkPriceUsd: null, now: NOW });
    expect(noPrice.cost_basis).toMatchObject({ cost_usd: 2_500_032, value_usd: null, change_usd: null, change_pct: null });
    expect(noPrice.performance).toMatchObject({ above: null, below: null });
    expect(noPrice.transfers[0]).toMatchObject({ value_now_usd: null, change_pct: null });
  });

  it('has no pace, weeks or milestone before the first deposit', () => {
    const empty = reserveStats({ transfers: [t('2026-09-02T12:00:00.000Z', '0x02', 'in', 5, 10, '0xgift')], linkPriceUsd: 15, now: NOW });
    expect(empty.weekly).toEqual([]);
    expect(empty.pace).toMatchObject({
      deposits: 0, last_deposit: null, days_since_last_deposit: null, avg_weekly_link_4w: null, annualized_link: null, next_milestone: null,
    });
    expect(empty.performance).toEqual({ best: null, worst: null, above: 0, below: 0 });
  });

  it('averages over fewer than four complete weeks when the history is short', () => {
    const short = reserveStats({
      transfers: [t('2026-09-22T10:00:00.000Z', '0x10', 'in', 30_000, 10), t('2026-09-30T10:00:00.000Z', '0x11', 'in', 10_000, 10)],
      linkPriceUsd: 10,
      now: NOW,
    });
    expect(short.pace?.avg_weekly_link_4w).toBe(20_000);
  });
});
