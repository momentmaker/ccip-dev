import { PUBLIC_SCHEMAS, type ChainsFile, type MomentsFile, type PublicFile, type PublicFileName, type ReplayFile } from '@ccip-dev/core/public';
import { ARB, BASE, CHAINS, ETH, loadFixture, MONDAY, REPLAY } from './broadcast';

/** A chain whose first messages, on Sunday Oct 11, went to Ethereum and came from Base. */
export const TEMPO = '7281642695469137430';
/** The week the poll asks about, and the Monday it posts. */
export const POLL_MONDAY = '2026-10-12';

const envelope = { schema_version: 1 as const, updated_at: '2026-10-12T00:07:00.000Z', attribution: 'Data: Chainlink CCIP API, DefiLlama' };
const board = (key: string, rank: number, previous: number | null, value: number, label: string | null = null) => ({ key, label, value, rank, previous_rank: previous });

/** replay.json with Tempo's two first lanes on Oct 11. */
export const MOMENT_REPLAY: ReplayFile = {
  ...REPLAY,
  chains: [...REPLAY.chains, { selector: TEMPO, name: 'tempo-mainnet', display_name: 'Tempo Mainnet', first_day: '2026-10-11' }],
  lanes: [...REPLAY.lanes, [3, 0], [1, 3]],
  days: REPLAY.days.map((d) => (d.day === '2026-10-11' ? { ...d, lanes: [...d.lanes, [2, 30, 400_000], [3, 8, 12_500]] } : d)),
};

export const MOMENT_CHAINS: ChainsFile = {
  ...CHAINS,
  chains: [...CHAINS.chains, { selector: TEMPO, name: 'tempo-mainnet', display_name: 'Tempo Mainnet', family: 'EVM', chain_id: '4217', first_seen: null }],
};

/**
 * The week of Oct 5: Base took #1 by fees from Ethereum, a token and a lane entered the top 10, and Base grew fastest.
 * Tempo arrived on Oct 11; fees are 7 days from $2.5M; last week's poll was closed with 45 votes.
 */
export const MOMENTS: MomentsFile = {
  ...envelope,
  network: { chains: 4, lanes: 4 },
  arrivals: {
    chains: [{ selector: TEMPO, day: '2026-10-11', number: 4, partners: [ETH, BASE], messages: 38, usd: 412_500 }],
    lanes: [
      { key: `${ETH}>${ARB}`, day: '2026-10-06', messages: 12, usd: 90_000 },
      { key: `${ARB}>${BASE}`, day: '2026-10-08', messages: 3, usd: 2_000 },
      { key: `${TEMPO}>${ETH}`, day: '2026-10-11', messages: 30, usd: 400_000 },
      { key: `${BASE}>${TEMPO}`, day: '2026-10-11', messages: 8, usd: 12_500 },
    ],
    tokens: [
      { key: 'usdat', symbol: 'USDat', day: '2026-10-07', chains: [ETH], usd: 5_000 },
      { key: `${BASE}:0xp`, symbol: 'PST', day: '2026-10-09', chains: [BASE], usd: 700 },
    ],
    senders: [
      { key: 'project:xstocks', label: 'xStocks', x: 'xStocksFi', kind: 'protocol', inferred: false, day: '2026-10-11', first_day: '2026-10-09', rank: 1, messages: 319, total_messages: 520, chains: [ETH, BASE] },
    ],
  },
  weeks: [
    {
      week: '2026-09-28',
      boards: { fee_chains: [board(ETH, 1, 1, 1_900), board(BASE, 2, 3, 1_500), board(ARB, 3, 2, 1_100)], tokens: [board(`${BASE}:0xtok`, 1, 1, 9e6, 'syrupUSDC')], lanes: [board(`${ETH}>${BASE}`, 1, 1, 5e6)] },
      spotlight: null,
    },
    {
      week: MONDAY,
      boards: {
        fee_chains: [board(BASE, 1, 2, 1_800), board(ETH, 2, 1, 1_600), board(ARB, 3, 3, 1_000)],
        tokens: [board(`${BASE}:0xtok`, 1, 1, 8e6, 'syrupUSDC'), board(`${ARB}:0xs`, 7, null, 1e6, 'syrupUSDT')],
        lanes: [board(`${ETH}>${BASE}`, 1, 1, 4e6), board(`${ARB}>${ETH}`, 9, null, 1e5)],
      },
      spotlight: {
        selector: BASE, rank: 2, messages: 3_412, previous_messages: 1_844, usd: 96.4e6, previous_usd: 68.4e6, fee_usd: 1_800, previous_fee_usd: 1_417,
        partners: [ETH, ARB], token: { key: `${BASE}:0xtok`, label: 'USDC', usd: 41.2e6 },
      },
    },
  ],
  countdowns: [{ metric: 'fees', threshold: 2.5e6, total: 2.43e6, per_day: 11_600, days_left: 7, previous: { threshold: 2e6, day: '2026-07-20' } }],
  polls: [
    {
      week: MONDAY, question_kind: 'fee_chain', question: 'Which chain will pay the most CCIP fees this week?',
      options: [{ key: BASE, label: 'Base' }, { key: ETH, label: 'Ethereum' }, { key: ARB, label: 'Arbitrum One' }, { key: 'other', label: 'Another chain' }],
      answer: BASE, outcome: { key: BASE, label: 'Base', value: 1_800, change_pct: null }, votes: [38, 31, 22, 9], total_votes: 45,
    },
    {
      week: POLL_MONDAY, question_kind: 'fees_change', question: "Will CCIP fees beat last week's $29?",
      options: [{ key: 'up', label: 'Up more than 10%' }, { key: 'within', label: 'Within 10%' }, { key: 'down', label: 'Down more than 10%' }],
      answer: null, outcome: null, votes: null, total_votes: null,
    },
  ],
};

export const MOMENT_FILES: Record<string, unknown> = { 'moments.json': MOMENTS, 'replay.json': MOMENT_REPLAY, 'chains.json': MOMENT_CHAINS };

/** The broadcast fixtures, with moments.json and Tempo's chains.json and replay.json in place of theirs. */
export async function loadMoments<N extends PublicFileName>(name: N): Promise<PublicFile<N>> {
  return name in MOMENT_FILES ? (PUBLIC_SCHEMAS[name].parse(MOMENT_FILES[name]) as PublicFile<N>) : loadFixture(name);
}

/** loadMoments with one file's top-level fields replaced. */
export const withMoments = (patch: Partial<MomentsFile>): typeof loadMoments => async (name) => (name === 'moments.json' ? ({ ...MOMENTS, ...patch } as never) : loadMoments(name));
