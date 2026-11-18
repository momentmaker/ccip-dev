import { describe, expect, it } from 'vitest';
import { UpstreamSchemaError } from '../src/http';
import { barRow, fetchPegBars, PEG_PAGE_S, PEG_POOL, pegDays, STLINK_TOKEN, type PegBar } from '../src/peg';
import { fakeFetch, instantDeps, jsonResponse } from '../src/testing';

const T20 = 1_790_366_400; // 2026-09-25T20:00:00Z

describe('fetchPegBars', () => {
  it('reads hourly bars of stLINK priced in LINK from the main pool', async () => {
    const f = fakeFetch(() => jsonResponse({ chain: 'ethereum', address: PEG_POOL, data: [{ time: T20, open: 0.9916, close: 1.0254, high: 1.0272, low: 0.9913 }] }));
    const bars = await fetchPegBars(instantDeps(f), T20 - 3_600, T20);
    expect(bars).toEqual([{ hour: '2026-09-25T20:00:00.000Z', open: 0.9916, high: 1.0272, low: 0.9913, close: 1.0254 }]);
    const url = new URL(f.calls[0]!.url);
    expect(url.origin + url.pathname).toBe(`https://prices.curve.finance/v1/ohlc/ethereum/${PEG_POOL}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      main_token: STLINK_TOKEN,
      reference_token: '0x514910771af9ca656af840dff83e8264ecf986ca',
      agg_number: '1',
      agg_units: 'hour',
      start: String(T20 - 3_600),
      end: String(T20),
    });
  });

  it('answers a page without swaps or history with no bars', async () => {
    const f = fakeFetch(() => jsonResponse({ chain: 'ethereum', address: PEG_POOL, data: [] }));
    expect(await fetchPegBars(instantDeps(f), T20 - 3_600, T20)).toEqual([]);
  });

  it('drops a bar with a zero price rather than charting a 100% discount', async () => {
    const f = fakeFetch(() => jsonResponse({ data: [{ time: T20, open: 0, close: 0, high: 0, low: 0 }, { time: T20 + 3_600, open: 1, close: 1, high: 1, low: 1 }] }));
    expect((await fetchPegBars(instantDeps(f), T20, T20 + 3_600)).map((b) => b.hour)).toEqual(['2026-09-25T21:00:00.000Z']);
  });

  it('drops a bar with any price outside 0.5 to 1.5, so one bogus wick is not kept as a record', async () => {
    const f = fakeFetch(() => jsonResponse({ data: [{ time: T20, open: 1, close: 1, high: 3.2, low: 1 }, { time: T20 + 3_600, open: 1, close: 1, high: 1, low: 0.2 }, { time: T20 + 7_200, open: 1, close: 1, high: 1.01, low: 0.99 }] }));
    expect((await fetchPegBars(instantDeps(f), T20, T20 + 7_200)).map((b) => b.hour)).toEqual(['2026-09-25T22:00:00.000Z']);
  });

  it('refuses a page longer than one request holds, without calling the API', async () => {
    const f = fakeFetch(() => jsonResponse({ data: [] }));
    await expect(fetchPegBars(instantDeps(f), 0, PEG_PAGE_S + 1)).rejects.toThrow(/over the 777600s/);
    expect(f.calls).toHaveLength(0);
  });

  it('fails loudly on an unexpected shape', async () => {
    const f = fakeFetch(() => jsonResponse({ detail: 'Too big aggregation window for this units' }));
    await expect(fetchPegBars(instantDeps(f), T20 - 3_600, T20)).rejects.toBeInstanceOf(UpstreamSchemaError);
  });
});

describe('pegDays', () => {
  const bar = (hour: string, open: number, high: number, low: number, close: number): PegBar => ({ hour, open, high, low, close });

  it('folds hours into UTC days: first open, highest high, lowest low, last close', () => {
    const days = pegDays([
      bar('2026-09-25T22:00:00.000Z', 1.04, 1.0564, 1.0414, 1.0564),
      bar('2026-09-25T23:00:00.000Z', 1.0564, 1.0559, 1.0186, 1.0186),
      bar('2026-09-26T00:00:00.000Z', 1.0186, 1.0189, 1.0029, 1.0029),
    ]);
    expect(days.map(barRow)).toEqual([
      ['2026-09-25T00:00:00.000Z', 1.04, 1.0564, 1.0186, 1.0186],
      ['2026-09-26T00:00:00.000Z', 1.0186, 1.0189, 1.0029, 1.0029],
    ]);
  });

  it('has no days without hours', () => {
    expect(pegDays([])).toEqual([]);
  });
});
