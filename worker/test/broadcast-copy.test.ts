import { describe, expect, it } from 'vitest';
import { composeCopy, fitLines, noLinks, TELEGRAM_CAPTION_MAX, X_MAX } from '../src/broadcasts/copy';
import type { DailyFacts, MilestoneFacts, RecordFacts, ReserveFacts, WeeklyFacts } from '../src/broadcasts/facts';
import { xLength } from '../src/broadcasts/x-length';

const p = (name: string, x: string | null = null) => ({ name, x });
const DAILY: DailyFacts = {
  kind: 'daily',
  day: '2026-10-10',
  totals: { day: '2026-10-10', messages: { value: 1313, pct: -34 }, value: { value: 17_100_000, pct: -64 }, fees: { value: 739, pct: -34 }, linkSharePct: 0.5, linkUsd: 3.7, linkAmount: 0.29 },
  leaders: {
    token: { key: 't', symbol: 'syrupUSDC', project: p('Maple', 'maplefinance'), usd: 6_100_000, sharePct: 35.67 },
    sender: { key: 's', player: p('xStocks', 'xStocksFi'), messages: 97 },
    lane: { key: 'l', src: p('Ethereum', 'ethereum'), dst: p('Arc', 'arc'), usd: 5_200_000, messages: 400, feeUsd: 10 },
  },
  feeChain: { key: 'c', player: p('Base', 'base'), feeUsd: 412 },
  records: [],
};
const WEEKLY: WeeklyFacts = {
  kind: 'weekly',
  monday: '2026-10-05',
  totals: {
    monday: '2026-10-05', sunday: '2026-10-11', messages: { value: 14_103, pct: 5 }, value: { value: 334e6, pct: 17 }, fees: { value: 7_970, pct: 6 },
    linkSharePct: 0.5, linkUsd: 41, linkAmount: 3.2, feesByDay: [1, 2, 3, 4, 5, 6, 7],
  },
  leaders: DAILY.leaders,
  feeChains: [{ key: 'b', player: p('Base', 'base'), feeUsd: 1_800 }, { key: 'n', player: p('BNB Chain', 'BNBCHAIN'), feeUsd: 1_600 }, { key: 'e', player: p('Ethereum'), feeUsd: 1_000 }],
};
const RECORD: RecordFacts = {
  kind: 'record',
  record: { kind: 'fees', day: '2026-07-09', value: 57_300, previous: { day: '2026-03-01', value: 47_800 }, stoodDays: 130 },
  driver: { lane: 'a>b', messages: 5_712, usd: 9e6, feeUsd: 50_000, symbol: null },
  route: { src: p('ADI', 'ADIChain'), dst: p('Ethereum', 'ethereum') },
  allTime: 2_140_000,
};
const MILESTONE: MilestoneFacts = { kind: 'milestone', milestone: { metric: 'fees', threshold: 2_500_000, day: '2026-10-10', label: '$2.5M in fees' }, allTime: 2_510_000 };
const RESERVE: ReserveFacts = {
  kind: 'reserve',
  deposit: {
    tx: `0x${'ab'.repeat(32)}`, ts: '2026-10-08T15:35:00.000Z', link: 82_480, usdAtDeposit: 1_030_000, usdNow: 1_100_000, changePct: 6.9, balanceLink: 6_200_000,
    depositCount: 94, streak: 62, avgWeeklyLink: 85_687, avgWeeklyUsd: 1_080_000, nextMilestone: { link: 7_000_000, eta: '2026-12-16' }, weeks: [],
  },
};
const withLeaders = (leaders: Partial<DailyFacts['leaders']>): DailyFacts => ({ ...DAILY, leaders: { ...DAILY.leaders, ...leaders } });
const long = (n: number, ch = 'N') => ch.repeat(n);
const LINKLIKE = /\b[a-z0-9-]+\.[a-z]{2,}\b/i;

describe('xLength', () => {
  it.each([
    ['hello', 5], ['🚨', 2], ['👨‍👩‍👧', 2], ['🇺🇸', 2], ['❤️', 2], ['日本', 4], ['USD₮0', 6], ['→', 2], ['·', 1], ['—', 1], ['café', 4],
  ])('counts %j as %i, as X does', (text, length) => {
    expect(xLength(text)).toBe(length);
  });
});

describe('X posts', () => {
  it('writes the daily post in the shape of the spec', () => {
    expect(composeCopy(DAILY).xText).toBe(
      [
        '#CCIP · Sat, Oct 10',
        '1,313 messages · $17.1M moved',
        '$739 in fees · 0.5% paid in $LINK',
        'Top token: $syrupUSDC @maplefinance · $6.1M (36%)',
        'Top sender: @xStocksFi · 97 messages',
        'Busiest lane: @ethereum → @arc · $5.2M',
        '#Chainlink',
      ].join('\n'),
    );
  });

  it('writes the weekly post with changes and the top fee chains, dropping the busiest lane first to fit', () => {
    // #when
    const text = composeCopy(WEEKLY).xText;
    // #then
    expect({ text, length: xLength(text) }).toEqual({
      text: [
        '#CCIP this week · Oct 5–11',
        '14,103 messages ▲ 5.0% · $334.0M moved ▲ 17%',
        '$8.0K in fees ▲ 6.0% · 0.5% paid in $LINK',
        'Top token: $syrupUSDC @maplefinance · $6.1M (36%)',
        'Top sender: @xStocksFi · 97 messages',
        'Top fee chains: @base · @BNBCHAIN · Ethereum',
        '#Chainlink',
      ].join('\n'),
      length: 259,
    });
  });

  it('writes the record post of the spec', () => {
    expect(composeCopy(RECORD).xText).toBe(
      [
        '🚨 New all-time high for #CCIP: $57.3K in fees in one day',
        'Previous record: $47.8K (Mar 1), held for 130 days',
        'Driven by @ADIChain → @ethereum · 5,712 messages',
        '@chainlink $LINK',
      ].join('\n'),
    );
  });

  it('writes the milestone and Reserve posts', () => {
    expect([composeCopy(MILESTONE).xText, composeCopy(RESERVE).xText]).toEqual([
      ['🏁 New milestone for #CCIP: $2.5M in fees all time', 'Reached on Sat, Oct 10', '@chainlink $LINK'].join('\n'),
      [
        'The Chainlink Reserve just added 82,480 $LINK ($1.0M)',
        'Now 6.2M LINK · 62 weekly deposits in a row · on pace for 7M around Dec 16',
        '@chainlink #CCIP',
      ].join('\n'),
    ]);
  });

  it('drops the busiest lane, then the top sender, then the top token until the post fits 280', () => {
    // #given ever longer plain names
    const lane = { ...DAILY.leaders.lane!, src: p(long(60)), dst: p(long(60)) };
    const sender = { key: 's', player: p(long(120)), messages: 97 };
    const token = { ...DAILY.leaders.token!, symbol: long(200, 'T') };
    // #when
    const first = composeCopy(withLeaders({ lane })).xText;
    const second = composeCopy(withLeaders({ lane, sender })).xText;
    const third = composeCopy(withLeaders({ lane, sender, token })).xText;
    const kept = (text: string) => text.split('\n').map((l) => l.split(':')[0]);
    // #then the headline lines and the closing hashtag stay
    expect({ first: kept(first), second: kept(second), third, lengths: [first, second, third].map(xLength).every((n) => n <= X_MAX) }).toEqual({
      first: ['#CCIP · Sat, Oct 10', '1,313 messages · $17.1M moved', '$739 in fees · 0.5% paid in $LINK', 'Top token', 'Top sender', '#Chainlink'],
      second: ['#CCIP · Sat, Oct 10', '1,313 messages · $17.1M moved', '$739 in fees · 0.5% paid in $LINK', 'Top token', '#Chainlink'],
      third: '#CCIP · Sat, Oct 10\n1,313 messages · $17.1M moved\n$739 in fees · 0.5% paid in $LINK\n#Chainlink',
      lengths: true,
    });
  });

  it('drops the closing hashtag last, and refuses a post whose headline alone is too long', () => {
    // #given
    const fits = (t: string) => xLength(t) <= X_MAX;
    // #then
    expect(fitLines([{ text: long(275, 'H') }, { text: '#Chainlink', drop: 5 }], fits)).toBe(long(275, 'H'));
    expect(() => fitLines([{ text: long(300, 'H') }], fits)).toThrow('does not fit');
  });
});

describe('links', () => {
  it('never writes a domain-looking name as a link, on X or Telegram', () => {
    // #given a sender, a token and a project whose names read as domains
    const facts = withLeaders({
      sender: { key: 's', player: p('pump.fun'), messages: 97 },
      token: { ...DAILY.leaders.token!, symbol: 'xStocks.fi', project: p('Ondo.finance') },
    });
    // #when
    const { xText, telegramHtml } = composeCopy(facts);
    // #then
    expect({ x: LINKLIKE.test(xText), tg: LINKLIKE.test(telegramHtml), shown: xText.includes('pump\u2024fun') && telegramHtml.includes('xStocks\u2024fi') }).toEqual({ x: false, tg: false, shown: true });
  });

  it('keeps names without a domain as they are', () => {
    expect([noLinks('St. Louis'), noLinks('$17.1M'), noLinks('Bungee (Socket)')]).toEqual(['St. Louis', '$17.1M', 'Bungee (Socket)']);
  });
});

describe('Telegram captions', () => {
  it('words the daily report in HTML with names in place of handles', () => {
    expect(composeCopy(DAILY).telegramHtml).toBe(
      [
        '<b>CCIP daily report · Sat, Oct 10, 2026</b>',
        '1,313 messages (▼ 34% vs the 7-day average)',
        '$17.1M moved (▼ 64%)',
        '$739 in fees (▼ 34%) · 0.5% paid in LINK ($4, 0.29 LINK)',
        '',
        'Top token: syrupUSDC (Maple) · $6.1M, 36% of the value moved',
        'Top sender: xStocks · 97 messages',
        'Busiest lane: Ethereum → Arc · $5.2M',
        'Top fee chain: Base · $412 in fees',
        '',
        '#CCIP #Chainlink $LINK',
      ].join('\n'),
    );
  });

  it('escapes names, and drops lines to stay within 1,024 characters', () => {
    // #given a sender name with HTML in it, and lane names too long for a caption
    const escaped = composeCopy(withLeaders({ sender: { key: 's', player: p('A<b>&C'), messages: 1 } })).telegramHtml;
    const longLane = composeCopy(withLeaders({ lane: { ...DAILY.leaders.lane!, src: p(long(400)), dst: p(long(400)) } })).telegramHtml;
    // #then
    expect({
      escaped: escaped.includes('Top sender: A&lt;b&gt;&amp;C · 1 message'),
      length: longLane.length <= TELEGRAM_CAPTION_MAX,
      lane: longLane.includes('Busiest lane'),
      sender: longLane.includes('Top sender'),
    }).toEqual({ escaped: true, length: true, lane: false, sender: true });
  });

  it('words the record, milestone and Reserve captions', () => {
    expect([composeCopy(RECORD).telegramHtml, composeCopy(MILESTONE).telegramHtml, composeCopy(RESERVE).telegramHtml]).toEqual([
      [
        '<b>New all-time high for CCIP</b>',
        '$57.3K in fees in one day, on Thu, Jul 9, 2026',
        'Previous record: $47.8K on Sun, Mar 1, 2026, held for 130 days',
        'Driven by ADI → Ethereum · 5,712 messages',
        '',
        '#CCIP #Chainlink $LINK',
      ].join('\n'),
      ['<b>New milestone for CCIP</b>', '$2.5M in fees all time, reached on Sat, Oct 10, 2026', '', '#CCIP #Chainlink $LINK'].join('\n'),
      [
        '<b>New deposit into the Chainlink Reserve</b>',
        '+82,480 LINK · $1.0M at deposit · $1.1M today (+6.9%)',
        'Now 6.2M LINK held · 62 weekly deposits in a row',
        '4-week average: 85,687 LINK a week ($1.1M)',
        'On pace for 7M LINK around Wed, Dec 16, 2026',
        '',
        '#CCIP #Chainlink $LINK',
      ].join('\n'),
    ]);
  });
});
