import { describe, expect, it } from 'vitest';
import { apportion, boardRows, clampStake, dialDots, hiveCenters, hiveKinds, onDial, replaySteps, stakerHref, yearlyReward } from '../src/lib/staking-view';

const QUEUE = {
  unbonding: { stakers: 3, link: 300, stakelink_stakers: 1, stakelink_link: 15_000 },
  claimable: { stakers: 2, link: 50, stakelink_stakers: 0, stakelink_link: 0 },
  days: [
    { day: '2026-11-01', link: 200, stakelink_link: 0, stakers: 2 },
    { day: '2026-11-10', link: 15_100, stakelink_link: 15_000, stakers: 2 },
  ],
  closed: [
    { day: '2026-10-29', left: 40, stayed: 10, stakelink_stayed: 0 },
    { day: '2026-10-30', left: 0, stayed: 0, stakelink_stayed: 15_000 },
  ],
  conversion: { others: { left: 1, total: 2 }, stakelink: { left: 0, total: 1 } },
  likely_to_leave: 150,
  lapsed: 1,
};

describe('hive', () => {
  it('lays out a honeycomb center first, ring by ring', () => {
    const cells = hiveCenters(2);
    expect(cells).toHaveLength(1 + 6 + 12);
    expect(cells[0]).toEqual({ x: 0, y: 0 });
    const ring1 = cells.slice(1, 7).map((c) => Math.round(Math.hypot(c.x, c.y) * 1000) / 1000);
    expect(new Set(ring1)).toEqual(new Set([Math.round(Math.sqrt(3) * 1000) / 1000]));
  });

  it('splits cells by largest remainder and always uses every cell', () => {
    expect(apportion([1, 1, 1], 10)).toEqual([4, 3, 3]);
    expect(apportion([0, 0], 5)).toEqual([0, 5]);
  });

  it('gives each holder its share of the cap and leaves open space on the rim', () => {
    const kinds = hiveKinds(
      {
        community: { total: 90, cap: 100, min_stake: 1, max_stake: 10, stakers: 3, ever: 3, at_max: 0, median: 0, mean: 0, full_since: null },
        holders: [{ kind: 'wallet', stakers: 2, link: 60 }, { kind: 'smart', stakers: 0, link: 0 }, { kind: 'stakelink', stakers: 1, link: 30 }, { kind: 'contract', stakers: 0, link: 0 }],
      },
      10,
    );
    expect(kinds.filter((k) => k === 'wallet')).toHaveLength(6);
    expect(kinds.filter((k) => k === 'stakelink')).toHaveLength(3);
    expect(kinds.at(-1)).toBe('open');
  });

  it('replays openings with a cell per cell of LINK and a tenth of their real time on screen', () => {
    const steps = replaySteps(
      [
        { opened_at: '2026-10-30T00:00:00Z', gap: 250_000, seconds: 12, blocks: 1, grabs: ['0xa'] },
        { opened_at: '2026-10-30T01:00:00Z', gap: 10, seconds: 600, blocks: 50, grabs: ['0xb'] },
        { opened_at: '2026-10-30T02:00:00Z', gap: 10, seconds: null, blocks: null, grabs: [] },
      ],
      100_000,
    );
    expect(steps.map((s) => [s.cells, s.holdMs])).toEqual([[3, 1_200], [1, 4_000]]);
  });
});

describe('boardRows', () => {
  it('lists open windows, then coming days with stake.link apart, then the last week newest first', () => {
    expect(boardRows(QUEUE).map((r) => [r.day, r.status, r.link])).toEqual([
      [null, 'GATE OPEN', 50],
      ['2026-11-01', 'BOARDING', 200],
      ['2026-11-10', 'BOARDING', 100],
      ['2026-11-10', 'LADDER', 15_000],
      ['2026-10-30', 'STAYED', 15_000],
      ['2026-10-29', 'DEPARTED', 40],
      ['2026-10-29', 'STAYED', 10],
    ]);
    expect(boardRows(QUEUE, 1, 2).map((r) => r.status)).toEqual(['GATE OPEN', 'BOARDING', 'STAYED', 'DEPARTED']);
  });
});

describe('dialDots', () => {
  it('places each cohort by how far into its 35 days it is', () => {
    const dots = dialDots(QUEUE, { unbonding_s: 28 * 86_400, claim_s: 7 * 86_400 }, new Date('2026-10-31T18:00:00Z'));
    expect(dots).toEqual([
      { elapsed: 27, link: 200, stakelink: false },
      { elapsed: 18, link: 100, stakelink: false },
      { elapsed: 18, link: 15_000, stakelink: true },
      { elapsed: 31.5, link: 50, stakelink: false },
    ]);
  });

  it('measures the dial clockwise from 12 o’clock', () => {
    expect(onDial(0, 10)).toEqual({ x: 0, y: -10 });
    expect(onDial(0.25, 10)).toEqual({ x: 10, y: 0 });
  });
});

describe('rewards', () => {
  it('estimates a stake’s yearly LINK within the pool limits', () => {
    expect(yearlyReward(1_000, 4.32)).toBeCloseTo(43.2);
    expect(yearlyReward(1_000, null)).toBeNull();
    expect(clampStake(20_000, { min_stake: 1, max_stake: 15_000 })).toBe(15_000);
    expect(clampStake(Number.NaN, { min_stake: 1, max_stake: 15_000 })).toBe(1);
  });

  it('links a staker to its card by lowercase address', () => {
    expect(stakerHref('0xAbC')).toBe('/staking/0xabc/');
  });
});
