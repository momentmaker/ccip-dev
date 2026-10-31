import { describe, expect, it } from 'vitest';
import { apportion, boardRows, clampStake, daysFull, dialDots, hiveCenters, hiveKinds, onDial, replaySteps, spaceForecast, stakePresets, stakerHref, tapeGrid, tapeMax, timelapseFrames, yearlyReward } from '../src/lib/staking-view';

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
    // Three cells left over after flooring: every one is handed out, so no cell is left without a holder.
    expect(apportion([1, 1, 1, 1], 7)).toEqual([2, 2, 2, 1]);
    expect(hiveKinds({ community: { total: 100, cap: 100, min_stake: 1, max_stake: 10, stakers: 4, ever: 4, at_max: 0, median: 0, mean: 0, full_since: null }, holders: [{ kind: 'wallet', stakers: 1, link: 33 }, { kind: 'smart', stakers: 1, link: 33 }, { kind: 'stakelink', stakers: 1, link: 33 }, { kind: 'contract', stakers: 1, link: 1 }] }, 271).filter(Boolean)).toHaveLength(271);
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

describe('spaceForecast', () => {
  const NOW = new Date('2026-10-31T18:00:00Z');

  it('expects each day’s opening windows outside stake.link to leave at the measured rate', () => {
    const f = spaceForecast(QUEUE, NOW, 28)!;
    expect([f.days.find((d) => d.day === '2026-11-01'), f.days.find((d) => d.day === '2026-11-10')]).toEqual([
      { day: '2026-11-01', opening: 200, likely: 100 },
      { day: '2026-11-10', opening: 100, likely: 50 },
    ]);
  });

  it('lays out every day from today, quiet ones as zeros', () => {
    const f = spaceForecast(QUEUE, NOW, 28)!;
    expect([f.days.length, f.days[0], f.days.at(-1)?.day]).toEqual([28, { day: '2026-10-31', opening: 0, likely: 0 }, '2026-11-27']);
  });

  it('calls out the day most LINK is likely to leave', () => {
    expect(spaceForecast(QUEUE, NOW, 28)?.peak?.day).toBe('2026-11-01');
  });

  it('counts what is likely to leave from the windows open now apart', () => {
    expect(spaceForecast(QUEUE, NOW, 28)?.openNow).toBe(25);
  });

  it('has no forecast before any window has closed to measure the rate', () => {
    expect(spaceForecast({ ...QUEUE, conversion: { others: { left: 0, total: 0 }, stakelink: { left: 0, total: 0 } } }, NOW, 28)).toBeNull();
  });
});

describe('daysFull', () => {
  it('counts whole days since the pool filled', () => {
    expect(daysFull({ full_since: '2023-12-07T23:13:35.000Z' }, new Date('2026-10-31T20:00:00Z'))).toBe(1_058);
  });

  it('has no count while the pool has space or before the clock is read', () => {
    expect([daysFull({ full_since: null }, new Date('2026-10-31T20:00:00Z')), daysFull({ full_since: '2023-12-07T23:13:35.000Z' }, null)]).toEqual([null, null]);
  });
});

describe('stakePresets', () => {
  it('offers the minimum round stake, the median staker and the max', () => {
    expect(stakePresets({ median: 1_951.6, max_stake: 15_000 }).map((p) => p.value)).toEqual([1_000, 1_952, 15_000]);
  });

  it('drops a median that matches another preset', () => {
    expect(stakePresets({ median: 15_000, max_stake: 15_000 }).map((p) => p.value)).toEqual([1_000, 15_000]);
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

describe('the tape', () => {
  const week = (staked: number, asked: number, unstaked = staked) => ({ week: '2026-01-05', staked, unstaked, unbondings: 1, unbonding_link: asked + 5_000, stakelink_unbonding_link: 5_000, new_stakers: 0, openings: 0 });
  const ordinary = Array.from({ length: 60 }, () => week(100_000, 200_000));

  it('never lets the LINK that asked to leave run off the top', () => {
    expect(tapeMax([...ordinary, week(150_000, 1_550_000)])).toBeGreaterThanOrEqual(1_550_000);
  });

  it('lets the launch weeks run off rather than flatten every other week', () => {
    expect(tapeMax([week(21_000_000, 0, 0), week(12_000_000, 0, 0), ...ordinary])).toBeLessThan(1_000_000);
  });

  it('draws a round gridline below the top', () => {
    expect([tapeGrid(1_670_000), tapeGrid(430_000), tapeGrid(90_000)]).toEqual([1_000_000, 200_000, 50_000]);
  });
});

describe('timelapseFrames', () => {
  it('runs the pool level and the stakers ever up week by week, within the cap', () => {
    const week = (w: string, staked: number, unstaked: number, n: number) => ({ week: w, staked, unstaked, unbondings: 0, unbonding_link: 30, stakelink_unbonding_link: 10, new_stakers: n, openings: 0 });
    const frames = timelapseFrames([week('2023-11-27', 80, 0, 5), week('2023-12-04', 40, 5, 3), week('2023-12-11', 10, 10, 1)], 100);
    expect(frames.map((f) => [f.level, f.stakers, f.asked])).toEqual([[80, 5, 20], [100, 8, 20], [100, 9, 20]]);
  });
});
