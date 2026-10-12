import type { BroadcastTarget } from '@ccip-dev/core/broadcasts';
import { describe, expect, it } from 'vitest';
import { broadcastTree } from '../worker/cards/broadcast-cards';
import { MISSING_GLYPHS } from '../worker/cards/glyphs';
import type { VNode } from '../worker/h';
import { ARB, BASE, ETH, MONDAY, texts } from './fixtures/broadcast';
import { loadMoments, MOMENT_REPLAY, MOMENTS, POLL_MONDAY, TEMPO, withMoments } from './fixtures/moments';

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

  it('names only the messages when the first day moved $0', async () => {
    // #given Tempo's first 10 messages carried no value
    const free = withMoments({ arrivals: { ...MOMENTS.arrivals, chains: [{ ...MOMENTS.arrivals.chains[0]!, messages: 10, usd: 0 }] } });
    // #when
    const words = texts(await tree({ kind: 'welcome', selector: TEMPO }, free));
    // #then
    expect(words.slice(words.indexOf('First day: '), words.indexOf('Connected to '))).toEqual(['First day: ', '10 messages']);
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

const LONG_NAMES: Record<string, string> = { [BASE]: 'Ethereum Mainnet Optimism Superchain Rollup', [ARB]: 'Avalanche C-Chain', [ETH]: 'Polygon zkEVM' };
const renamed = (chains: { selector: string; display_name: string }[]) => chains.map((c) => ({ ...c, display_name: LONG_NAMES[c.selector] ?? c.display_name }));
const loadLong: typeof loadMoments = async (name) => {
  const file = (await loadMoments(name)) as never as { chains: { selector: string; display_name: string }[] };
  return name === 'replay.json' || name === 'chains.json' ? ({ ...file, chains: renamed(file.chains) } as never) : (file as never);
};
const styleOf = (card: VNode, word: string): Record<string, unknown> | null => {
  const walk = (n: unknown): Record<string, unknown> | null => {
    if (typeof n !== 'object' || n === null) return null;
    const node = n as VNode;
    const kids = ([] as unknown[]).concat(node.props?.children ?? []);
    const style = (node.props?.style ?? null) as Record<string, unknown> | null;
    if (kids.includes(word) && style?.textOverflow === 'ellipsis' && style.flexShrink !== undefined) return style;
    for (const k of kids) { const found = walk(k);
      if (found) return found; }
    return null;
  };
  return walk(card);
};

describe('long chain names', () => {
  it('never cut the spotlight name: it sizes down, then ends in an ellipsis, on its own row from the rank', async () => {
    // #when
    const card = await tree({ kind: 'spotlight', monday: MONDAY }, loadLong);
    const name = styleOf(card, 'Ethereum Mainnet Optimism Superchain Rollup');
    // #then
    expect({ size: name?.fontSize, ellipsis: name?.textOverflow, nowrap: name?.whiteSpace, width: name?.maxWidth, words: texts(card).includes('Avalanche C-Chain') }).toEqual({ size: 40, ellipsis: 'ellipsis', nowrap: 'nowrap', width: 480, words: true });
  });

  it('keeps a lane climber on one row of flexible width, its two ends shrinking around the arrow', async () => {
    // #when
    const card = await tree({ kind: 'movers', monday: MONDAY }, loadLong);
    const end = styleOf(card, 'Avalanche C-Chain');
    // #then
    expect({ size: end?.fontSize, ellipsis: end?.textOverflow, shrink: end?.flexShrink, words: texts(card).includes('Polygon zkEVM') }).toEqual({ size: 20, ellipsis: 'ellipsis', shrink: 1, words: true });
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

describe('New on CCIP card', () => {
  it("lists the week's new lanes and tokens in two columns, with the network's size in the strip", async () => {
    // #when
    const words = texts(await tree({ kind: 'roundup', monday: MONDAY }));
    // #then Tempo's lanes came on Sunday, after the Monday-to-Friday window
    expect(words.slice(words.indexOf('ccip.dev'))).toEqual([
      'ccip.dev', 'This week · Oct 5 – 9, 2026', 'NEW ON CCIP', '2 new lanes', 'Ethereum', 'Arbitrum One', 'Arbitrum One', 'Base',
      '2 new tokens', 'USDat ', 'on Ethereum', 'PST ', 'on Base', 'CCIP now runs ', '4 lanes', ' between ', '4 chains', 'Watch every lane: ', 'ccip.dev/replay',
    ]);
  });

  it('names 5 lanes and counts the rest as "+N more"', async () => {
    // #given seven new lanes on the Tuesday
    const lanes = Array.from({ length: 7 }, (_, i) => ({ key: `${ETH}>${BASE}`, day: '2026-10-06', messages: 1, usd: 7 - i }));
    // #when
    const all = texts(await tree({ kind: 'roundup', monday: MONDAY }, withMoments({ arrivals: { ...MOMENTS.arrivals, lanes, tokens: [] } })));
    const words = all.slice(all.indexOf('ccip.dev'));
    // #then
    expect({ title: words.includes('7 new lanes'), named: words.filter((w) => w === 'Ethereum').length, more: words.includes('+2 more'), tokens: words.some((w) => w.includes('token')) }).toEqual({
      title: true, named: 5, more: true, tokens: false,
    });
  });

  it('has no card for a week with nothing new', async () => {
    expect(await broadcastTree({ kind: 'roundup', monday: '2026-09-28' }, inputs)).toBeNull();
  });
});

describe('poll card', () => {
  it("shows last week's answer, each option's share with the answer gold, and how many called it, beside this week's question", async () => {
    // #when
    const card = await tree({ kind: 'poll', monday: POLL_MONDAY });
    const words = texts(card);
    // #then
    expect({ words: words.slice(words.indexOf('ccip.dev')), goldBars: JSON.stringify(card).split('"backgroundColor":"#ffcf5a"').length - 1 }).toEqual({
      words: [
        'ccip.dev', 'Prediction · Week of Oct 12, 2026', 'Last week', 'Which chain paid the most fees?', 'Base', '· $1.8K',
        'Base', '38%', 'Ethereum', '31%', 'Arbitrum One', '22%', 'Another chain', '9%', '38% of you called it',
        'This week', "Will CCIP fees beat last week's $29?", 'A', 'Up more than 10%', 'B', 'Within 10%', 'C', 'Down more than 10%',
        'Vote in the poll below · results next Monday', 'Every week: ', 'ccip.dev/history',
      ],
      goldBars: 1,
    });
  });

  it('shows the answer without shares or "called it" when last week\'s poll could not be closed', async () => {
    // #given
    const [last, current] = MOMENTS.polls;
    const unclosed = withMoments({ polls: [{ ...last!, votes: null, total_votes: null }, current!] });
    // #when
    const words = texts(await tree({ kind: 'poll', monday: POLL_MONDAY }, unclosed));
    // #then
    expect({ answer: words.includes('· $1.8K'), shares: words.filter((w) => w.endsWith('%') && !w.includes(' ')), called: words.some((w) => w.includes('called it')) }).toEqual({
      answer: true, shares: [], called: false,
    });
  });

  it('shows only this week\'s question, wider, for the first poll', async () => {
    // #given no poll was sent last week
    const first = withMoments({ polls: [MOMENTS.polls[1]!] });
    // #when
    const card = await tree({ kind: 'poll', monday: POLL_MONDAY }, first);
    // #then
    expect({ last: texts(card).includes('Last week'), wide: JSON.stringify(card).includes('"width":1096,"backgroundColor":"rgba(16,24,44,0.85)"') }).toEqual({ last: false, wide: true });
  });

  it('shows at most 4 options', async () => {
    // #given five options
    const five = withMoments({ polls: [{ ...MOMENTS.polls[1]!, options: ['a', 'b', 'c', 'd', 'e'].map((key) => ({ key, label: `Option ${key}` })) }] });
    // #when
    const words = texts(await tree({ kind: 'poll', monday: POLL_MONDAY }, five));
    // #then
    expect(words.filter((w) => w.startsWith('Option '))).toEqual(['Option a', 'Option b', 'Option c', 'Option d']);
  });

  it('draws a lane option with an arrow glyph, and has no card for a week without a poll', async () => {
    // #given this week asks about lanes
    const lanes = withMoments({ polls: [{ ...MOMENTS.polls[1]!, question_kind: 'lane', options: [{ key: `${ETH}>${BASE}`, label: 'Ethereum → Base' }, { key: 'other', label: 'Another lane' }] }] });
    // #when
    const words = texts(await tree({ kind: 'poll', monday: POLL_MONDAY }, lanes));
    // #then
    expect({ option: words.includes('Ethereum') && words.includes('Base'), arrow: words.some((w) => w.includes('→')), missing: await broadcastTree({ kind: 'poll', monday: '2026-10-19' }, inputs) }).toEqual({
      option: true, arrow: false, missing: null,
    });
  });
});

describe('moment cards', () => {
  const targets: BroadcastTarget[] = [
    { kind: 'welcome', selector: TEMPO }, { kind: 'countdown', metric: 'fees', threshold: 2.5e6 }, { kind: 'movers', monday: MONDAY }, { kind: 'spotlight', monday: MONDAY },
    { kind: 'roundup', monday: MONDAY }, { kind: 'poll', monday: POLL_MONDAY },
  ];

  it('write no glyph the card fonts lack', async () => {
    // #when
    const words = (await Promise.all(targets.map(async (t) => texts(await tree(t))))).flat();
    // #then
    expect({ words: words.length > 0, missing: words.filter((w) => MISSING_GLYPHS.test(w)) }).toEqual({ words: true, missing: [] });
  });

  it('have no card while moments.json is more than 10 minutes older than replay.json, as after its publish failed', async () => {
    // #given replay.json is from Oct 12, 00:07; moments.json from 10 minutes, then 10 minutes and a second, before it
    const atLimit = withMoments({ updated_at: '2026-10-11T23:57:00.000Z' });
    const stale = withMoments({ updated_at: '2026-10-11T23:56:59.000Z' });
    // #when
    const rendered = async (load: typeof loadMoments) => Promise.all(targets.map(async (t) => (await broadcastTree(t, { ...inputs, load })) !== null));
    // #then
    expect({ atLimit: await rendered(atLimit), stale: await rendered(stale) }).toEqual({ atLimit: targets.map(() => true), stale: targets.map(() => false) });
  });
});
