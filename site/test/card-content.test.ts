import type { HistoryFile, ReserveFile, TodayFile, TopFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { cardMaxAge } from '../worker/cache';
import { cardText, dayCard, flowCard, historyCard, homeCard, recordsCard, replayChainCard, reserveCard, sparkPoints, topCard } from '../worker/cards/content';
import { bigFontSize, CARD_H, CARD_W, cardTree, coinsClearOfBadge, SKY_W, SPARK_H, SPARK_W, SPARK_X, sparkSvg } from '../worker/cards/frame';
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
    expect(topCard(top, 'lane', '7d', 'value', names)).toEqual({
      eyebrow: 'TOP LANE · LAST 7 DAYS',
      big: 'Ethereum to Base',
      label: '$5.0M · 10 messages',
      date: '',
      extra: ['#2 Base to Ethereum · $2.0M', '#3 Base to Base · $1'],
      spark: null,
    });
    expect(topCard(top, 'lane', '30d', 'value', names)).toMatchObject({ big: '—', label: 'No data yet' });
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

  it('describes a chain replay card', () => {
    const spec = replayChainCard({ name: 'Base', since: '2023-11-03', usd: 611_000_000, messages: 123_456, partners: 31, coin: 'data:image/svg+xml;base64,AA' }, 'base');
    expect(spec).toEqual({
      eyebrow: 'BASE ON CHAINLINK CCIP',
      big: '$611.0M',
      label: 'moved · 123,456 messages · 31 chains',
      date: 'since Nov 3, 2023',
      extra: ['ccip.dev/replay/base'],
      spark: null,
      badge: 'data:image/svg+xml;base64,AA',
    });
  });

  it('says "1 chain" for a chain with a single partner', () => {
    const spec = replayChainCard({ name: 'Solo', since: '2023-11-03', usd: 5, messages: 2, partners: 1, coin: null }, 'solo');
    expect(spec.label).toBe('moved · 2 messages · 1 chain');
  });

  it('drops sky coins the badge covers and keeps touching and clear ones', () => {
    const at = (x: number, y: number) => ({ x, y, d: 20, src: 'data:image/svg+xml;base64,AA' });
    const inside = at(330, 315);
    const touching = at(320 + 76, 315);
    const clear = at(320 + 200, 315);
    expect(coinsClearOfBadge([inside, touching, clear], 320, 315, 66)).toEqual([touching, clear]);
  });

  it('caps the eyebrow and label lines short of the badge', () => {
    const render = (coin: string | null) =>
      JSON.stringify(cardTree(replayChainCard({ name: 'Base', since: '2023-11-03', usd: 1, messages: 2, partners: 3, coin }, 'base'), { skyDataUri: null, coins: [], sparkDataUri: null, sponsorLine: null }));
    const capped = '"maxWidth":718,"whiteSpace":"nowrap","overflow":"hidden","textOverflow":"ellipsis"';
    expect(render('data:image/svg+xml;base64,AA').split(capped)).toHaveLength(3);
    expect(render(null).split(capped)).toHaveLength(1);
  });

  it('names the leader by fees on a fees card', () => {
    // #given
    const feesTop: TopFile = {
      ...top,
      by_fees: { '7d': [{ key: `${BASE}>${ETH}`, messages: 4, usd: 2e6, fee_usd: 812.4 }, { key: `${ETH}>${BASE}`, messages: 10, usd: 5e6, fee_usd: 99 }], '30d': [], all: [] },
    };
    // #when, #then
    expect(topCard(feesTop, 'lane', '7d', 'fees', names)).toEqual({
      eyebrow: 'TOP LANE BY FEES · LAST 7 DAYS',
      big: 'Base to Ethereum',
      label: '$812 in fees · 4 messages',
      date: '',
      extra: ['#2 Ethereum to Base · $99'],
      spark: null,
    });
  });

  it('says there is no data yet on a fees card from a file without the fee ranking', () => {
    expect(topCard(top, 'lane', '7d', 'fees', names)).toMatchObject({ big: '—', label: 'No data yet' });
  });

  it('names a chain on a Chains card', () => {
    // #given
    const chainTop: TopFile = { ...top, dim: 'src_chain', windows: { '7d': [{ key: ETH, messages: 10, usd: 5e6 }], '30d': [], all: [] } };
    // #when, #then
    expect(topCard(chainTop, 'chain', '7d', 'value', names)).toMatchObject({ eyebrow: 'TOP CHAIN · LAST 7 DAYS', big: 'Ethereum' });
  });
});

describe('sparkline placement', () => {
  const tree = () => JSON.stringify(cardTree(replayChainCard({ name: 'Base', since: '2023-11-03', usd: 1, messages: 2, partners: 3, coin: null }, 'base'), { skyDataUri: null, coins: [], sparkDataUri: 'data:image/svg+xml;base64,AA', sponsorLine: null }));

  it('renders the sparkline at the shared size', () => {
    expect(tree()).toContain(`"width":${SPARK_W},"height":${SPARK_H}`);
  });

  it('ends before the sky starts', () => {
    expect(SPARK_X + SPARK_W).toBeLessThanOrEqual(CARD_W - SKY_W);
    expect(CARD_H).toBeGreaterThan(SPARK_H);
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
    [{ kind: 'top', dim: 'token', window: '7d', order: 'value' }, null, 1800],
  ] as const)('%j → %s s', (route, last, seconds) => {
    expect(cardMaxAge(route, last)).toBe(seconds);
  });
});
