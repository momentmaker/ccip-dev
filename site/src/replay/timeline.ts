import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { daysBetween } from '../lib/days';
import type { Milestone } from '../lib/records';
import type { FrameComet, SkyFrame } from '../sky/frame';
import type { StarPoint } from '../sky/layout';
import { cometKind, cometSize } from '../sky/scene';
import { laneOpacity, starRadius } from '../sky/weights';

export const REPLAY_LENGTHS = [30, 60, 120] as const;
export type ReplayLength = (typeof REPLAY_LENGTHS)[number];
export const REPLAY_FPS = 30;
export const END_CARD_S = 2;
export const REPLAY_COMET_S = 1.2;
export const CAPTION_S = 2;
export const IGNITE_S = 1;
export const MAX_REPLAY_COMETS = 400;
const STAR_WINDOW_DAYS = 30;
const MAX_CAPTIONS = 2;

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

export interface ReplayFrameState {
  t: number;
  dayIndex: number;
  day: string;
  endCard: boolean;
  cumulativeMessages: number;
  cumulativeUsd: number;
  activeChains: number;
  captions: string[];
  sky: SkyFrame;
}

export class ReplayModel {
  readonly days: string[];
  readonly secondsPerDay: number;
  readonly length: number;
  readonly duration: number;
  private readonly lanesByDay: Map<string, readonly LaneRow[]>;
  private readonly cumulative: { messages: number; usd: number }[];
  private readonly starOfChain: number[];
  private readonly firstDayIndex: number[];
  private readonly captions: { dayIndex: number; label: string }[];
  private readonly spawnCache = new Map<number, Spawn[]>();

  constructor(
    private readonly replay: ReplayFile,
    history: readonly DayTotals[],
    milestones: readonly Milestone[],
    private readonly stars: readonly StarPoint[],
    length: number,
  ) {
    const first = replay.since ?? replay.days[0]?.day;
    const last = replay.days.at(-1)?.day;
    this.days = first && last ? daysBetween(first, last) : [];
    this.length = length;
    this.secondsPerDay = this.days.length > 0 ? length / this.days.length : length;
    this.duration = length + END_CARD_S;
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
    this.captions = milestones.flatMap((m) => {
      const i = dayIndex.get(m.day);
      return i === undefined ? [] : [{ dayIndex: i, label: m.label }];
    });
  }

  dayStart(i: number): number {
    return i * this.secondsPerDay;
  }

  private spawns(i: number, lanes: readonly LaneRow[]): Spawn[] {
    let cached = this.spawnCache.get(i);
    if (!cached) {
      cached = daySpawns(lanes, i);
      this.spawnCache.set(i, cached);
    }
    return cached;
  }

  frameAt(t: number): ReplayFrameState {
    const time = Math.max(0, t);
    const empty: SkyFrame = { stars: [], lanes: [], comets: [], rings: [] };
    if (this.days.length === 0) {
      return { t: time, dayIndex: 0, day: '', endCard: true, cumulativeMessages: 0, cumulativeUsd: 0, activeChains: 0, captions: [], sky: empty };
    }
    const dayIndex = Math.min(Math.floor(Math.min(time, this.length - 1e-9) / this.secondsPerDay), this.days.length - 1);
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
    const stars = this.stars.map((s, i) => {
      const first = this.firstDayIndex[i]!;
      if (first > dayIndex) return { x: s.x, y: s.y, radius: 0, brightness: 0, flash: 0 };
      const since = time - this.dayStart(first);
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
    const lookback = Math.ceil(REPLAY_COMET_S / this.secondsPerDay) + 1;
    for (let d = Math.max(0, dayIndex - lookback); d <= dayIndex; d++) {
      const dayLanes = this.lanesByDay.get(this.days[d]!);
      if (!dayLanes) continue;
      for (const spawn of this.spawns(d, dayLanes)) {
        const progress = (time - (this.dayStart(d) + spawn.offset * this.secondsPerDay)) / REPLAY_COMET_S;
        if (progress < 0 || progress >= 1) continue;
        const ends = this.replay.lanes[spawn.lane];
        const from = ends ? this.starOfChain[ends[0]] ?? -1 : -1;
        const to = ends ? this.starOfChain[ends[1]] ?? -1 : -1;
        if (from < 0 || to < 0) continue;
        comets.push({ from, to, progress, size: cometSize(spawn.usd), kind: cometKind(spawn.usd, spawn.usd > 0 ? 'token' : null) });
      }
    }

    const captions = this.captions
      .filter((c) => c.dayIndex <= dayIndex && time - this.dayStart(c.dayIndex) < CAPTION_S)
      .slice(-MAX_CAPTIONS)
      .map((c) => c.label);

    return {
      t: time,
      dayIndex,
      day,
      endCard: time >= this.length,
      cumulativeMessages: this.cumulative[dayIndex]!.messages,
      cumulativeUsd: this.cumulative[dayIndex]!.usd,
      activeChains: this.firstDayIndex.filter((f) => f <= dayIndex).length,
      captions,
      sky: { stars, lanes, comets: comets.slice(-MAX_REPLAY_COMETS), rings },
    };
  }
}
