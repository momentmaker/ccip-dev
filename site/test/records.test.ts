import { describe, expect, it } from 'vitest';
import {
  computeMilestones, computeRecords, formatThresholdUsd, liveRecordBreaks, messageThresholds, valueThresholds, type DayStats,
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
