import { describe, expect, it } from 'vitest';
import {
  allTimeTotal, broadcastCardPath, broadcastKey, dayTotalsFacts, newcomerPathOk, parseBroadcastPath, recordDriver, recordValueText, reserveDepositFacts, weekTotalsFacts, type BroadcastTarget,
} from '../src/broadcasts';
import type { DayTotals, TransferView } from '../src/public';
import type { RecordSet } from '../src/records';

const TX = `0x${'ab'.repeat(32)}`;
const totals = (day: string, messages: number, usd: number, fee: number | null, link: number | null = null, amount: number | null = null): DayTotals => ({
  day, messages, token_messages: 0, usd_value: usd, fee_usd: fee, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0, fee_link_usd: link, fee_link_amount: amount,
});

describe('broadcast keys and card paths', () => {
  const targets: [BroadcastTarget, string, string][] = [
    [{ kind: 'daily', day: '2026-10-10' }, 'broadcast:daily:2026-10-10', 'broadcast/daily/2026-10-10'],
    [{ kind: 'weekly', monday: '2026-10-05' }, 'broadcast:weekly:2026-10-05', 'broadcast/weekly/2026-10-05'],
    [{ kind: 'record', record: 'fees', day: '2026-07-09' }, 'broadcast:record:fees:2026-07-09', 'broadcast/record/fees/2026-07-09'],
    [{ kind: 'milestone', metric: 'value', threshold: 2_500_000_000 }, 'broadcast:milestone:value:2500000000', 'broadcast/milestone/value/2500000000'],
    [{ kind: 'reserve', tx: TX }, `broadcast:reserve:${TX}`, `broadcast/reserve/${TX}`],
    [{ kind: 'welcome', selector: '7281642695469137430' }, 'broadcast:welcome:7281642695469137430', 'broadcast/welcome/7281642695469137430'],
    [{ kind: 'countdown', metric: 'fees', threshold: 2_500_000 }, 'broadcast:countdown:fees:2500000', 'broadcast/countdown/fees/2500000'],
    [{ kind: 'poll', monday: '2026-10-12' }, 'broadcast:poll:2026-10-12', 'broadcast/poll/2026-10-12'],
    [{ kind: 'movers', monday: '2026-10-05' }, 'broadcast:movers:2026-10-05', 'broadcast/movers/2026-10-05'],
    [{ kind: 'spotlight', monday: '2026-10-05' }, 'broadcast:spotlight:2026-10-05', 'broadcast/spotlight/2026-10-05'],
    [{ kind: 'roundup', monday: '2026-10-05' }, 'broadcast:roundup:2026-10-05', 'broadcast/roundup/2026-10-05'],
    [{ kind: 'project', monday: '2026-10-05' }, 'broadcast:project:2026-10-05', 'broadcast/project/2026-10-05'],
    [{ kind: 'newcomer', key: 'project:xstocks' }, 'broadcast:newcomer:project:xstocks', 'broadcast/newcomer/project/xstocks'],
    [
      { kind: 'newcomer', key: 'address:0x671be08d6d3c826c2f6d76915f1b54af484d4077' },
      'broadcast:newcomer:address:0x671be08d6d3c826c2f6d76915f1b54af484d4077',
      'broadcast/newcomer/address/0x671be08d6d3c826c2f6d76915f1b54af484d4077',
    ],
  ];

  it.each(targets)('keys, prints and parses back %o', (target, key, path) => {
    // #when
    const parsed = parseBroadcastPath(path.split('/'));
    // #then
    expect({ key: broadcastKey(target), path: broadcastCardPath(target), parsed }).toEqual({ key, path, parsed: target });
  });

  it.each([
    'broadcast/monthly/2026-10-10', 'broadcast/weekly/2026-10-06', 'broadcast/daily/2026-02-30', 'broadcast/record/busiest/2026-07-09',
    'broadcast/record/fees/2026-07-09/x', 'broadcast/milestone/fees/0', 'broadcast/milestone/fees/1e6', 'broadcast/reserve/0xABC', 'daily/2026-10-10',
    'broadcast/welcome/0123', 'broadcast/welcome/base', 'broadcast/countdown/link_share/100', 'broadcast/countdown/fees/0', 'broadcast/movers/2026-10-06', 'broadcast/project/2026-10-06',
    'broadcast/poll/2026-10-12/x', 'broadcast/roundup/2026-02-30',
    'broadcast/newcomer/project/XStocks', 'broadcast/newcomer/robot/x', 'broadcast/newcomer/address/a_b', 'broadcast/newcomer/project',
  ])('rejects %s', (path) => {
    expect(parseBroadcastPath(path.split('/'))).toBeNull();
  });

  it('plans a newcomer only when its key can be a card path', () => {
    // #then
    expect(['project:xstocks', 'address:A8JPtC8mYrZKvainsrr3cGhTcoBeUV2vd8SXun55in3u', 'address:a:b', 'address:a/b', 'address:a_b'].map(newcomerPathOk)).toEqual([true, true, false, false, false]);
  });

  it('keys the monthly video, which has no card path', () => {
    expect(broadcastKey({ kind: 'monthly', month: '2026-09' })).toBe('broadcast:monthly:2026-09');
  });
});

describe('dayTotalsFacts', () => {
  const prior = ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map((d) => totals(d, 200, 8e6, 4));

  it('compares the day with the mean of the 7 days before it, and gives its LINK share', () => {
    // #when
    const facts = dayTotalsFacts([totals('2026-10-02', 9_999, 9e9, 999), ...prior, totals('2026-10-10', 150, 2e6, 5, 1.25, 0.1)], '2026-10-10');
    // #then the day 8 days back is not in the mean
    expect(facts).toEqual({
      day: '2026-10-10',
      messages: { value: 150, pct: -25 },
      value: { value: 2e6, pct: -75 },
      fees: { value: 5, pct: 25 },
      linkSharePct: 25,
      linkUsd: 1.25,
      linkAmount: 0.1,
    });
  });

  it('averages over the days it has, and gives no change without any', () => {
    // #when
    const short = dayTotalsFacts([totals('2026-10-09', 100, 1e6, null), totals('2026-10-10', 150, 2e6, 5)], '2026-10-10');
    // #then the one earlier day has no fee data, so fees have no change
    expect({ messages: short?.messages, fees: short?.fees, missing: dayTotalsFacts(prior, '2026-10-10') }).toEqual({
      messages: { value: 150, pct: 50 },
      fees: { value: 5, pct: null },
      missing: null,
    });
  });
});

describe('weekTotalsFacts', () => {
  const MONDAY = '2026-10-05';
  const week = [0, 1, 2, 3, 4, 5, 6].map((i) => totals(`2026-10-${String(5 + i).padStart(2, '0')}`, 100, 1e6, i + 1, i === 0 ? 7 : 0, i === 0 ? 0.5 : 0));
  const before = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((d) => totals(d, 50, 2e6, 4));

  it('totals Monday to Sunday against the week before, with fees by day', () => {
    // #when
    const facts = weekTotalsFacts([...before, ...week], MONDAY);
    // #then
    expect(facts).toEqual({
      monday: MONDAY,
      sunday: '2026-10-11',
      messages: { value: 700, pct: 100 },
      value: { value: 7e6, pct: -50 },
      fees: { value: 28, pct: 0 },
      linkSharePct: 25,
      linkUsd: 7,
      linkAmount: 0.5,
      feesByDay: [1, 2, 3, 4, 5, 6, 7],
    });
  });

  it('has nothing for a week with no day', () => {
    expect(weekTotalsFacts(week, '2026-10-12')).toBeNull();
  });
});

describe('record text, drivers and totals', () => {
  const record = (kind: RecordSet['kind']): RecordSet => ({ kind, day: '2026-07-09', value: 57_300, previous: { day: '2026-03-01', value: 47_800 }, stoodDays: 130 });
  const lane = { key: '1>2', messages: 400, usd: 5.2e6, fee_usd: 10 };
  const feeLane = { key: '3>1', messages: 5_712, usd: 1e6, fee_usd: 50_000 };

  it('writes each record value the way the Records page does', () => {
    expect(['messages', 'value', 'fees', 'largest_fee', 'link_share'].map((k) => recordValueText(k as RecordSet['kind'], 57_300))).toEqual([
      '57,300', '$57.3K', '$57.3K', '$57.3K', '57300%',
    ]);
  });

  it('takes the top fee lane for fees, the busiest lane for messages and value, the fee itself for the largest fee, and nothing for the LINK share', () => {
    // #given
    const leaders = { lane, fee_lane: feeLane };
    const largest = [{ message_id: '0x1', day: '2026-07-09', src: '5', dst: '6', fee_usd: 57_300, symbol: 'USDC' }];
    // #then
    expect([
      recordDriver(record('fees'), leaders, largest),
      recordDriver(record('value'), leaders, largest),
      recordDriver(record('largest_fee'), leaders, largest),
      recordDriver(record('link_share'), leaders, largest),
    ]).toEqual([
      { lane: '3>1', messages: 5_712, usd: 1e6, feeUsd: 50_000, symbol: null },
      { lane: '1>2', messages: 400, usd: 5.2e6, feeUsd: 10, symbol: null },
      { lane: '5>6', messages: 1, usd: null, feeUsd: 57_300, symbol: 'USDC' },
      null,
    ]);
  });

  it('sums an all-time total through the record day', () => {
    // #given
    const days = [totals('2026-07-08', 10, 100, 1, null, 0.5), totals('2026-07-09', 20, 200, null, null, 0.25), totals('2026-07-10', 40, 400, 4, null, 1)];
    // #then
    expect(['messages', 'value', 'fees', 'link_amount'].map((m) => allTimeTotal(m as 'messages', days, '2026-07-09'))).toEqual([30, 300, 1, 0.75]);
  });
});

describe('reserveDepositFacts', () => {
  const view = (ts: string, tx: string, direction: 'in' | 'out', link: number, extra: Partial<TransferView> = {}): TransferView => ({
    ts, tx, direction, counterparty: '0xd', link, price_usd: null, usd: null, value_now_usd: null, change_pct: null, deposit: direction === 'in' && link >= 1000, ...extra,
  });
  const reserve = {
    transfers: [
      view('2026-09-01T10:00:00.000Z', '0x01', 'in', 100_000),
      view('2026-09-02T12:00:00.000Z', '0x02', 'in', 5),
      view('2026-09-08T15:00:00.000Z', '0x03', 'in', 50_000),
      view('2026-09-10T09:00:00.000Z', '0x04', 'out', 1),
      view('2026-09-15T15:00:00.000Z', '0x05', 'in', 60_000, { price_usd: 12.5, usd: 750_000, value_now_usd: 900_000, change_pct: 20 }),
    ],
    weekly: [
      { week: '2026-08-31', deposits: 1, link: 100_000, usd: 1_000_000 },
      { week: '2026-09-07', deposits: 1, link: 50_000, usd: 600_000 },
      { week: '2026-09-14', deposits: 1, link: 60_000, usd: 750_000 },
    ],
  };

  it('describes a deposit as of its own time, so a later render reads the same', () => {
    // #when
    const facts = reserveDepositFacts(reserve, '0x05');
    // #then 210,004 LINK held; the 4 weeks before its week average 75,000 LINK; 789,996 LINK to go is 10.53 weeks
    expect(facts).toEqual({
      tx: '0x05', ts: '2026-09-15T15:00:00.000Z', link: 60_000, usdAtDeposit: 750_000, usdNow: 900_000, changePct: 20,
      balanceLink: 210_004, depositCount: 3, streak: 3, avgWeeklyLink: 75_000, avgWeeklyUsd: 800_000, averageWeeks: 2,
      nextMilestone: { link: 1_000_000, eta: '2026-11-28' },
      weeks: [{ week: '2026-08-31', link: 100_000 }, { week: '2026-09-07', link: 50_000 }, { week: '2026-09-14', link: 60_000 }],
    });
  });

  it('averages at most the 4 weeks before the deposit, and says how many it used', () => {
    // #given six earlier weeks before a deposit in the week of Oct 12, and none before the first week
    const weekly = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'].map((week) => ({ week, deposits: 1, link: 1000, usd: 10_000 }));
    const long = { transfers: [{ ...reserve.transfers[4]!, ts: '2026-10-13T15:00:00.000Z' }], weekly };
    // #when
    const counts = [reserveDepositFacts(long, '0x05')?.averageWeeks, reserveDepositFacts(reserve, '0x05')?.averageWeeks, reserveDepositFacts({ ...reserve, weekly: [] }, '0x05')?.averageWeeks];
    // #then
    expect(counts).toEqual([4, 2, 0]);
  });

  it('has nothing for a gift, an outflow or an unknown transaction', () => {
    expect([reserveDepositFacts(reserve, '0x02'), reserveDepositFacts(reserve, '0x04'), reserveDepositFacts(reserve, '0x99')]).toEqual([null, null, null]);
  });

  it('reads deposits from a file published before the deposit flag existed', () => {
    // #given the same transfers without the flag
    const old = { ...reserve, transfers: reserve.transfers.map(({ deposit: _flag, ...rest }) => rest) };
    // #then
    expect(reserveDepositFacts(old, '0x05')?.depositCount).toBe(3);
  });
});
