import type { HistoryFile, ReserveFile, TodayFile, TopFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { cardMaxAge } from '../worker/cache';
import { cardText, dayCard, flowCard, historyCard, homeCard, recordsCard, reserveCard, sparkPoints, topCard } from '../worker/cards/content';
import { bigFontSize, sparkSvg } from '../worker/cards/frame';
import { chainNameMap } from '../src/lib/names';

const envelope = { schema_version: 1 as const, updated_at: '2026-10-07T00:00:00.000Z', attribution: 'Data: Chainlink CCIP API, DefiLlama' };
const totals = (day: string, messages: number, usd: number) => ({
  day, messages, token_messages: messages, usd_value: usd, fee_usd: null, unique_senders: 5, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null,
});
const history: HistoryFile = { ...envelope, since: '2023-07-06', days: [totals('2026-10-05', 2000, 1e6), totals('2026-10-06', 2500, 3e6)] };
const ETH = '5009297550715157269';
const BASE = '15971525489660198786';
const names = chainNameMap([{ selector: ETH, display_name: 'Ethereum Mainnet' }, { selector: BASE, display_name: 'Base Mainnet' }]);
const top: TopFile = {
  ...envelope,
  dim: 'lane',
  since: '2023-07-06',
  windows: {
    '7d': [{ key: `${ETH}>${BASE}`, messages: 10, usd: 5e6 }, { key: `${BASE}>${ETH}`, messages: 4, usd: 2e6 }, { key: `${BASE}>${BASE}`, messages: 1, usd: 1 }],
    '30d': [],
    all: [],
  },
};

describe('card content', () => {
  it('describes today', () => {
    const today = { ...envelope, day: '2026-10-07', totals: { ...totals('2026-10-07', 44, 9467), fee_link_share_pct: null }, top: { lane: [], token: [], sender: [] }, arrivals: [] } as TodayFile;
    expect(homeCard(today)).toEqual({ eyebrow: 'CCIP TODAY · UTC', big: '44', label: 'messages · $9.5K moved', date: 'Oct 7, 2026 · so far', extra: [], spark: null });
  });

  it('describes a day with its change, and nothing for a missing day', () => {
    expect(dayCard(history, '2026-10-06')).toMatchObject({ big: '2,500', date: 'Oct 6, 2026', extra: ['+25.0% messages vs the day before'] });
    expect(dayCard(history, '2026-10-05')!.extra).toEqual([]);
    expect(dayCard(history, '2026-01-01')).toBeNull();
  });

  it('describes a history range with a sparkline', () => {
    expect(historyCard(history, 'all')).toMatchObject({ eyebrow: 'CCIP · ALL TIME', big: '4,500', date: 'since 2023-07-06', spark: [2000, 2500] });
  });

  it('names the leader and the next two in a top list, with plain-text arrows', () => {
    expect(topCard(top, 'lane', '7d', names)).toEqual({
      eyebrow: 'TOP LANE · LAST 7 DAYS',
      big: 'Ethereum to Base',
      label: '$5.0M · 10 messages',
      date: '',
      extra: ['#2 Base to Ethereum · $2.0M', '#3 Base to Base · $1'],
      spark: null,
    });
    expect(topCard(top, 'lane', '30d', names)).toMatchObject({ big: '—', label: 'No data yet' });
    expect(flowCard(top, '7d', names)).toMatchObject({ eyebrow: 'BIGGEST LANE · LAST 7 DAYS', big: 'Ethereum to Base', label: '$5.0M moved' });
    expect(cardText('A → B')).toBe('A to B');
  });

  it('describes the Reserve even before the cost basis exists', () => {
    const reserve = {
      ...envelope, token: '0xl', reserve: '0xr', latest: { ts: '2026-10-07T00:00:00.000Z', link: 6_122_201.43 }, series: [{ ts: 'a', link: 1 }, { ts: 'b', link: 2 }],
      link_price_usd: 14, cost_basis: null, pace: null, weekly: [], performance: null, transfers: [], latest_transfer: null,
    } as ReserveFile;
    expect(reserveCard(reserve)).toEqual({ eyebrow: 'CHAINLINK RESERVE', big: '6,122,201 LINK', label: 'held by the Chainlink Reserve', date: 'Oct 7, 2026', extra: [], spark: [1, 2] });
  });

  it('describes the records', () => {
    expect(recordsCard(history)).toMatchObject({ eyebrow: 'CCIP RECORDS', big: '2,500 messages', label: 'busiest day · Oct 6, 2026', extra: ['Biggest day: $3.0M moved · Oct 6, 2026'] });
  });

  it('downsamples sparklines and draws them', () => {
    expect(sparkPoints(Array.from({ length: 1000 }, (_, i) => i), 100)).toHaveLength(100);
    expect(sparkPoints([1, 2], 100)).toEqual([1, 2]);
    expect(sparkSvg([0, 10], 100, 50)).toContain('d="M0.0,50.0L100.0,0.0"');
    expect(sparkSvg([5], 100, 50)).toBeNull();
  });
});

describe('bigFontSize', () => {
  it.each([
    [7, 120], [8, 96], [12, 96], [13, 72], [18, 72], [19, 56],
  ])('%i characters → %i px', (length, size) => {
    expect(bigFontSize('x'.repeat(length))).toBe(size);
  });
});

describe('cardMaxAge', () => {
  it.each([
    [{ kind: 'home' }, null, 300],
    [{ kind: 'daily' }, '2026-10-06', 600],
    [{ kind: 'day', day: '2026-10-04' }, '2026-10-06', 604_800],
    [{ kind: 'day', day: '2026-10-05' }, '2026-10-06', 600],
    [{ kind: 'day', day: '2026-10-04' }, null, 600],
    [{ kind: 'reserve' }, null, 900],
    [{ kind: 'top', dim: 'token', window: '7d' }, null, 1800],
  ] as const)('%j → %s s', (route, last, seconds) => {
    expect(cardMaxAge(route, last)).toBe(seconds);
  });
});
