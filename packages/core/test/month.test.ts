import { describe, expect, it } from 'vitest';
import {
  isMonth, isPlayableMonth, monthBounds, monthDays, monthLabel, monthlyDue, monthlySummaryKey, monthlyVideoKey, monthSummary, nextMonth, parseMonthlySummary, previousMonth,
  type MonthSource,
} from '../src/month';
import type { DayTotals, ReplayFile } from '../src/public';

const totals = (day: string, messages: number, usd: number, fee: number | null = null, link: number | null = null): DayTotals => ({
  day, messages, token_messages: 0, usd_value: usd, fee_usd: fee, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0, fee_link_usd: link,
});

describe('months', () => {
  it('knows a month, its days, its neighbours and its name', () => {
    // #when
    const known = {
      valid: ['2026-10', '2026-12', '2026-1', '2026-13', '2026-10-01', 'x'].map(isMonth),
      bounds: monthBounds('2028-02'),
      days: monthDays('2026-09').length,
      next: [nextMonth('2026-12'), nextMonth('2026-09')],
      previous: [previousMonth('2027-01'), previousMonth('2026-10')],
      label: monthLabel('2026-10'),
      key: monthlyVideoKey('2026-09'),
      summaryKey: monthlySummaryKey('2026-09'),
    };
    // #then
    expect(known).toEqual({
      valid: [true, true, false, false, false, false],
      bounds: { first: '2028-02-01', last: '2028-02-29' },
      days: 30,
      next: ['2027-01', '2026-10'],
      previous: ['2026-12', '2026-09'],
      label: 'October 2026',
      key: 'videos/monthly/2026-09.mp4',
      summaryKey: 'videos/monthly/2026-09.json',
    });
  });

  it('plays a month only once its last day is in the data and CCIP had begun by then', () => {
    // #given data from 2023-07-06 to 2026-10-11
    const data = { first: '2023-07-06', lastDay: '2026-10-11' };
    // #when
    const playable = ['2026-09', '2023-07', '2026-10', '2026-11', '2023-06', '2026-13', 'soon'].map((m) => isPlayableMonth(m, data));
    const noData = isPlayableMonth('2026-09', { first: null, lastDay: null });
    // #then September is over, October is not, and June 2023 came before the first message
    expect({ playable, noData }).toEqual({ playable: [true, true, false, false, false, false, false], noData: false });
  });

  it("is due on the 1st to the 3rd for the month before, and not after", () => {
    // #given
    const times = ['2026-10-01T00:30:00Z', '2026-10-03T23:59:00Z', '2026-10-04T00:00:00Z', '2027-01-02T12:00:00Z', '2026-10-31T12:00:00Z'];
    // #when
    const due = times.map((iso) => monthlyDue(new Date(iso)));
    // #then
    expect(due).toEqual(['2026-09', '2026-09', null, '2026-12', null]);
  });
});

const chain = (selector: string, display: string, first: string): ReplayFile['chains'][number] => ({ selector, name: null, display_name: display, first_day: first });

const SOURCE: MonthSource = {
  days: [
    totals('2026-08-30', 100, 1e6),
    totals('2026-08-31', 120, 2e6),
    totals('2026-09-01', 150, 1.5e6, 10, 4),
    totals('2026-09-02', 110, 5e6, 20, 10),
    totals('2026-09-03', 160, 1e6, 30, 15),
    totals('2026-10-01', 300, 9e6, 5, 1),
  ],
  largest: [
    { message_id: '0x1', day: '2026-09-02', src: '1', dst: '2', fee_usd: 3, symbol: 'LINK' },
    { message_id: '0x2', day: '2026-08-31', src: '1', dst: '2', fee_usd: 1, symbol: null },
  ],
  replay: {
    chains: [chain('1', 'Ethereum Mainnet', '2026-08-30'), chain('2', 'Base Mainnet', '2026-08-30'), chain('3', 'Gravity', '2026-09-02'), chain('4', 'Tempo', '2026-10-01')],
    lanes: [[0, 1], [1, 0], [2, 0], [3, 0]],
    days: [
      { day: '2026-08-31', lanes: [[0, 120, 2e6]] },
      { day: '2026-09-01', lanes: [[0, 100, 1e6], [1, 50, 5e5]] },
      { day: '2026-09-02', lanes: [[0, 60, 4e6], [2, 50, 1e6]] },
      { day: '2026-09-03', lanes: [[2, 160, 1e6]] },
      { day: '2026-10-01', lanes: [[3, 300, 9e6]] },
    ],
  },
};

describe('monthSummary', () => {
  it("adds up the month's messages, value and fees, with the share of fees paid in LINK", () => {
    // #when
    const s = monthSummary('2026-09', SOURCE);
    // #then 29 of 60 in fees were paid in LINK
    expect({ month: s.month, label: s.label, messages: s.messages, usd: s.usd, fees: s.fees, link: s.linkSharePct?.toFixed(2) }).toEqual({
      month: '2026-09', label: 'September 2026', messages: 420, usd: 7.5e6, fees: 60, link: '48.33',
    });
  });

  it('lists the all-time records set in the month, the last one of each kind, by the record broadcasts\' rules', () => {
    // #when
    const s = monthSummary('2026-09', SOURCE);
    // #then fees' first day has nothing before it to beat, and the LINK share tied on 09-03 keeps 09-02
    expect(s.records.map((r) => [r.kind, r.day, r.value])).toEqual([
      ['messages', '2026-09-03', 160],
      ['value', '2026-09-02', 5e6],
      ['fees', '2026-09-03', 30],
      ['largest_fee', '2026-09-02', 3],
      ['link_share', '2026-09-02', 50],
    ]);
  });

  it('names the chains that joined in the month and its busiest lane by value', () => {
    // #when
    const s = monthSummary('2026-09', SOURCE);
    // #then
    expect({ joined: s.joined, lane: s.busiestLane }).toEqual({
      joined: [{ selector: '3', name: 'Gravity' }],
      lane: { key: '1>2', src: { selector: '1', name: 'Ethereum' }, dst: { selector: '2', name: 'Base' }, usd: 5e6 },
    });
  });

  it('has no fees, records, arrivals or lane for a month without them', () => {
    // #when August's two days have no fee data and set no record against nothing before them
    const s = monthSummary('2026-08', { ...SOURCE, days: SOURCE.days.slice(0, 1), largest: [] });
    // #then
    expect({ messages: s.messages, fees: s.fees, link: s.linkSharePct, records: s.records, joined: s.joined.map((c) => c.name) }).toEqual({
      messages: 100, fees: null, link: null, records: [], joined: ['Ethereum', 'Base'],
    });
    expect(monthSummary('2026-07', SOURCE).busiestLane).toBeNull();
  });

  it('skips a lane whose chain is not in the file, rather than failing the month', () => {
    // #given September's biggest lane, $50M on Sep 3, names a chain index replay.json does not have
    const replay = { ...SOURCE.replay, lanes: [...SOURCE.replay.lanes, [0, 9]] as [number, number][], days: [...SOURCE.replay.days, { day: '2026-09-03', lanes: [[4, 1, 5e7]] as [number, number, number][] }] };
    // #when
    const lane = monthSummary('2026-09', { ...SOURCE, replay }).busiestLane;
    // #then
    expect(lane?.key).toBe('1>2');
  });
});

describe('parseMonthlySummary', () => {
  it('reads back a month summary written as JSON, unchanged', () => {
    // #given September with every record kind, a new chain and a lane, and August with no fees, records or lane
    const summaries = [monthSummary('2026-09', SOURCE), monthSummary('2026-08', { ...SOURCE, days: SOURCE.days.slice(0, 1), largest: [] })];
    // #when
    const parsed = summaries.map((summary) => parseMonthlySummary(JSON.stringify({ month: summary.month, summary }), summary.month));
    // #then
    expect(parsed).toEqual(summaries.map((summary) => ({ summary })));
  });

  it('names what is wrong with a file that is not JSON, not a month summary, or for another month', () => {
    // #given
    const summary = monthSummary('2026-09', SOURCE);
    const { usd: _usd, ...noValue } = summary;
    const files = [
      'not json',
      JSON.stringify({ month: '2026-09', summary: noValue }),
      JSON.stringify({ month: '2026-09', summary: { ...summary, messages: '420' } }),
      JSON.stringify({ month: '2026-09', summary: { ...summary, records: [{ ...summary.records[0], kind: 'senders' }] } }),
      JSON.stringify({ month: '2026-08', summary }),
      JSON.stringify({ month: '2026-09', summary: { ...summary, month: '2026-08' } }),
    ];
    // #when
    const problems = files.map((text) => {
      const parsed = parseMonthlySummary(text, '2026-09');
      return 'problem' in parsed ? parsed.problem : null;
    });
    // #then
    expect(problems).toEqual([
      'is not JSON',
      'is not a month summary (summary.usd: Invalid input: expected number, received undefined)',
      'is not a month summary (summary.messages: Invalid input: expected number, received string)',
      'is not a month summary (summary.records.0.kind: Invalid option: expected one of "messages"|"value"|"fees"|"largest_fee"|"link_share")',
      'is for 2026-08, not 2026-09',
      'is for 2026-08, not 2026-09',
    ]);
  });
});
