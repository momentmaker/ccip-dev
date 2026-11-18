import { STAKING_FIRST_BLOCK, type StakingEvent } from '@ccip-dev/core';
import { PegHistoryFileSchema } from '@ccip-dev/core/public';
import { fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { PEG_MARKER_BATCH, runPegHistory, scanPegMarkers } from '../src/jobs/peg-history';
import * as pegStore from '../src/peg-store';
import * as store from '../src/store';
import { harness, readPublic, resetStorage } from './helpers';

beforeEach(resetStorage);

const VAULT = (i: number) => `0x${(0xa000 + i).toString(16).padStart(40, '0')}`;
const event = (i: number, block: number, ts: string, kind: StakingEvent['kind'], amount: string | null = null): StakingEvent => ({
  blockNumber: block, logIndex: i, pool: 'community', kind, staker: VAULT(i), txHash: `0x${block.toString(16)}`, ts, amount, stake: null, total: null,
});

async function seed(events: StakingEvent[]) {
  await store.insertStakingEvents(env.DB, events);
  await store.upsertStakingHolders(env.DB, new Map(events.map((e) => [e.staker, 'stakelink' as const])), '2026-09-27T00:00:00.000Z');
}

const NOW = '2026-09-27T00:00:00.000Z';

describe('scanPegMarkers', () => {
  it('pins the hour 80 stake.link vaults began unbonding', async () => {
    await seed(Array.from({ length: 80 }, (_, i) => event(i, STAKING_FIRST_BLOCK + 10, '2026-09-23T16:00:12.000Z', 'unbonding')));
    await scanPegMarkers(harness({ now: NOW }).c);
    expect(await pegStore.pegMarkers(env.DB)).toEqual([{ hour: '2026-09-23T16:00:00.000Z', kind: 'stakelink_unbonding', vaults: 80, link: null }]);
  });

  it('adds an hour split across runs, and keeps quiet hours off the chart', async () => {
    await seed(Array.from({ length: 6 }, (_, i) => event(i, STAKING_FIRST_BLOCK + 1, '2026-09-23T16:00:00.000Z', 'unbonding')));
    await scanPegMarkers(harness({ now: NOW }).c);
    expect(await pegStore.pegMarkers(env.DB)).toEqual([]);
    await seed(Array.from({ length: 6 }, (_, i) => event(100 + i, STAKING_FIRST_BLOCK + 2, '2026-09-23T16:40:00.000Z', 'unbonding')));
    await scanPegMarkers(harness({ now: NOW }).c);
    expect((await pegStore.pegMarkers(env.DB))[0]?.vaults).toBe(12);
  });

  it('waits while any staker is unclassified, so no stake.link vault is missed', async () => {
    await store.insertStakingEvents(env.DB, [event(0, STAKING_FIRST_BLOCK + 1, '2026-09-23T16:00:00.000Z', 'staked', '20000000000000000000000')]);
    await scanPegMarkers(harness({ now: NOW }).c);
    expect(await store.getMeta(env.DB, 'peg_marker_block')).toBeNull();
  });

  it(`never splits a block across batches of ${PEG_MARKER_BATCH}`, async () => {
    const big = Array.from({ length: PEG_MARKER_BATCH + 5 }, (_, i) => event(i, STAKING_FIRST_BLOCK + (i < PEG_MARKER_BATCH - 2 ? 1 : 2), '2026-09-23T16:00:00.000Z', 'unbonding'));
    await seed(big);
    await scanPegMarkers(harness({ now: NOW }).c);
    expect((await pegStore.pegMarkers(env.DB))[0]?.vaults).toBe(PEG_MARKER_BATCH + 5);
  });

  it('publishes the markers in peg-history.json', async () => {
    await seed(Array.from({ length: 10 }, (_, i) => event(i, STAKING_FIRST_BLOCK + 10, '2026-09-23T16:00:12.000Z', 'unbonding')));
    const curve = fakeFetch(() => jsonResponse({ data: [{ time: 1_790_366_400, open: 1, high: 1, low: 1, close: 1 }] }));
    await runPegHistory(harness({ now: NOW, fetch: curve }).c);
    expect(PegHistoryFileSchema.parse(await readPublic('peg-history.json')).markers).toHaveLength(1);
  });
});
