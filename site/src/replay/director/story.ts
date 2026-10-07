import type { ReplayFile } from '@ccip-dev/core/public';
import type { Warp } from './warp';

export interface StoryValues {
  usd: number;
  messages: number;
  chains: number;
  day: string;
  timeline: number;
}

type Source = Pick<ReplayFile, 'chains' | 'lanes' | 'days'>;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export class StoryCounter {
  private readonly daily: { day: string; messages: number; usd_value: number }[];
  private readonly cumUsd: number[];
  private readonly cumMessages: number[];
  private readonly chainsByDay: number[];

  constructor(
    private readonly days: readonly string[],
    history: readonly { day: string; messages: number; usd_value: number }[],
    replay: Source,
    focus: string | null,
  ) {
    const focusIndex = focus === null ? -1 : replay.chains.findIndex((c) => c.selector === focus);
    if (focusIndex >= 0) {
      const lanesByDay = new Map(replay.days.map((d) => [d.day, d.lanes]));
      const partners = new Set<number>();
      this.chainsByDay = [];
      this.daily = days.map((day) => {
        let messages = 0;
        let usd = 0;
        for (const [lane, m, u] of lanesByDay.get(day) ?? []) {
          const ends = replay.lanes[lane];
          if (!ends || (ends[0] !== focusIndex && ends[1] !== focusIndex)) continue;
          messages += m;
          usd += u;
          const partner = ends[0] === focusIndex ? ends[1] : ends[0];
          if (partner !== focusIndex) partners.add(partner);
        }
        this.chainsByDay.push(partners.size);
        return { day, messages, usd_value: usd };
      });
    } else {
      const byDay = new Map(history.map((h) => [h.day, h]));
      const firstDays = replay.chains.map((c) => c.first_day).sort();
      let joined = 0;
      this.chainsByDay = days.map((day) => {
        while (joined < firstDays.length && firstDays[joined]! <= day) joined++;
        return joined;
      });
      this.daily = days.map((day) => ({ day, messages: byDay.get(day)?.messages ?? 0, usd_value: byDay.get(day)?.usd_value ?? 0 }));
    }
    let usd = 0;
    let messages = 0;
    this.cumUsd = this.daily.map((d) => (usd += d.usd_value));
    this.cumMessages = this.daily.map((d) => (messages += d.messages));
  }

  dailyMessages(): number[] {
    return this.daily.map((d) => d.messages);
  }

  dailyTotals(): { day: string; messages: number; usd_value: number }[] {
    return this.daily.map((d) => ({ ...d }));
  }

  at(t: number, warp: Warp): StoryValues {
    const { index, progress } = warp.dayAt(t);
    const p = t <= warp.start ? 0 : progress;
    const lerp = (cum: number[]) => {
      const before = index > 0 ? cum[index - 1]! : 0;
      return before + ((cum[index] ?? before) - before) * p;
    };
    return {
      usd: lerp(this.cumUsd),
      messages: lerp(this.cumMessages),
      chains: this.chainsByDay[index] ?? 0,
      day: this.days[index] ?? '',
      timeline: clamp01((t - warp.start) / Math.max(1e-9, warp.end - warp.start)),
    };
  }
}
