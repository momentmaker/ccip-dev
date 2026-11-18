import { describe, expect, it } from 'vitest';
import type { PegBar } from '../src/peg';
import { DEFAULT_PEG_THRESHOLDS, pegEpisodesFromBars, pegMarkerHours, pegHistoryBody, pegRecords, stepPeg, type PegEvent, type PegMarkerEvent, type PegMachine, type PegSample } from '../src/peg-episodes';

const SEP_CLOSES = [
  1.0, 1.0, 1.0, 1.0, 0.9998, 0.9998, 1.0, 0.9998, 1.0, 0.9986, 0.9981, 0.9981, 0.9964, 0.995, 0.9953, 0.9953, 0.9953, 0.9953, 0.9953, 0.9953,
  0.9953, 0.9953, 0.9953, 0.9951, 0.9951, 0.9957, 0.9957, 0.9962, 0.9962, 0.9967, 0.9967, 0.9967, 0.9967, 0.9967, 0.9971, 0.9949, 0.9949, 0.9918, 0.9914, 0.9916,
  0.9921, 0.9922, 0.9922, 0.9922, 0.9922, 0.9922, 0.9922, 0.9922, 0.9922, 0.9922, 0.993, 0.9931, 0.9939, 0.9939, 0.9939, 0.9939, 0.9939, 0.9939, 0.9939, 0.9939,
  0.9939, 0.9939, 0.9939, 0.9939, 0.9939, 0.9939, 0.9944, 0.9944, 0.9944, 0.9944, 0.9944, 0.9944, 0.9944, 0.9944, 0.9955, 0.9955, 0.9959, 0.9962, 0.9962, 0.9914,
  0.9914, 0.9913, 0.9913, 0.9912, 0.9916, 0.9916, 0.9913, 0.9916, 0.9916, 0.9916, 0.9916, 1.0254, 1.0415, 1.0564, 1.0186, 1.0029, 1.0036, 1.0026, 1.0026, 1.0026,
  1.0022, 1.0022, 1.0022, 1.0017, 1.0017, 1.0016, 1.0016, 1.0016, 1.0016, 1.0016, 1.0016, 1.0016, 1.0014, 1.0014, 1.0014, 1.0014, 1.0014, 1.0016, 1.0018,
];
const hourAt = (i: number) => new Date(Date.UTC(2026, 8, 22, i)).toISOString();
const SEP_BARS: PegBar[] = SEP_CLOSES.map((c, i) => ({ hour: hourAt(i), open: c, high: c, low: c, close: c }));
const T = DEFAULT_PEG_THRESHOLDS;
const EMPTY: PegMachine = { open: null, prev: null };

function replay(samples: readonly PegSample[], confirm: 1 | 2): { events: PegEvent[]; machine: PegMachine } {
  let machine = EMPTY;
  const events: PegEvent[] = [];
  for (const s of samples) {
    const step = stepPeg(machine, s, T, confirm);
    machine = step.machine;
    events.push(...step.events);
  }
  return { events, machine };
}

const brief = (e: PegEvent) => [e.kind, e.episode.side, e.kind === 'closed' ? e.closedAt : e.kind === 'tier' ? e.tier : e.episode.openedAt];

describe('stepPeg on the 22–26 Sep 2026 swing, two samples to confirm', () => {
  const { events, machine } = replay(SEP_BARS.map((b) => ({ at: b.hour, gap: b.close - 1 })), 2);

  it('opens a discount, takes it public, closes it on the flip, then opens and closes a public premium', () => {
    expect(events.map(brief)).toEqual([
      ['opened', 'discount', hourAt(12)],
      ['went_public', 'discount', hourAt(12)],
      ['closed', 'discount', hourAt(92)],
      ['opened', 'premium', hourAt(91)],
      ['went_public', 'premium', hourAt(91)],
      ['tier', 'premium', 0.02],
      ['closed', 'premium', hourAt(113)],
    ]);
    expect(machine.open).toBeNull();
  });

  it('keeps each episode’s peak', () => {
    const closed = events.filter((e) => e.kind === 'closed');
    expect(closed[0]!.episode.peakGap).toBeCloseTo(-0.0088, 6);
    expect(closed[0]!.episode.peakAt).toBe(hourAt(83));
    expect(closed[1]!.episode.peakGap).toBeCloseTo(0.0564, 6);
    expect(closed[1]!.episode.peakAt).toBe(hourAt(93));
  });

  it('never announces the 5% tier, since only one sample reached it', () => {
    expect(events.filter((e) => e.kind === 'tier').map((e) => (e as { tier: number }).tier)).toEqual([0.02]);
  });
});

describe('stepPeg rules', () => {
  const s = (minute: number, gap: number): PegSample => ({ at: new Date(Date.UTC(2026, 10, 18, 0, minute)).toISOString(), gap });

  it('does not open on one spike', () => {
    expect(replay([s(0, 0), s(5, -0.02), s(10, 0)], 2).events).toEqual([]);
  });

  it('does not open across sides', () => {
    expect(replay([s(0, -0.004), s(5, 0.004)], 2).events).toEqual([]);
  });

  it('opens at the first of the two samples, with the deeper one as its peak', () => {
    const { events } = replay([s(0, -0.004), s(5, -0.005)], 2);
    expect(events).toEqual([{ kind: 'opened', episode: { side: 'discount', openedAt: s(0, 0).at, peakGap: -0.005, peakAt: s(5, 0).at, tier: 0, public: false } }]);
  });

  it('stays open while one sample dips under half the threshold, and closes on the second', () => {
    const { events } = replay([s(0, -0.004), s(5, -0.004), s(10, -0.001), s(15, -0.002), s(20, -0.001), s(25, -0.0005)], 2);
    expect(events.map((e) => e.kind)).toEqual(['opened', 'closed']);
    expect((events[1] as { closedAt: string }).closedAt).toBe(s(25, 0).at);
  });

  it('announces each tier once, the highest reached at once', () => {
    const { events } = replay([s(0, -0.004), s(5, -0.004), s(10, -0.021), s(15, -0.022), s(20, -0.012), s(25, -0.025), s(30, -0.03)], 2);
    expect(events.map((e) => (e.kind === 'tier' ? `tier ${e.tier}` : e.kind))).toEqual(['opened', 'went_public', 'tier 0.02']);
  });

  it('goes public once', () => {
    const { events } = replay([s(0, -0.008), s(5, -0.008), s(10, -0.009), s(15, -0.009)], 2);
    expect(events.filter((e) => e.kind === 'went_public')).toHaveLength(1);
  });
});

describe('pegEpisodesFromBars', () => {
  it('finds the same two September episodes in hourly bars, one bar confirming', () => {
    expect(pegEpisodesFromBars(SEP_BARS, T)).toEqual([
      { side: 'discount', start: hourAt(12), end: hourAt(91), peak_gap: expect.closeTo(-0.0088, 6), peak_at: hourAt(83), hours: 79 },
      { side: 'premium', start: hourAt(91), end: hourAt(112), peak_gap: expect.closeTo(0.0564, 6), peak_at: hourAt(93), hours: 21 },
    ]);
  });

  it('leaves an episode still running open-ended, measured to the last bar', () => {
    const episodes = pegEpisodesFromBars(SEP_BARS.slice(0, 20), T);
    expect(episodes).toEqual([{ side: 'discount', start: hourAt(12), end: null, peak_gap: expect.closeTo(-0.005, 6), peak_at: hourAt(13), hours: 7 }]);
  });
});

describe('pegRecords', () => {
  it('takes the deepest low, the highest high, the longest episode and the last end', () => {
    const episodes = pegEpisodesFromBars(SEP_BARS, T);
    const records = pegRecords(SEP_BARS, episodes);
    expect(records.deepest_discount).toEqual({ gap: expect.closeTo(-0.0088, 6), hour: hourAt(83) });
    expect(records.highest_premium).toEqual({ gap: expect.closeTo(0.0564, 6), hour: hourAt(93) });
    expect(records.longest?.side).toBe('discount');
    expect(records.last_end).toBe(hourAt(112));
  });

  it('has no records without bars', () => {
    expect(pegRecords([], [])).toEqual({ deepest_discount: null, highest_premium: null, longest: null, last_end: null });
  });
});

describe('pegHistoryBody', () => {
  it('keeps 90 days of hours and every day', () => {
    const body = pegHistoryBody({ bars: SEP_BARS, markers: [], thresholds: T, now: new Date('2026-12-22T00:00:00Z') });
    expect(body.hours.map((r) => r[0])).toEqual(SEP_BARS.filter((b) => b.hour >= '2026-09-23T00:00:00.000Z').map((b) => b.hour));
    expect(body.days.map((r) => r[0])).toEqual(['2026-09-22T00:00:00.000Z', '2026-09-23T00:00:00.000Z', '2026-09-24T00:00:00.000Z', '2026-09-25T00:00:00.000Z', '2026-09-26T00:00:00.000Z']);
    expect(body.episodes).toHaveLength(2);
  });
});

describe('pegHistoryBody markers', () => {
  it('drops markers from before the first bar, which the chart cannot draw', () => {
    // #given one marker before the bars begin and one inside them
    const early = { hour: '2023-12-05T10:00:00.000Z', kind: 'stakelink_unbonding' as const, vaults: 40, link: null };
    const inside = { hour: SEP_BARS[3]!.hour, kind: 'stakelink_unbonding' as const, vaults: 12, link: null };
    // #when the body is built
    const body = pegHistoryBody({ bars: SEP_BARS, markers: [early, inside], thresholds: T, now: new Date('2026-12-22T00:00:00Z') });
    // #then only the drawable one is kept
    expect(body.markers).toEqual([inside]);
  });
});

describe('pegMarkerHours', () => {
  const e = (ts: string, kind: PegMarkerEvent['kind'], holder: string | null, amount: string | null = null): PegMarkerEvent => ({ blockNumber: 1, ts, kind, amount, holder });

  it('sums stake.link vault unbondings and stakes by hour, leaving everyone else out', () => {
    expect(
      pegMarkerHours([
        e('2026-09-23T16:01:00.000Z', 'unbonding', 'stakelink'),
        e('2026-09-23T16:59:00.000Z', 'unbonding', 'stakelink'),
        e('2026-09-23T16:30:00.000Z', 'unbonding', 'wallet'),
        e('2026-09-26T03:10:00.000Z', 'staked', 'stakelink', '6250000000000000000000'),
        e('2026-09-26T03:20:00.000Z', 'staked', 'stakelink', '6250000000000000000000'),
      ]),
    ).toEqual([
      { hour: '2026-09-23T16:00:00.000Z', kind: 'stakelink_unbonding', vaults: 2, link: null },
      { hour: '2026-09-26T03:00:00.000Z', kind: 'stakelink_deposit', vaults: 2, link: 12_500 },
    ]);
  });
});
