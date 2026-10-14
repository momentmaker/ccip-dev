import { describe, expect, it } from 'vitest';
import { CostFileSchema, DayLeadersFileSchema, HistoryFileSchema, MomentsFileSchema, ProjectsFileSchema, PUBLIC_SCHEMAS, ReplayFileSchema, ReserveFileSchema, StatusFileSchema, TopFileSchema, type PublicFileName } from '../src/public';
import chains from './fixtures/public/chains.json';
import history from './fixtures/public/history.json';
import live from './fixtures/public/live.json';
import reserve from './fixtures/public/reserve.json';
import status from './fixtures/public/status.json';
import today from './fixtures/public/today.json';
import tokens from './fixtures/public/tokens.json';
import topLane from './fixtures/public/top-lane.json';
import topSender from './fixtures/public/top-sender.json';
import topToken from './fixtures/public/top-token.json';

const CAPTURED: [PublicFileName, unknown][] = [
  ['status.json', status],
  ['live.json', live],
  ['today.json', today],
  ['history.json', history],
  ['top/lane.json', topLane],
  ['top/token.json', topToken],
  ['top/sender.json', topSender],
  ['chains.json', chains],
  ['tokens.json', tokens],
  ['reserve.json', reserve],
];

const envelope = { schema_version: 1, updated_at: '2026-10-07T00:00:00.000Z', attribution: 'Data: Chainlink CCIP API, DefiLlama' };
const emptyStatus = { ...envelope, last_ingest_ok_at: null, lag_seconds: null, last_finalize_day: null, coverage_from: null };

describe('public file schemas', () => {

  it('parses projects.json and lists it among the public files', () => {
    // #given
    const window = { messages: 319, usd: 0, fee_usd: 79.75, share_pct: 20.3 };
    const doc = {
      ...envelope, from: '2026-09-14', to: '2026-10-13',
      projects: [{
        slug: 'xstocks', name: 'xStocks', x: 'xStocksFi', url: 'https://xstocks.fi', kind: 'protocol', source: null,
        totals: { '7d': window, '30d': window, all: window }, series: [{ day: '2026-10-13', messages: 319 }], chains: ['1'],
        lanes: [{ src: '1', dst: '2', messages: 2, usd: 0 }], split: { data_messages: 2, token_messages: 1 },
        addresses: [{ chain: '1', address: '0xa', note: null, inferred: true }],
      }],
    };
    // #when
    const parsed = ProjectsFileSchema.parse(doc);
    // #then
    expect({ slug: parsed.projects[0]?.slug, listed: PUBLIC_SCHEMAS['projects.json'] === ProjectsFileSchema }).toEqual({ slug: 'xstocks', listed: true });
  });
  it('reads identity fields on top entries and leaders, and still reads files without them', () => {
    // #given an identity entry, and the per-chain entry an older file holds
    const identity = { key: 'project:xstocks', label: 'xStocks', messages: 319, usd: 0, fee_usd: 79.75, x: 'xStocksFi', kind: 'protocol', inferred: false, chains: ['1', '2'], addresses: 2, share_pct: 20.3 };
    const windows = { '7d': [identity], '30d': [], all: [] };
    const file = { ...envelope, dim: 'sender', since: null, windows: { '7d': [{ key: '1:0xa', messages: 1, usd: 1, label: null }], '30d': [], all: [] }, identities: windows, identities_by_fees: windows };
    // #when
    const top = TopFileSchema.parse(file);
    const old = TopFileSchema.parse({ ...file, identities: undefined, identities_by_fees: undefined });
    const leader = DayLeadersFileSchema.parse({ ...envelope, days: [{ day: '2026-10-13', token: null, sender: identity, lane: null, fee_lane: null, fee_chain: null }], weeks: [] });
    // #then
    expect({ share: top.identities?.['7d'][0]?.share_pct, old: old.identities, chains: leader.days[0]?.sender?.chains }).toEqual({ share: 20.3, old: undefined, chains: ['1', '2'] });
  });

  it('parses day-leaders.json and lists it among the public files', () => {
    // #given a day with every leader, a day without fees, and a week
    const leader = { key: '1>2', label: null, messages: 3, usd: 10, fee_usd: 1.5 };
    const doc = {
      ...envelope,
      days: [
        { day: '2026-10-10', token: { ...leader, key: '1:0xt', label: 'USDC', fee_usd: null }, sender: leader, lane: leader, fee_lane: leader, fee_chain: { ...leader, key: '1' } },
        { day: '2026-10-11', token: null, sender: null, lane: null, fee_lane: null, fee_chain: null },
      ],
      weeks: [{ week: '2026-10-05', fee_chains: [{ ...leader, key: '1' }] }],
    };
    // #when
    const parsed = DayLeadersFileSchema.parse(doc);
    // #then
    expect({ days: parsed.days.length, token: parsed.days[0]?.token?.label, week: parsed.weeks[0]?.week, listed: PUBLIC_SCHEMAS['day-leaders.json'] === DayLeadersFileSchema }).toEqual({
      days: 2, token: 'USDC', week: '2026-10-05', listed: true,
    });
  });

  it('parses moments.json and lists it among the public files', () => {
    // #given a closed poll and this week's open one, and a week with a spotlight
    const board = { key: '1', label: null, value: 1_800, rank: 1, previous_rank: 2 };
    const doc = {
      ...envelope,
      network: { chains: 93, lanes: 933 },
      arrivals: {
        chains: [{ selector: '9', day: '2026-10-11', number: 93, partners: ['1'], messages: 38, usd: 412_500 }],
        lanes: [{ key: '1>9', day: '2026-10-11', messages: 30, usd: 400_000 }],
        tokens: [{ key: 'group-1', symbol: 'USDat', day: '2026-10-08', chains: ['1'], usd: 5_000 }, { key: '1:0xa', symbol: null, day: '2026-10-09', chains: ['1'], usd: 0 }],
      },
      weeks: [{
        week: '2026-10-05',
        boards: { fee_chains: [board], tokens: [{ ...board, key: '1:0xa', label: 'USDC' }], lanes: [] },
        spotlight: {
          selector: '1', rank: 2, messages: 3_412, previous_messages: 1_844, usd: 96.4e6, previous_usd: 68e6, fee_usd: 1_800, previous_fee_usd: null,
          partners: ['5', '4'], token: { key: '1:0xa', label: 'USDC', usd: 41.2e6 },
        },
      }],
      countdowns: [{ metric: 'fees', threshold: 2.5e6, total: 2.43e6, per_day: 11_600, days_left: 7, previous: { threshold: 2e6, day: '2026-07-20' } }],
      polls: [
        {
          week: '2026-10-05', question_kind: 'fee_chain', question: 'Which chain will pay the most CCIP fees this week?', options: [{ key: '1', label: 'Base' }, { key: 'other', label: 'Another chain' }],
          answer: '1', outcome: { key: '1', label: 'Base', value: 1_800, change_pct: null }, votes: [62, 38], total_votes: 13,
        },
        { week: '2026-10-12', question_kind: 'fees_change', question: 'Will CCIP fees beat last week’s $8.0K?', options: [{ key: 'up', label: 'Up more than 10%' }], answer: null, outcome: null, votes: null, total_votes: null },
      ],
    };
    // #when
    const parsed = MomentsFileSchema.parse(doc);
    // #then
    expect({ polls: parsed.polls.length, spotlight: parsed.weeks[0]?.spotlight?.selector, listed: PUBLIC_SCHEMAS['moments.json'] === MomentsFileSchema }).toEqual({ polls: 2, spotlight: '1', listed: true });
  });

  it('rejects a moments.json poll of an unknown kind', () => {
    const doc = { ...envelope, network: { chains: 0, lanes: 0 }, arrivals: { chains: [], lanes: [], tokens: [] }, weeks: [], countdowns: [], polls: [{ week: '2026-10-12', question_kind: 'quiz', question: 'q', options: [], answer: null, outcome: null, votes: null, total_votes: null }] };
    expect(MomentsFileSchema.safeParse(doc).success).toBe(false);
  });

  it('parses cost.json with and without the LINK and gas-token split', () => {
    // #given a route with the split and one without
    const lane = { src: '1', dst: '2', messages: 25, median_usd: 13, p10_usd: 3, p90_usd: 23 };
    const doc = {
      ...envelope, from: '2026-09-08', to: '2026-10-07',
      lanes: [{ ...lane, link: { messages: 20, median_usd: 10 }, gas: { messages: 5, median_usd: 23 } }, { ...lane, src: '3' }],
    };
    // #when
    const parsed = CostFileSchema.parse(doc);
    // #then
    expect(parsed.lanes.map((l) => [l.link?.median_usd ?? null, l.gas?.median_usd ?? null])).toEqual([[10, 23], [null, null]]);
  });

  it('lists cost.json among the public files', () => {
    expect(PUBLIC_SCHEMAS['cost.json']).toBe(CostFileSchema);
  });
  it('parses top files with and without the fee ranking', () => {
    // #given one top file from after the fee rankings and one from before
    const entry = { key: '1>2', messages: 3, usd: 10, fee_usd: 1.5 };
    const before = { ...envelope, dim: 'lane', since: '2023-07-06', windows: { '7d': [entry], '30d': [entry], all: [entry] } };
    const after = { ...before, by_fees: { '7d': [entry], '30d': [], all: [entry] } };
    // #when
    const parsed = TopFileSchema.parse(after);
    // #then the fee ranking survives parsing, and the older file still parses
    expect({ fees7d: parsed.by_fees?.['7d'], before: TopFileSchema.safeParse(before).success }).toEqual({ fees7d: [entry], before: true });
  });
  it('parses history.json with and without fee groups and the largest fees', () => {
    // #given one file from after the fee groups and one from before
    const day = { day: '2026-10-07', messages: 3, token_messages: 0, usd_value: 0, fee_usd: 6, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0, fee_link_usd: 1 };
    const after = {
      ...envelope, since: '2023-07-06',
      days: [{ ...day, fee_native_usd: 2, fee_stable_usd: 3, fee_link_amount: 0.1 }],
      largest_fees: [{ message_id: '0xabc', day: '2026-10-07', src: '1', dst: '2', fee_usd: 3, symbol: null }],
    };
    const before = { ...envelope, since: '2023-07-06', days: [day] };
    // #when
    const parsed = HistoryFileSchema.parse(after);
    // #then the new fields survive parsing, and the older file still parses
    expect({ largest: parsed.largest_fees?.length, linkAmount: parsed.days[0]?.fee_link_amount, before: HistoryFileSchema.safeParse(before).success }).toEqual({
      largest: 1,
      linkAmount: 0.1,
      before: true,
    });
  });

  it.each(CAPTURED)('parse the captured production %s', (name, body) => {
    expect(PUBLIC_SCHEMAS[name].safeParse(body).error?.issues ?? []).toEqual([]);
  });

  it('ignore fields they do not know', () => {
    expect(StatusFileSchema.parse({ ...emptyStatus, brand_new: 1 })).not.toHaveProperty('brand_new');
  });

  it('reject a file missing a required field', () => {
    const { lag_seconds: _dropped, ...rest } = emptyStatus;
    expect(StatusFileSchema.safeParse(rest).success).toBe(false);
  });

  it('accept reserve.json before the scan has caught up', () => {
    const doc = {
      ...envelope, token: '0xlink', reserve: '0xreserve', latest: null, series: [], link_price_usd: null,
      cost_basis: null, pace: null, weekly: [], performance: null, transfers: [], latest_transfer: null,
    };
    expect(ReserveFileSchema.safeParse(doc).success).toBe(true);
  });

  it('parse replay.json chain, lane and day tuples', () => {
    const doc = {
      ...envelope,
      since: '2023-07-06',
      chains: [
        { selector: '1', name: 'a-mainnet', display_name: 'A Mainnet', first_day: '2023-07-06' },
        { selector: '2', name: null, display_name: null, first_day: '2023-07-06' },
      ],
      lanes: [[0, 1]],
      days: [{ day: '2023-07-06', lanes: [[0, 2, 0]] }],
    };
    expect(ReplayFileSchema.parse(doc).days[0]!.lanes).toEqual([[0, 2, 0]]);
  });

  it('reject a replay lane row with the wrong number of fields', () => {
    const doc = { ...envelope, since: null, chains: [], lanes: [], days: [{ day: '2023-07-06', lanes: [[0, 2]] }] };
    expect(ReplayFileSchema.safeParse(doc).success).toBe(false);
  });
});
