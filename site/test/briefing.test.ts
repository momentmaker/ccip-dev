import type { DayTotals } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { arrivalRows, latestWeek, moveLabel, moveText, newestMedal, pollCards, rankMove, recordMedals, weekChange } from '../src/lib/briefing';
import { chainNameMap } from '../src/lib/names';
import { ARB, BASE, CHAINS, ETH, MONDAY } from './fixtures/broadcast';
import { MOMENT_CHAINS, MOMENTS, POLL_MONDAY, TEMPO } from './fixtures/moments';

const names = chainNameMap(MOMENT_CHAINS.chains);

describe('rankMove', () => {
  it('reads a climb, a drop, a repeat and an entry', () => {
    expect(moveText(rankMove(1, 2))).toBe('▲1');
    expect(moveText(rankMove(5, 3))).toBe('▼2');
    expect(moveText(rankMove(3, 3))).toBe('—');
    expect(moveText(rankMove(7, null))).toBe('NEW');
    expect(moveLabel(rankMove(5, 3))).toBe('down 2 on the week before');
  });
});

describe('latestWeek', () => {
  it('is the newest week, whatever the order', () => {
    expect(latestWeek({ weeks: [...MOMENTS.weeks].reverse() })?.week).toBe(MONDAY);
    expect(latestWeek(null)).toBeNull();
  });
});

describe('weekChange', () => {
  it('reads a percentage, a multiple from tenfold, or new', () => {
    expect(weekChange(2_100, 1_400)).toBe('+50%');
    expect(weekChange(1_200, 100)).toBe('12×');
    expect(weekChange(50, 0)).toBe('new');
  });
});

describe('arrivalRows', () => {
  it('lists chains, lanes and tokens newest first, a lane opened both ways once', () => {
    const rows = arrivalRows({ ...MOMENTS.arrivals, lanes: [...MOMENTS.arrivals.lanes, { key: `${ARB}>${ETH}`, day: '2026-10-06', messages: 1, usd: 1 }] }, names, 10);
    expect(rows.map((r) => `${r.kind}:${r.label}`)).toEqual([
      'chain:Tempo',
      'lane:Tempo → Ethereum',
      'lane:Base → Tempo',
      'token:PST',
      'lane:Arbitrum One → Base',
      'token:USDat',
      'lane:Ethereum ⇄ Arbitrum One',
    ]);
    expect(rows[0]).toMatchObject({ selectors: [TEMPO], sub: 'chain #4' });
  });

  it('keeps to the limit', () => {
    expect(arrivalRows(MOMENTS.arrivals, names, 2)).toHaveLength(2);
  });
});

describe('pollCards', () => {
  it("pairs the week's open poll with the last answered one", () => {
    const { open, last } = pollCards(MOMENTS.polls);
    expect(open?.week).toBe(POLL_MONDAY);
    expect(last?.outcome?.label).toBe('Base');
    expect(pollCards([])).toEqual({ open: null, last: null });
  });
});

describe('recordMedals', () => {
  const day = (d: string, over: Partial<DayTotals>): DayTotals => ({
    day: d, messages: 10, token_messages: 5, usd_value: 1_000, fee_usd: 10, unique_senders: 3, median_delivery_s: 600, unpriced_messages: 0, fee_link_usd: 0, ...over,
  });
  const days = [day('2026-01-01', { messages: 47_414 }), day('2026-02-01', { usd_value: 330.2e6 }), day('2026-03-01', { fee_usd: 57_347 }), day('2026-04-01', { unique_senders: 3_866 })];
  const largest = [{ message_id: '0xabc', day: '2025-08-19', src: BASE, dst: ETH, fee_usd: 9_002, symbol: 'WETH' }];

  it('shows five records as the hall reads them', () => {
    const medals = recordMedals(days, largest, chainNameMap(CHAINS.chains));
    expect(medals.map((m) => [m.key, m.value, m.day])).toEqual([
      ['busiest', '47,414', '2026-01-01'],
      ['biggest', '$330.2M', '2026-02-01'],
      ['most_fees', '$57.3K', '2026-03-01'],
      ['largest_fee', '$9.0K', '2025-08-19'],
      ['senders', '3,866', '2026-04-01'],
    ]);
    expect(medals[3]!.sub).toBe('Base → Ethereum');
    expect(newestMedal(medals)).toBe('senders');
  });
});
