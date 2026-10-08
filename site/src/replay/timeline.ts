import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { linearWarp, type Warp } from './director/warp';
import { daysBetween } from '../lib/days';
import type { CometKind, FrameComet, SkyFrame } from '../sky/frame';
import type { StarPoint } from '../sky/layout';
import { coinSelectors } from '../sky/coins';
import { cometKind, cometSize } from '../sky/scene';
import { laneOpacity, starRadius } from '../sky/weights';

export const REPLAY_LENGTHS = [15, 30, 60] as const;
export type ReplayLength = (typeof REPLAY_LENGTHS)[number];
export const REPLAY_FPS = 30;
export const REPLAY_COMET_S = 0.8;
export const IGNITE_S = 1;
export const MAX_REPLAY_COMETS = 250;
const COMET_FILL = 0.9;
export const ARRIVAL_S = 0.4;
export const MAX_ARRIVALS = 120;
export const REPLAY_COINS = 12;
export const COIN_FADE_S = 0.5;
const STAR_WINDOW_DAYS = 30;

const easeOutCubic = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
const smoothstep = (x: number) => x * x * (3 - 2 * x);

type LaneRow = readonly [number, number, number];

export function cometCount(messages: number): number {
  return Math.min(messages, Math.round(4 * Math.log2(messages + 1)));
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Spawn {
  lane: number;
  offset: number;
  usd: number;
}

export function daySpawns(lanes: readonly LaneRow[], dayIndex: number): Spawn[] {
  const total = lanes.reduce((sum, [, messages]) => sum + messages, 0);
  const rng = mulberry32(dayIndex);
  const out: Spawn[] = [];
  for (let k = 0; k < cometCount(total); k++) {
    let pick = rng() * total;
    let chosen = lanes[lanes.length - 1]!;
    for (const lane of lanes) {
      pick -= lane[1];
      if (pick < 0) {
        chosen = lane;
        break;
      }
    }
    out.push({ lane: chosen[0], offset: rng(), usd: chosen[1] > 0 ? chosen[2] / chosen[1] : 0 });
  }
  return out.sort((a, b) => a.offset - b.offset);
}

export function keptSpawns(spawns: readonly Spawn[], dayIndex: number, dayLength: number): Spawn[] {
  const keep = Math.min(1, (COMET_FILL * MAX_REPLAY_COMETS * dayLength) / (spawns.length * REPLAY_COMET_S));
  return spawns.filter((_, k) => mulberry32(dayIndex * 7919 + k)() < keep);
}

export interface FrameCoin {
  star: number;
  selector: string;
  alpha: number;
}

export interface CoinOptions {
  count: number;
  eligible: (selector: string) => boolean;
}

export interface FrameArrival {
  from: number;
  to: number;
  age: number;
  size: number;
  kind: CometKind;
}

export interface ReplayFrameState {
  t: number;
  dayIndex: number;
  day: string;
  endCard: boolean;
  cumulativeMessages: number;
  cumulativeUsd: number;
  activeChains: number;
  extent: number;
  coins: FrameCoin[];
  arrivals: FrameArrival[];
  sky: SkyFrame;
}

export class ReplayModel {
  readonly days: string[];
  readonly warp: Warp;
  readonly length: number;
  readonly duration: number;
  private readonly lanesByDay: Map<string, readonly LaneRow[]>;
  private readonly cumulative: { messages: number; usd: number }[];
  private readonly starOfChain: number[];
  private readonly firstDayIndex: number[];
  private readonly coinSets: number[][];
  private readonly spawnCache = new Map<number, Spawn[]>();

  constructor(
    private readonly replay: ReplayFile,
    history: readonly DayTotals[],
    private readonly stars: readonly StarPoint[],
    length: number,
    coinOptions: CoinOptions = { count: REPLAY_COINS, eligible: () => true },
    warp?: Warp,
  ) {
    const first = replay.since ?? replay.days[0]?.day;
    const last = replay.days.at(-1)?.day;
    this.days = first && last ? daysBetween(first, last) : [];
    this.warp = warp ?? linearWarp(this.days.length, 0, length);
    this.length = length;
    this.duration = length;
    this.lanesByDay = new Map(replay.days.map((d) => [d.day, d.lanes]));
    const historyByDay = new Map(history.map((d) => [d.day, d]));
    let messages = 0;
    let usd = 0;
    this.cumulative = this.days.map((day) => {
      const h = historyByDay.get(day);
      if (h) {
        messages += h.messages;
        usd += h.usd_value;
      }
      return { messages, usd };
    });
    const dayIndex = new Map(this.days.map((d, i) => [d, i]));
    const starBySelector = new Map(stars.map((s, i) => [s.selector, i]));
    const firstDayBySelector = new Map(replay.chains.map((c) => [c.selector, c.first_day]));
    this.starOfChain = replay.chains.map((c) => starBySelector.get(c.selector) ?? -1);
    this.firstDayIndex = stars.map((s) => dayIndex.get(firstDayBySelector.get(s.selector) ?? '') ?? 0);
    this.coinSets = this.dailyCoinSets(coinOptions);
  }

  dayStart(i: number): number {
    return this.warp.dayStart(i);
  }

  private spawns(i: number, lanes: readonly LaneRow[]): Spawn[] {
    let cached = this.spawnCache.get(i);
    if (!cached) {
      cached = keptSpawns(daySpawns(lanes, i), i, this.warp.dayLength(i));
      this.spawnCache.set(i, cached);
    }
    return cached;
  }

  private dailyCoinSets(opts: CoinOptions): number[][] {
    const values = new Map<string, number>();
    const starBySelector = new Map(this.stars.map((s, i) => [s.selector, i]));
    const shift = (dayIndex: number, sign: 1 | -1) => {
      for (const [lane, , usd] of this.lanesByDay.get(this.days[dayIndex]!) ?? []) {
        for (const chain of this.replay.lanes[lane] ?? []) {
          const star = this.starOfChain[chain] ?? -1;
          if (star < 0) continue;
          const selector = this.stars[star]!.selector;
          values.set(selector, (values.get(selector) ?? 0) + sign * usd);
        }
      }
    };
    return this.days.map((_, d) => {
      shift(d, 1);
      if (d >= STAR_WINDOW_DAYS) shift(d - STAR_WINDOW_DAYS, -1);
      return coinSelectors(values, opts.count, opts.eligible).map((selector) => starBySelector.get(selector)!);
    });
  }

  coinSelectorsEver(): string[] {
    const stars = new Set(this.coinSets.flat());
    return [...stars].sort((a, b) => a - b).map((star) => this.stars[star]!.selector);
  }

  private coinsAt(time: number): FrameCoin[] {
    const end = time;
    const start = end - COIN_FADE_S;
    const firstDay = Math.min(this.days.length - 1, this.warp.dayAt(Math.max(this.warp.start, start)).index);
    const lastDay = Math.min(this.days.length - 1, this.warp.dayAt(Math.max(this.warp.start, end)).index);
    const share = new Map<number, number>();
    for (let d = firstDay; d <= lastDay; d++) {
      const dayEnd = d === this.days.length - 1 ? end : this.dayStart(d + 1);
      const overlap = Math.min(end, dayEnd) - Math.max(start, this.dayStart(d));
      if (overlap <= 0) continue;
      for (const star of this.coinSets[d]!) share.set(star, (share.get(star) ?? 0) + overlap / COIN_FADE_S);
    }
    return [...share]
      .sort(([a], [b]) => a - b)
      .map(([star, m]) => ({ star, selector: this.stars[star]!.selector, alpha: smoothstep(Math.min(1, m)) }));
  }

  frameAt(t: number): ReplayFrameState {
    const time = Math.max(this.warp.start, t);
    const empty: SkyFrame = { stars: [], lanes: [], comets: [], rings: [] };
    if (this.days.length === 0) {
      return { t: time, dayIndex: 0, day: '', endCard: true, cumulativeMessages: 0, cumulativeUsd: 0, activeChains: 0, extent: 1, coins: [], arrivals: [], sky: empty };
    }
    const dayIndex = Math.min(this.warp.dayAt(Math.min(time, this.warp.end - 1e-9)).index, this.days.length - 1);
    const day = this.days[dayIndex]!;

    const values = new Map<number, number>();
    for (let d = Math.max(0, dayIndex - STAR_WINDOW_DAYS + 1); d <= dayIndex; d++) {
      for (const [lane, , usd] of this.lanesByDay.get(this.days[d]!) ?? []) {
        for (const chain of this.replay.lanes[lane] ?? []) {
          const star = this.starOfChain[chain] ?? -1;
          if (star >= 0) values.set(star, (values.get(star) ?? 0) + usd);
        }
      }
    }
    const maxValue = Math.max(0, ...values.values());
    const rings: SkyFrame['rings'] = [];
    let extent = this.stars.length > 0 ? Math.hypot(this.stars[0]!.x, this.stars[0]!.y) : 1;
    const stars = this.stars.map((s, i) => {
      const first = this.firstDayIndex[i]!;
      if (first > dayIndex) return { x: s.x, y: s.y, radius: 0, brightness: 0, flash: 0 };
      const since = time - this.dayStart(first);
      extent = Math.max(extent, Math.hypot(s.x, s.y) * easeOutCubic(since / IGNITE_S));
      if (since < IGNITE_S) rings.push({ star: i, progress: since / IGNITE_S });
      return { x: s.x, y: s.y, radius: starRadius(values.get(i) ?? 0, maxValue), brightness: 0.6, flash: since < IGNITE_S ? 1 - since / IGNITE_S : 0 };
    });

    const todays = this.lanesByDay.get(day) ?? [];
    const maxLane = Math.max(0, ...todays.map(([, , usd]) => usd));
    const lanes = todays.flatMap(([lane, , usd]) => {
      const ends = this.replay.lanes[lane];
      const from = ends ? this.starOfChain[ends[0]] ?? -1 : -1;
      const to = ends ? this.starOfChain[ends[1]] ?? -1 : -1;
      return from < 0 || to < 0 ? [] : [{ from, to, opacity: laneOpacity(usd, maxLane) }];
    });

    const comets: FrameComet[] = [];
    const arrivals: FrameArrival[] = [];
    const firstSpawnDay = this.warp.dayAt(Math.max(this.warp.start, time - REPLAY_COMET_S - ARRIVAL_S)).index;
    for (let d = firstSpawnDay; d <= dayIndex; d++) {
      const dayLanes = this.lanesByDay.get(this.days[d]!);
      if (!dayLanes) continue;
      for (const spawn of this.spawns(d, dayLanes)) {
        const progress = (time - (this.dayStart(d) + spawn.offset * this.warp.dayLength(d))) / REPLAY_COMET_S;
        if (progress < 0) continue;
        const ends = this.replay.lanes[spawn.lane];
        const from = ends ? this.starOfChain[ends[0]] ?? -1 : -1;
        const to = ends ? this.starOfChain[ends[1]] ?? -1 : -1;
        if (from < 0 || to < 0) continue;
        const kind = cometKind(spawn.usd, spawn.usd > 0 ? 'token' : null);
        const size = cometSize(spawn.usd);
        if (progress < 1) comets.push({ from, to, progress, size, kind });
        else if ((progress - 1) * REPLAY_COMET_S < ARRIVAL_S) arrivals.push({ from, to, age: (progress - 1) * REPLAY_COMET_S, size, kind });
      }
    }

    return {
      t: time,
      dayIndex,
      day,
      endCard: time >= this.length,
      cumulativeMessages: this.cumulative[dayIndex]!.messages,
      cumulativeUsd: this.cumulative[dayIndex]!.usd,
      activeChains: this.firstDayIndex.filter((f) => f <= dayIndex).length,
      extent,
      coins: this.coinsAt(time),
      arrivals: arrivals.slice(-MAX_ARRIVALS),
      sky: { stars, lanes, comets: comets.slice(-MAX_REPLAY_COMETS), rings },
    };
  }
}
