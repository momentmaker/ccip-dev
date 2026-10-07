import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { BOARD_FADE_S, BOARD_REST_S, BOARD_ROWS, BOARD_SWAP_S, Leaderboard, stripCells, stripColumns, type BoardRow } from '../src/replay/director/leaderboard';
import { Show } from '../src/replay/director/show';
import { linearWarp } from '../src/replay/director/warp';
import { buildLayout } from '../src/sky/layout';
import replayJson from './fixtures/replay.json';

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
    const rows = new Leaderboard(replay, days, () => true, warp).at(0.9, null);
    expect(rows.map((r) => [r.selector, r.rank])).toEqual([['A', 0], ['B', 1], ['C', 2]]);
    expect(rows[0]!.value).toBe(200);
  });

  it('slides ranks smoothly when a chain overtakes', () => {
    const rows = new Leaderboard(replay, days, () => true, warp).at(1.2, null);
    const a = rows.find((r) => r.selector === 'A')!;
    const b = rows.find((r) => r.selector === 'B')!;
    expect(a.rank).toBeCloseTo(0.5, 6);
    expect(b.rank).toBeCloseTo(0.5, 6);
  });

  it('skips chains without an icon and pins an off-board focus chain', () => {
    const board = new Leaderboard(replay, days, (s) => s !== 'A', warp);
    expect(board.at(0.9, null).map((r) => r.selector)).toEqual(['B', 'C']);
    const pinned = board.at(0.9, 'A');
    expect(pinned.at(-1)).toMatchObject({ selector: 'A', rank: BOARD_ROWS, focus: true, alpha: 1 });
  });

  it('is empty before the story starts', () => {
    expect(new Leaderboard(replay, days, () => true, linearWarp(3, 0, 3)).at(-1, null)).toEqual([]);
  });
});

const DAY_MS = 86_400_000;
const dayAfter = (n: number) => new Date(Date.UTC(2024, 0, 1) + n * DAY_MS).toISOString().slice(0, 10);

function race(dayCount: number, usd: (chain: number, day: number) => number, chainCount = 3): { replay: ReplayFile; history: DayTotals[] } {
  const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'].slice(0, chainCount);
  const dayList = Array.from({ length: dayCount }, (_, i) => dayAfter(i));
  const replay = {
    schema_version: 1,
    updated_at: '2026-10-07T00:00:00.000Z',
    attribution: 'test',
    since: dayList[0]!,
    chains: names.map((n) => ({ selector: n.toLowerCase(), name: `${n.toLowerCase()}-mainnet`, display_name: n, first_day: dayList[0]! })),
    lanes: names.map((_, i) => [i, i]),
    days: dayList.map((day, d) => ({ day, lanes: names.map((_, i) => [i, 1, usd(i, d)]) })),
  } as unknown as ReplayFile;
  const history = dayList.map((day) => ({ day, messages: chainCount, token_messages: chainCount, usd_value: 1, fee_usd: null, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null })) as DayTotals[];
  return { replay, history };
}

const showOf = ({ replay, history }: { replay: ReplayFile; history: DayTotals[] }, focus: string | null = null, length = 30) =>
  new Show({ replay, history, stars: buildLayout(replay.chains), length, focus, eligible: () => true });

const flapDelta = (day: number) => (day === 0 ? 3 : day % 2 === 1 ? -6 : 6);
const flapping = race(30, (chain, day) => (chain === 0 ? 100 : chain === 1 ? 100 + flapDelta(day) : 40));
const overtaken = race(40, (chain, day) => (chain === 0 ? (day >= 20 ? 400 : 100) : chain === 1 ? 103 : 40));
const lateSwap = race(200, (chain, day) => (chain === 0 ? (day === 199 ? 100_000 : 100) : chain === 1 ? 300 : 40));
const busy = race(120, (chain, day) => 100 + 60 * Math.sin(day / (3 + chain) + chain), 6);

function overlaps(s: Show, step = 1 / 30): { outsideSwap: number; longestS: number } {
  let run = 0;
  let longest = 0;
  let outsideSwap = 0;
  for (let f = Math.ceil(s.warp.start / step); f * step <= s.length; f++) {
    const board = s.frameAt(f * step).board;
    const settled = board.filter((r) => r.alpha >= 0.9);
    const bad = settled.some((a, i) => settled.slice(i + 1).some((b) => Math.abs(a.rank - b.rank) < 0.5));
    if (bad && !board.some((r) => r.from !== r.to)) outsideSwap += 1;
    run = bad ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return { outsideSwap, longestS: longest * step };
}

describe('Leaderboard slots and swaps', () => {
  const fixtureHistory = (replayJson as ReplayFile).days.map((d) => ({ day: d.day, messages: 10, token_messages: 10, usd_value: 1000, fee_usd: null, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null })) as DayTotals[];
  const fixture = { replay: replayJson as ReplayFile, history: fixtureHistory };
  const shows: [string, Show][] = [
    ['fixture 30 s', showOf(fixture)],
    ['fixture 15 s', showOf(fixture, null, 15)],
    ['fixture Base focus', showOf(fixture, '15971525489660198786')],
    ['flapping', showOf(flapping)],
    ['overtaken', showOf(overtaken)],
    ['late swap', showOf(lateSwap)],
    ['busy race', showOf(busy)],
    ['busy race 15 s focus', showOf(busy, 'zeta', 15)],
  ];

  it.each(shows)('never draws two settled rows on top of each other outside a swap of at most 0.4 s (%s)', (_name, s) => {
    const { outsideSwap, longestS } = overlaps(s);
    expect(outsideSwap).toBe(0);
    expect(longestS).toBeLessThanOrEqual(BOARD_SWAP_S + 1 / 30 + 1e-9);
  });

  it('flips the strict order every day in the flapping series, so the hold below is the hysteresis', () => {
    const sums = [0, 1, 2, 3].map((d) => {
      const span = Array.from({ length: d + 1 }, (_, k) => k);
      return [span.reduce((a) => a + 100, 0), span.reduce((a, k) => a + 100 + flapDelta(k), 0)];
    });
    expect(sums.map(([a, b]) => b! > a!)).toEqual([true, false, true, false]);
  });

  it('holds the leader while a challenger stays within 5% of it', () => {
    const s = showOf(flapping);
    for (let t = s.warp.start + BOARD_FADE_S; t <= s.length; t += 0.05) {
      const ranks = Object.fromEntries(s.frameAt(t).board.map((r) => [r.selector, r.rank]));
      expect([ranks.beta, ranks.alpha]).toEqual([0, 1]);
    }
  });

  it('swaps once when a challenger pulls ahead by more than 5%', () => {
    const s = showOf(overtaken);
    const leaders = new Set<string>();
    for (let t = s.warp.start + BOARD_FADE_S; t <= s.length; t += 0.05) {
      const top = s.frameAt(t).board.find((r) => r.rank === 0);
      if (top) leaders.add(top.selector);
    }
    expect([...leaders]).toEqual(['beta', 'alpha']);
  });

  it('starts a swap on the day the order changed and finishes it within 0.4 s', () => {
    const s = showOf(overtaken);
    const changeDay = s.days.indexOf(dayAfter(20));
    let first = Infinity;
    for (let t = s.warp.start; t <= s.length; t += 0.01) {
      if (s.frameAt(t).board.some((r) => r.from !== r.to)) {
        first = t;
        break;
      }
    }
    const start = s.warp.dayStart(changeDay);
    expect(first).toBeGreaterThanOrEqual(start - 1e-9);
    expect(first).toBeLessThan(start + 0.02);
    expect(s.frameAt(start + BOARD_SWAP_S + 1e-6).board.every((r) => r.from === r.to && Number.isInteger(r.rank))).toBe(true);
  });

  it.each(shows)('shows the final settled board with integer slots through the finale (%s)', (_name, s) => {
    const final = s.frameAt(s.length).board.map((r) => [r.selector, r.rank]);
    for (let t = s.warp.end; t <= s.length; t += 1 / 30) {
      const board = s.frameAt(t).board;
      for (const r of board) {
        expect(Number.isInteger(r.rank)).toBe(true);
        expect(r.from).toBe(r.to);
      }
      expect(board.map((r) => [r.selector, r.rank])).toEqual(final);
    }
  });

  it.each([
    ['busy race', showOf(busy)],
    ['busy race 15 s focus', showOf(busy, 'zeta', 15)],
  ])('rests at least BOARD_REST_S between two swaps (%s)', (_name, s) => {
    const step = 1 / 120;
    const windows: { start: number; end: number }[] = [];
    for (let f = 0; f * step <= s.length; f++) {
      const t = f * step;
      const moving = s.frameAt(t).board.some((r) => r.from !== r.to);
      const open = windows.at(-1);
      if (moving && open && t - open.end <= step + 1e-9) open.end = t;
      else if (moving) windows.push({ start: t, end: t });
    }
    expect(windows.length).toBeGreaterThan(2);
    for (let i = 1; i < windows.length; i++) expect(windows[i]!.start - windows[i - 1]!.end).toBeGreaterThanOrEqual(BOARD_REST_S - 2 * step);
  });

  it('lands a change on the last day before the finale starts', () => {
    const s = showOf(lateSwap);
    const ranks = Object.fromEntries(s.frameAt(s.warp.end).board.map((r) => [r.selector, r.rank]));
    expect(ranks.alpha).toBe(0);
  });

  it('is a pure function of t, whatever was asked before', () => {
    const s = showOf(busy, 'zeta');
    const times = Array.from({ length: 120 }, (_, i) => s.warp.start + (i * (s.length - s.warp.start)) / 119);
    const inOrder = times.map((t) => s.frameAt(t).board);
    const shuffled = times.map((t, i) => [t, i] as const).sort(([a], [b]) => Math.sin(a * 997) - Math.sin(b * 997));
    for (const [t, i] of shuffled) expect(s.frameAt(t).board).toEqual(inOrder[i]);
  });
});

describe('the strip layout', () => {
  const row = (selector: string, from: number, to: number, swap = 1, focus = false): BoardRow => ({
    selector, value: 1, rank: from + (to - from) * swap, from, to, swap, alpha: 1, shown: 1, focus,
  });

  it('uses three columns for the network and four for a focus cut', () => {
    expect([stripColumns(false), stripColumns(true)]).toEqual([3, 4]);
  });

  it('gives the 4th column to the focus chain while it is outside the top 3', () => {
    const cells = stripCells([row('a', 0, 0), row('b', 1, 1), row('c', 2, 2), row('d', 3, 3), row('f', 5, 5, 1, true)], true);
    expect(cells.map((c) => [c.row.selector, c.column])).toEqual([['a', 0], ['b', 1], ['c', 2], ['f', 3]]);
  });

  it('shows 4th place in the 4th column while the focus chain is inside the top 3', () => {
    const cells = stripCells([row('a', 0, 0), row('f', 1, 1, 1, true), row('c', 2, 2), row('d', 3, 3), row('e', 4, 4)], true);
    expect(cells.map((c) => [c.row.selector, c.column])).toEqual([['a', 0], ['f', 1], ['c', 2], ['d', 3]]);
  });

  it('crossfades two swapping rows in place instead of sliding them over each other', () => {
    const cells = stripCells([row('a', 0, 1, 0.25), row('b', 1, 0, 0.25), row('c', 2, 2)], false);
    const at = (s: string, column: number) => cells.find((c) => c.row.selector === s && c.column === column)?.alpha;
    expect([at('a', 0), at('b', 0), at('a', 1), at('b', 1), at('c', 2)]).toEqual([0.75, 0.25, 0.25, 0.75, 1]);
  });

  it('fades a row leaving the visible columns instead of popping it', () => {
    const cells = stripCells([row('a', 0, 0), row('b', 1, 1), row('c', 2, 3, 0.4), row('d', 3, 2, 0.4)], false);
    expect(cells.filter((c) => c.column === 2).map((c) => [c.row.selector, +c.alpha.toFixed(6)])).toEqual([['c', 0.6], ['d', 0.4]]);
  });

  it.each([
    ['network', null],
    ['focus', 'zeta'],
  ])('keeps one column count and one row per column, except while crossfading, through a whole %s show', (_name, focus) => {
    const s = showOf(busy, focus);
    const columns = stripColumns(s.focus !== null);
    for (let t = 0; t <= s.length; t += 1 / 30) {
      const frame = s.frameAt(t);
      expect(stripColumns(frame.focus !== null)).toBe(columns);
      const cells = stripCells(frame.board, frame.focus !== null);
      for (let c = 0; c < columns; c++) {
        const inColumn = cells.filter((x) => x.column === c);
        expect(inColumn.length).toBeLessThanOrEqual(2);
        if (inColumn.length === 2) {
          expect(frame.board.some((r) => r.from !== r.to)).toBe(true);
          expect(inColumn[0]!.alpha + inColumn[1]!.alpha).toBeLessThanOrEqual(inColumn[0]!.row.shown + 1e-9);
        }
      }
      expect(cells.every((x) => x.column < columns)).toBe(true);
    }
  });
});
