import type { ReplayFile } from '@ccip-dev/core/public';
import { topSelectors } from '../../sky/weights';
import type { Warp } from './warp';

export const BOARD_ROWS = 5;
export const BOARD_FADE_S = 0.4;
const WINDOW_DAYS = 30;

export interface BoardRow {
  selector: string;
  value: number;
  rank: number;
  alpha: number;
  focus: boolean;
}

type Source = Pick<ReplayFile, 'chains' | 'lanes' | 'days'>;

export class Leaderboard {
  private readonly ranks: Map<string, number>[];
  private readonly values: Map<string, number>[];

  constructor(replay: Source, days: readonly string[], eligible: (selector: string) => boolean) {
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
    this.ranks = days.map((_, d) => {
      shift(d, 1);
      if (d >= WINDOW_DAYS) shift(d - WINDOW_DAYS, -1);
      const snapshot = new Map([...running].filter(([, v]) => v > 0));
      this.values.push(snapshot);
      const top = topSelectors(new Map([...snapshot].filter(([s]) => eligible(s))), BOARD_ROWS);
      return new Map(top.map((s, rank) => [s, rank]));
    });
  }

  at(t: number, warp: Warp, focus: string | null): BoardRow[] {
    if (this.ranks.length === 0 || t <= warp.start) return [];
    const start = t - BOARD_FADE_S;
    const last = this.ranks.length - 1;
    const sums = new Map<string, number>();
    const spans: { ranks: Map<string, number>; weight: number }[] = [];
    const pre = Math.max(0, Math.min(t, warp.start) - start) / BOARD_FADE_S;
    const first = warp.dayAt(Math.max(start, warp.start)).index;
    const current = warp.dayAt(t).index;
    for (let d = first; d <= current; d++) {
      const to = d === last ? t : Math.min(t, warp.dayStart(d + 1));
      const overlap = to - Math.max(start, warp.dayStart(d));
      if (overlap > 0) spans.push({ ranks: this.ranks[d]!, weight: overlap / BOARD_FADE_S });
    }
    const candidates = new Set(spans.flatMap((s) => [...s.ranks.keys()]));
    for (const selector of candidates) {
      let avg = pre * BOARD_ROWS;
      for (const s of spans) avg += s.weight * (s.ranks.get(selector) ?? BOARD_ROWS);
      sums.set(selector, avg);
    }
    const values = this.values[current]!;
    const rows = [...sums]
      .filter(([, rank]) => rank < BOARD_ROWS)
      .sort(([a, ra], [b, rb]) => ra - rb || (a < b ? -1 : 1))
      .map(([selector, rank]) => ({
        selector,
        value: values.get(selector) ?? 0,
        rank,
        alpha: Math.min(1, BOARD_ROWS - rank),
        focus: selector === focus,
      }));
    if (focus && !rows.some((r) => r.selector === focus)) {
      rows.push({ selector: focus, value: values.get(focus) ?? 0, rank: BOARD_ROWS, alpha: 1, focus: true });
    }
    return rows;
  }
}
