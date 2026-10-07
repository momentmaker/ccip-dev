import type { ReplayFile } from '@ccip-dev/core/public';
import { addDays } from '../lib/days';

export interface LaneWeight {
  src: string;
  dst: string;
  usd: number;
  messages: number;
}

export interface Weights {
  chains: Map<string, number>;
  lanes: LaneWeight[];
}

export function lastReplayDay(replay: Pick<ReplayFile, 'days'>): string | null {
  return replay.days.at(-1)?.day ?? null;
}

export function windowWeights(replay: ReplayFile, fromDay: string | null, toDay: string): Weights {
  const byLane = new Map<number, LaneWeight>();
  for (const d of replay.days) {
    if (d.day > toDay || (fromDay !== null && d.day < fromDay)) continue;
    for (const [lane, messages, usd] of d.lanes) {
      const ends = replay.lanes[lane];
      if (!ends) continue;
      let w = byLane.get(lane);
      if (!w) {
        w = { src: replay.chains[ends[0]]!.selector, dst: replay.chains[ends[1]]!.selector, usd: 0, messages: 0 };
        byLane.set(lane, w);
      }
      w.usd += usd;
      w.messages += messages;
    }
  }
  const lanes = [...byLane.entries()].sort(([a], [b]) => a - b).map(([, w]) => w);
  const chains = new Map<string, number>();
  for (const w of lanes) {
    chains.set(w.src, (chains.get(w.src) ?? 0) + w.usd);
    chains.set(w.dst, (chains.get(w.dst) ?? 0) + w.usd);
  }
  return { chains, lanes };
}

export function trailingWeights(replay: ReplayFile, days: number): Weights {
  const last = lastReplayDay(replay);
  return last ? windowWeights(replay, addDays(last, -(days - 1)), last) : { chains: new Map(), lanes: [] };
}

export function starRadius(value: number, max: number): number {
  return max > 0 ? 2 + 8 * Math.sqrt(Math.max(0, value) / max) : 2;
}

export function skyScale(width: number, height: number): number {
  return Math.min(width, height) / 700;
}

export function laneOpacity(usd: number, maxUsd: number): number {
  return maxUsd > 0 ? 0.06 + 0.5 * (Math.log10(1 + Math.max(0, usd)) / Math.log10(1 + maxUsd)) : 0.06;
}

export function topSelectors(values: Map<string, number>, n: number): string[] {
  return [...values]
    .sort(([a, va], [b, vb]) => vb - va || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, n)
    .map(([selector]) => selector);
}
