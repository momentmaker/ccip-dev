import { addDays, type DailyBreakdown, type Dim, type NetworkInfo } from '@ccip-dev/core';
import type { DayTotals } from '@ccip-dev/core/public';
import { NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMoments } from '../src/moments';
import { publishHistoryFiles } from '../src/publish';
import * as store from '../src/store';
import { harness, readPublic, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const ETH = NETWORKS.ethereum.chainSelector;
const BASE = NETWORKS.base.chainSelector;
const BSC = NETWORKS.bsc.chainSelector;
const TEMPO = '7281642695469137430';
const TEMPO_NET: NetworkInfo = { name: 'tempo-mainnet', displayName: 'Tempo Mainnet', chainSelector: TEMPO, chainId: '4217', chainFamily: 'EVM', environment: 'mainnet' };
const USDAT_ETH = '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
const USDAT_BASE = '0xa2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2';
const USDC_BASE = '0xc1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1';
const USDC_BSC = '0xc2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2';
const LOOSE = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const NOW = '2026-10-12T00:07:00.000Z';
const LAST_DAY = '2026-10-11';

const row = (day: string, dim: Dim, key: string, messages: number, usd_value: number, fee_usd: number | null = null): DailyBreakdown => ({ day, dim, key, messages, usd_value, fee_usd });
const lane = (day: string, src: string, dst: string, messages: number, usd: number) => row(day, 'lane', `${src}>${dst}`, messages, usd);
const totals = (day: string, fee: number | null = null): DayTotals => ({
  day, messages: 1, token_messages: 0, usd_value: 1, fee_usd: fee, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0, fee_link_usd: null,
});

/** Writes each day's rows as finalize would, one replaceDaily per day. */
async function seedRows(rows: DailyBreakdown[]): Promise<void> {
  const days = [...new Set(rows.map((r) => r.day))].sort();
  for (const day of days) await store.replaceDaily(env.DB, totals(day), rows.filter((r) => r.day === day), NOW);
}

async function seedRegistryChains(): Promise<void> {
  await seedRegistry([NETWORKS.ethereum, NETWORKS.base, NETWORKS.bsc, TEMPO_NET], [
    { chainSelector: ETH, address: USDAT_ETH, symbol: 'USDat', name: 'USDat', decimals: 18, groupId: 'usdat' },
    { chainSelector: BASE, address: USDAT_BASE, symbol: 'USDat', name: 'USDat', decimals: 18, groupId: 'usdat' },
    { chainSelector: BASE, address: USDC_BASE, symbol: 'USDC', name: 'USD Coin', decimals: 6, groupId: 'usdc' },
    { chainSelector: BSC, address: USDC_BSC, symbol: 'USDC', name: 'USD Coin', decimals: 6, groupId: 'usdc' },
  ]);
}

const build = (lastDay = LAST_DAY, days: DayTotals[] = []) => buildMoments(harness({ now: NOW }).c, { lastDay, days });

describe('moments.json arrivals', () => {
  beforeEach(async () => {
    // #given Tempo entered the registry on Sep 1 but sent its first message on Oct 11, to Ethereum and from Base
    await seedRegistryChains();
    await store.insertArrivals(env.DB, 'chain', [TEMPO], '2026-09-01T00:00:00.000Z', null);
    await seedRows([
      lane('2026-08-03', ETH, BASE, 10, 1_000), lane('2026-08-03', BASE, BSC, 5, 500), row('2026-08-03', 'token', `${BASE}:${USDC_BASE}`, 5, 500),
      lane('2026-09-11', BSC, ETH, 1, 10),
      lane('2026-09-12', BSC, BASE, 2, 20),
      lane('2026-10-06', ETH, BSC, 4, 2_000),
      row('2026-10-07', 'token', `${BSC}:${USDC_BSC}`, 1, 100),
      row('2026-10-08', 'token', `${ETH}:${USDAT_ETH}`, 3, 5_000),
      row('2026-10-09', 'token', `${BASE}:${USDAT_BASE}`, 1, 1_000), row('2026-10-09', 'token', `${BSC}:${LOOSE}`, 2, 70),
      lane('2026-10-11', TEMPO, ETH, 30, 400_000), lane('2026-10-11', BASE, TEMPO, 8, 12_500), lane('2026-10-11', ETH, BASE, 1, 5),
    ]);
  });

  it('dates a chain by its first message, numbers it among the chains so far, and lists its first-day partners by value', async () => {
    // #when
    const moments = await build();
    // #then
    expect({ network: moments.network, chains: moments.arrivals.chains }).toEqual({
      network: { chains: 4, lanes: 7 },
      chains: [{ selector: TEMPO, day: '2026-10-11', number: 4, partners: [ETH, BASE], messages: 38, usd: 412_500 }],
    });
  });

  it('numbers two chains that arrive on the same day apart, in selector order', async () => {
    // #given Solana also sent its first message on Oct 11, to Ethereum
    const SOL = NETWORKS.solana.chainSelector;
    await store.replaceDaily(env.DB, totals('2026-10-11'), [lane('2026-10-11', TEMPO, ETH, 30, 400_000), lane('2026-10-11', BASE, TEMPO, 8, 12_500), lane('2026-10-11', ETH, BASE, 1, 5), lane('2026-10-11', SOL, ETH, 2, 50)], NOW);
    // #when
    const { chains } = (await build()).arrivals;
    // #then
    expect(chains.map((c) => [c.selector, c.number])).toEqual([[SOL, 4], [TEMPO, 5]]);
  });

  it('lists the lanes whose first message fell in the last 30 days, with their first-day totals', async () => {
    // #when Sep 12 is the first of the 30 days through Oct 11
    const { lanes } = (await build()).arrivals;
    // #then
    expect(lanes).toEqual([
      { key: `${BSC}>${BASE}`, day: '2026-09-12', messages: 2, usd: 20 },
      { key: `${ETH}>${BSC}`, day: '2026-10-06', messages: 4, usd: 2_000 },
      { key: `${TEMPO}>${ETH}`, day: '2026-10-11', messages: 30, usd: 400_000 },
      { key: `${BASE}>${TEMPO}`, day: '2026-10-11', messages: 8, usd: 12_500 },
    ]);
  });

  it('dates a registry token group by its first message on any chain, and a token outside the registry on its own', async () => {
    // #when USDC's group moved in August, so its new chain is not new
    const { tokens } = (await build()).arrivals;
    // #then
    expect(tokens).toEqual([
      { key: 'usdat', symbol: 'USDat', day: '2026-10-08', chains: [ETH], usd: 5_000 },
      { key: `${BSC}:${LOOSE}`, symbol: null, day: '2026-10-09', chains: [BSC], usd: 70 },
    ]);
  });
});

describe('moments.json weeks', () => {
  const src = (day: string, key: string, messages: number, usd: number, fee: number) => row(day, 'src_chain', key, messages, usd, fee);
  const dst = (day: string, key: string, messages: number, usd: number) => row(day, 'dst_chain', key, messages, usd, null);

  beforeEach(async () => {
    // #given three old chains; Base grew fastest in the week of Oct 5 and Ethereum in the week of Oct 12
    await seedRegistryChains();
    await seedRows([
      lane('2026-08-03', ETH, BASE, 1, 1), lane('2026-08-03', BASE, BSC, 1, 1),
      src('2026-09-28', BSC, 80, 1_000, 300), src('2026-09-28', BASE, 40, 2_000, 200), src('2026-09-28', ETH, 100, 3_000, 100),
      dst('2026-09-28', BASE, 20, 1_500), dst('2026-09-28', BSC, 20, 500),
      src('2026-10-05', BASE, 150, 60_000, 500), src('2026-10-05', BSC, 100, 9_000, 300), src('2026-10-05', ETH, 250, 90_000, 50),
      dst('2026-10-05', BASE, 50, 36_400), dst('2026-10-05', ETH, 50, 1_000),
      lane('2026-10-05', ETH, BASE, 30, 9_000), lane('2026-10-05', BASE, BSC, 20, 3_000),
      row('2026-10-05', 'token', `${BASE}:${USDC_BASE}`, 10, 41_200), row('2026-10-05', 'token', `${ETH}:${USDAT_ETH}`, 4, 50_000),
      src('2026-10-12', ETH, 900, 1, 10), src('2026-10-12', BASE, 800, 1, 10), src('2026-10-12', BSC, 100, 1, 10),
    ]);
  });

  it('ranks the top 10 of each board for each of the last 8 complete weeks, with each entry’s rank the week before', async () => {
    // #when
    const { weeks } = await build();
    const latest = weeks.at(-1)!;
    // #then
    expect({
      mondays: weeks.map((w) => w.week),
      fees: latest.boards.fee_chains.map((e) => [e.key, e.value, e.rank, e.previous_rank]),
      tokens: latest.boards.tokens.map((e) => [e.label, e.rank, e.previous_rank]),
      lanes: latest.boards.lanes.map((e) => e.key),
    }).toEqual({
      mondays: ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'],
      fees: [[BASE, 500, 1, 2], [BSC, 300, 2, 1], [ETH, 50, 3, 3]],
      tokens: [['USDat', 1, null], ['USDC', 2, null]],
      lanes: [`${ETH}>${BASE}`, `${BASE}>${BSC}`],
    });
  });

  it("spotlights the week's fastest grower by messages sent and received, with its rank, totals, changes, partners and top token", async () => {
    // #when Base: 60 messages the week before, 200 now (+233%); Ethereum: 100, then 300 (+200%)
    const { weeks } = await build();
    // #then
    expect(weeks.at(-1)!.spotlight).toEqual({
      selector: BASE, rank: 2, messages: 200, previous_messages: 60, usd: 96_400, previous_usd: 3_500, fee_usd: 500, previous_fee_usd: 200,
      partners: [ETH, BSC], token: { key: `${BASE}:${USDC_BASE}`, label: 'USDC', usd: 41_200 },
    });
  });

  it('skips the chain spotlighted the week before', async () => {
    // #when a week later, Base grew fastest again (800 against 200) but was the Oct 5 pick
    const { weeks } = await build('2026-10-18');
    // #then Ethereum grew from 300 to 900
    expect(weeks.slice(-2).map((w) => w.spotlight?.selector)).toEqual([BASE, ETH]);
  });
});

describe('moments.json polls', () => {
  const RECORD = {
    chat_id: '@ccipdev', message_id: 7, question_kind: 'fee_chain', question: 'Which chain will pay the most CCIP fees this week?',
    options: [{ key: BSC, label: 'BNB Chain' }, { key: BASE, label: 'Base' }, { key: ETH, label: 'Ethereum' }, { key: 'other', label: 'Another chain' }],
  };
  const week = (monday: string, fee: number) => Array.from({ length: 7 }, (_, i) => totals(addDays(monday, i), fee));

  beforeEach(async () => {
    // #given Base paid the most fees in the week of Oct 5, after BNB Chain led the week of Sep 28
    await seedRegistryChains();
    await seedRows([
      lane('2026-08-03', ETH, BASE, 1, 1),
      row('2026-09-28', 'src_chain', BSC, 1, 1, 300), row('2026-09-28', 'src_chain', BASE, 1, 1, 200),
      row('2026-10-05', 'src_chain', BASE, 1, 1, 500), row('2026-10-05', 'src_chain', BSC, 1, 1, 300), row('2026-10-05', 'src_chain', ETH, 1, 1, 50),
    ]);
  });

  it("answers last week's sent poll with its record's options and vote shares, and asks this week's question", async () => {
    // #given last week's poll was sent and closed with 13 votes
    await store.setMeta(env.DB, 'poll:2026-10-05', JSON.stringify({ ...RECORD, voters: [5, 8, 0, 0], total_voters: 13 }));
    // #when the week of Oct 5 is in history
    const { polls } = await build(LAST_DAY, [...week('2026-09-28', 70), ...week('2026-10-05', 120)]);
    // #then week 42 asks about fee chains, from the week of Oct 5's top 3
    expect(polls).toEqual([
      {
        week: '2026-10-05', question_kind: 'fee_chain', question: RECORD.question, options: RECORD.options,
        answer: BASE, outcome: { key: BASE, label: 'Base', value: 500, change_pct: null }, votes: [38, 62, 0, 0], total_votes: 13,
      },
      {
        week: '2026-10-12', question_kind: 'fee_chain', question: 'Which chain will pay the most CCIP fees this week?',
        options: [{ key: BASE, label: 'Base' }, { key: BSC, label: 'BNB Chain' }, { key: ETH, label: 'Ethereum' }, { key: 'other', label: 'Another chain' }],
        answer: null, outcome: null, votes: null, total_votes: null,
      },
    ]);
  });

  it('keeps a sent poll that could not be closed without votes, and lists no poll for a week none was sent', async () => {
    // #given last week's record has no voter counts
    await store.setMeta(env.DB, 'poll:2026-10-05', JSON.stringify(RECORD));
    // #when
    const { polls } = await build(LAST_DAY, [...week('2026-09-28', 70), ...week('2026-10-05', 120)]);
    // #then
    expect(polls.map((p) => [p.week, p.answer, p.votes])).toEqual([['2026-10-05', BASE, null], ['2026-10-12', null, null]]);
  });
});

describe('moments.json publish', () => {
  it('is published with the history files, as of yesterday', async () => {
    // #given a lane that first moved yesterday, and no fee data: this week's poll falls through to the lane question
    await seedRegistryChains();
    await seedRows([lane('2026-08-03', ETH, BASE, 1, 1), lane(LAST_DAY, TEMPO, ETH, 3, 30)]);
    // #when
    await publishHistoryFiles(harness({ now: NOW }).c);
    // #then
    const moments = await readPublic('moments.json');
    expect({
      chains: moments.arrivals.chains.map((c: { selector: string }) => c.selector),
      weeks: moments.weeks.length,
      polls: moments.polls.map((p: { week: string; question_kind: string }) => [p.week, p.question_kind]),
    }).toEqual({ chains: [TEMPO], weeks: 8, polls: [['2026-10-12', 'lane']] });
  });

  it('raises one moments-publish alert when its query fails, and still publishes the other history files', async () => {
    // #given
    vi.spyOn(store, 'firstDays').mockRejectedValueOnce(new Error('D1 unavailable'));
    const { c, alerts } = harness({ now: NOW });
    // #when
    await publishHistoryFiles(c);
    // #then
    expect({ moments: await env.PUBLIC.get('v1/moments.json'), replay: (await env.PUBLIC.get('v1/replay.json')) !== null, alerts }).toEqual({
      moments: null,
      replay: true,
      alerts: [{ signature: 'moments-publish', text: 'moments.json was not published: D1 unavailable' }],
    });
  });

  it('reads the weekly chain messages through the daily_breakdown_dim index', async () => {
    // #when
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${store.CHAIN_WEEK_MESSAGES_SQL}`).bind('2026-09-28', '2026-10-11').all<{ detail: string }>();
    // #then
    expect(plan.results.map((r) => r.detail).join(' | ')).toContain('USING INDEX daily_breakdown_dim');
  });
});
