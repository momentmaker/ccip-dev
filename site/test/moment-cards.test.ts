import type { BroadcastTarget } from '@ccip-dev/core/broadcasts';
import { describe, expect, it } from 'vitest';
import { broadcastTree } from '../worker/cards/broadcast-cards';
import { MISSING_GLYPHS } from '../worker/cards/glyphs';
import type { VNode } from '../worker/h';
import { BASE, ETH, MONDAY, texts } from './fixtures/broadcast';
import { loadMoments, MOMENT_REPLAY, MOMENTS, TEMPO, withMoments } from './fixtures/moments';

const inputs = { load: loadMoments, icon: async (selector: string) => (selector === BASE ? 'data:image/svg+xml;base64,AAAA' : null) };
const tree = async (target: BroadcastTarget, load = loadMoments) => (await broadcastTree(target, { ...inputs, load })) as VNode;
const GOLD_RIM = 'rgba(255,207,90,0.9)';

describe('welcome card', () => {
  it("names the new chain big with its number, first message and first-day totals, gold at the hub of its first lanes", async () => {
    // #when
    const card = await tree({ kind: 'welcome', selector: TEMPO });
    // #then Tempo's sky holds only Tempo and the two chains it shared a lane with on Oct 11 (Base drawn from its icon)
    expect({ words: texts(card), gold: JSON.stringify(card).split(GOLD_RIM).length - 1 }).toEqual({
      words: [
        'T', 'E', 'Tempo', 'Ethereum', 'ccip.dev', 'New chain · Sun, Oct 11, 2026', 'WELCOME TO CCIP', 'Chain #4 on CCIP', 'Tempo',
        'First message ', 'Oct 11, 2026 ', 'with ', 'Ethereum', 'First day: ', '38 messages ', '· ', '$412.5K ', 'moved',
        'Connected to ', 'Ethereum', ' · ', 'Base', 'Every chain: ', 'ccip.dev/chains',
      ],
      gold: 1,
    });
  });

  it('has no card for a chain moments.json does not list, or whose first day replay.json lacks', async () => {
    // #given replay.json ends on Oct 10
    const stale: typeof loadMoments = async (name) => (name === 'replay.json' ? ({ ...MOMENT_REPLAY, days: MOMENT_REPLAY.days.slice(0, -1) } as never) : loadMoments(name));
    // #then
    expect([await broadcastTree({ kind: 'welcome', selector: ETH }, inputs), await broadcastTree({ kind: 'welcome', selector: TEMPO }, { ...inputs, load: stale })]).toEqual([null, null]);
  });
});

describe('countdown card', () => {
  it('shows the next milestone big, its days left at the pace, and the way there from the last one', async () => {
    // #when
    const card = await tree({ kind: 'countdown', metric: 'fees', threshold: 2.5e6 });
    // #then $2.43M is 86% of the way from $2M to $2.5M: 516 of the bar's 600 px
    expect({ words: texts(card).slice(texts(card).indexOf('ccip.dev')), bar: JSON.stringify(card).includes('"width":516,"height":18') }).toEqual({
      words: [
        'ccip.dev', 'Countdown · Mon, Oct 12, 2026', 'COUNTDOWN', 'All-time fees paid to CCIP', '$2.5M', 'About ', '7 days ', 'away at ', '$11.6K ', 'a day',
        '$2M · Jul 20', '$2.4M now', '$2.5M', 'Last milestone: ', '$2M', ' on Jul 20, 2026', 'Every record: ', 'ccip.dev/records',
      ],
      bar: true,
    });
  });

  it('starts the bar from zero before the first milestone, and has no card for a threshold moments.json does not count down to', async () => {
    // #given a first milestone with none before it
    const first = withMoments({ countdowns: [{ metric: 'messages', threshold: 1_000, total: 400, per_day: 100, days_left: 6, previous: null }] });
    // #when
    const card = await tree({ kind: 'countdown', metric: 'messages', threshold: 1_000 }, first);
    // #then
    expect({ words: texts(card).filter((w) => ['0', '400 now', '1,000', 'All-time now '].includes(w)), missing: await broadcastTree({ kind: 'countdown', metric: 'fees', threshold: 5e6 }, inputs) }).toEqual({
      words: ['1,000', '0', '400 now', '1,000', 'All-time now '],
      missing: null,
    });
  });
});

describe('movers card', () => {
  const after = (words: string[]) => words.slice(words.indexOf('ccip.dev'));

  it("names the new #1 big, the leader it took the spot from, and the climbers, with the week's top token and busiest lane in the strip", async () => {
    // #when
    const card = await tree({ kind: 'movers', monday: MONDAY });
    // #then Base is gold in the week's sky
    expect({ words: after(texts(card)), gold: JSON.stringify(card).split(GOLD_RIM).length - 1 }).toEqual({
      words: [
        'ccip.dev', 'Leaderboards · Oct 5 – 11, 2026', 'NEW #1', 'Most fees paid to CCIP this week', 'Base', '$1.8K in fees', ' · took #1 from ', 'Ethereum',
        'Climbers', '#7', 'syrupUSDT', 'by value', 'new', '#9', 'Arbitrum One', 'Ethereum', 'by value', 'new',
        'Top token: ', 'syrupUSDC', ' · ', 'Busiest lane: ', 'Ethereum', 'Base', 'Every board: ', 'ccip.dev/top/chain/7d/fees',
      ],
      gold: 1,
    });
  });

  it('leads with the top climber when no board has a new #1', async () => {
    // #given Ethereum kept #1 by fees
    const week = MOMENTS.weeks[1]!;
    const kept = withMoments({ weeks: [MOMENTS.weeks[0]!, { ...week, boards: { ...week.boards, fee_chains: [{ ...week.boards.fee_chains[1]!, rank: 1, previous_rank: 1 }] } }] });
    // #when
    const words = after(texts(await tree({ kind: 'movers', monday: MONDAY }, kept)));
    // #then
    expect(words.slice(0, 9)).toEqual(['ccip.dev', 'Leaderboards · Oct 5 – 11, 2026', 'TOP CLIMBER', 'Biggest climb by value this week', 'syrupUSDT', 'New in the top 10 at #7', ' · $1.0M moved', 'Also climbing', '#9']);
  });

  it('has no card for a week without movers, or whose Sunday replay.json lacks', async () => {
    // #given replay.json ends on Saturday, Oct 10
    const stale: typeof loadMoments = async (name) => (name === 'replay.json' ? ({ ...MOMENT_REPLAY, days: MOMENT_REPLAY.days.slice(0, -1) } as never) : loadMoments(name));
    // #then the week of Sep 28 has no week before it in the file
    expect([await broadcastTree({ kind: 'movers', monday: '2026-09-28' }, inputs), await broadcastTree({ kind: 'movers', monday: MONDAY }, { ...inputs, load: stale })]).toEqual([null, null]);
  });
});

describe('spotlight card', () => {
  it('puts the fastest grower gold at the hub, with its rank, its week against the one before, partners and top token', async () => {
    // #when
    const card = await tree({ kind: 'spotlight', monday: MONDAY });
    const words = texts(card);
    // #then 3,412 messages against 1,844 is +85%; $96.4M against $68.4M +41%; $1,800 against $1,417 +27%
    expect({ words: words.slice(words.indexOf('ccip.dev')), gold: JSON.stringify(card).split(GOLD_RIM).length - 1 }).toEqual({
      words: [
        'ccip.dev', 'Chain spotlight · Oct 5 – 11, 2026', 'FASTEST GROWER · VS LAST WEEK', 'Base', '#2 by messages',
        'Messages', '3,412', '85%', 'Value moved', '$96.4M', '41%', 'Fees', '$1.8K', '27%',
        'TOP PARTNERS', 'Ethereum', ' · ', 'Arbitrum One', 'TOP TOKEN', 'USDC ', '· $41.2M moved',
        'Fastest-growing chain on CCIP this week', 'Every chain: ', 'ccip.dev/chains',
      ],
      gold: 1,
    });
  });

  it('has no card for a week without a spotlight', async () => {
    expect(await broadcastTree({ kind: 'spotlight', monday: '2026-09-28' }, inputs)).toBeNull();
  });
});

describe('moment cards', () => {
  it('write no glyph the card fonts lack', async () => {
    // #when
    const targets: BroadcastTarget[] = [
      { kind: 'welcome', selector: TEMPO }, { kind: 'countdown', metric: 'fees', threshold: 2.5e6 }, { kind: 'movers', monday: MONDAY }, { kind: 'spotlight', monday: MONDAY },
    ];
    const words = (await Promise.all(targets.map(async (t) => texts(await tree(t))))).flat();
    // #then
    expect({ words: words.length > 0, missing: words.filter((w) => MISSING_GLYPHS.test(w)) }).toEqual({ words: true, missing: [] });
  });
});
