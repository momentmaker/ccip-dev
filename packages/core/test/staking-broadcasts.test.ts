import { describe, expect, it } from 'vitest';
import { operatorMomentFacts, operatorMoments, stakingWeekFacts, topHunter } from '../src/staking-broadcasts';
import { STAKING_FIXTURE, STAKING_NEW_OPERATOR, STAKING_OPERATOR } from '../src/testing';

const STAKING = STAKING_FIXTURE;
const OP = STAKING_OPERATOR;
const NEW = STAKING_NEW_OPERATOR;

describe('stakingWeekFacts', () => {
  it('tells the week from its Monday, with stake.link’s ladder out of who asked to leave', () => {
    const f = stakingWeekFacts(STAKING, '2026-10-26')!;
    expect(f).toMatchObject({ full: true, fullDays: 1_060, stakers: 8_528, askedToLeave: 260_000, openings: 9, fastestRefillS: 12, topHunter: { address: '0xaa', grabs: 2, withinABlock: 1 }, communityRatePct: 4.32 });
    expect(f.conversionPct).toBeCloseTo(58.51, 2);
    expect(f.operatorEvents.map((e) => e.kind)).toEqual(['added', 'unbonding', 'unstaked']);
  });

  it('waits until the file covers the whole week, and reads a quiet week as zeros', () => {
    expect(stakingWeekFacts({ ...STAKING, updated_at: '2026-11-01T23:00:00.000Z' }, '2026-10-26')).toBeNull();
    expect(stakingWeekFacts(STAKING, '2026-10-19')?.week).toMatchObject({ week: '2026-10-19', staked: 0, openings: 0 });
  });
});

describe('topHunter', () => {
  const opening = (grabs: string[], blocks: number | null) => ({ opened_at: '2026-10-27T10:00:00.000Z', gap: 100, seconds: blocks === null ? null : blocks * 12, blocks, grabs });

  it('names who took space in the most openings, and how many of those refilled within a block', () => {
    expect(topHunter([opening(['0xaa', '0xbb'], 2), opening(['0xaa', '0xaa'], 1), opening(['0xbb'], 0), opening(['0xaa'], 0)])).toEqual({ address: '0xaa', grabs: 3, withinABlock: 2 });
  });

  it('breaks a tie by the lower address, and finds none when nobody took space', () => {
    expect(topHunter([opening(['0xbb'], 1), opening(['0xaa'], 3)])?.address).toBe('0xaa');
    expect(topHunter([])).toBeNull();
    expect(topHunter([opening([], null)])).toBeNull();
  });
});

describe('operator moments', () => {
  it('posts joins, removals and unstakes, and leaves top-ups and unbondings to the weekly report', () => {
    expect(operatorMoments(STAKING).map((m) => [m.address, m.at])).toEqual([
      [NEW, Date.parse('2026-11-01T09:00:00.000Z') / 1000],
      [OP, Date.parse('2026-10-27T12:00:00.000Z') / 1000],
    ]);
  });

  it('finds an event by address and time, with the roster around it', () => {
    expect(operatorMomentFacts(STAKING, OP, Date.parse('2026-10-27T12:00:00.000Z') / 1000)).toEqual({
      kind: 'unstaked', address: OP, name: 'LinkPool', ts: '2026-10-27T12:00:00.000Z', amount: 7_221, stake: 67_779, via: 'stakelink', operators: 35, operatorTotal: 1_646_261,
    });
    expect(operatorMomentFacts(STAKING, OP, Date.parse('2026-10-28T16:42:59.000Z') / 1000)).toBeNull();
  });
});
