import { describe, expect, it } from 'vitest';
import {
  calledShare, clip, countdownsOf, isoWeek, moversOf, parsePollRecord, pollAnswer, pollKindFor, pollQuestion, pollRecordKey, projectSpotlightPick, rankBoard, roundupOf, spotlightPick,
  spotlightPicks, voteShares, type ChainCount, type MomentsBody, type PollData,
} from '../src/moments';
import type { BoardEntry, DayTotals, MomentsWeek } from '../src/public';

const totals = (day: string, messages: number, usd: number, fee: number | null): DayTotals => ({
  day, messages, token_messages: 0, usd_value: usd, fee_usd: fee, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0, fee_link_usd: null,
});
const LAST_WEEK = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];

describe('isoWeek', () => {
  it.each([['2026-10-12', 42], ['2026-01-01', 1], ['2027-01-01', 53], ['2024-12-30', 1], ['2026-12-31', 53]])('puts %s in ISO week %i', (day, week) => {
    expect(isoWeek(day)).toBe(week);
  });
});

describe('clip', () => {
  it('keeps a text that fits and shortens a long one to the limit, ending with "…"', () => {
    // #when
    const long = clip(`${'Ethereum Mainnet Optimism Superchain '.repeat(4)}→ Base`, 100);
    // #then
    expect({ short: clip('Ethereum → Base', 100), fits: long.length <= 100, end: long.endsWith('…'), emoji: clip('🎉🎉🎉', 5) }).toEqual({
      short: 'Ethereum → Base', fits: true, end: true, emoji: '🎉🎉…',
    });
  });
});

describe('rankBoard', () => {
  it("ranks this week's top 10 and gives each its rank the week before, or null outside last week's top 10", () => {
    // #given c was #11 last week
    const previous = 'b a d e f g h i j k c'.split(' ').map((key) => ({ key }));
    const current = 'a b c'.split(' ').map((key, i) => ({ key, label: null, value: 30 - i }));
    // #when
    const board = rankBoard(current, previous);
    // #then
    expect(board.map((e) => [e.key, e.rank, e.previous_rank])).toEqual([['a', 1, 2], ['b', 2, 1], ['c', 3, null]]);
  });
});

const entry = (key: string, rank: number, previous: number | null, value = 100 - rank): BoardEntry => ({ key, label: null, value, rank, previous_rank: previous });
const week = (monday: string, boards: Partial<MomentsWeek['boards']>): MomentsWeek => ({
  week: monday,
  boards: { fee_chains: [entry('x', 1, 1)], tokens: [entry('y', 1, 1)], lanes: [entry('z', 1, 1)], ...boards },
  spotlight: null,
});
const BEFORE = week('2026-09-28', { fee_chains: [entry('bnb', 1, 1), entry('base', 2, 2)] });

describe('moversOf', () => {
  it('leads with a new #1 by fees and the chain it took the top spot from, then up to 3 climbers by places gained', () => {
    // #given Base rose from #2 to #1 by fees, Arbitrum from #9 to #3, and a token and a lane entered the top 10
    const after = week('2026-10-05', {
      fee_chains: [entry('base', 1, 2), entry('bnb', 2, 1), entry('arb', 3, 9), entry('eth', 4, 5)],
      tokens: [entry('usdc', 1, 1), entry('syrup', 7, null)],
      lanes: [entry('eth>arc', 1, 1), entry('ink>eth', 9, null)],
    });
    // #when
    const movers = moversOf([BEFORE, after], '2026-10-05');
    // #then the entrants climbed at least from #11: syrup 4 places, the lane 2
    expect({
      headline: movers?.headline.kind === 'leader' ? [movers.headline.board, movers.headline.entry.key, movers.headline.dethroned?.key] : null,
      climbers: movers?.climbers.map((c) => [c.board, c.entry.key, c.gain]),
    }).toEqual({
      headline: ['fee_chains', 'base', 'bnb'],
      climbers: [['fee_chains', 'arb', 6], ['tokens', 'syrup', null], ['lanes', 'ink>eth', null]],
    });
  });

  it('takes a new #1 on tokens when the fee board kept its leader, and leads with the top climber when no board has a new #1', () => {
    // #given
    const newToken = week('2026-10-05', { fee_chains: [entry('bnb', 1, 1)], tokens: [entry('syrup', 1, 4)] });
    const noLeader = week('2026-10-05', { fee_chains: [entry('bnb', 1, 1), entry('arb', 3, 8), entry('op', 5, 9)] });
    // #when
    const token = moversOf([BEFORE, newToken], '2026-10-05');
    const climber = moversOf([BEFORE, noLeader], '2026-10-05');
    // #then
    expect({
      token: token?.headline.kind === 'leader' ? [token.headline.board, token.headline.entry.key, token.headline.dethroned?.key] : null,
      climber: climber?.headline.kind === 'climber' ? [climber.headline.climber.entry.key, climber.headline.climber.gain] : null,
      rest: climber?.climbers.map((c) => c.entry.key),
    }).toEqual({ token: ['tokens', 'syrup', 'y'], climber: ['arb', 5], rest: ['op'] });
  });

  it('has no movers when no board has a new #1 and nothing climbed 3 places or entered the top 10', () => {
    // #given Arbitrum rose 2 places only
    const quiet = week('2026-10-05', { fee_chains: [entry('bnb', 1, 1), entry('arb', 3, 5)] });
    // #then
    expect(moversOf([BEFORE, quiet], '2026-10-05')).toBeNull();
  });

  it('names no new #1 and no climber on a board that was empty the week before', () => {
    // #given no fee data the week before, so every fee entry looks new
    const before = week('2026-09-28', { fee_chains: [] });
    const after = week('2026-10-05', { fee_chains: [entry('base', 1, null), entry('bnb', 2, null)] });
    // #then
    expect(moversOf([before, after], '2026-10-05')).toBeNull();
  });

  it('has no movers for a week whose week before is not in the file', () => {
    expect(moversOf([week('2026-10-05', { fee_chains: [entry('base', 1, 2)] })], '2026-10-05')).toBeNull();
  });
});

const chain = (selector: string, messages: number, previous: number, firstDay = '2024-01-01'): ChainCount => ({ selector, messages, previous, firstDay });

describe('spotlightPick', () => {
  it('picks the largest rise among chains with 100 messages this week and 50 the week before', () => {
    // #given C and D miss a floor, F fell, and A and B rose by the same 200%
    const chains = [chain('B', 150, 50), chain('A', 300, 100), chain('C', 99, 10), chain('D', 1_000, 40), chain('F', 120, 200)];
    // #when
    const pick = spotlightPick({ monday: '2026-10-05', chains }, new Set());
    // #then the tie goes to more messages
    expect(pick).toBe('A');
  });

  it('breaks a tie on rise and messages by selector, and skips the chains it is told to', () => {
    const chains = [chain('B', 300, 100), chain('A', 300, 100), chain('C', 200, 100)];
    expect([spotlightPick({ monday: '2026-10-05', chains }, new Set()), spotlightPick({ monday: '2026-10-05', chains }, new Set(['A']))]).toEqual(['A', 'B']);
  });

  it('leaves out a chain whose first message came after the week before began, whose partial week inflates its rise', () => {
    // #given E's first message was on Wednesday of the week before
    const chains = [chain('A', 300, 100), chain('E', 2_000, 60, '2026-09-30'), chain('G', 2_000, 60, '2026-09-28')];
    // #when
    const pick = spotlightPick({ monday: '2026-10-05', chains }, new Set());
    // #then G arrived on that week's Monday, so its week before was whole
    expect(pick).toBe('G');
  });

  it('has no pick when no chain rose', () => {
    expect(spotlightPick({ monday: '2026-10-05', chains: [chain('A', 100, 100), chain('B', 100, 150)] }, new Set())).toBeNull();
  });
});

describe('spotlightPicks', () => {
  it('skips a chain spotlighted in the 4 weeks before, counting only picks from 2026-10-05 on', () => {
    // #given the same three growers every week, A fastest, then B, then C
    const mondays = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'];
    const weeks = mondays.map((monday) => ({ monday, chains: [chain('A', 400, 100), chain('B', 300, 100), chain('C', 150, 100)] }));
    // #when
    const picks = spotlightPicks(weeks);
    // #then the picks before Oct 5 were never posted, so A is still picked on Oct 5
    expect([...picks]).toEqual([
      ['2026-09-21', 'A'], ['2026-09-28', 'A'], ['2026-10-05', 'A'], ['2026-10-12', 'B'], ['2026-10-19', 'C'], ['2026-10-26', null], ['2026-11-02', null], ['2026-11-09', 'A'],
    ]);
  });
});

describe('countdownsOf', () => {
  const FIRST = '2023-07-06';
  const days = (firstFee: number | null) => [totals(FIRST, 9_000, 2.3e9, firstFee), ...LAST_WEEK.map((d) => totals(d, 100, 1e7, 10_000))];

  it("gives each metric's next threshold, its total, the last 7 days' pace, the days left rounded up and the last milestone", () => {
    // #when
    const countdowns = countdownsOf(days(2_400_000));
    // #then
    expect(countdowns).toEqual([
      { metric: 'messages', threshold: 10_000, total: 9_700, per_day: 100, days_left: 3, previous: { threshold: 5_000, day: FIRST } },
      { metric: 'value', threshold: 2.5e9, total: 2.37e9, per_day: 1e7, days_left: 13, previous: { threshold: 1e9, day: FIRST } },
      { metric: 'fees', threshold: 2.5e6, total: 2.47e6, per_day: 10_000, days_left: 3, previous: { threshold: 1e6, day: FIRST } },
    ]);
  });

  it('counts a total sitting exactly on a threshold as past it', () => {
    // #given 9,300 + 700 = 10,000 messages
    const exact = [totals(FIRST, 9_300, 2.3e9, 2_400_000), ...LAST_WEEK.map((d) => totals(d, 100, 1e7, 10_000))];
    // #then
    expect(countdownsOf(exact)[0]).toMatchObject({ metric: 'messages', threshold: 20_000, days_left: 100 });
  });

  it('leaves fees out while fee data does not reach back to the first message, and gives nothing before 7 finalized days', () => {
    expect({ fees: countdownsOf(days(null)).map((c) => c.metric), short: countdownsOf(days(2_400_000).slice(0, 6)) }).toEqual({ fees: ['messages', 'value'], short: [] });
  });
});

describe('roundupOf', () => {
  const arrivals = (o: Partial<MomentsBody['arrivals']>): Pick<MomentsBody, 'arrivals'> => ({ arrivals: { chains: [], lanes: [], tokens: [], ...o } });

  it('lists the lanes and tokens that arrived Monday to Friday by first-day value, leaving out the lanes of chains welcomed that week', () => {
    // #given T and S first sent on Sunday and Wednesday, so their welcomes fall in the week; a lane on Saturday is next week's
    const m = arrivals({
      chains: [{ selector: 'T', day: '2026-10-04', number: 92, partners: ['1'], messages: 1, usd: 1 }, { selector: 'S', day: '2026-10-07', number: 93, partners: ['1'], messages: 1, usd: 1 }],
      lanes: [
        { key: '1>2', day: '2026-10-05', messages: 3, usd: 10 },
        { key: '2>3', day: '2026-10-09', messages: 3, usd: 900 },
        { key: '1>T', day: '2026-10-06', messages: 3, usd: 5_000 },
        { key: 'S>1', day: '2026-10-07', messages: 3, usd: 5_000 },
        { key: '3>1', day: '2026-10-10', messages: 3, usd: 9_000 },
      ],
      tokens: [{ key: 'g1', symbol: 'USDat', day: '2026-10-08', chains: ['1'], usd: 50 }, { key: '1:0xa', symbol: 'PST', day: '2026-10-05', chains: ['1'], usd: 70 }],
    });
    // #when
    const roundup = roundupOf(m, '2026-10-05');
    // #then
    expect({ lanes: roundup?.lanes.map((l) => l.key), tokens: roundup?.tokens.map((t) => t.symbol) }).toEqual({ lanes: ['2>3', '1>2'], tokens: ['PST', 'USDat'] });
  });

  it('has no roundup for a week with nothing new', () => {
    expect(roundupOf(arrivals({ lanes: [{ key: '1>2', day: '2026-10-03', messages: 1, usd: 1 }] }), '2026-10-05')).toBeNull();
  });
});

const DATA: PollData = {
  feeChains: [{ key: 'base', label: 'Base' }, { key: 'bnb', label: 'BNB Chain' }, { key: 'eth', label: 'Ethereum' }, { key: 'arb', label: 'Arbitrum' }],
  lanes: [{ key: 'eth>arc', label: 'Ethereum → Arc' }],
  feeTotal: 7_970,
};

describe('pollQuestion', () => {
  it('turns the question by ISO week: fee chains, then the fee total, then lanes', () => {
    // #when weeks 42, 43 and 44
    const polls = ['2026-10-12', '2026-10-19', '2026-10-26'].map((monday) => pollQuestion(monday, DATA));
    // #then
    expect(polls.map((p) => [p?.question_kind, p?.question, p?.options.map((o) => o.label)])).toEqual([
      ['fee_chain', 'Which chain will pay the most CCIP fees this week?', ['Base', 'BNB Chain', 'Ethereum', 'Another chain']],
      ['fees_change', "Will CCIP fees beat last week's $8.0K?", ['Up more than 10%', 'Within 10%', 'Down more than 10%']],
      ['lane', 'Which lane will move the most value this week?', ['Ethereum → Arc', 'Another lane']],
    ]);
    expect([pollKindFor('2026-10-12'), polls[0]?.options.map((o) => o.key)]).toEqual(['fee_chain', ['base', 'bnb', 'eth', 'other']]);
  });

  it('asks the next kind when last week has no data for the turn, and nothing when it has none at all', () => {
    // #given no fee chains last week, and then no data at all
    const noFees = { ...DATA, feeChains: [] };
    // #then
    expect({ next: pollQuestion('2026-10-12', noFees)?.question_kind, none: pollQuestion('2026-10-12', { feeChains: [], lanes: [], feeTotal: null }) }).toEqual({ next: 'fees_change', none: null });
  });

  it('shortens an option past 100 characters with "…"', () => {
    // #given a lane between two chains with very long names
    const label = `${'Ethereum Mainnet Optimism Superchain Rollup '.repeat(2)}→ ${'Arbitrum Nova Orbit Gaming Network '.repeat(2)}`;
    // #when
    const poll = pollQuestion('2026-10-26', { ...DATA, lanes: [{ key: 'a>b', label }] });
    // #then
    const option = poll!.options[0]!.label;
    expect({ fits: option.length <= 100, cut: option.length > 90, end: option.endsWith('…') }).toEqual({ fits: true, cut: true, end: true });
  });
});

describe('pollAnswer', () => {
  const feeChain = pollQuestion('2026-10-12', DATA)!;
  const feesChange = pollQuestion('2026-10-19', DATA)!;
  const result = (o: Partial<Parameters<typeof pollAnswer>[1]>) => ({ feeChain: null, lane: null, feeTotal: null, previousFeeTotal: null, ...o });

  it("answers with the leader's option, or with the other option when the leader was not listed", () => {
    expect([
      pollAnswer(feeChain, result({ feeChain: { key: 'base', label: 'Base', value: 1_800 } })),
      pollAnswer(feeChain, result({ feeChain: { key: 'celo', label: 'Celo', value: 2_100 } })),
    ]).toEqual([
      { answer: 'base', outcome: { key: 'base', label: 'Base', value: 1_800, change_pct: null } },
      { answer: 'other', outcome: { key: 'celo', label: 'Celo', value: 2_100, change_pct: null } },
    ]);
  });

  it('answers the fee question by the change against the week before, with exactly 10% counted as within', () => {
    // #when
    const answers = [8_800, 9_000, 7_000].map((feeTotal) => pollAnswer(feesChange, result({ feeTotal, previousFeeTotal: 8_000 })));
    // #then
    expect(answers.map((a) => [a.answer, a.outcome?.change_pct])).toEqual([['within', 10], ['up', 12.5], ['down', -12.5]]);
  });

  it('has no answer without the figures', () => {
    expect([pollAnswer(feeChain, result({})), pollAnswer(feesChange, result({ feeTotal: 10, previousFeeTotal: 0 }))]).toEqual([
      { answer: null, outcome: null }, { answer: null, outcome: null },
    ]);
  });
});

describe('calledShare', () => {
  const poll = { options: [{ key: 'a', label: 'A' }, { key: 'other', label: 'Another' }], answer: 'other', votes: [70, 30], total_votes: 10 };

  it("gives the answer's share of the votes, and nothing before the answer, without votes or with no voter", () => {
    expect([calledShare(poll), calledShare({ ...poll, answer: null }), calledShare({ ...poll, votes: null, total_votes: null }), calledShare({ ...poll, votes: [0, 0], total_votes: 0 })]).toEqual([30, null, null, null]);
  });
});

describe('voteShares', () => {
  it('gives each option its share of the votes in whole percent, and zeros without votes', () => {
    expect([voteShares([38, 31, 22, 9]), voteShares([1, 2]), voteShares([0, 0])]).toEqual([[38, 31, 22, 9], [33, 67], [0, 0]]);
  });
});

describe('parsePollRecord', () => {
  it('reads a sent poll\'s record, and reads a missing, broken or foreign row as no poll', () => {
    // #given
    const record = { chat_id: '@ccipdev', message_id: 7, question_kind: 'lane', question: 'Which lane will move the most value this week?', options: [{ key: 'other', label: 'Another lane' }] };
    // #then
    expect([
      parsePollRecord(JSON.stringify(record)), parsePollRecord(null), parsePollRecord('{'), parsePollRecord(JSON.stringify({ ...record, message_id: 'x' })), pollRecordKey('2026-10-05'),
    ]).toEqual([record, null, null, null, 'poll:2026-10-05']);
  });

  it('keeps the mark of a poll that was closed without its counts', () => {
    // #given
    const record = { chat_id: '@ccipdev', message_id: 7, question_kind: 'lane', question: 'Which lane will move the most value this week?', options: [{ key: 'other', label: 'Another lane' }], closed: 'unavailable' };
    // #then
    expect(parsePollRecord(JSON.stringify(record))?.closed).toBe('unavailable');
  });
});

describe('projectSpotlightPick', () => {
  it('picks the project that gained the most messages on the week before, with 50 or more this week', () => {
    // #then b grew more in percent, a in messages; c is under 50
    expect(projectSpotlightPick([{ key: 'a', messages: 300, previous: 100 }, { key: 'b', messages: 120, previous: 10 }, { key: 'c', messages: 49, previous: 0 }])).toBe('a');
  });

  it('picks no project that shrank or stayed flat, and none from an empty week', () => {
    // #then
    expect([projectSpotlightPick([{ key: 'a', messages: 300, previous: 300 }, { key: 'b', messages: 60, previous: 90 }]), projectSpotlightPick([])]).toEqual([null, null]);
  });

  it('breaks a tie in gain by more messages, then by key', () => {
    // #then
    expect([
      projectSpotlightPick([{ key: 'a', messages: 150, previous: 50 }, { key: 'b', messages: 300, previous: 200 }]),
      projectSpotlightPick([{ key: 'b', messages: 100, previous: 0 }, { key: 'a', messages: 100, previous: 0 }]),
    ]).toEqual(['b', 'a']);
  });
});
