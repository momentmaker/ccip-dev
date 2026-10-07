import type { ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import {
  CARD_MAX_LAG_S,
  CARD_MIN_S,
  dayFlags,
  joinEvents,
  laneOpenEvents,
  MAX_RECORDS,
  milestoneEvents,
  recordEvents,
  scheduleCards,
  scheduleSlams,
  type DayEvent,
} from '../src/replay/director/beats';
import { linearWarp } from '../src/replay/director/warp';

const days = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'];
const chain = (selector: string, display_name: string, first_day: string) => ({ selector, name: `${selector}-mainnet`, display_name, first_day });

describe('day events', () => {
  it('turns each chain first day into a join, ordered by day', () => {
    const events = joinEvents([chain('b', 'Base Mainnet', '2024-01-03'), chain('e', 'Ethereum Mainnet', '2024-01-01')], days);
    expect(events).toEqual([
      { kind: 'join', dayIndex: 0, label: 'Ethereum', selectors: ['e'] },
      { kind: 'join', dayIndex: 2, label: 'Base', selectors: ['b'] },
    ]);
  });

  it('keeps threshold milestones and drops joins from the milestone list', () => {
    const events = milestoneEvents(
      [
        { kind: 'messages', day: '2024-01-02', label: '1,000 messages', threshold: 1000 },
        { kind: 'join', day: '2024-01-01', label: 'Ethereum joins', threshold: null },
      ],
      days,
    );
    expect(events).toEqual([{ kind: 'milestone', dayIndex: 1, label: '1,000 messages', selectors: [] }]);
  });

  it('picks the biggest jumps in the all-time daily record after the first month', () => {
    const series = Array.from({ length: 60 }, (_, i) => {
      const d = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
      return { day: d, messages: i === 40 ? 500 : i === 45 ? 600 : i === 50 ? 2000 : i === 55 ? 2100 : 10 };
    });
    const allDays = series.map((s) => s.day);
    const events = recordEvents(series, allDays);
    expect(events.length).toBeLessThanOrEqual(MAX_RECORDS);
    expect(events.map((e) => e.dayIndex)).toEqual([40, 45, 50]);
    expect(events[2]!.label).toBe('Record day · 2,000 messages');
  });

  it('opens one lane event per partner chain, on its first day', () => {
    const replay = {
      chains: [chain('e', 'Ethereum Mainnet', '2024-01-01'), chain('b', 'Base Mainnet', '2024-01-01'), chain('a', 'Arbitrum Mainnet', '2024-01-02')],
      lanes: [[0, 1], [2, 1], [1, 0]],
      days: [
        { day: '2024-01-01', lanes: [[0, 1, 5]] },
        { day: '2024-01-02', lanes: [[2, 1, 5], [1, 1, 5]] },
      ],
    } as unknown as ReplayFile;
    expect(laneOpenEvents(replay, 'b', days)).toEqual([
      { kind: 'lane', dayIndex: 0, label: 'Ethereum', selectors: ['e'] },
      { kind: 'lane', dayIndex: 1, label: 'Arbitrum', selectors: ['a'] },
    ]);
  });

  it('flags days that hold joins, lanes, milestones and records', () => {
    const flags = dayFlags(
      [
        { kind: 'join', dayIndex: 0, label: 'E', selectors: [] },
        { kind: 'milestone', dayIndex: 2, label: 'x', selectors: [] },
        { kind: 'record', dayIndex: 3, label: 'r', selectors: [] },
      ],
      4,
    );
    expect(flags).toEqual([
      { join: true, milestone: false, record: false },
      { join: false, milestone: false, record: false },
      { join: false, milestone: true, record: false },
      { join: false, milestone: false, record: true },
    ]);
  });
});

describe('scheduleCards', () => {
  const join = (dayIndex: number, label: string): DayEvent => ({ kind: 'join', dayIndex, label, selectors: [label] });

  it('labels single, double and batched joins', () => {
    const warp = linearWarp(30, 0, 30);
    const cards = scheduleCards([join(0, 'Ethereum'), join(10, 'Base'), join(10, 'Arbitrum'), join(20, 'A'), join(20, 'B'), join(20, 'C'), join(20, 'D')], warp, null);
    expect(cards.map((c) => c.label)).toEqual(['Ethereum joins', 'Base and Arbitrum join', '+4 chains: A · B · C']);
    expect(cards[2]!.selectors).toEqual(['A', 'B', 'C']);
    expect(cards[2]!.count).toBe(4);
  });

  it('never overlaps cards, holds each at least the minimum, and lets a join lag at most the limit', () => {
    const warp = linearWarp(3, 0, 1.5);
    const events = Array.from({ length: 20 }, (_, i) => join(i % 3, `C${i}`)).sort((a, b) => a.dayIndex - b.dayIndex);
    const cards = scheduleCards(events, warp, null);
    for (let i = 1; i < cards.length; i++) expect(cards[i]!.start).toBeGreaterThanOrEqual(cards[i - 1]!.end - 1e-9);
    for (const c of cards) {
      expect(c.end - c.start).toBeGreaterThanOrEqual(CARD_MIN_S - 1e-9);
      expect(c.start - c.time).toBeLessThanOrEqual(CARD_MAX_LAG_S + 1e-9);
    }
    expect(cards.reduce((n, c) => n + c.count, 0)).toBe(20);
  });

  it('labels focus lane cards with the focus chain', () => {
    const warp = linearWarp(10, 0, 10);
    const lane = (dayIndex: number, label: string): DayEvent => ({ kind: 'lane', dayIndex, label, selectors: [label] });
    expect(scheduleCards([lane(1, 'Arbitrum')], warp, 'Base')[0]!.label).toBe('Arbitrum ↔ Base');
    expect(scheduleCards([lane(1, 'A'), lane(1, 'B'), lane(1, 'C')], warp, 'Base')[0]!.label).toBe('+3 lanes to Base: A · B · C');
  });

  it('keeps record cards separate and handles empty input', () => {
    const warp = linearWarp(10, 0, 10);
    const record: DayEvent = { kind: 'record', dayIndex: 1, label: 'Record day · 5 messages', selectors: [] };
    expect(scheduleCards([record, { ...record }], warp, null)).toHaveLength(2);
    expect(scheduleCards([], warp, null)).toEqual([]);
  });
});

describe('scheduleSlams', () => {
  it('places milestones at their day and spaces close ones apart', () => {
    const warp = linearWarp(10, 0, 10);
    const slams = scheduleSlams(
      [
        { kind: 'milestone', dayIndex: 2, label: '$1B moved', selectors: [] },
        { kind: 'milestone', dayIndex: 2, label: '50 chains', selectors: [] },
        { kind: 'join', dayIndex: 3, label: 'x', selectors: [] },
      ],
      warp,
    );
    expect(slams).toEqual([
      { start: 2, label: '$1B moved' },
      { start: 3.4, label: '50 chains' },
    ]);
  });
});
