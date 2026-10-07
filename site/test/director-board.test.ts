import type { ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { BOARD_ROWS, Leaderboard } from '../src/replay/director/leaderboard';
import { linearWarp } from '../src/replay/director/warp';

const days = ['2024-01-01', '2024-01-02', '2024-01-03'];
const replay = {
  chains: ['A', 'B', 'C'].map((s) => ({ selector: s, name: s, display_name: s, first_day: '2024-01-01' })),
  lanes: [[0, 0], [1, 1], [2, 2]],
  days: [
    { day: '2024-01-01', lanes: [[0, 1, 100], [1, 1, 50], [2, 1, 10]] },
    { day: '2024-01-02', lanes: [[1, 1, 200]] },
    { day: '2024-01-03', lanes: [[2, 1, 5]] },
  ],
} as unknown as ReplayFile;
const warp = linearWarp(3, 0, 3);

describe('Leaderboard', () => {
  it('ranks chains by trailing value and settles after the fade', () => {
    const rows = new Leaderboard(replay, days, () => true).at(0.9, warp, null);
    expect(rows.map((r) => [r.selector, r.rank])).toEqual([['A', 0], ['B', 1], ['C', 2]]);
    expect(rows[0]!.value).toBe(200);
  });

  it('slides ranks smoothly when a chain overtakes', () => {
    const rows = new Leaderboard(replay, days, () => true).at(1.2, warp, null);
    const a = rows.find((r) => r.selector === 'A')!;
    const b = rows.find((r) => r.selector === 'B')!;
    expect(a.rank).toBeCloseTo(0.5, 6);
    expect(b.rank).toBeCloseTo(0.5, 6);
  });

  it('skips chains without an icon and pins an off-board focus chain', () => {
    const board = new Leaderboard(replay, days, (s) => s !== 'A');
    expect(board.at(0.9, warp, null).map((r) => r.selector)).toEqual(['B', 'C']);
    const pinned = board.at(0.9, warp, 'A');
    expect(pinned.at(-1)).toMatchObject({ selector: 'A', rank: BOARD_ROWS, focus: true, alpha: 1 });
  });

  it('is empty before the story starts', () => {
    expect(new Leaderboard(replay, days, () => true).at(-1, linearWarp(3, 0, 3), null)).toEqual([]);
  });
});
