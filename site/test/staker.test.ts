import { STAKING_FIXTURE, STAKING_OPERATOR } from '@ccip-dev/core/testing';
import { describe, expect, it } from 'vitest';
import { addressFromPath, findStaker, isAddress, sizeText, stakerFacts, stakerPath, topShare } from '../src/lib/staker';

const A = '0x00000000000000000000000000000000000000aa';
const ROWS = {
  stakers: [
    [A, 'c', 15_000, '2023-12-01T00:00:00.000Z', '2026-10-10T00:00:00.000Z', 'wallet', 120, 1, 3],
    [STAKING_OPERATOR, 'o', 75_000, '2023-11-28T16:58:23.000Z', null, 'stakelink', 1, 1, 0],
  ] as [string, 'c' | 'o', number, string, string | null, 'wallet' | 'stakelink', number, number, number][],
};
const NOW = new Date('2026-11-02T14:00:00.000Z');

describe('staker paths', () => {
  it('reads a lowercase address from its page path and spells it back', () => {
    expect(addressFromPath(`/staking/${A.toUpperCase().replace('0X', '0x')}/`)).toBe(A);
    expect(addressFromPath('/staking/staker/')).toBeNull();
    expect(addressFromPath('/staking/0x12/')).toBeNull();
    expect(stakerPath(` ${A.toUpperCase().replace('0X', '0x')} `)).toBe(`/staking/${A}/`);
    expect([isAddress(A), isAddress('0x12'), isAddress(`${A}0`)]).toEqual([true, false, false]);
  });
});

describe('stakerFacts', () => {
  it('tells a day-one community staker at the max, partway through unbonding', () => {
    const f = stakerFacts(findStaker(ROWS, A.toUpperCase().replace('0X', '0x'))!, STAKING_FIXTURE, NOW);
    expect(f).toMatchObject({ pool: 'community', stake: 15_000, atMax: true, days: 1_067, sinceRank: 120, stakeRank: 1, dayOne: true, grabs: 3, status: { kind: 'unbonding', opensAt: '2026-11-07T00:00:00.000Z', days: 5 } });
    expect(f.yearly).toBeCloseTo(648);
    expect(sizeText(f)).toBe('one of 1,329 at the max');
    expect(sizeText({ atMaxCount: null, stakeRank: 1_200, poolStakers: 8_528 })).toBe('#1,200 by size (top 15%)');
  });

  it('names an operator, and reads its clock as open or lapsed later on', () => {
    const op = stakerFacts(findStaker(ROWS, STAKING_OPERATOR)!, STAKING_FIXTURE, NOW);
    expect(op).toMatchObject({ pool: 'operator', operatorName: 'LinkPool', status: { kind: 'staked' }, holder: 'stakelink' });
    expect(stakerFacts(ROWS.stakers[0]!, STAKING_FIXTURE, new Date('2026-11-08T00:00:00.000Z')).status).toEqual({ kind: 'claimable', closesAt: '2026-11-14T00:00:00.000Z', days: 6 });
    expect(stakerFacts(ROWS.stakers[0]!, STAKING_FIXTURE, new Date('2026-11-20T00:00:00.000Z')).status).toEqual({ kind: 'lapsed', closedAt: '2026-11-14T00:00:00.000Z' });
  });

  it('gives the top share by principal for the top half only', () => {
    expect([topShare({ stakeRank: 1, poolStakers: 8_528 }), topShare({ stakeRank: 1_200, poolStakers: 8_528 }), topShare({ stakeRank: 6_000, poolStakers: 8_528 })]).toEqual(['top 1%', 'top 15%', null]);
  });
});
