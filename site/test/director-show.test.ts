import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
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
