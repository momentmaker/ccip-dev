import { labelKey, type Dim } from '@ccip-dev/core';
import { NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { dailyFacts, loadFactsSource, recordFacts, weeklyFacts } from '../src/broadcasts/facts';
import * as store from '../src/store';
import { harness, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-10-11T00:07:00.000Z';
const DAY = '2026-10-10';
const ETH = NETWORKS.ethereum.chainSelector;
const BASE = NETWORKS.base.chainSelector;
const BSC = NETWORKS.bsc.chainSelector;
const SYRUP_ETH = '0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b';
const SYRUP_BASE = '0x660975730059246a68521a3e2fbd4740173100f5';
const SENDER = '0x7af7632562b6063e52788607ad56f7a60f57ce09';
const OTHER = '0x1111111111111111111111111111111111111111';
const PRIOR = ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
const totals = (day: string, messages: number, usd: number, fee: number | null) => ({
  day, messages, token_messages: 0, usd_value: usd, fee_usd: fee, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0,
});
const row = (day: string, dim: Dim, key: string, messages: number, usd_value: number, fee_usd: number | null) => ({ day, dim, key, messages, usd_value, fee_usd });
const HANDLES = {
  chains: { 'ethereum-mainnet': 'ethereum', 'ethereum-mainnet-base-1': 'base' },
  tokens: [{ chain: 'ethereum-mainnet', address: SYRUP_ETH, project: 'Maple', x: 'maplefinance' }],
};
const LABELS = { [labelKey('ethereum-mainnet', SENDER)]: { name: 'xStocks', x: 'xStocksFi', kind: 'issuer' as const, slug: 'xstocks' } };

/** Seven days of 200 messages, $8M and $4 in fees, then a day of 150 messages, $2M and $5 with one of each leader. */
async function seedDay(): Promise<void> {
  await seedRegistry([NETWORKS.ethereum, NETWORKS.base, NETWORKS.bsc], [
    { chainSelector: ETH, address: SYRUP_ETH, symbol: 'syrupUSDC', name: 'Syrup USDC', decimals: 6, groupId: 'syrup' },
    { chainSelector: BASE, address: SYRUP_BASE, symbol: 'syrupUSDC', name: 'Syrup USDC', decimals: 6, groupId: 'syrup' },
  ]);
  for (const day of PRIOR) await store.replaceDaily(env.DB, totals(day, 200, 8e6, 4), [], NOW);
  await store.replaceDaily(env.DB, totals(DAY, 150, 2e6, 5), [
    row(DAY, 'token', `${BASE}:${SYRUP_BASE}`, 40, 500_000, null),
    row(DAY, 'token', `${ETH}:0xother`, 10, 100_000, null),
    row(DAY, 'sender', `${ETH}:${SENDER}`, 97, 300_000, 1),
    row(DAY, 'sender', `${BASE}:${OTHER}`, 20, 1_500_000, 3),
    row(DAY, 'lane', `${ETH}>${BASE}`, 30, 1_200_000, 1),
    row(DAY, 'lane', `${BASE}>${BSC}`, 60, 800_000, 4),
    row(DAY, 'src_chain', ETH, 90, 1_200_000, 1),
    row(DAY, 'src_chain', BASE, 60, 800_000, 4),
  ], NOW);
  await store.setFeeGroupTotals(env.DB, DAY, { link_usd: 1.25, native_usd: 3.75, stable_usd: 0, link_amount: 0.1 });
}

describe('daily facts', () => {
  it("gives the day's totals and leaders, tagging a token's project through its registry group", async () => {
    // #given the project's token entry is on Ethereum and the day's top token is its copy on Base
    await seedDay();
    const { c } = harness({ now: NOW, labels: LABELS, handles: HANDLES });
    // #when
    const facts = dailyFacts(await loadFactsSource(c, { days: [DAY], monday: null }), DAY);
    // #then
    expect(facts).toEqual({
      kind: 'daily',
      day: DAY,
      totals: { day: DAY, messages: { value: 150, pct: -25 }, value: { value: 2e6, pct: -75 }, fees: { value: 5, pct: 25 }, linkSharePct: 25, linkUsd: 1.25, linkAmount: 0.1 },
      leaders: {
        token: { key: `${BASE}:${SYRUP_BASE}`, symbol: 'syrupUSDC', project: { name: 'Maple', x: 'maplefinance' }, usd: 500_000, sharePct: 25 },
        sender: { key: `${ETH}:${SENDER}`, player: { name: 'xStocks', x: 'xStocksFi' }, messages: 97 },
        lane: { key: `${ETH}>${BASE}`, src: { name: 'Ethereum', x: 'ethereum' }, dst: { name: 'Base', x: 'base' }, usd: 1_200_000, messages: 30, feeUsd: 1 },
      },
      feeChain: { key: BASE, player: { name: 'Base', x: 'base' }, feeUsd: 4 },
      records: [{ kind: 'fees', day: DAY, value: 5, previous: { day: '2026-10-03', value: 4 }, stoodDays: 7 }],
    });
  });

  it('writes an unlabeled sender as its short address, a chain without a handle by its name, and no project without an entry', async () => {
    // #given no labels and no handles
    await seedDay();
    const { c } = harness({ now: NOW });
    // #when
    const facts = dailyFacts(await loadFactsSource(c, { days: [DAY], monday: null }), DAY);
    // #then
    expect({ sender: facts?.leaders.sender?.player, src: facts?.leaders.lane?.src, project: facts?.leaders.token?.project }).toEqual({
      sender: { name: '0x7af7…ce09', x: null },
      src: { name: 'Ethereum', x: null },
      project: null,
    });
  });

  it('has nothing for a day without totals', async () => {
    await seedDay();
    const { c } = harness({ now: NOW });
    expect(dailyFacts(await loadFactsSource(c, { days: [DAY], monday: null }), '2026-10-01')).toBeNull();
  });
});

describe('weekly facts', () => {
  it('totals the Monday–Sunday week against the one before, with its top 3 fee chains', async () => {
    // #given fees by source chain over Oct 5–11: Base 4 + 6, BNB 2 and Ethereum 1; the week before has Oct 3 and 4
    await seedDay();
    await store.replaceDaily(env.DB, totals('2026-10-11', 10, 10, 9), [row('2026-10-11', 'src_chain', BASE, 1, 1, 6), row('2026-10-11', 'src_chain', BSC, 1, 1, 2)], NOW);
    const { c } = harness({ now: '2026-10-12T00:07:00.000Z', handles: HANDLES });
    // #when
    const facts = weeklyFacts(await loadFactsSource(c, { days: ['2026-10-11'], monday: '2026-10-05' }), '2026-10-05');
    // #then 5 × 200 + 150 + 10 = 1,160 messages against 400
    expect({ messages: facts?.totals.messages, chains: facts?.feeChains.map((f) => [f.player.name, f.feeUsd]), lane: facts?.leaders.lane?.key }).toEqual({
      messages: { value: 1_160, pct: 190 },
      chains: [['Base', 10], ['BNB Chain', 2], ['Ethereum', 1]],
      lane: `${ETH}>${BASE}`,
    });
  });
});

describe('record facts', () => {
  it("carries what drove a fees record: the day's top lane by fees and its messages, and the all-time fees", async () => {
    // #given
    await seedDay();
    const { c } = harness({ now: NOW, handles: HANDLES });
    const src = await loadFactsSource(c, { days: [DAY], monday: null });
    // #when
    const facts = recordFacts(src, dailyFacts(src, DAY)!.records[0]!);
    // #then 7 × $4 + $5
    expect({ driver: facts.driver, route: facts.route, allTime: facts.allTime }).toEqual({
      driver: { lane: `${BASE}>${BSC}`, messages: 60, usd: 800_000, feeUsd: 4, symbol: null },
      route: { src: { name: 'Base', x: 'base' }, dst: { name: 'BNB Chain', x: null } },
      allTime: 33,
    });
  });
});
