import type { DayTotals, TopFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { creLeaders, creSeries, creSparkPoints, creTotal } from '../src/lib/cre';

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

describe('creSparkPoints', () => {
  it('scales shares into the box, highest at the top', () => {
    // #given
    const points = [
      { day: 'a', messages: 0, sharePct: 0 },
      { day: 'b', messages: 1, sharePct: 2 },
    ];
    // #when
    const out = creSparkPoints(points, 100, 20);
    // #then
    expect(out).toBe('0,20 100,0');
  });
});
