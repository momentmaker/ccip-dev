import { describe, expect, it } from 'vitest';
import { classifyStakers, decodeStakingLog, linkUnits, readStakingChain, readStakingEvents, STAKING_COMMUNITY_POOL, type StakingChain, type StakingEvent } from '../src/staking';
import { stakerRows, stakingStats } from '../src/staking-stats';
import { fakeFetch, jsonResponse } from '../src/testing';
import { PUBLIC_SCHEMAS, stakerShard, StakersFileSchema } from '../src/public';

// Real logs from mainnet: an unbonding start and a 10.61 LINK unstake in the community pool, and an operator's top-up.
const UNBONDING = { address: '0xbc10f2e862ed4502144c7d632a3459f49dfcdb5e', blockNumber: '0x18ff99c', transactionHash: '0xE0C5', logIndex: '0xdf', topics: ['0x5b9cd1c6f24b416d2354b7b7ad07d92bc1c662a403180e84fac2782414a5f4ed', '0x00000000000000000000000096913c8f98273f8836ce6d25a720dd98ceca1909'], data: '0x' };
const UNSTAKED = {
  address: '0xBc10f2E862ED4502144c7d632a3459F49DFCDB5e', blockNumber: '0x1900bab', transactionHash: '0xccd6', logIndex: '0x87',
  topics: ['0x204fccf0d92ed8d48f204adb39b2e81e92bad0dedb93f5716ca9478cfb57de00', '0x000000000000000000000000cb5561dadb833665210a7b5046f4ce83e02630da'],
  data: '0x000000000000000000000000000000000000000000000000933e4ac92ae50000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000021cf9d9d66ada7e9fb0000',
};
const OPERATOR_STAKED = {
  address: '0xa1d76a7ca72128541e9fcacafbda3a92ef94fdc5', blockNumber: '0x190976a', transactionHash: '0x07cc', logIndex: '0x10e',
  topics: ['0xb4caaf29adda3eefee3ad552a8e85058589bf834c7466cae4ee58787f70589ed', '0x000000000000000000000000dd629d38285d15847b3c57ae2eff1c3d860a6d76'],
  data: '0x00000000000000000000000000000000000000000000011885d4a1f92d44d2b0000000000000000000000000000000000000000000000f72cf158a2bdbed0b19000000000000000000000000000000000000000000015b408e5372b7ae4a6df3',
};

describe('decodeStakingLog', () => {
  it('reads an unstake: what left, what the staker kept, and the pool after it', () => {
    const e = decodeStakingLog(UNSTAKED, 1_793_000_000)!;
    expect(e).toMatchObject({ pool: 'community', kind: 'unstaked', staker: '0xcb5561dadb833665210a7b5046f4ce83e02630da', blockNumber: 0x1900bab, logIndex: 0x87, txHash: '0xccd6' });
    expect(linkUnits(e.amount!)).toBe(10.61);
    expect(linkUnits(e.stake!)).toBe(0);
    expect(linkUnits(e.total!)).toBeCloseTo(40_874_989.39, 6);
    expect(e.ts).toBe(new Date(1_793_000_000_000).toISOString());
  });

  it('reads an unbonding start, which carries no amounts, and an operator stake', () => {
    expect(decodeStakingLog(UNBONDING, 0)).toMatchObject({ kind: 'unbonding', staker: '0x96913c8f98273f8836ce6d25a720dd98ceca1909', amount: null, stake: null, total: null });
    const op = decodeStakingLog(OPERATOR_STAKED, 0)!;
    expect(op).toMatchObject({ pool: 'operator', kind: 'staked' });
    expect(Math.round(linkUnits(op.total!))).toBe(1_639_852);
  });

  it('skips removed logs, other contracts and other events', () => {
    expect(decodeStakingLog({ ...UNSTAKED, removed: true }, 0)).toBeNull();
    expect(decodeStakingLog({ ...UNSTAKED, address: '0x0000000000000000000000000000000000000001' }, 0)).toBeNull();
    expect(decodeStakingLog({ ...UNSTAKED, topics: ['0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d', UNSTAKED.topics[1]!] }, 0)).toBeNull();
  });
});

describe('readStakingEvents', () => {
  it('asks both pools for every staking event and dates each log, reading blocks in one batch only for logs with no time', async () => {
    const f = fakeFetch((_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (!Array.isArray(body)) return jsonResponse({ jsonrpc: '2.0', id: 1, result: [{ ...UNSTAKED, blockTimestamp: '0x10' }, UNBONDING] });
      return jsonResponse(body.map((c: { id: number }) => ({ jsonrpc: '2.0', id: c.id, result: { timestamp: '0x20' } })));
    });
    const events = await readStakingEvents({ fetch: f }, ['https://rpc.one'], 26_000_000, 26_009_999);
    const filter = JSON.parse(String(f.calls[0]!.init?.body)).params[0];
    expect(filter.address).toContain(STAKING_COMMUNITY_POOL);
    expect(filter.topics[0]).toHaveLength(6);
    expect(events.map((e) => [e.kind, e.ts])).toEqual([
      ['unbonding', new Date(0x20 * 1000).toISOString()],
      ['unstaked', new Date(0x10 * 1000).toISOString()],
    ]);
    expect(JSON.parse(String(f.calls[1]!.init?.body))).toEqual([{ jsonrpc: '2.0', id: 0, method: 'eth_getBlockByNumber', params: ['0x18ff99c', false] }]);
    expect(f.calls).toHaveLength(2);
  });
});

const word = (n: bigint) => n.toString(16).padStart(64, '0');
const link = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;

describe('readStakingChain', () => {
  it('reads both pools and the reward vault in one batch', async () => {
    const pool = (max: number, lo: number, hi: number, total: number) => [`0x${word(link(max))}`, `0x${word(link(lo))}${word(link(hi))}`, `0x${word(2_419_200n)}${word(604_800n)}`, `0x${word(link(total))}`];
    const buckets = `0x${[link(0.0058), 1_805_259_334n, 1n, link(0.056), 1_805_259_334n, 1n, link(0.0023), 1_805_259_334n, 1n].map(word).join('')}`;
    const results = [...pool(40_875_000, 1, 15_000, 40_875_000), ...pool(4_125_000, 1_000, 75_000, 1_646_261), buckets];
    const f = fakeFetch((_url, init) => jsonResponse(JSON.parse(String(init?.body)).map((c: { id: number }) => ({ jsonrpc: '2.0', id: c.id, result: results[c.id] }))));
    const chain = await readStakingChain({ fetch: f }, ['https://rpc.one']);
    expect(chain.community).toEqual({ maxPoolSize: 40_875_000, minStake: 1, maxStake: 15_000, unbondingSeconds: 2_419_200, claimSeconds: 604_800, totalPrincipal: 40_875_000 });
    expect(chain.operator.maxStake).toBe(75_000);
    expect(chain.rewards?.communityBase).toEqual({ perSecond: 0.056, endsAt: new Date(1_805_259_334_000).toISOString() });
    expect(f.calls).toHaveLength(1);
  });
});

describe('classifyStakers', () => {
  it('tells wallets, EIP-7702 wallets, stake.link vaults and other contracts apart', async () => {
    const addrs = ['0xaa', '0xbb', '0xcc', '0xdd'];
    const code: Record<string, string> = { '0xaa': '0x', '0xbb': '0xef0100abc', '0xcc': '0x6080', '0xdd': '0x6080' };
    const owner: Record<string, string> = { '0xcc': `0x${'0'.repeat(24)}ac12290b097f6893322f5430627e472131fbc1b5`, '0xdd': `0x${'0'.repeat(24)}${'1'.repeat(40)}` };
    const f = fakeFetch((_url, init) => {
      const calls = JSON.parse(String(init?.body)) as { id: number; method: string; params: [any] }[];
      return jsonResponse(calls.map((c) => ({ jsonrpc: '2.0', id: c.id, result: c.method === 'eth_getCode' ? code[c.params[0]] : owner[c.params[0].to] })));
    });
    const kinds = await classifyStakers({ fetch: f }, ['https://rpc.one'], addrs);
    expect(Object.fromEntries(kinds)).toEqual({ '0xaa': 'wallet', '0xbb': 'smart', '0xcc': 'stakelink', '0xdd': 'contract' });
  });

  it('reads a contract whose owner() reverts as a plain contract, and leaves the rest of the batch standing', async () => {
    const f = fakeFetch((_url, init) => {
      const calls = JSON.parse(String(init?.body)) as { id: number; method: string; params: [any] }[];
      return jsonResponse(
        calls.map((c) =>
          c.method === 'eth_getCode'
            ? { jsonrpc: '2.0', id: c.id, result: '0x6080' }
            : c.params[0].to === '0xcc'
              ? { jsonrpc: '2.0', id: c.id, result: `0x${'0'.repeat(24)}ac12290b097f6893322f5430627e472131fbc1b5` }
              : { jsonrpc: '2.0', id: c.id, error: { code: 3, message: 'execution reverted' } },
        ),
      );
    });
    expect(Object.fromEntries(await classifyStakers({ fetch: f }, ['https://rpc.one'], ['0xcc', '0xdd']))).toEqual({ '0xcc': 'stakelink', '0xdd': 'contract' });
  });

  it('never guesses when an endpoint limits or fails an owner() read: it tries the next endpoint, then gives up', async () => {
    const limited = (calls: { id: number; method: string }[]) =>
      calls.map((c) => (c.method === 'eth_getCode' ? { jsonrpc: '2.0', id: c.id, result: '0x6080' } : { jsonrpc: '2.0', id: c.id, error: { code: 429, message: 'Too many requests' } }));
    const next = fakeFetch((url, init) => {
      const calls = JSON.parse(String(init?.body)) as { id: number; method: string }[];
      if (url === 'https://rpc.one') return jsonResponse(limited(calls));
      return jsonResponse(calls.map((c) => ({ jsonrpc: '2.0', id: c.id, result: c.method === 'eth_getCode' ? '0x6080' : `0x${'0'.repeat(24)}ac12290b097f6893322f5430627e472131fbc1b5` })));
    });
    expect(Object.fromEntries(await classifyStakers({ fetch: next }, ['https://rpc.one', 'https://rpc.two'], ['0xcc']))).toEqual({ '0xcc': 'stakelink' });
    const down = fakeFetch((_url, init) => jsonResponse(limited(JSON.parse(String(init?.body)))));
    await expect(classifyStakers({ fetch: down }, ['https://rpc.one'], ['0xcc'])).rejects.toThrow(/Too many requests/);
  });
});

// A small pool to check the stats by hand: cap 100, at most 40 a staker, a 28-day unbonding and a 7-day claim window.
const DAY = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00Z');
const at = (days: number, plusSeconds = 0) => new Date(T0 + days * DAY + plusSeconds * 1000).toISOString();
const raw = (n: number) => link(n).toString();
let block = 1_000;
const ev = (pool: 'community' | 'operator', kind: StakingEvent['kind'], staker: string, ts: string, amount?: number, stake?: number, total?: number): StakingEvent => ({
  pool, kind, staker, blockNumber: block++, logIndex: 0, txHash: '0x', ts,
  amount: amount === undefined ? null : raw(amount), stake: stake === undefined ? null : raw(stake), total: total === undefined ? null : raw(total),
});
const chain: StakingChain = {
  community: { maxPoolSize: 100, minStake: 1, maxStake: 40, unbondingSeconds: 28 * 86_400, claimSeconds: 7 * 86_400, totalPrincipal: 100 },
  operator: { maxPoolSize: 20, minStake: 1, maxStake: 10, unbondingSeconds: 28 * 86_400, claimSeconds: 7 * 86_400, totalPrincipal: 10 },
  rewards: {
    communityBase: { perSecond: (100 * 0.05) / (365 * 86_400), endsAt: '2027-01-01T00:00:00.000Z' },
    operatorBase: { perSecond: (10 * 0.1) / (365 * 86_400), endsAt: '2027-01-01T00:00:00.000Z' },
    operatorDelegated: { perSecond: (10 * 0.02) / (365 * 86_400), endsAt: '2027-01-01T00:00:00.000Z' },
  },
};
const events: StakingEvent[] = [
  ev('community', 'staked', '0xa', at(0), 40, 40, 40),
  ev('community', 'staked', '0xb', at(0, 60), 40, 40, 80),
  ev('community', 'staked', '0xvault', at(1), 20, 20, 100),
  ev('community', 'unbonding', '0xa', at(2)),
  ev('community', 'unbonding', '0xvault', at(2)),
  ev('operator', 'operator_added', '0xop1', at(0)),
  ev('operator', 'operator_added', '0xop2', at(0)),
  ev('operator', 'staked', '0xop1', at(0, 30), 10, 10, 10),
  ev('operator', 'operator_removed', '0xop2', at(5), 0, undefined, 10),
  // 0xa leaves 20 inside its window (Jan 30 to Feb 6); 0xd takes the space one block, 12 s, later.
  ev('community', 'unstaked', '0xa', at(30), 20, 20, 80),
  ev('community', 'staked', '0xd', at(30, 12), 20, 20, 100),
  ev('community', 'unbonding', '0xb', at(50)),
];
const NOW = new Date(at(59));
const holders = new Map([['0xvault', 'stakelink' as const]]);
const stats = stakingStats({ events, chain, holders, names: { '0xop1': 'LinkPool' }, now: NOW, asOfBlock: 2_000 });

describe('stakingStats', () => {
  it('sizes up the community pool', () => {
    expect(stats.community).toMatchObject({ total: 100, cap: 100, stakers: 4, ever: 4, at_max: 1, full_since: at(1) });
    expect(stats.holders.find((h) => h.kind === 'stakelink')).toEqual({ kind: 'stakelink', stakers: 1, link: 20 });
    expect(stats.tenure).toMatchObject({ first_month: 3, by_year: [{ year: '2026', stakers: 4 }] });
  });

  it('times the opening and credits who filled it', () => {
    expect(stats.refills).toMatchObject({ openings: 1, median_s: 12, same_block: 0, next_block: 1, hunters: 1, leaders: [{ address: '0xd', grabs: 1, link: 20, fastest_s: 12 }] });
  });

  it('splits the exit queue and the conversion between stakers and stake.link, and forecasts what leaves', () => {
    expect(stats.queue.unbonding).toEqual({ stakers: 1, link: 40, stakelink_stakers: 0, stakelink_link: 0 });
    expect(stats.queue.days).toEqual([{ day: '2026-03-20', link: 40, stakelink_link: 0, stakers: 1 }]);
    expect(stats.queue.conversion).toEqual({ others: { left: 1, total: 1 }, stakelink: { left: 0, total: 1 } });
    expect(stats.queue.likely_to_leave).toBe(40);
    expect(stats.queue.lapsed).toBe(1);
  });

  it('keeps the operator roster with names, and the yearly reward rates', () => {
    expect(stats.operator).toMatchObject({ stakers: 1, allowlisted: 1, removed: 1, at_max: 1 });
    expect(stats.operators[0]).toMatchObject({ address: '0xop1', name: 'LinkPool', via: 'wallet', stake: 10, status: 'active' });
    expect(stats.operator_events[0]).toMatchObject({ kind: 'removed', address: '0xop2' });
    expect(stats.rewards).toMatchObject({ community_rate_pct: 5, operator_rate_pct: 12 });
    expect(stats.stakelink).toEqual({ community_vaults: 1, community_link: 20, operator_vaults: 0, operator_link: 0 });
  });

  it('counts each week by Monday', () => {
    expect(stats.weeks.find((w) => w.week === '2025-12-29')).toMatchObject({ unbondings: 2, unbonding_link: 60, stakelink_unbonding_link: 20 });
    const week = stats.weeks.find((w) => w.week === '2026-01-26')!;
    expect(week).toMatchObject({ staked: 20, unstaked: 20, new_stakers: 1, openings: 1 });
  });
});

describe('stakerRows', () => {
  it('lists every current staker with its first stake, unbonding clock, places in its pool and grabs, oldest first', () => {
    expect(stakerRows({ events, holders, chain })).toEqual([
      ['0xa', 'c', 20, at(0), null, 'wallet', 1, 2, 0],
      ['0xop1', 'o', 10, at(0, 30), null, 'wallet', 1, 1, 0],
      ['0xb', 'c', 40, at(0, 60), at(50), 'wallet', 2, 1, 0],
      ['0xvault', 'c', 20, at(1), at(2), 'stakelink', 3, 2, 0],
      ['0xd', 'c', 20, at(30, 12), null, 'wallet', 4, 2, 1],
    ]);
  });
});

describe('stakerShard', () => {
  it('files an address by its first hex digit', () => {
    expect(stakerShard('0xAB12')).toBe('stakers/a.json');
    expect(PUBLIC_SCHEMAS['stakers/f.json']).toBe(StakersFileSchema);
  });
});
