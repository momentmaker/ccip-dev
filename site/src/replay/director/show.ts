import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { daysBetween } from '../../lib/days';
import { formatUtcDay } from '../../lib/format';
import { shortChainName } from '../../lib/names';
import { computeMilestones } from '../../lib/records';
import type { StarPoint } from '../../sky/layout';
import { REPLAY_COINS, REPLAY_COMET_S, ReplayModel, type ReplayFrameState } from '../timeline';
import {
  joinEvents,
  laneOpenEvents,
  milestoneEvents,
  recordEvents,
  scheduleCards,
  scheduleSlams,
  SLAM_S,
  dayFlags,
  type Card,
  type Slam,
} from './beats';
import { cameraAt, punch, type Camera } from './camera';
import { Leaderboard, type BoardRow } from './leaderboard';
import { phaseAt, shotTiming, type Phase, type ShotTiming } from './phases';
import { StoryCounter, type StoryValues } from './story';
import { storyWarp, WARP_PRE_JOIN_SHARE, type Warp } from './warp';

export const LOOP_S = 0.5;
export const YEAR_TICK_GAP = 0.07;

export interface ShowInput {
  replay: ReplayFile;
  history: readonly DayTotals[];
  stars: readonly StarPoint[];
  length: number;
  focus: string | null;
  eligible: (selector: string) => boolean;
}

export interface ShowCard extends Card {
  progress: number;
}

export interface ShowSlam extends Slam {
  progress: number;
}

export interface Hook {
  title: string;
  subtitle: string;
  progress: number;
}

export interface ShowFrame {
  t: number;
  phase: Phase;
  base: ReplayFrameState;
  camera: Camera;
  card: ShowCard | null;
  slam: ShowSlam | null;
  story: StoryValues;
  board: BoardRow[];
  hook: Hook | null;
  finale: number;
  loop: number;
  punch: number;
  focus: string | null;
  focusStar: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

export function yearsLabel(from: string, to: string): string {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  const years = Math.floor((days / 365.25) * 2) / 2;
  if (years < 1) {
    const months = Math.max(1, Math.round(days / 30.44));
    return `${months} ${months === 1 ? 'month' : 'months'}`;
  }
  const whole = Math.floor(years);
  const text = years === whole ? String(whole) : `${whole}½`;
  return `${text} ${years === 1 ? 'year' : 'years'}`;
}

export class Show {
  readonly length: number;
  readonly timing: ShotTiming;
  readonly warp: Warp;
  readonly model: ReplayModel;
  readonly cards: Card[];
  readonly slams: Slam[];
  readonly days: string[];
  readonly focus: string | null;
  readonly focusName: string | null;
  private readonly board: Leaderboard;
  private readonly counter: StoryCounter;
  private readonly fullExtent: number;
  private readonly focusPoint: StarPoint | null;
  private readonly focusStar: number;
  private readonly title: { title: string; subtitle: string };
  private readonly hookLane: { from: number; to: number } | null;

  constructor(input: ShowInput) {
    const { replay, history, stars, length } = input;
    const first = replay.since ?? replay.days[0]?.day;
    const last = replay.days.at(-1)?.day;
    this.days = first && last ? daysBetween(first, last) : [];
    this.length = length;
    this.timing = shotTiming(length);
    const focusChain = input.focus ? replay.chains.find((c) => c.selector === input.focus) ?? null : null;
    this.focus = focusChain?.selector ?? null;
    this.focusName = focusChain ? shortChainName(focusChain) : null;
    this.counter = new StoryCounter(this.days, history, replay, this.focus);
    const milestones = this.focus
      ? computeMilestones(this.counter.dailyTotals(), [])
      : computeMilestones(history, replay.chains);
    const events = [
      ...(this.focus ? laneOpenEvents(replay, this.focus, this.days) : joinEvents(replay.chains, this.days)),
      ...milestoneEvents(milestones, this.days),
      ...(this.focus ? [] : recordEvents(history, this.days)),
    ];
    const preJoin = focusChain ? { preDays: Math.max(0, this.days.indexOf(focusChain.first_day)), preShareMax: WARP_PRE_JOIN_SHARE } : undefined;
    this.warp = storyWarp(this.counter.dailyMessages(), dayFlags(events, this.days.length), this.timing.hook, length - this.timing.finale, length, preJoin);
    this.model = new ReplayModel(replay, history, [], stars, length, { count: REPLAY_COINS, eligible: input.eligible }, this.warp);
    this.cards = scheduleCards(events, this.warp, this.focusName);
    this.slams = scheduleSlams(events, this.warp);
    this.board = new Leaderboard(replay, this.days, input.eligible, this.warp);
    this.fullExtent = Math.max(1e-6, ...stars.map((s) => Math.hypot(s.x, s.y)));
    this.focusPoint = this.focus ? stars.find((s) => s.selector === this.focus) ?? null : null;
    this.focusStar = this.focus ? stars.findIndex((s) => s.selector === this.focus) : -1;
    this.title = focusChain
      ? { title: `${this.focusName} × Chainlink CCIP`, subtitle: `since ${formatUtcDay(focusChain.first_day)}` }
      : { title: `${yearsLabel(first ?? '', last ?? '')} of Chainlink CCIP`, subtitle: `in ${length} seconds` };
    const starOf = new Map(stars.map((s, i) => [s.selector, i]));
    const firstDay = [...replay.days].sort((a, b) => (a.day < b.day ? -1 : 1))[0];
    const lane = firstDay ? replay.lanes[firstDay.lanes[0]?.[0] ?? -1] : undefined;
    const from = lane ? starOf.get(replay.chains[lane[0]]?.selector ?? '') : undefined;
    const to = lane ? starOf.get(replay.chains[lane[1]]?.selector ?? '') : undefined;
    this.hookLane = from !== undefined && to !== undefined ? { from, to } : null;
  }

  frameAt(t: number): ShowFrame {
    const time = Math.max(0, Math.min(t, this.length));
    const phase = phaseAt(time, this.length);
    const modelT = Math.min(Math.max(time, this.warp.start), this.warp.end - 1e-6);
    const raw = this.model.frameAt(modelT);
    const sky = { ...raw.sky, comets: [...raw.sky.comets], lanes: [...raw.sky.lanes], stars: [...raw.sky.stars] };
    if (this.focusStar >= 0) {
      const touches = (a: number, b: number) => a === this.focusStar || b === this.focusStar;
      sky.lanes = sky.lanes.map((l) => (touches(l.from, l.to) ? l : { ...l, opacity: l.opacity * 0.25 }));
      sky.comets = sky.comets.filter((c) => {
        const spawn = Math.round((modelT - c.progress * REPLAY_COMET_S) * 30);
        return touches(c.from, c.to) || (c.from * 31 + c.to * 17 + spawn) % 4 === 0;
      });
      sky.stars = sky.stars.map((s, i) => (i === this.focusStar ? s : { ...s, brightness: s.brightness * 0.6 }));
    }
    if (phase === 'hook' && this.hookLane) {
      sky.comets.push({ ...this.hookLane, progress: clamp01(time / this.timing.hook), size: 0.4, kind: 'data' });
    }
    const base: ReplayFrameState = { ...raw, sky };
    const slamHit = this.slams.find((s) => time >= s.start && time < s.start + SLAM_S);
    const cardHit = this.cards.find((c) => time >= c.start && time < c.end);
    const finaleStart = this.length - this.timing.finale;
    return {
      t: time,
      phase,
      base,
      camera: cameraAt({
        t: time,
        baseExtent: raw.extent,
        fullExtent: this.fullExtent,
        storyStart: this.warp.start,
        storyEnd: this.warp.end,
        slamStarts: this.slams.map((s) => s.start),
        focus: this.focusPoint,
      }),
      card: cardHit ? { ...cardHit, progress: (time - cardHit.start) / (cardHit.end - cardHit.start) } : null,
      slam: slamHit ? { ...slamHit, progress: (time - slamHit.start) / SLAM_S } : null,
      story: this.counter.at(time, this.warp),
      board: this.board.at(time, this.focus),
      hook: phase === 'hook' ? { ...this.title, progress: clamp01(time / this.timing.hook) } : null,
      finale: phase === 'finale' ? clamp01((time - finaleStart) / this.timing.finale) : 0,
      loop: smoothstep((time - (this.length - LOOP_S)) / LOOP_S),
      punch: Math.max(0, ...this.slams.map((s) => punch(time - s.start))),
      focus: this.focus,
      focusStar: this.focusStar,
    };
  }

  posterTime(): number {
    return this.length - LOOP_S;
  }

  milestoneMarks(): { time: number; label: string; day: string }[] {
    return this.slams.map((s) => ({ time: s.start, label: s.label, day: this.days[this.warp.dayAt(s.start).index] ?? '' }));
  }

  yearTicks(): { time: number; label: string }[] {
    const years = this.days.flatMap((day, i) => (i === 0 || day.endsWith('-01-01') ? [{ time: this.warp.dayStart(i), label: day.slice(0, 4) }] : []));
    const gap = YEAR_TICK_GAP * (this.warp.end - this.warp.start);
    const kept: { time: number; label: string }[] = [];
    for (const tick of years.reverse()) {
      const next = kept[0];
      if (!next || next.time - tick.time >= gap) kept.unshift(tick);
    }
    return kept;
  }
}
