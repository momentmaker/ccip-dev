import type { DayTotals, TopFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { creBand, creBars, creLeaders, creMonthTotals, creSeries, creStats, creSummary, creTip, creTotal, hasCreReplay } from '../src/lib/cre';

const day = (d: string, messages: number, cre: number): DayTotals =>
  ({ day: d, messages, token_messages: 0, usd_value: 0, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0, fee_link_usd: null, cre_messages: cre, cre_usd: 0 }) as DayTotals;

describe('creSeries', () => {
  it("gives each day's CRE share of messages, and 0 for days before CRE tagging", () => {
    // #given
    const days = [day('2026-11-01', 100, 2), { ...day('2026-11-02', 50, 0), cre_messages: undefined } as DayTotals];
    // #when
    const series = creSeries(days);
    // #then
    expect(series).toEqual([
      { day: '2026-11-01', messages: 2, sharePct: 2 },
      { day: '2026-11-02', messages: 0, sharePct: 0 },
    ]);
  });
});

describe('creBand', () => {
  it('hides the band when the history has no CRE messages', () => {
    // #given
    const days = [day('2026-11-01', 100, 0), day('2026-11-02', 50, 0)];
    // #when
    const band = creBand(days);
    // #then
    expect(band).toBeNull();
  });

  it('hides the band for an empty history', () => {
    // #when
    const band = creBand([]);
    // #then
    expect(band).toBeNull();
  });

  it('shows the band, its latest point being the last finalized day, when any day has CRE messages', () => {
    // #given
    const days = [day('2026-11-01', 100, 2), day('2026-11-02', 50, 0)];
    // #when
    const band = creBand(days);
    // #then
    expect(band?.latest).toEqual({ day: '2026-11-02', messages: 0, sharePct: 0 });
  });
});

describe('creTotal', () => {
  it('sums every day', () => {
    // #given
    const days = [day('a', 1, 2), day('b', 1, 3)];
    // #when
    const total = creTotal(days);
    // #then
    expect(total).toBe(5);
  });
});

describe('creLeaders', () => {
  it('names identities, linking only projects that have a page', () => {
    // #given
    const top = {
      identities: {
        '30d': [
          { key: 'project:re', label: 'Re', messages: 750, usd: 0 },
          { key: 'project:gone', label: 'Gone', messages: 3, usd: 0 },
          { key: 'address:0x00000000000000000000000000000000000000a1', label: null, messages: 2, usd: 0 },
        ],
        '7d': [],
        all: [],
      },
    } as unknown as TopFile;
    // #when
    const leaders = creLeaders(top, new Set(['re']));
    // #then
    expect(leaders).toEqual([
      { name: 'Re', slug: 're', messages: 750 },
      { name: 'Gone', slug: null, messages: 3 },
      { name: '0x0000…00a1', slug: null, messages: 2 },
    ]);
  });

  it('is empty without the file', () => {
    // #when
    const leaders = creLeaders(null, new Set());
    // #then
    expect(leaders).toEqual([]);
  });
});

const run = (start: string, counts: readonly number[], messages = 100): DayTotals[] =>
  counts.map((c, i) => day(new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), messages, c));

const FRAME = { width: 600, height: 200, gap: 2, monthGap: 40 };

describe('creStats', () => {
  it('totals the last 30 days against the 30 before, with the daily average and the share of all CCIP', () => {
    // #given
    const days = [...run('2026-09-06', Array<number>(30).fill(10)), ...run('2026-10-06', Array<number>(30).fill(15))];
    // #when
    const stats = creStats(days);
    // #then
    expect(stats).toMatchObject({ total: 450, prior: 300, changePct: 50, perDay: 15, sharePct: 15 });
    expect(stats.line).toBe('Last 30 days: 450 messages · ▲ 50% vs the 30 before · ~15 a day · 15% of all CCIP');
  });

  it('shows a drop with a down arrow', () => {
    // #given
    const days = [...run('2026-09-06', Array<number>(30).fill(20)), ...run('2026-10-06', Array<number>(30).fill(10))];
    // #when
    const stats = creStats(days);
    // #then
    expect(stats.line).toContain('▼ 50% vs the 30 before');
  });

  it('leaves out the change clause when the 30 before had no CRE messages', () => {
    // #given
    const days = [...run('2026-09-06', Array<number>(30).fill(0)), ...run('2026-10-06', Array<number>(30).fill(3))];
    // #when
    const stats = creStats(days);
    // #then
    expect(stats.changePct).toBeNull();
    expect(stats.line).toBe('Last 30 days: 90 messages · ~3 a day · 3.0% of all CCIP');
  });

  it('does not divide by zero when no messages were sent', () => {
    // #given
    const days = run('2026-10-06', Array<number>(30).fill(0), 0);
    // #when
    const stats = creStats(days);
    // #then
    expect(stats).toMatchObject({ total: 0, sharePct: 0, perDay: 0, changePct: null });
  });
});

describe('creBars', () => {
  const series = creSeries(run('2026-10-01', [0, 5, 27, 27, 3, 10]));

  it('draws one bar per day', () => {
    // #when
    const chart = creBars(series, FRAME);
    // #then
    expect(chart.bars).toHaveLength(6);
  });

  it('scales bar heights to the nice axis maximum and draws nothing for a zero day', () => {
    // #when
    const chart = creBars(series, FRAME);
    // #then
    expect(chart.max).toBe(30);
    expect(chart.bars.map((b) => b.height)).toEqual([0, 33.33, 180, 180, 20, 66.67]);
    expect(chart.bars[0]?.path).toBe('');
  });

  it('puts every bar on the baseline inside the plot, with the gap between neighbours', () => {
    // #when
    const chart = creBars(series, FRAME);
    // #then
    const [a, b] = chart.bars;
    expect(a!.x + a!.width).toBeLessThan(b!.x);
    expect(chart.bars.every((bar) => bar.x >= 0 && bar.x + bar.width <= FRAME.width)).toBe(true);
  });

  it('starts the ticks at 0 and covers the data maximum in 3 to 4 steps', () => {
    // #when
    const chart = creBars(series, FRAME);
    // #then
    expect(chart.ticks.map((t) => t.value)).toEqual([0, 10, 20, 30]);
    expect(chart.ticks[0]?.y).toBe(FRAME.height);
    expect(chart.ticks.at(-1)?.y).toBe(0);
  });

  it('picks nice ticks for small and large maxima', () => {
    // #when
    const small = creBars(creSeries(run('2026-10-01', [0, 1])), FRAME);
    const mid = creBars(creSeries(run('2026-10-01', [0, 4])), FRAME);
    const large = creBars(creSeries(run('2026-10-01', [0, 130])), FRAME);
    // #then
    expect(small.ticks.map((t) => t.value)).toEqual([0, 1]);
    expect(mid.ticks.map((t) => t.value)).toEqual([0, 2, 4]);
    expect(large.ticks.map((t) => t.value)).toEqual([0, 50, 100, 150]);
  });

  it('keeps an all-zero series from dividing by zero', () => {
    // #when
    const chart = creBars(creSeries(run('2026-10-01', [0, 0])), FRAME);
    // #then
    expect(chart.max).toBeGreaterThan(0);
    expect(chart.peak).toBeNull();
  });

  it('labels the first day of each month inside the window, at its bar', () => {
    // #given
    const long = creSeries(run('2026-08-09', Array<number>(90).fill(1)));
    // #when
    const chart = creBars(long, FRAME);
    // #then
    expect(chart.months.map((m) => m.label)).toEqual(['Sep', 'Oct', 'Nov']);
    expect(chart.months[0]?.x).toBeCloseTo((23 / 90) * FRAME.width, 1);
  });

  it('skips a month label that would sit on the previous one', () => {
    // #given
    const short = creSeries(run('2026-09-28', Array<number>(40).fill(1)));
    // #when
    const chart = creBars(short, { ...FRAME, monthGap: 500 });
    // #then
    expect(chart.months.map((m) => m.label)).toEqual(['Oct']);
  });

  it('marks the peak, the first of equal days, with its count and date', () => {
    // #when
    const chart = creBars(series, FRAME);
    // #then
    expect(chart.peak).toMatchObject({ index: 2, label: '27 · Oct 3' });
  });

  it('flips the peak label left near the right edge and right near the left edge', () => {
    // #when
    const right = creBars(creSeries(run('2026-10-01', [1, 1, 1, 1, 1, 1, 1, 1, 1, 9])), FRAME);
    const left = creBars(creSeries(run('2026-10-01', [9, 1, 1, 1, 1, 1, 1, 1, 1, 1])), FRAME);
    const middle = creBars(creSeries(run('2026-10-01', [1, 1, 1, 1, 9, 1, 1, 1, 1, 1])), FRAME);
    // #then
    expect([left.peak?.anchor, middle.peak?.anchor, right.peak?.anchor]).toEqual(['start', 'middle', 'end']);
  });
});

describe('creMonthTotals', () => {
  it('sums the window by calendar month, oldest first', () => {
    // #given
    const series = creSeries(run('2026-09-29', [1, 2, 3, 4, 5]));
    // #when
    const months = creMonthTotals(series);
    // #then
    expect(months).toEqual([
      { month: 'Sep 2026', messages: 3 },
      { month: 'Oct 2026', messages: 12 },
    ]);
  });
});

describe('creSummary', () => {
  it('names the total, the peak and the latest day', () => {
    // #given
    const series = creSeries(run('2026-10-01', [0, 5, 27, 3, 14]));
    // #when
    const text = creSummary(series);
    // #then
    expect(text).toBe('CRE-sent CCIP messages per day over the last 5 days: 49 in total, peak 27 on Oct 3, 14 on Oct 5');
  });
});

describe('creTip', () => {
  it('reads the weekday, date, count and share of CCIP', () => {
    // #when
    const tip = creTip({ day: '2026-10-12', messages: 27, sharePct: 2.4 });
    // #then
    expect(tip).toBe('Mon, Oct 12 · 27 CRE messages · 2.4% of CCIP');
  });

  it('uses the singular for one message', () => {
    // #when
    const tip = creTip({ day: '2026-10-13', messages: 1, sharePct: 0.05 });
    // #then
    expect(tip).toBe('Tue, Oct 13 · 1 CRE message · <0.1% of CCIP');
  });
});

describe('hasCreReplay', () => {
  it('is true only when the replay lists CRE days', () => {
    // #given
    const withDays = { cre: [{ day: '2026-11-01', lanes: [[0, 1, 0]] as [number, number, number][] }] };
    // #when
    const results = [hasCreReplay(withDays), hasCreReplay({ cre: [] }), hasCreReplay({}), hasCreReplay(null)];
    // #then
    expect(results).toEqual([true, false, false, false]);
  });
});
