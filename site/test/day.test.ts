import type { DayTotals } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { dayFeeLine, dayHighlights, dayView } from '../src/lib/day';

const row = (day: string, messages: number, usd: number, senders: number): DayTotals => ({
  day, messages, token_messages: messages, usd_value: usd, fee_usd: null, unique_senders: senders, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null,
});
const DAYS = [row('2026-10-04', 300, 3000, 30), row('2026-10-01', 100, 1000, 10), row('2026-10-03', 200, 0, 20)];

describe('dayView', () => {
  it('compares a day with the day before and the 7-day average', () => {
    const view = dayView(DAYS, '2026-10-04')!;
    expect(view.previous?.day).toBe('2026-10-03');
    expect(view.avg7).toEqual({ messages: 150, usd_value: 500, unique_senders: 15 });
    expect(view.deltas.messages).toEqual({ vsPrevious: 50, vsAvg7: 100 });
    expect(view.deltas.usd_value).toEqual({ vsPrevious: null, vsAvg7: 500 });
    expect([view.prevDay, view.nextDay]).toEqual(['2026-10-03', null]);
  });

  it('has no previous-day comparison when the calendar day before has no row', () => {
    const view = dayView(DAYS, '2026-10-03')!;
    expect(view.previous).toBeNull();
    expect(view.deltas.messages).toEqual({ vsPrevious: null, vsAvg7: 100 });
    expect([view.prevDay, view.nextDay]).toEqual(['2026-10-01', '2026-10-04']);
  });

  it('has no average for the first day and no view for a missing day', () => {
    expect(dayView(DAYS, '2026-10-01')).toMatchObject({ previous: null, avg7: null, deltas: { messages: { vsPrevious: null, vsAvg7: null } } });
    expect(dayView(DAYS, '2026-01-01')).toBeNull();
  });
});

describe('dayHighlights', () => {
  it('lists the records and milestones set that day', () => {
    expect(
      dayHighlights(
        '2026-10-05',
        [
          { key: 'busiest', title: 'Busiest day', day: '2026-10-05', value: 2487, display: '2,487 messages', note: null },
          { key: 'biggest', title: 'Biggest day', day: '2026-10-06', value: 1, display: '$1 moved', note: null },
        ],
        [{ kind: 'join', day: '2026-10-05', label: 'Base joins', threshold: null }],
      ),
    ).toEqual(['Busiest day ever: 2,487 messages', 'Base joins']);
  });
});

describe('dayFeeLine', () => {
  const fees = (fee: number | null, link: number | null): DayTotals => ({ ...row('2026-10-07', 2795, 58.6e6, 1), fee_usd: fee, fee_link_usd: link });

  it('gives the fee per message and the share paid in LINK', () => {
    expect(dayFeeLine(fees(1538.19, 5.97))).toBe('$0.55 per message · 0.4% paid in LINK');
  });

  it('leaves the LINK share out when the day has no LINK figure', () => {
    expect(dayFeeLine(fees(1538.19, null))).toBe('$0.55 per message');
  });

  it('has no line for a day without fees', () => {
    expect(dayFeeLine(fees(null, null))).toBeNull();
  });
});
