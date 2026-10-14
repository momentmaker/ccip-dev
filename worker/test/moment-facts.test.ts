import type { MomentsBody } from '@ccip-dev/core/moments';
import { NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadMomentsSource, momentFacts, type MomentsSource } from '../src/broadcasts/moment-facts';
import type { Tagger } from '../src/broadcasts/tags';
import * as store from '../src/store';
import { harness, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const NAMES: Record<string, [string, string | null]> = { '1': ['Ethereum', 'ethereum'], '2': ['Base', 'base'], '3': ['BNB Chain', 'BNBCHAIN'], '4': ['Arbitrum', 'arbitrum'], '9': ['Tempo', null] };
const TAGS: Tagger = {
  chain: (s) => ({ name: NAMES[s]?.[0] ?? s, x: NAMES[s]?.[1] ?? null }),
  tokenProject: (key) => (key === '2:0xp' ? { name: 'Huma', x: 'humafinance' } : null),
  groupProject: (group) => (group === 'usdat' ? { name: 'Saturn', x: 'saturn' } : null),
};
const board = (key: string, rank: number, previous: number | null, value: number, label: string | null = null) => ({ key, label, value, rank, previous_rank: previous });
const MOMENTS: MomentsBody = {
  network: { chains: 93, lanes: 933 },
  arrivals: {
    chains: [{ selector: '9', day: '2026-10-11', number: 93, partners: ['1', '2'], messages: 38, usd: 412_500 }],
    lanes: [{ key: '1>9', day: '2026-10-11', messages: 30, usd: 400_000 }, { key: '2>3', day: '2026-10-07', messages: 3, usd: 900 }],
    tokens: [{ key: 'usdat', symbol: 'USDat', day: '2026-10-08', chains: ['1'], usd: 5_000 }, { key: '2:0xp', symbol: 'PST', day: '2026-10-06', chains: ['2'], usd: 700 }],
  },
  weeks: [
    { week: '2026-09-28', boards: { fee_chains: [board('3', 1, 1, 2_000), board('2', 2, 3, 1_500)], tokens: [board('1:0xu', 1, 1, 9e6, 'USDC')], lanes: [board('1>2', 1, 1, 5e6)] }, spotlight: null },
    {
      week: '2026-10-05',
      boards: {
        fee_chains: [board('2', 1, 2, 1_800), board('3', 2, 1, 1_600), board('4', 3, 9, 900)],
        tokens: [board('1:0xu', 1, 1, 9e6, 'USDC'), board('2:0xs', 7, null, 1e6, 'syrupUSDT')],
        lanes: [board('1>2', 1, 1, 5e6), board('4>1', 9, null, 1e5)],
      },
      spotlight: {
        selector: '2', rank: 2, messages: 3_412, previous_messages: 1_844, usd: 96.4e6, previous_usd: 68.4e6, fee_usd: 1_800, previous_fee_usd: 1_417,
        partners: ['1', '4', '3'], token: { key: '2:0xc', label: 'USDC', usd: 41.2e6 },
      },
    },
  ],
  countdowns: [{ metric: 'fees', threshold: 2.5e6, total: 2.43e6, per_day: 11_600, days_left: 7, previous: { threshold: 2e6, day: '2026-07-20' } }],
  polls: [
    {
      week: '2026-10-05', question_kind: 'fee_chain', question: 'Which chain will pay the most CCIP fees this week?', options: [{ key: '2', label: 'Base' }, { key: 'other', label: 'Another chain' }],
      answer: '2', outcome: { key: '2', label: 'Base', value: 1_800, change_pct: null }, votes: [38, 62], total_votes: 13,
    },
    { week: '2026-10-12', question_kind: 'fees_change', question: "Will CCIP fees beat last week's $8.0K?", options: [{ key: 'up', label: 'Up more than 10%' }], answer: null, outcome: null, votes: null, total_votes: null },
  ],
};
const SRC: MomentsSource = { moments: MOMENTS, tags: TAGS, today: '2026-10-10' };

describe('momentFacts', () => {
  it('welcomes a new chain with its number, first-day totals and partners as players', () => {
    expect(momentFacts(SRC, { kind: 'welcome', selector: '9' })).toEqual({
      kind: 'welcome', selector: '9', chain: { name: 'Tempo', x: null }, number: 93, day: '2026-10-11', messages: 38, usd: 412_500,
      partners: [{ name: 'Ethereum', x: 'ethereum' }, { name: 'Base', x: 'base' }],
    });
  });

  it('names the new #1, the chain it took the top spot from, and the climbers by board', () => {
    expect(momentFacts(SRC, { kind: 'movers', monday: '2026-10-05' })).toEqual({
      kind: 'movers',
      monday: '2026-10-05',
      headline: { board: 'fee_chains', name: { kind: 'chain', player: { name: 'Base', x: 'base' } }, rank: 1, gain: 1, value: 1_800 },
      newLeader: true,
      dethroned: { kind: 'chain', player: { name: 'BNB Chain', x: 'BNBCHAIN' } },
      climbers: [
        { board: 'fee_chains', name: { kind: 'chain', player: { name: 'Arbitrum', x: 'arbitrum' } }, rank: 3, gain: 6, value: 900 },
        { board: 'tokens', name: { kind: 'token', symbol: 'syrupUSDT' }, rank: 7, gain: null, value: 1e6 },
        { board: 'lanes', name: { kind: 'lane', src: { name: 'Arbitrum', x: 'arbitrum' }, dst: { name: 'Ethereum', x: 'ethereum' } }, rank: 9, gain: null, value: 1e5 },
      ],
    });
  });

  it("gives the spotlight its chain, partners and top token, and the roundup its lanes and tokens with each token's project", () => {
    // #when
    const spotlight = momentFacts(SRC, { kind: 'spotlight', monday: '2026-10-05' });
    const roundup = momentFacts(SRC, { kind: 'roundup', monday: '2026-10-05' });
    // #then
    expect({
      spotlight: spotlight?.kind === 'spotlight' ? [spotlight.chain.name, spotlight.partners.map((p) => p.name), spotlight.token] : null,
      roundup: roundup?.kind === 'roundup' ? [roundup.lanes.map((l) => `${l.src.name} → ${l.dst.name}`), roundup.tokens.map((t) => [t.symbol, t.chain.name, t.project?.x])] : null,
    }).toEqual({
      spotlight: ['Base', ['Ethereum', 'Arbitrum', 'BNB Chain'], { symbol: 'USDC', usd: 41.2e6 }],
      roundup: [['Base → BNB Chain'], [['USDat', 'Ethereum', 'saturn'], ['PST', 'Base', 'humafinance']]],
    });
  });

  it("marks a roundup posted after its week's Sunday as last week's, and one posted by that Sunday as this week's", () => {
    // #when the roundup of the week of Oct 5 posts on its Sunday, then carried to the Monday after
    const on = (today: string) => momentFacts({ ...SRC, today }, { kind: 'roundup', monday: '2026-10-05' });
    // #then
    expect([on('2026-10-11'), on('2026-10-12')].map((f) => (f?.kind === 'roundup' ? f.lastWeek : null))).toEqual([false, true]);
  });

  it("gives the poll this week's question and last week's result", () => {
    // #when
    const facts = momentFacts(SRC, { kind: 'poll', monday: '2026-10-12' });
    // #then
    expect(facts?.kind === 'poll' ? [facts.poll.question_kind, facts.last?.answer, facts.last?.votes] : null).toEqual(['fees_change', '2', [38, 62]]);
  });

  it('has no facts for a moment the data does not hold', () => {
    expect([
      momentFacts(SRC, { kind: 'welcome', selector: '1' }),
      momentFacts(SRC, { kind: 'countdown', metric: 'fees', threshold: 5e6 }),
      momentFacts(SRC, { kind: 'movers', monday: '2026-09-28' }),
      momentFacts(SRC, { kind: 'spotlight', monday: '2026-09-28' }),
      momentFacts(SRC, { kind: 'roundup', monday: '2026-09-28' }),
      momentFacts(SRC, { kind: 'poll', monday: '2026-10-19' }),
    ]).toEqual([null, null, null, null, null, null]);
  });
});

describe('loadMomentsSource', () => {
  const ETH = NETWORKS.ethereum.chainSelector;
  const BASE = NETWORKS.base.chainSelector;
  const USDAT_ETH = '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
  const USDAT_BASE = '0xa2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2';

  it("reads yesterday's moments from D1 and tags a token group's project through the entry of any of its tokens", async () => {
    // #given USDat's project entry names its Ethereum token, and the group first moved on Base
    await seedRegistry([NETWORKS.ethereum, NETWORKS.base], [
      { chainSelector: ETH, address: USDAT_ETH, symbol: 'USDat', name: 'USDat', decimals: 18, groupId: 'usdat' },
      { chainSelector: BASE, address: USDAT_BASE, symbol: 'USDat', name: 'USDat', decimals: 18, groupId: 'usdat' },
    ]);
    const totals = (day: string) => ({ day, messages: 1, token_messages: 0, usd_value: 1, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 });
    await store.replaceDaily(env.DB, totals('2026-08-03'), [{ day: '2026-08-03', dim: 'lane', key: `${ETH}>${BASE}`, messages: 1, usd_value: 1, fee_usd: null }], '2026-10-12T00:07:00.000Z');
    await store.replaceDaily(env.DB, totals('2026-10-07'), [{ day: '2026-10-07', dim: 'token', key: `${BASE}:${USDAT_BASE}`, messages: 1, usd_value: 900, fee_usd: null }], '2026-10-12T00:07:00.000Z');
    const handles = { chains: { 'ethereum-mainnet-base-1': 'base' }, tokens: [{ chain: 'ethereum-mainnet', address: USDAT_ETH, project: 'Saturn', x: 'saturn' }] };
    const { c } = harness({ now: '2026-10-12T00:07:00.000Z', handles });
    // #when
    const src = await loadMomentsSource(c);
    const facts = momentFacts(src, { kind: 'roundup', monday: '2026-10-05' });
    // #then
    expect(facts?.kind === 'roundup' ? facts.tokens : null).toEqual([{ key: 'usdat', symbol: 'USDat', chain: { name: 'Base', x: 'base' }, project: { name: 'Saturn', x: 'saturn' } }]);
  });
});
