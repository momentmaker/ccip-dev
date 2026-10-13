import { monthSummary } from '@ccip-dev/core/month';
import type { HistoryFile, ReplayFile } from '@ccip-dev/core/public';
import { NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadMonthlyFacts } from '../src/broadcasts/monthly';
import { publishHistoryFiles } from '../src/publish';
import * as store from '../src/store';
import { harness, readPublic, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const ETH = NETWORKS.ethereum.chainSelector;
const BASE = NETWORKS.base.chainSelector;
const BSC = NETWORKS.bsc.chainSelector;
const NOW = '2026-10-02T01:00:00.000Z';

/** Aug 30 to Oct 1: Ethereum → Base every day, BNB Chain → Ethereum from Sep 10; fees from Sep 1, 40% of them in LINK. */
async function seedMonths(): Promise<void> {
  await seedRegistry([NETWORKS.ethereum, NETWORKS.base, NETWORKS.bsc], []);
  for (let ms = Date.parse('2026-08-30T00:00:00Z'); ms <= Date.parse('2026-10-01T00:00:00Z'); ms += 86_400_000) {
    const day = new Date(ms).toISOString().slice(0, 10);
    const fee = day >= '2026-09-01' ? 10 : null;
    const lanes = [{ day, dim: 'lane' as const, key: `${ETH}>${BASE}`, messages: 100, usd_value: 1e6, fee_usd: fee }];
    if (day >= '2026-09-10') lanes.push({ day, dim: 'lane' as const, key: `${BSC}>${ETH}`, messages: 50, usd_value: 3e6, fee_usd: fee });
    const messages = lanes.reduce((s, l) => s + l.messages, 0);
    const usd = lanes.reduce((s, l) => s + l.usd_value, 0);
    await store.replaceDaily(env.DB, { day, messages, token_messages: 0, usd_value: usd, fee_usd: fee === null ? null : fee * lanes.length, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 }, lanes, NOW);
    if (fee !== null) await store.setFeeGroupTotals(env.DB, day, { link_usd: fee * lanes.length * 0.4, native_usd: fee * lanes.length * 0.6, stable_usd: 0, link_amount: 1 });
  }
}

describe('loadMonthlyFacts', () => {
  it("sums the month from D1: its totals, LINK share, new chains and busiest lane", async () => {
    // #given
    await seedMonths();
    const h = harness({ now: NOW });
    // #when
    const { summary } = await loadMonthlyFacts(h.c, '2026-09');
    // #then 9 days of one lane and 21 of two
    expect({
      label: summary.label, messages: summary.messages, usd: summary.usd, fees: summary.fees, link: summary.linkSharePct,
      joined: summary.joined.map((c) => c.name), lane: summary.busiestLane && [summary.busiestLane.src.name, summary.busiestLane.dst.name, summary.busiestLane.usd],
    }).toEqual({
      label: 'September 2026', messages: 9 * 100 + 21 * 150, usd: 9 * 1e6 + 21 * 4e6, fees: 9 * 10 + 21 * 20, link: 40,
      joined: ['BNB Chain'], lane: ['BNB Chain', 'Ethereum', 21 * 3e6],
    });
  });

  it('agrees with the month summary of the history.json and replay.json the month page reads', async () => {
    // #given the files the finalize publishes
    await seedMonths();
    const h = harness({ now: NOW });
    await publishHistoryFiles(h.c);
    const history = (await readPublic('history.json')) as HistoryFile;
    const replay = (await readPublic('replay.json')) as ReplayFile;
    // #when
    const { summary } = await loadMonthlyFacts(h.c, '2026-09');
    // #then
    expect(summary).toEqual(monthSummary('2026-09', { days: history.days, largest: history.largest_fees ?? [], replay }));
  });
});
