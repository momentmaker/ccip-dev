import { describe, expect, it } from 'vitest';
import {
  computeFeeMilestones, computeFeeRecords, computeMilestones, computeRecords, feeThresholds, feesNote, feesSince, formatThresholdUsd, liveRecordBreaks, messageThresholds, valueThresholds, type DayStats, type FeeDayStats,
} from '../src/lib/records';

const day = (d: string, messages: number, usd: number, senders: number, fee: number | null, median: number | null): DayStats => ({
  day: d, messages, usd_value: usd, unique_senders: senders, fee_usd: fee, median_delivery_s: median,
});

const DAYS = [
  day('2023-07-08', 210, 0, 6, null, 900),
  day('2023-07-06', 2, 0, 1, null, 3068),
  day('2026-10-05', 2487, 22_954_922, 812, 1245.29, 62),
  day('2026-10-06', 2409, 67_160_000, 812, 2100, 58),
  day('2026-10-04', 150, 5, 30, null, 40),
  day('2026-10-03', 99, 1, 3, null, 10),
];

describe('computeRecords', () => {
  it('finds each record, giving ties to the earliest day', () => {
    expect(computeRecords(DAYS)).toEqual([
      { key: 'busiest', title: 'Busiest day', day: '2026-10-05', value: 2487, display: '2,487 messages', note: null },
      { key: 'biggest', title: 'Biggest day', day: '2026-10-06', value: 67_160_000, display: '$67.2M moved', note: null },
      { key: 'senders', title: 'Most senders', day: '2026-10-05', value: 812, display: '812 senders', note: null },
      { key: 'fees', title: 'Highest fees', day: '2026-10-06', value: 2100, display: '$2.1K in fees', note: 'since 2026-10-05' },
      { key: 'fastest', title: 'Fastest delivery', day: '2026-10-04', value: 40, display: '40s median', note: 'days with 100+ messages' },
    ]);
  });

  it('counts a day for the fastest record from exactly 100 messages, not from 99', () => {
    const fastestOf = (messages: number) => computeRecords([day('2026-10-01', messages, 0, 1, null, 5), day('2026-10-02', 500, 0, 1, null, 50)]).find((r) => r.key === 'fastest');
    expect(fastestOf(100)).toMatchObject({ day: '2026-10-01', value: 5, display: '5s median' });
    expect(fastestOf(99)).toMatchObject({ day: '2026-10-02', value: 50 });
  });

  it('skips records no day qualifies for', () => {
    expect(computeRecords([day('2023-07-06', 2, 0, 1, null, null)]).map((r) => r.key)).toEqual(['busiest', 'biggest', 'senders']);
    expect(computeRecords([])).toEqual([]);
  });
});

describe('milestones', () => {
  it('lists thresholds up to the total', () => {
    expect(messageThresholds(12_000)).toEqual([1_000, 2_000, 5_000, 10_000]);
    expect(messageThresholds(999)).toEqual([]);
    expect(valueThresholds(30e9)).toEqual([1e9, 2.5e9, 5e9, 1e10, 2.5e10]);
    expect([2.5e9, 1e10, 1e12].map(formatThresholdUsd)).toEqual(['$2.5B', '$10B', '$1T']);
  });

  it('dates each threshold by the first day the running total reaches it', () => {
    const days = [day('2023-07-06', 600, 0.6e9, 1, null, null), day('2023-07-07', 500, 0.5e9, 1, null, null), day('2023-07-08', 1000, 1.5e9, 1, null, null)];
    const chains = Array.from({ length: 25 }, (_, i) => ({
      selector: String(1000 + i),
      name: null,
      display_name: i === 0 ? 'Ethereum Mainnet' : null,
      first_day: i < 24 ? '2023-07-06' : '2023-07-08',
    }));
    const milestones = computeMilestones(days, chains);
    expect(milestones.filter((m) => m.kind !== 'join')).toEqual([
      { kind: 'messages', day: '2023-07-07', label: '1,000 messages', threshold: 1_000 },
      { kind: 'value', day: '2023-07-07', label: '$1B moved', threshold: 1e9 },
      { kind: 'messages', day: '2023-07-08', label: '2,000 messages', threshold: 2_000 },
      { kind: 'value', day: '2023-07-08', label: '$2.5B moved', threshold: 2.5e9 },
      { kind: 'chains', day: '2023-07-08', label: '25 chains', threshold: 25 },
    ]);
    expect(milestones.filter((m) => m.kind === 'join')).toHaveLength(25);
    expect(milestones[0]).toEqual({ kind: 'join', day: '2023-07-06', label: 'Ethereum joins', threshold: null });
  });
});

describe('liveRecordBreaks', () => {
  const records = computeRecords(DAYS);

  it('announces each record today beats', () => {
    expect(liveRecordBreaks({ day: '2026-10-07', messages: 5212, usd_value: 1, unique_senders: 900 }, records)).toEqual([
      { key: 'busiest', text: 'New record: busiest day ever — 5,212 messages and counting' },
      { key: 'senders', text: 'New record: most senders in a day — 900 and counting' },
    ]);
    expect(liveRecordBreaks({ day: '2026-10-07', messages: 1, usd_value: 70_000_000, unique_senders: 1 }, records)).toEqual([
      { key: 'biggest', text: 'New record: biggest day ever — $70.0M and counting' },
    ]);
  });

  it('stays quiet when today only ties a record or no records exist', () => {
    expect(liveRecordBreaks({ day: '2026-10-07', messages: 2487, usd_value: 0, unique_senders: 812 }, records)).toEqual([]);
    expect(liveRecordBreaks({ day: '2026-10-07', messages: 10, usd_value: 0, unique_senders: 1 }, [])).toEqual([]);
  });
});

describe('fee coverage', () => {
  const days = [
    { day: '2026-10-03', fee_usd: null },
    { day: '2026-10-04', fee_usd: null },
    { day: '2026-10-05', fee_usd: 1245.29 },
    { day: '2026-10-06', fee_usd: 1072.33 },
  ];

  it('starts at the first day with fee data', () => {
    // #given days where fees begin on the 5th
    // #then the start is that day
    expect(feesSince(days)).toBe('2026-10-05');
  });

  it('has no start without fee data', () => {
    expect(feesSince([{ day: '2026-10-03', fee_usd: null }])).toBeNull();
  });

  it('notes a start that falls inside the shown days', () => {
    expect(feesNote(days, '2026-10-05')).toBe('since 2026-10-05');
  });

  it('has no note once fees cover every shown day', () => {
    expect(feesNote(days.slice(2), '2026-10-05')).toBeNull();
  });

  it('notes the start on the highest-fees record only while coverage is partial', () => {
    // #given one history with a fee gap and one without
    const full = (fee: number | null, d: string) => ({ day: d, messages: 1, usd_value: 1, unique_senders: 1, fee_usd: fee, median_delivery_s: null });
    // #when the records are computed
    const partial = computeRecords([full(null, '2026-10-04'), full(5, '2026-10-05')]).find((r) => r.key === 'fees');
    const complete = computeRecords([full(4, '2026-10-04'), full(5, '2026-10-05')]).find((r) => r.key === 'fees');
    // #then only the partial one carries a note
    expect([partial?.note, complete?.note]).toEqual(['since 2026-10-05', null]);
  });
});

describe('fee records', () => {
  const names = new Map([['15971525489660198786', 'Base'], ['5009297550715157269', 'Ethereum']]);
  const fee = (d: string, messages: number, usd: number | null, link: number | null, amount: number | null = null): FeeDayStats => ({
    ...day(d, messages, 0, 1, usd, null), fee_link_usd: link, fee_link_amount: amount,
  });
  const DAYS_F = [fee('2026-10-05', 150, 1000, 300, 25), fee('2026-10-06', 99, 50, 45, 3), fee('2026-10-07', 400, 2500, 500, 41.5)];
  const largest = [{ message_id: '0xabc', day: '2026-10-06', src: '15971525489660198786', dst: '5009297550715157269', fee_usd: 812.4, symbol: 'WETH' }];

  it('finds the four fee records', () => {
    expect(computeFeeRecords(DAYS_F, largest, names)).toEqual([
      { key: 'most_fees', title: 'Most fees in a day', day: '2026-10-07', display: '$2.5K', sub: null, explorerUrl: null },
      { key: 'largest_fee', title: 'Largest single fee', day: '2026-10-06', display: '$812', sub: 'Base → Ethereum · WETH', explorerUrl: 'https://ccip.chain.link/msg/0xabc' },
      { key: 'link_paid', title: 'Most paid in LINK in a day', day: '2026-10-07', display: '$500', sub: '42 LINK', explorerUrl: null },
      { key: 'link_share', title: 'Highest LINK share in a day', day: '2026-10-05', display: '30% paid in LINK', sub: 'days with 100+ messages', explorerUrl: null },
    ]);
  });

  it('counts a day for the LINK share from exactly 100 messages', () => {
    // #given the 90% day at 100 messages instead of 99
    const days = [DAYS_F[0]!, fee('2026-10-06', 100, 50, 45, 3), DAYS_F[2]!];
    // #when, #then
    expect(computeFeeRecords(days, largest, names).find((r) => r.key === 'link_share')?.day).toBe('2026-10-06');
  });

  it('leaves the largest fee out when history.json has no largest_fees', () => {
    expect(computeFeeRecords(DAYS_F, [], names).map((r) => r.key)).toEqual(['most_fees', 'link_paid', 'link_share']);
  });

  it('leaves the LINK records out while no day has LINK data', () => {
    expect(computeFeeRecords([fee('2026-10-05', 150, 1000, null)], [], names).map((r) => r.key)).toEqual(['most_fees']);
  });

  it('notes the first fee day on the most-fees record while coverage is partial', () => {
    // #given a day before fees began
    const days = [fee('2026-10-04', 150, null, null), ...DAYS_F];
    // #when, #then
    expect(computeFeeRecords(days, [], names)[0]?.sub).toBe('since 2026-10-05');
  });
});

describe('fee milestones', () => {
  const feeDay = (d: string, usd: number | null) => ({ day: d, fee_usd: usd });

  it('steps fee thresholds by 1, 2.5 and 5 from where they start, up to the total', () => {
    expect([feeThresholds(12e6, 1e6), feeThresholds(60e3, 1e4)]).toEqual([[1e6, 2.5e6, 5e6, 1e7], [1e4, 2.5e4, 5e4]]);
  });

  it('formats thresholds in K, M, B and T', () => {
    expect([1e4, 2.5e4, 1e6, 2.5e6, 1e9].map(formatThresholdUsd)).toEqual(['$10K', '$25K', '$1M', '$2.5M', '$1B']);
  });

  it('dates each all-time fee total by the first day the running total reaches it', () => {
    // #given fees from 2023-07-06 that pass $1M on the third day
    const days = [feeDay('2023-07-06', 400e3), feeDay('2023-07-07', 500e3), feeDay('2023-07-08', 200e3)];
    // #when, #then
    expect(computeFeeMilestones(days).filter((m) => m.kind === 'fees')).toEqual([{ kind: 'fees', day: '2023-07-08', label: '$1M in fees', threshold: 1e6 }]);
  });

  it('dates each fee-day threshold by the first day over it', () => {
    // #given
    const days = [feeDay('2023-07-06', 8e3), feeDay('2023-07-07', 12e3), feeDay('2023-07-08', 30e3), feeDay('2023-07-09', 11e3)];
    // #when
    const firsts = computeFeeMilestones(days).filter((m) => m.kind === 'fee_day').map((m) => [m.day, m.label]);
    // #then
    expect(firsts).toEqual([['2023-07-07', 'First $10K fee day'], ['2023-07-08', 'First $25K fee day']]);
  });

  it('lists no fee milestones while fee coverage starts after 2023-07-06', () => {
    expect(computeFeeMilestones([feeDay('2026-10-05', 2e6), feeDay('2026-10-06', 50e3)])).toEqual([]);
  });
});
