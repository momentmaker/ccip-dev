import { formatUsdDown } from '@ccip-dev/core/format';
import { monthDays, monthSummary, type MonthSummary } from '@ccip-dev/core/month';
import { describe, expect, it } from 'vitest';
import { monthCardRows, monthCut, monthReplay } from '../src/replay/director/month';
import { Show } from '../src/replay/director/show';
import { scoreFor } from '../src/replay/score/schedule';
import { odometer } from '../src/replay/story/odometer';
import { buildLayout } from '../src/sky/layout';
import { CHAINS, LARGEST_FEES, monthsHistory, monthsReplay } from './fixtures/months';

const replay = monthsReplay();
const history = monthsHistory(replay);
const data = { replay, history, largest: LARGEST_FEES };

function monthShow(month: string, length = 30): Show {
  const cut = monthCut(data, month)!;
  return new Show({ replay: cut.replay, history, stars: buildLayout(cut.replay.chains), length, focus: null, eligible: () => true, month: cut.month });
}

const name = (i: number) => CHAINS[i]!.selector;

describe('monthReplay', () => {
  it('keeps every day of the month and only the chains and lanes that moved in it, re-indexed', () => {
    // #when
    const cut = monthReplay(replay, '2026-09');
    // #then Gravity's first lane is in October, so it is left out
    expect({
      since: cut.since,
      days: cut.days.map((d) => d.day),
      chains: cut.chains.map((c) => c.selector),
      lanes: cut.lanes,
      firstDay: cut.days[0]!.lanes.map(([lane]) => lane),
    }).toEqual({
      since: '2026-09-01',
      days: monthDays('2026-09'),
      chains: [name(0), name(1), name(2), name(3), name(4)],
      lanes: [[0, 1], [1, 0], [0, 2], [2, 1], [3, 0], [4, 3]],
      firstDay: [0, 1, 2, 3],
    });
  });

  it('has empty days for a month with nothing on some days', () => {
    // #given only October's first 5 days are in the data
    const cut = monthReplay(replay, '2026-10');
    // #then
    expect({ days: cut.days.length, empty: cut.days.filter((d) => d.lanes.length === 0).length }).toEqual({ days: 31, empty: 26 });
  });
});

describe('monthCut', () => {
  it('plays a month that is over and in the data, and no other', () => {
    // #given data from 2026-07-25 to 2026-10-05
    // #then July counts from its first message on; October is not over, and June came before the data
    expect(['2026-07', '2026-08', '2026-09', '2026-10', '2026-06', '2026-13', ''].map((m) => monthCut(data, m) !== null)).toEqual([true, true, true, false, false, false, false]);
  });
});

describe('the month show', () => {
  it("covers exactly the month's days, opens on its title and ends on a 4 s finale", () => {
    // #when
    const s = monthShow('2026-09');
    // #then
    expect({
      days: s.days,
      timing: s.timing,
      hook: s.frameAt(1).hook?.title,
      first: s.frameAt(2.01).story.day,
      last: s.frameAt(25.99).story.day,
      phases: [s.frameAt(1.9).phase, s.frameAt(2).phase, s.frameAt(25.9).phase, s.frameAt(26).phase],
    }).toEqual({
      days: monthDays('2026-09'),
      timing: { hook: 2, finale: 4 },
      hook: 'CCIP · September 2026',
      first: '2026-09-01',
      last: '2026-09-30',
      phases: ['hook', 'story', 'story', 'finale'],
    });
  });

  it('lights a chain from before the month at once, and ignites one that joins in it exactly once', () => {
    // #given Ethereum and Base predate September; BNB Chain joins on 2026-09-03
    const s = monthShow('2026-09');
    const cut = monthCut(data, '2026-09')!.replay;
    const star = (sel: string) => cut.chains.findIndex((c) => c.selector === sel);
    const ringsFor = (sel: string) => Array.from({ length: 241 }, (_, i) => s.frameAt(i / 8).base.sky.rings.filter((r) => r.star === star(sel)).length);
    // #when
    const [ethereum, base, bnb] = [name(0), name(1), name(3)].map((sel) => ringsFor(sel));
    const flashAtStart = s.frameAt(2.01).base.sky.stars[star(name(0))]!.flash;
    // #then
    expect({ ethereum: Math.max(...ethereum!), base: Math.max(...base!), flash: flashAtStart, bnbRingFrames: bnb!.some((n) => n > 0) }).toEqual({ ethereum: 0, base: 0, flash: 0, bnbRingFrames: true });
  });

  it('beats only the joins, records and all-time milestones that fall in the month', () => {
    // #when
    const s = monthShow('2026-09');
    // #then Arbitrum joined and 5,000 messages passed in August, Gravity joins in October; BNB Chain's lane set a record on its first day
    expect({ cards: s.cards.map((c) => c.label), slams: s.slams.map((m) => m.label) }).toEqual({
      cards: ['BNB Chain joins', 'Record day · 256 messages', 'Record day · 952 messages', 'Mode joins'],
      slams: ['$1B moved', '10,000 messages'],
    });
  });

  it("counts the month's fees from zero up to the month's fee sum, and the value moved from zero too", () => {
    // #when
    const s = monthShow('2026-09');
    const september = history.filter((d) => d.day.startsWith('2026-09'));
    // #then
    expect({ start: s.frameAt(1).story.fees, end: s.frameAt(30).story.fees, usd: s.frameAt(30).story.usd }).toEqual({
      start: 0,
      end: september.reduce((sum, d) => sum + (d.fee_usd ?? 0), 0),
      usd: september.reduce((sum, d) => sum + d.usd_value, 0),
    });
  });

  it('ranks only the month on its leaderboard', () => {
    // #when
    const top = monthShow('2026-09').frameAt(25.99).board[0]!;
    // #then Ethereum's value is the month's, its August lanes left out
    const ethereum = replay.days
      .filter((d) => d.day.startsWith('2026-09'))
      .flatMap((d) => d.lanes)
      .filter(([lane]) => replay.lanes[lane]!.includes(0))
      .reduce((sum, [, , usd]) => sum + usd, 0);
    expect({ selector: top.selector, value: top.value }).toEqual({ selector: name(0), value: ethereum });
  });

  it('shows the end card during the finale only', () => {
    // #when
    const s = monthShow('2026-09');
    // #then
    expect({ story: s.frameAt(20).endCard, finale: s.frameAt(28).endCard }).toEqual({
      story: undefined,
      finale: monthCardRows(monthSummary('2026-09', { days: history, largest: LARGEST_FEES, replay })),
    });
  });

  it('runs the score unchanged, its swell on the finale', () => {
    // #when
    const swell = scoreFor(monthShow('2026-09')).find((e) => e.kind === 'swell');
    // #then
    expect(swell).toMatchObject({ time: 26, duration: 4 });
  });
});

describe('monthCardRows', () => {
  it("lists the month's totals, fees and LINK share, records, new chains and busiest lane", () => {
    // #when
    const rows = monthCardRows(monthSummary('2026-09', { days: history, largest: LARGEST_FEES, replay }));
    // #then
    expect(rows).toEqual([
      '7,725 messages · $940.1M moved',
      '$3.9K in fees · 40% paid in LINK',
      'Records: 952 messages · $115.6M moved · $476 in fees · $900.00 single fee',
      'New on CCIP: BNB Chain · Mode',
      'Busiest lane: Arbitrum One → Base · $195.0M',
    ]);
  });

  it('names three new chains and counts the rest', () => {
    // #given
    const names = ['A', 'B', 'C', 'D', 'E', 'F'];
    const busy = { ...monthSummary('2026-09', { days: history, largest: LARGEST_FEES, replay }), joined: names.map((name) => ({ name })) } as unknown as MonthSummary;
    // #when
    const row = monthCardRows(busy).find((r) => r.startsWith('New on CCIP'));
    // #then
    expect(row).toBe('New on CCIP: A · B · C · +3 more');
  });

  const empty = { month: '2026-06', label: 'June 2026', messages: 0, usd: 0, fees: null, linkSharePct: null, records: [], joined: [], busiestLane: null };

  it('leaves out every row with nothing to show', () => {
    expect(monthCardRows(empty)).toEqual(['0 messages · $0 moved']);
  });

  it('writes the value moved as the counter stops on it, rounded down', () => {
    // #given $1.37B, which formatUsd would round up to $1.4B
    const rows = monthCardRows({ ...empty, usd: 1_370_000_000 });
    // #then
    expect({ row: rows[0], counter: odometer(1_370_000_000).text }).toEqual({ row: '0 messages · $1.3B moved', counter: '$1.3B' });
  });

  it.each([0, 0.4, 999.99, 1_000, 1_049_999, 940_120_000, 25_349_999_999, 999_999_999_999.9, 1.2e13])('rounds %s down exactly as the counter does', (usd) => {
    expect(formatUsdDown(usd)).toBe(odometer(usd).text);
  });
});
