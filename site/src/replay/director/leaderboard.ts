import type { ReplayFile } from '@ccip-dev/core/public';
import type { Warp } from './warp';

export const BOARD_ROWS = 5;
export const BOARD_FADE_S = 0.4;
export const BOARD_SWAP_S = 0.4;
export const BOARD_REST_S = 0.4;
export const BOARD_OVERTAKE = 1.05;
const WINDOW_DAYS = 30;

export interface BoardRow {
  selector: string;
  value: number;
  rank: number;
  from: number;
  to: number;
  swap: number;
  alpha: number;
  shown: number;
  focus: boolean;
}

export interface StripCell {
  row: BoardRow;
  column: number;
  alpha: number;
}

interface Swap {
  start: number;
  end: number;
  from: readonly string[];
  to: readonly string[];
}

type Source = Pick<ReplayFile, 'chains' | 'lanes' | 'days'>;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};
const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((s, i) => s === b[i]);
const byValue = (values: Map<string, number>) => (a: string, b: string) => values.get(b)! - values.get(a)! || (a < b ? -1 : a > b ? 1 : 0);

function overtakeOrder(previous: readonly string[], values: Map<string, number>): string[] {
  const kept = previous.filter((s) => values.has(s));
  const known = new Set(kept);
  const order = [...kept, ...[...values.keys()].filter((s) => !known.has(s)).sort(byValue(values))];
  let moved = true;
  while (moved) {
    moved = false;
    for (let i = 1; i < order.length; i++) {
      if (values.get(order[i]!)! >= BOARD_OVERTAKE * values.get(order[i - 1]!)!) {
        [order[i - 1], order[i]] = [order[i]!, order[i - 1]!];
        moved = true;
      }
    }
  }
  return order;
}

function scheduleSwaps(tops: readonly (readonly string[])[], warp: Warp): Swap[] {
  const swaps: Swap[] = [];
  const latest = warp.end - BOARD_SWAP_S;
  let shown = tops[0] ?? [];
  let ready = warp.start;
  let pending = -1;
  for (let d = 1; d < tops.length; d++) {
    if (sameOrder(tops[d]!, shown)) continue;
    const start = Math.max(warp.dayStart(d), ready);
    if (start > latest - BOARD_SWAP_S - BOARD_REST_S) {
      pending = d;
      break;
    }
    const day = Math.max(d, warp.dayAt(start).index);
    const to = tops[day]!;
    d = day;
    if (sameOrder(to, shown)) continue;
    swaps.push({ start, end: start + BOARD_SWAP_S, from: shown, to });
    shown = to;
    ready = start + BOARD_SWAP_S + BOARD_REST_S;
  }
  const final = tops.at(-1) ?? [];
  if (pending >= 0 && !sameOrder(final, shown)) {
    const start = Math.min(Math.max(warp.dayStart(pending), ready), latest);
    swaps.push({ start, end: Math.min(start + BOARD_SWAP_S, warp.end), from: shown, to: final });
  }
  return swaps;
}

export class Leaderboard {
  private readonly values: Map<string, number>[];
  private readonly first: readonly string[];
  private readonly swaps: Swap[];

  constructor(
    replay: Source,
    days: readonly string[],
    eligible: (selector: string) => boolean,
    private readonly warp: Warp,
  ) {
    const lanesByDay = new Map(replay.days.map((d) => [d.day, d.lanes]));
    const running = new Map<string, number>();
    const shift = (dayIndex: number, sign: 1 | -1) => {
      for (const [lane, , usd] of lanesByDay.get(days[dayIndex]!) ?? []) {
        for (const chain of replay.lanes[lane] ?? []) {
          const selector = replay.chains[chain]?.selector;
          if (selector) running.set(selector, (running.get(selector) ?? 0) + sign * usd);
        }
      }
    };
    this.values = [];
    const tops: string[][] = [];
    let order: string[] = [];
    days.forEach((_, d) => {
      shift(d, 1);
      if (d >= WINDOW_DAYS) shift(d - WINDOW_DAYS, -1);
      const snapshot = new Map([...running].filter(([, v]) => v > 0));
      this.values.push(snapshot);
      order = overtakeOrder(order, new Map([...snapshot].filter(([s]) => eligible(s))));
      tops.push(order.slice(0, BOARD_ROWS));
    });
    this.first = tops[0] ?? [];
    this.swaps = scheduleSwaps(tops, warp);
  }

  private swapAt(t: number): { from: readonly string[]; to: readonly string[]; swap: number } {
    let lo = 0;
    let hi = this.swaps.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.swaps[mid]!.start <= t) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found < 0) return { from: this.first, to: this.first, swap: 1 };
    const s = this.swaps[found]!;
    return t >= s.end ? { from: s.to, to: s.to, swap: 1 } : { from: s.from, to: s.to, swap: smoothstep((t - s.start) / (s.end - s.start)) };
  }

  at(t: number, focus: string | null): BoardRow[] {
    if (this.values.length === 0 || t <= this.warp.start) return [];
    const shown = clamp01((t - this.warp.start) / BOARD_FADE_S);
    const { from, to, swap } = this.swapAt(t);
    const values = this.values[this.warp.dayAt(t).index]!;
    const slot = (order: readonly string[], selector: string) => {
      const i = order.indexOf(selector);
      return i < 0 ? BOARD_ROWS : i;
    };
    const selectors = new Set([...from, ...to, ...(focus ? [focus] : [])]);
    return [...selectors]
      .map((selector) => {
        const a = slot(from, selector);
        const b = slot(to, selector);
        const rank = a === b ? a : a + (b - a) * swap;
        const isFocus = selector === focus;
        return {
          selector,
          value: values.get(selector) ?? 0,
          rank,
          from: a,
          to: b,
          swap,
          alpha: shown * (isFocus ? 1 : clamp01(BOARD_ROWS - rank)),
          shown,
          focus: isFocus,
        };
      })
      .sort((x, y) => x.rank - y.rank || (x.selector < y.selector ? -1 : 1));
  }
}

export function stripColumns(focusCut: boolean): number {
  return focusCut ? 4 : 3;
}

export function stripCells(rows: readonly BoardRow[], focusCut: boolean): StripCell[] {
  const focusRow = rows.find((r) => r.focus);
  const column = (slot: number, isFocus: boolean, focusSlot: number): number | null => {
    if (!focusCut) return slot < 3 ? slot : null;
    if (isFocus) return Math.min(slot, 3);
    if (slot < 3) return slot;
    return slot === 3 && focusSlot < 3 ? 3 : null;
  };
  return rows.flatMap((row) => {
    const a = column(row.from, row.focus, focusRow?.from ?? BOARD_ROWS);
    const b = column(row.to, row.focus, focusRow?.to ?? BOARD_ROWS);
    const cells: StripCell[] = [];
    if (a !== null && a === b) cells.push({ row, column: a, alpha: row.shown });
    else {
      if (a !== null) cells.push({ row, column: a, alpha: row.shown * (1 - row.swap) });
      if (b !== null) cells.push({ row, column: b, alpha: row.shown * row.swap });
    }
    return cells.filter((c) => c.alpha > 0);
  });
}
