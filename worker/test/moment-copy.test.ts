import type { Poll } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { TELEGRAM_CAPTION_MAX, X_MAX } from '../src/broadcasts/copy';
import { composeMomentCopy, handleWriter } from '../src/broadcasts/moment-copy';
import type { CountdownFacts, MoversFacts, PollFacts, RoundupFacts, SpotlightFacts, WelcomeFacts } from '../src/broadcasts/moment-facts';
import { xLength } from '../src/broadcasts/x-length';

const p = (name: string, x: string | null = null) => ({ name, x });
const long = (n: number, ch = 'N') => ch.repeat(n);
const LINKLIKE = /\b[a-z0-9-]+\.[a-z]{2,}\b/i;

const WELCOME: WelcomeFacts = {
  kind: 'welcome', selector: '9', chain: p('Tempo', 'tempo'), number: 93, day: '2026-10-11', messages: 38, usd: 412_500,
  partners: [p('Ethereum', 'ethereum'), p('Base', 'base'), p('Arbitrum', 'arbitrum')],
};
const COUNTDOWN: CountdownFacts = { kind: 'countdown', countdown: { metric: 'fees', threshold: 2.5e6, total: 2_430_000, per_day: 11_600, days_left: 7, previous: { threshold: 2e6, day: '2026-07-20' } } };
const MOVERS: MoversFacts = {
  kind: 'movers',
  monday: '2026-10-05',
  headline: { board: 'fee_chains', name: { kind: 'chain', player: p('Base', 'base') }, rank: 1, gain: 1, value: 1_800 },
  newLeader: true,
  dethroned: { kind: 'chain', player: p('BNB Chain', 'BNBCHAIN') },
  climbers: [
    { board: 'fee_chains', name: { kind: 'chain', player: p('Arbitrum', 'arbitrum') }, rank: 3, gain: 6, value: 900 },
    { board: 'tokens', name: { kind: 'token', symbol: 'syrupUSDT' }, rank: 7, gain: 9, value: 1e6 },
    { board: 'lanes', name: { kind: 'lane', src: p('Ink', 'inkonchain'), dst: p('Ethereum', 'ethereum') }, rank: 9, gain: null, value: 1e5 },
  ],
};
const SPOTLIGHT: SpotlightFacts = {
  kind: 'spotlight',
  monday: '2026-10-05',
  chain: p('Base', 'base'),
  spotlight: {
    selector: '2', rank: 2, messages: 3_412, previous_messages: 1_844, usd: 96.4e6, previous_usd: 68.4e6, fee_usd: 1_800, previous_fee_usd: 1_417,
    partners: ['1', '4', '3'], token: { key: '2:0xc', label: 'USDC', usd: 41.2e6 },
  },
  partners: [p('Ethereum', 'ethereum'), p('Arbitrum', 'arbitrum'), p('BNB Chain', 'BNBCHAIN')],
  token: { symbol: 'USDC', usd: 41.2e6 },
};
const ROUNDUP: RoundupFacts = {
  kind: 'roundup',
  monday: '2026-10-05',
  lanes: [
    { key: 'a', src: p('Ethereum', 'ethereum'), dst: p('Tempo'), usd: 9 },
    { key: 'b', src: p('Base', 'base'), dst: p('Monad'), usd: 8 },
    { key: 'c', src: p('Plasma'), dst: p('Arc'), usd: 7 },
  ],
  tokens: [
    { key: 'g', symbol: 'USDat', chain: p('Ethereum', 'ethereum'), project: p('Saturn', 'saturn') },
    { key: '1:0x', symbol: 'PST', chain: p('Base', 'base'), project: p('Huma Finance', 'humafinance') },
  ],
  network: { chains: 93, lanes: 933 },
};
const LAST: Poll = {
  week: '2026-10-05', question_kind: 'fee_chain', question: 'Which chain will pay the most CCIP fees this week?',
  options: [{ key: '2', label: 'Base' }, { key: '3', label: 'BNB Chain' }, { key: '1', label: 'Ethereum' }, { key: 'other', label: 'Another chain' }],
  answer: '2', outcome: { key: '2', label: 'Base', value: 1_800, change_pct: null }, votes: [38, 31, 22, 9], total_votes: 45,
};
const POLL: PollFacts = {
  kind: 'poll',
  monday: '2026-10-12',
  poll: {
    week: '2026-10-12', question_kind: 'fees_change', question: "Will CCIP fees beat last week's $8.0K?",
    options: [{ key: 'up', label: 'Up more than 10%' }, { key: 'within', label: 'Within 10%' }, { key: 'down', label: 'Down more than 10%' }],
    answer: null, outcome: null, votes: null, total_votes: null,
  },
  last: LAST,
};

describe('moment X posts', () => {
  it('writes the welcome, countdown, movers, spotlight and New on CCIP posts in the shape of the spec', () => {
    // #given the five moments that have an X post
    const facts = [WELCOME, COUNTDOWN, MOVERS, SPOTLIGHT, ROUNDUP];
    // #when
    const texts = facts.map((f) => composeMomentCopy(f).xText);
    // #then
    expect(texts).toEqual([
      '🎉 Welcome to #CCIP, @tempo\nChain #93 on CCIP: first message on Oct 11, with @ethereum\nFirst day: 38 messages · $412.5K moved\n@chainlink',
      '⏳ $2.5M in all-time #CCIP fees is about 7 days away\n$2.4M now, adding about $11.6K a day\n@chainlink',
      'New #1 on #CCIP: @base paid the most fees last week ($1.8K), taking the top spot from @BNBCHAIN\n' +
        'Climbers: @arbitrum ▲6 to #3 by fees · syrupUSDT ▲9 to #7 by value · Ink → Ethereum new at #9 by value\n#Chainlink $LINK',
      'Chain spotlight: @base is the fastest-growing chain on #CCIP this week\n3,412 messages (▲ 85% vs last week) · $96.4M moved · $1.8K in fees\n' +
        'Top partners: @ethereum · @arbitrum · @BNBCHAIN\n#Chainlink $LINK',
      'New on #CCIP this week\nLanes: Ethereum → Tempo · Base → Monad · Plasma → Arc\nTokens: USDat on Ethereum (@saturn) · PST on Base (@humafinance)\n' +
        'CCIP now runs 933 lanes between 93 chains',
    ]);
  });

  it('leads with the top climber when no board has a new #1, and words an entrant as new in the top 10', () => {
    // #given
    const climber: MoversFacts = { ...MOVERS, newLeader: false, dethroned: null, headline: MOVERS.climbers[2]!, climbers: [MOVERS.climbers[0]!] };
    // #when
    const text = composeMomentCopy(climber).xText;
    // #then
    expect(text).toBe('Top climber on #CCIP last week: Ink → Ethereum new at #9 by value\nAlso climbing: @arbitrum ▲6 to #3 by fees\n#Chainlink $LINK');
  });

  it('gives the poll no X text, since it has no X draft', () => {
    // #given the poll
    // #when
    const text = composeMomentCopy(POLL).xText;
    // #then
    expect(text).toBe('');
  });
});

describe('moment Telegram captions', () => {
  it('says the same in fuller sentences, with bold numbers and plain names', () => {
    // #given
    const facts = [WELCOME, COUNTDOWN, MOVERS, SPOTLIGHT, ROUNDUP];
    // #when
    const captions = facts.map((f) => composeMomentCopy(f).telegramHtml);
    // #then
    expect(captions).toEqual([
      '<b>Welcome to CCIP, Tempo</b>\nTempo is chain <b>#93</b> on CCIP. Its first message was on Sun, Oct 11, 2026.\n' +
        'First day: <b>38</b> messages and <b>$412.5K</b> moved.\nConnected to Ethereum, Base and Arbitrum.\n\n#CCIP #Chainlink $LINK',
      '<b>CCIP countdown: $2.5M in fees all time</b>\nAbout <b>7 days</b> away at the pace of the last 7 days, about <b>$11.6K</b> a day.\n' +
        '<b>$2.4M</b> so far.\nLast milestone: $2M on Mon, Jul 20, 2026.\n\n#CCIP #Chainlink $LINK',
      '<b>CCIP leaderboards · Oct 5–11</b>\nNew #1: Base paid the most fees last week (<b>$1.8K</b>), taking the top spot from BNB Chain.\n' +
        'Climbers: Arbitrum ▲6 to #3 by fees · syrupUSDT ▲9 to #7 by value · Ink → Ethereum new at #9 by value\n\n#CCIP #Chainlink $LINK',
      '<b>Chain spotlight: Base</b>\nBase is the fastest-growing chain on CCIP this week, and #2 by messages.\n' +
        '<b>3,412</b> messages (▲ 85% vs last week) · <b>$96.4M</b> moved (▲ 41%) · <b>$1.8K</b> in fees (▲ 27%)\n' +
        'Top partners: Ethereum · Arbitrum · BNB Chain\nTop token: USDC · $41.2M moved\n\n#CCIP #Chainlink $LINK',
      '<b>New on CCIP this week · Oct 5–9</b>\nNew lanes: Ethereum → Tempo · Base → Monad · Plasma → Arc\n' +
        'New tokens: USDat on Ethereum (Saturn) · PST on Base (Huma Finance)\nCCIP now runs <b>933</b> lanes between <b>93</b> chains.\n\n#CCIP',
    ]);
  });

  it("captions the poll card with last week's answer and how many called it, then this week's question", () => {
    // #given the poll with a closed poll from last week
    // #when
    const caption = composeMomentCopy(POLL).telegramHtml;
    // #then
    expect(caption).toBe("🔮 Last week: Base paid the most fees ($1.8K). 38% of you called it.\nThis week: will CCIP fees beat last week's $8.0K? Vote below.");
  });

  it('leaves out "called it" for a poll that could not be closed, and the last-week line for the first poll', () => {
    // #given last week's poll has its answer but no votes; then there was no poll last week
    const unclosed = { ...POLL, last: { ...LAST, votes: null, total_votes: null } };
    const first: PollFacts = { ...POLL, poll: { ...LAST, week: '2026-10-12', answer: null, outcome: null, votes: null, total_votes: null }, last: null };
    // #when
    const captions = [composeMomentCopy(unclosed).telegramHtml, composeMomentCopy(first).telegramHtml];
    // #then the fee-chain question drops its "this week" after "This week:"
    expect(captions).toEqual([
      "🔮 Last week: Base paid the most fees ($1.8K).\nThis week: will CCIP fees beat last week's $8.0K? Vote below.",
      '🔮 This week: which chain will pay the most CCIP fees? Vote below.',
    ]);
  });

  it('words a fee-question answer as a change, and a lane answer by value', () => {
    // #given
    const fees: Poll = { ...POLL.poll, week: '2026-10-05', answer: 'up', outcome: { key: 'fees', label: 'CCIP fees', value: 9_000, change_pct: 12.5 }, votes: [50, 25, 25], total_votes: 4 };
    const lane: Poll = { ...LAST, question_kind: 'lane', options: [{ key: '1>2', label: 'Ethereum → Base' }, { key: 'other', label: 'Another lane' }], answer: 'other', outcome: { key: '3>1', label: 'Arbitrum → Ethereum', value: 9.6e6, change_pct: null }, votes: [70, 30] };
    // #when
    const lines = [fees, lane].map((last) => composeMomentCopy({ ...POLL, last }).telegramHtml.split('\n')[0]);
    // #then
    expect(lines).toEqual(['🔮 Last week: CCIP fees rose 13% to $9.0K. 50% of you called it.', '🔮 Last week: Arbitrum → Ethereum moved the most value ($9.6M). 30% of you called it.']);
  });
});

describe('moment handles', () => {
  it('writes at most 5 handles, in the order players appear, counting the fixed ones; a repeated handle is free', () => {
    // #given one fixed @chainlink
    const name = handleWriter(1);
    // #when
    const written = ['base', 'BNBCHAIN', 'base', 'arbitrum', 'ethereum', 'optimism'].map((x) => name(p(x.toUpperCase(), x)));
    // #then
    expect(written).toEqual(['@base', '@BNBCHAIN', '@base', '@arbitrum', '@ethereum', 'OPTIMISM']);
  });

  it('names the projects past the fifth handle in New on CCIP by their names', () => {
    // #given six new tokens whose projects all have handles, and a lane
    const tokens = Array.from({ length: 6 }, (_, i) => ({ key: `t${i}`, symbol: `T${i}`, chain: p('Base', 'base'), project: p(`Project ${i}`, `project${i}`) }));
    // #when
    const text = composeMomentCopy({ ...ROUNDUP, tokens }).xText;
    // #then five tokens are named, then "+1 more"
    expect({ handles: text.match(/@\w+/g), more: text.includes('· +1 more') }).toEqual({ handles: ['@project0', '@project1', '@project2', '@project3', '@project4'], more: true });
  });
});

describe('moment fitting', () => {
  it('drops the climbers line first, then the closing hashtag line, to fit 280', () => {
    // #given long lane names among the climbers, then a long headline too
    const lane = { kind: 'lane' as const, src: p(long(80)), dst: p(long(80)) };
    const longClimbers: MoversFacts = { ...MOVERS, climbers: MOVERS.climbers.map((c) => ({ ...c, name: lane })) };
    const longHeadline: MoversFacts = { ...longClimbers, dethroned: { kind: 'chain', player: p(long(180)) } };
    // #when
    const kept = (f: MoversFacts) => composeMomentCopy(f).xText.split('\n').map((l) => l.split(':')[0]);
    // #then
    expect([kept(longClimbers), kept(longHeadline)]).toEqual([['New #1 on #CCIP', '#Chainlink $LINK'], ['New #1 on #CCIP']]);
  });

  it('names fewer lanes in New on CCIP when 5 would not fit, with "+N more" for the rest, before dropping the network line', () => {
    // #given eight new lanes between chains with long names
    const lanes = Array.from({ length: 8 }, (_, i) => ({ key: `l${i}`, src: p(`Optimism Superchain ${i}`), dst: p(`Arbitrum Nova Orbit ${i}`), usd: 8 - i }));
    // #when
    const text = composeMomentCopy({ ...ROUNDUP, lanes }).xText;
    const [, lanesLine = ''] = text.split('\n');
    // #then three lanes fit beside the tokens; the network line is the closing line, so it goes
    expect({ fits: xLength(text) <= X_MAX, lanes: lanesLine.split(' → ').length - 1, more: lanesLine.endsWith('· +5 more'), lines: text.split('\n').length }).toEqual({
      fits: true, lanes: 3, more: true, lines: 3,
    });
  });

  it('keeps every moment within 280 on X and 1,024 on Telegram with long names everywhere', () => {
    // #given 40-character names on every player and symbol, a 300-character question and a 100-character answer
    const n = (x: string | null = null) => p(long(40), x);
    const facts = [
      { ...WELCOME, chain: n('tempo'), partners: [n(), n(), n()] },
      { ...SPOTLIGHT, chain: n('base'), partners: [n(), n(), n()], token: { symbol: long(40), usd: 1 } },
      { ...ROUNDUP, lanes: ROUNDUP.lanes.map((l) => ({ ...l, src: n(), dst: n() })), tokens: ROUNDUP.tokens.map((t) => ({ ...t, symbol: long(40), chain: n() })) },
      { ...POLL, poll: { ...POLL.poll, question: long(300, 'Q') }, last: { ...LAST, outcome: { ...LAST.outcome!, label: long(100) } } },
    ];
    // #when
    const copies = facts.map((f) => composeMomentCopy(f));
    // #then
    expect(copies.every((c) => xLength(c.xText) <= X_MAX && c.telegramHtml.length <= TELEGRAM_CAPTION_MAX)).toBe(true);
  });
});

describe('moment links', () => {
  it('never turns a token symbol with an @ or a domain-like name into a mention or a link, on X or Telegram', () => {
    // #given a token symbol that tries to mention someone, and chain and project names that read as domains
    const roundup: RoundupFacts = {
      ...ROUNDUP,
      lanes: [{ key: 'x', src: p('pump.fun'), dst: p('Base', 'base'), usd: 1 }],
      tokens: [{ key: 'g', symbol: 'AIRDROP@scam', chain: p('xStocks.fi'), project: p('Ondo.finance') }],
    };
    const movers: MoversFacts = { ...MOVERS, climbers: [{ ...MOVERS.climbers[1]!, name: { kind: 'token', symbol: 'claim.io' } }] };
    const poll: PollFacts = { ...POLL, last: { ...LAST, outcome: { ...LAST.outcome!, label: 'pump.fun' } } };
    // #when
    const texts = [roundup, movers, poll].flatMap((f) => Object.values(composeMomentCopy(f)));
    // #then
    expect({
      links: texts.filter((t) => LINKLIKE.test(t)),
      mention: texts.some((t) => /@scam/.test(t)),
      neutralized: texts.some((t) => t.includes('AIRDROP@​scam')) && texts.some((t) => t.includes('pump․fun')),
    }).toEqual({ links: [], mention: false, neutralized: true });
  });
});
