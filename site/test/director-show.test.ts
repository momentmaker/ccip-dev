import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { SLAM_S } from '../src/replay/director/beats';
import { Show, yearsLabel } from '../src/replay/director/show';
import { buildLayout } from '../src/sky/layout';
import replayJson from './fixtures/replay.json';

const replay = replayJson as ReplayFile;
const history: DayTotals[] = [
  ['2023-07-06', 2, 0],
  ['2023-07-07', 35, 1500],
  ['2023-07-08', 15, 1_502_000],
  ['2023-07-09', 8, 1000],
].map(([day, messages, usd]) => ({
  day: day as string, messages: messages as number, token_messages: messages as number, usd_value: usd as number, fee_usd: null, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null,
}));
const stars = buildLayout(replay.chains);
const show = (focus: string | null = null, length = 30) => new Show({ replay, history, stars, length, focus, eligible: () => true });

describe('yearsLabel', () => {
  it.each([
    ['2023-07-06', '2026-10-06', '3 years'],
    ['2023-07-06', '2027-01-10', '3½ years'],
    ['2025-01-01', '2026-01-02', '1 year'],
    ['2026-01-01', '2026-12-01', '11 months'],
    ['2026-09-01', '2026-10-01', '1 month'],
  ])('%s → %s is "%s"', (from, to, label) => {
    expect(yearsLabel(from, to)).toBe(label);
  });
});

describe('Show', () => {
  it('opens on the hook with the title and the first message in flight', () => {
    const f = show().frameAt(1);
    expect(f.phase).toBe('hook');
    expect(f.hook).toEqual({ title: '1 month of Chainlink CCIP', subtitle: 'in 30 seconds', progress: 0.5 });
    expect(f.base.sky.comets.length).toBeGreaterThan(0);
  });

  it('tells the story between the hook and the finale', () => {
    const s = show();
    expect(s.warp.start).toBe(2);
    expect(s.warp.end).toBeCloseTo(27, 9);
    expect(s.frameAt(15).phase).toBe('story');
    expect(s.frameAt(15).hook).toBeNull();
  });

  it('runs the finale and cross-fades into the loop at the very end', () => {
    const s = show();
    expect(s.frameAt(28).finale).toBeCloseTo(1 / 3, 6);
    expect(s.frameAt(29).loop).toBe(0);
    expect(s.frameAt(29.99).loop).toBeGreaterThan(0.9);
  });

  it('is a pure function of t, whatever was asked before', () => {
    const s = show();
    const first = s.frameAt(20);
    s.frameAt(3);
    s.frameAt(29.5);
    expect(s.frameAt(20)).toEqual(first);
  });

  it('keeps every card and slam inside the story', () => {
    const s = show();
    for (const c of s.cards) {
      expect(c.start).toBeGreaterThanOrEqual(s.warp.start - 1e-9);
      expect(c.start).toBeLessThan(s.length);
    }
    for (const m of s.milestoneMarks()) expect(m.time).toBeGreaterThanOrEqual(s.warp.start - 1e-9);
  });

  it.each([30, 15])('ends every card and slam by the end of the story in the %i s cut', (length) => {
    const s = show(null, length);
    for (const c of s.cards) expect(c.end).toBeLessThanOrEqual(s.warp.end + 1e-9);
    for (const m of s.slams) expect(m.start + SLAM_S).toBeLessThanOrEqual(s.warp.end + 1e-9);
  });

  it.each([30, 15])('ends every card and slam by the end of the story when a chain joins and a milestone lands on the last day (%i s)', (length) => {
    const days = Array.from({ length: 200 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10));
    const late: ReplayFile = {
      ...replay,
      since: days[0]!,
      chains: [
        { selector: 'a', name: 'alpha-mainnet', display_name: 'Alpha', first_day: days[0]! },
        { selector: 'c', name: 'gamma-mainnet', display_name: 'Gamma', first_day: days[0]! },
        { selector: 'b', name: 'beta-mainnet', display_name: 'Beta', first_day: days.at(-1)! },
      ],
      lanes: [[0, 1], [0, 2]],
      days: days.map((day, i) => ({ day, lanes: i === days.length - 1 ? [[0, 4, 100], [1, 500, 1000]] : [[0, 4, 100]] })),
    } as ReplayFile;
    const lateHistory = late.days.map((d, i) => ({ ...history[0]!, day: d.day, messages: i === days.length - 1 ? 504 : 4 }));
    const s = new Show({ replay: late, history: lateHistory, stars: buildLayout(late.chains), length, focus: null, eligible: () => true });
    const lastDayStart = s.warp.dayStart(days.length - 1);
    expect(lastDayStart).toBeGreaterThan(s.warp.end - SLAM_S);
    expect(s.cards.length + s.slams.length).toBeGreaterThan(0);
    for (const c of s.cards) expect(c.end).toBeLessThanOrEqual(s.warp.end + 1e-9);
    for (const m of s.slams) expect(m.start + SLAM_S).toBeLessThanOrEqual(s.warp.end + 1e-9);
  });

  it.each([15, 30, 60])('poses the poster on the settled finale, with the end title in and before the loop crossfade (%i s)', (length) => {
    const s = show(null, length);
    const poster = s.frameAt(s.posterTime());
    expect(poster.phase).toBe('finale');
    expect(poster.loop).toBe(0);
    expect(poster.finale).toBeGreaterThanOrEqual(0.7);
  });

  describe('year ticks', () => {
    const DAY_MS = 86_400_000;
    const span = (from: string, to: string) => Array.from({ length: (Date.parse(to) - Date.parse(from)) / DAY_MS + 1 }, (_, i) => new Date(Date.parse(from) + i * DAY_MS).toISOString().slice(0, 10));
    const days = span('2023-07-06', '2026-10-06');
    const joinDay = '2026-09-22';
    const multiYear: ReplayFile = {
      ...replay,
      since: days[0]!,
      chains: [
        { selector: 'a', name: 'alpha-mainnet', display_name: 'Alpha', first_day: days[0]! },
        { selector: 'c', name: 'gamma-mainnet', display_name: 'Gamma', first_day: days[0]! },
        { selector: 'b', name: 'beta-mainnet', display_name: 'Beta', first_day: joinDay },
      ],
      lanes: [[0, 1], [0, 2]],
      days: days.map((day) => ({ day, lanes: day >= joinDay ? [[0, 40, 1000], [1, 3, 100]] : [[0, 40, 1000]] })),
    } as ReplayFile;
    const multiHistory = multiYear.days.map((d) => ({ ...history[0]!, day: d.day, messages: 43 }));
    const showOf = (focus: string | null, length: number) => new Show({ replay: multiYear, history: multiHistory, stars: buildLayout(multiYear.chains), length, focus, eligible: () => true });
    const gaps = (s: Show) => s.yearTicks().slice(1).map((t, i) => (t.time - s.yearTicks()[i]!.time) / (s.warp.end - s.warp.start));

    it.each([15, 30, 60])('keeps the ticks of a late-joining focus cut at least 7 percent of the story apart, keeping the latest year (%i s)', (length) => {
      const s = showOf('b', length);
      expect(s.yearTicks().at(-1)!.label).toBe('2026');
      for (const g of gaps(s)) expect(g).toBeGreaterThanOrEqual(0.07);
    });

    it.each([15, 30, 60])('keeps every year of the network cut, whose ticks are already more than 7 percent apart (%i s)', (length) => {
      const s = showOf(null, length);
      expect(s.yearTicks().map((t) => t.label)).toEqual(['2023', '2024', '2025', '2026']);
      for (const g of gaps(s)) expect(g).toBeGreaterThan(0.07);
    });
  });

  it('starts the timeline with the first year', () => {
    expect(show().yearTicks()[0]).toEqual({ time: 2, label: '2023' });
  });

  it('follows a focus chain: its title, its counters and the lane cards', () => {
    const ethereum = '5009297550715157269';
    const s = show(ethereum);
    expect(s.frameAt(1).hook!.title).toBe('Ethereum × Chainlink CCIP');
    expect(s.frameAt(1).hook!.subtitle).toBe('since Jul 6, 2023');
    expect(s.cards.every((c) => c.kind === 'lane' || c.kind === 'record')).toBe(true);
    expect(s.frameAt(26.9).story.messages).toBeGreaterThan(0);
    expect(s.frameAt(26.9).focus).toBe(ethereum);
  });

  it('keeps the all-chains warp exactly as it was', () => {
    const at = (s: Show) => [0, 1, 2, 3, 4].map((i) => s.warp.dayStart(i));
    const expected30 = [2, 8.323773499702234, 12.712717903798037, 20.026496840412666, 27];
    const expected15 = [1.5, 4.408935809863028, 6.427850235747098, 9.792188546589827, 13];
    at(show()).forEach((v, i) => expect(v).toBeCloseTo(expected30[i]!, 9));
    at(show(null, 15)).forEach((v, i) => expect(v).toBeCloseTo(expected15[i]!, 9));
  });

  it('keeps the warp of a focus chain that joins on the first replay day exactly as it was', () => {
    const expected = [2, 8.323773499702234, 12.712717903798037, 20.026496840412666, 27];
    const s = show('5009297550715157269');
    [0, 1, 2, 3, 4].forEach((i) => expect(s.warp.dayStart(i)).toBeCloseTo(expected[i]!, 9));
  });

  it('reaches a late-joining focus chain within the first 15% of the story', () => {
    const solana = '124615329519749607';
    const s = show(solana);
    const joined = s.warp.dayStart(s.days.indexOf('2023-07-09'));
    expect(joined).toBeLessThanOrEqual(s.timing.hook + 0.15 * (s.warp.end - s.warp.start) + 1e-9);
  });

  it('reaches a chain that joins after 180 of 200 days within the first 15% of the story, with a monotonic warp', () => {
    const days = Array.from({ length: 200 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10));
    const late: ReplayFile = {
      ...replay,
      since: days[0]!,
      chains: [
        { selector: 'a', name: 'alpha-mainnet', display_name: 'Alpha', first_day: days[0]! },
        { selector: 'c', name: 'gamma-mainnet', display_name: 'Gamma', first_day: days[0]! },
        { selector: 'b', name: 'beta-mainnet', display_name: 'Beta', first_day: days[180]! },
      ],
      lanes: [[0, 1], [0, 2]],
      days: days.map((day, i) => ({ day, lanes: i >= 180 ? [[0, 40, 1000], [1, 3, 100]] : [[0, 40, 1000]] })),
    } as ReplayFile;
    const lateHistory = late.days.map((d) => ({ ...history[0]!, day: d.day, messages: 43 }));
    for (const length of [15, 30, 60]) {
      const s = new Show({ replay: late, history: lateHistory, stars: buildLayout(late.chains), length, focus: 'b', eligible: () => true });
      expect(s.warp.dayStart(180) - s.warp.start).toBeLessThanOrEqual(0.15 * (s.warp.end - s.warp.start) + 1e-9);
      expect(s.warp.end).toBeCloseTo(length - s.timing.finale, 9);
      let prev = { index: 0, progress: 0 };
      for (let t = 0; t <= length; t += 0.02) {
        const now = s.warp.dayAt(t);
        expect(now.index > prev.index || (now.index === prev.index && now.progress >= prev.progress)).toBe(true);
        prev = now;
      }
    }
  });

  it('handles a 15 s cut', () => {
    const s = show(null, 15);
    expect(s.warp.start).toBe(1.5);
    expect(s.warp.end).toBeCloseTo(13, 9);
  });

  it('keeps the first-message comet in a focus cut', () => {
    const f = show('5009297550715157269').frameAt(1);
    expect(f.base.sky.comets.some((c) => Math.abs(c.progress - 0.5) < 1e-9 && c.size === 0.4)).toBe(true);
  });

  it('thins focus-cut comets stably from one frame to the next', () => {
    const s = show('15971525489660198786');
    const step = 1 / 30;
    let checked = 0;
    for (let t = s.warp.start; t < s.warp.end - 0.2; t += 0.05) {
      const now = s.frameAt(t).base.sky.comets.filter((c) => c.from !== s.frameAt(t).focusStar && c.to !== s.frameAt(t).focusStar);
      const later = s.frameAt(t + step).base.sky.comets;
      for (const c of now) {
        if (c.progress < 0.9) {
          expect(later.some((l) => l.from === c.from && l.to === c.to)).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
