import { describe, expect, it } from 'vitest';
import {
  allTimeBase,
  crossedToday,
  dailyPaces,
  dayFraction,
  etaText,
  landedSince,
  liveAllTime,
  milestoneBounds,
  milestoneGoal,
  milestoneText,
  nearestGoal,
  pacedTotal,
} from '../src/lib/all-time';

const day = (d: string, messages: number, usd_value: number, fee_usd: number | null = null) => ({ day: d, messages, usd_value, fee_usd });

describe('allTimeBase', () => {
  it('sums every finalized day and remembers the last one', () => {
    const base = allTimeBase([day('2026-10-26', 10, 1_000, 2), day('2026-10-27', 5, 500, null)]);
    expect(base).toEqual({ messages: 15, usd: 1_500, fees: 2, through: '2026-10-27' });
  });
});

describe('liveAllTime', () => {
  const base = allTimeBase([day('2026-10-26', 10, 1_000, 2)]);

  it('adds the live days history does not hold yet, and the landed messages', () => {
    const totals = liveAllTime(base, [day('2026-10-27', 4, 400, 1), day('2026-10-28', 3, 300, 1)], { messages: 2, usd: 50 });
    expect(totals).toEqual({ messages: 19, usd: 1_750, fees: 4 });
  });

  it('skips a day history already holds and counts a repeated day once', () => {
    const totals = liveAllTime(base, [day('2026-10-26', 99, 99_999), day('2026-10-28', 3, 300), day('2026-10-28', 3, 300), null]);
    expect(totals).toEqual({ messages: 13, usd: 1_300, fees: 2 });
  });
});

describe('milestoneBounds', () => {
  it('steps value 10B → 25B → 50B, as the Records page counts it', () => {
    expect(milestoneBounds('value', 24_998_682_985)).toEqual({ previous: 10e9, next: 25e9 });
    expect(milestoneBounds('value', 25e9)).toEqual({ previous: 25e9, next: 50e9 });
  });

  it('steps messages 1M → 2M → 5M and fees $1M → $2.5M', () => {
    expect(milestoneBounds('messages', 1_616_023)).toEqual({ previous: 1e6, next: 2e6 });
    expect(milestoneBounds('fees', 2_158_815)).toEqual({ previous: 1e6, next: 2.5e6 });
  });

  it('starts below the first milestone at zero', () => {
    expect(milestoneBounds('fees', 300_000)).toEqual({ previous: 0, next: 1e6 });
  });
});

describe('milestoneGoal', () => {
  it('measures the way from the last milestone and the days left at the pace', () => {
    const goal = milestoneGoal('messages', 1_500_000, 2_500);
    expect(goal.previous).toBe(1e6);
    expect(goal.next).toBe(2e6);
    expect(goal.progress).toBeCloseTo(0.5, 9);
    expect(goal.daysLeft).toBe(200);
  });

  it('has no ETA without a pace', () => {
    expect(milestoneGoal('fees', 2e6, null).daysLeft).toBeNull();
    expect(milestoneGoal('fees', 2e6, 0).daysLeft).toBeNull();
  });
});

describe('nearestGoal', () => {
  it('picks the goal closest in time', () => {
    const goals = [milestoneGoal('messages', 1.9e6, 2_000), milestoneGoal('value', 24.99e9, 40e6), milestoneGoal('fees', 2.2e6, 1_000)];
    expect(nearestGoal(goals)?.metric).toBe('value');
  });

  it('falls back to value when no goal has a pace', () => {
    expect(nearestGoal([milestoneGoal('messages', 1.9e6, null), milestoneGoal('value', 24e9, null)])?.metric).toBe('value');
  });
});

describe('dailyPaces', () => {
  it("takes moments.json's countdown pace, else the last 7 days' average", () => {
    const days = Array.from({ length: 10 }, (_, i) => day(`2026-10-${String(10 + i).padStart(2, '0')}`, i < 3 ? 1_000 : 70, 7_000, 7));
    const paces = dailyPaces({ countdowns: [{ metric: 'messages', threshold: 2e6, total: 1, per_day: 2_310, days_left: 1, previous: null }] }, days);
    expect(paces).toEqual({ messages: 2_310, value: 7_000, fees: 7 });
    expect(dailyPaces(null, []).value).toBeNull();
  });
});

describe('crossedToday', () => {
  it('names the milestone the live total passed since the last finalized day', () => {
    expect(crossedToday('value', 24.93e9, 25.001e9)).toBe(25e9);
  });

  it('is null when no milestone sits between them', () => {
    expect(crossedToday('value', 24.93e9, 24.999e9)).toBeNull();
    expect(crossedToday('value', 25.1e9, 25.2e9)).toBeNull();
  });
});

describe('etaText', () => {
  const fmt = (iso: string) => iso.slice(0, 10);
  it('reads minutes, then hours, then the day', () => {
    expect(etaText(25 / 1440, 0, fmt)).toBe('~25 min');
    expect(etaText(0.0001, 0, fmt)).toBe('~1 min');
    expect(etaText(0.25, 0, fmt)).toBe('~6 h');
    expect(etaText(167, Date.parse('2026-10-28T00:00:00Z'), fmt)).toBe('~2027-04-13');
  });
});

describe('dayFraction and pacedTotal', () => {
  it('measures the UTC day and holds the pace back for its first two hours', () => {
    const noon = Date.parse('2026-10-28T12:00:00Z');
    expect(dayFraction('2026-10-28', noon)).toBe(0.5);
    expect(dayFraction('2026-10-27', noon)).toBe(1);
    expect(pacedTotal(1_000, 0.5)).toBe(2_000);
    expect(pacedTotal(40, 1 / 24)).toBeNull();
  });
});

describe('milestoneText', () => {
  it('names milestones the way the cards do', () => {
    expect(milestoneText('value', 25e9)).toBe('$25B');
    expect(milestoneText('fees', 2.5e6)).toBe('$2.5M');
    expect(milestoneText('messages', 2e6)).toBe('2M');
  });
});

describe('landedSince', () => {
  it('counts only the messages first seen after the today.json on screen', () => {
    const landed = new Map([
      ['a', { seenIn: '2026-10-28T14:00:00.000Z', usd: 100 }],
      ['b', { seenIn: '2026-10-28T14:01:00.000Z', usd: 3_000_000 }],
    ]);
    expect(landedSince(landed, '2026-10-28T14:00:00.000Z')).toEqual({ messages: 1, usd: 3_000_000 });
    expect(landedSince(landed, '2026-10-28T14:01:00.000Z')).toEqual({ messages: 0, usd: 0 });
  });
});
