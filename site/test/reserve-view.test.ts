import { describe, expect, it } from 'vitest';
import { countdown, DEPOSIT_PAST_DUE, depositCoins, depositWeeks, DUST_LINK, MAX_COINS, millionCrossings, roadTo, shownTransfers, stackWithReserve, timeToStack, valueAtPriceText, vaultFill } from '../src/lib/reserve-view';

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

const transfer = (ts: string, link: number, direction: 'in' | 'out' = 'in') => ({
  ts, tx: `0x${ts}`, direction, counterparty: '0xdep', link, price_usd: 10, usd: link * 10, value_now_usd: link * 12, change_pct: 20, deposit: direction === 'in',
});

describe('depositWeeks', () => {
  it('gives each deposit week the average price the Reserve paid', () => {
    // #given
    const weekly = [{ week: '2026-10-19', deposits: 1, link: 80_000, usd: 960_000 }];
    // #then
    expect(depositWeeks(weekly)).toEqual([{ week: '2026-10-19', link: 80_000, price: 12 }]);
  });

  it('skips weeks without a deposit', () => {
    // #given
    const weekly = [{ week: '2026-10-12', deposits: 0, link: 0, usd: 0 }, { week: '2026-10-19', deposits: 1, link: 50, usd: 500 }];
    // #then
    expect(depositWeeks(weekly).map((w) => w.week)).toEqual(['2026-10-19']);
  });
});

describe('millionCrossings', () => {
  it('dates each whole million the balance first reached, with the days since the one before', () => {
    // #given
    const transfers = [transfer('2025-08-01T00:00:00.000Z', 600_000), transfer('2025-08-11T00:00:00.000Z', 500_000), transfer('2025-08-21T00:00:00.000Z', 1_000_000)];
    // #then
    expect(millionCrossings(transfers)).toEqual([
      { link: 1_000_000, ts: '2025-08-11T00:00:00.000Z', days: 10 },
      { link: 2_000_000, ts: '2025-08-21T00:00:00.000Z', days: 10 },
    ]);
  });

  it('counts LINK sent out against the balance, so a million is reached once', () => {
    // #given
    const transfers = [transfer('2025-08-01T00:00:00.000Z', 1_000_000), transfer('2025-08-02T00:00:00.000Z', 10, 'out'), transfer('2025-08-03T00:00:00.000Z', 10)];
    // #then
    expect(millionCrossings(transfers).map((c) => c.ts)).toEqual(['2025-08-01T00:00:00.000Z']);
  });
});

describe('roadTo', () => {
  const reserve = {
    latest: { ts: '2026-10-31T19:00:00.000Z', link: 6_475_076 },
    pace: { avg_weekly_link_4w: 83_697, supply_share_pct: 0.6475, next_milestone: { link: 7_000_000, eta: '2026-12-14' } },
    transfers: [transfer('2025-08-01T00:00:00.000Z', 6_475_076)],
  };

  it('runs to 1% of all LINK, the millions ahead dated at this pace', () => {
    // #when
    const ahead = roadTo(reserve as never).filter((s) => !s.reached);
    // #then
    expect(ahead.map((s) => [s.link, s.day])).toEqual([
      [7_000_000, '2026-12-14'],
      [8_000_000, '2027-03-08'],
      [9_000_000, '2027-05-30'],
      [10_000_000, '2027-08-22'],
    ]);
  });

  it('keeps the millions already reached with the day each was', () => {
    // #when
    const reached = roadTo(reserve as never).filter((s) => s.reached);
    // #then
    expect(reached.map((s) => [s.link, s.day])).toEqual([1, 2, 3, 4, 5, 6].map((m) => [m * 1_000_000, '2025-08-01']));
  });

  it('leaves the days ahead blank without a pace', () => {
    // #when
    const ahead = roadTo({ ...reserve, pace: { ...reserve.pace, avg_weekly_link_4w: null, next_milestone: null } } as never).filter((s) => !s.reached);
    // #then
    expect(ahead.every((s) => s.day === null)).toBe(true);
  });
});

describe('stackWithReserve', () => {
  const weeks = [{ week: '2026-10-12', link: 100, price: 10 }, { week: '2026-10-19', link: 100, price: 20 }];

  it('buys the same dollars each deposit week at the price the Reserve paid', () => {
    // #then
    expect(stackWithReserve(weeks, 100, 15)).toEqual({ deposits: 2, invested: 200, link: 15, value: 225, changePct: 12.5 });
  });

  it('has no value without a LINK price', () => {
    // #then
    expect(stackWithReserve(weeks, 100, null)).toMatchObject({ link: 15, value: null, changePct: null });
  });
});

describe('timeToStack', () => {
  it('says how long the Reserve takes to stack a bag at this pace', () => {
    // #then
    expect(timeToStack(1_000, 84_000)).toBe(7_200);
  });

  it('has no answer without a pace', () => {
    // #then
    expect([timeToStack(1_000, null), timeToStack(1_000, 0)]).toEqual([null, null]);
  });
});

describe('shownTransfers', () => {
  const transfers = [transfer('2025-08-01T00:00:00.000Z', 1), ...Array.from({ length: 12 }, (_, i) => transfer(`2026-0${(i % 9) + 1}-1${i % 10}T00:00:00.000Z`, 80_000 + i))];

  it('shows the 10 newest transfers above the dust line, newest first', () => {
    // #when
    const shown = shownTransfers(transfers, { all: false, dust: false });
    // #then
    expect([shown.length, shown[0]!.ts >= shown.at(-1)!.ts, shown.every((t) => t.link >= DUST_LINK)]).toEqual([10, true, true]);
  });

  it('shows every transfer once asked, the dust only when asked too', () => {
    // #then
    expect([shownTransfers(transfers, { all: true, dust: false }).length, shownTransfers(transfers, { all: true, dust: true }).length]).toEqual([12, 13]);
  });
});
