import { STAKING_COMMUNITY_POOL, STAKING_FIRST_BLOCK, STAKING_OPERATOR_POOL } from '@ccip-dev/core';
import { StakersFileSchema, StakingFileSchema } from '@ccip-dev/core/public';
import { fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_CHUNKS_PER_RUN, runStaking, scanStaking } from '../src/jobs/staking';
import { CHUNK_BLOCKS } from '../src/jobs/reserve';
import * as store from '../src/store';
import { harness, readPublic, resetStorage } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-03-01T00:00:00.000Z';
const FIRST = STAKING_FIRST_BLOCK;
const TOPIC = {
  staked: '0xb4caaf29adda3eefee3ad552a8e85058589bf834c7466cae4ee58787f70589ed',
  unbonding: '0x5b9cd1c6f24b416d2354b7b7ad07d92bc1c662a403180e84fac2782414a5f4ed',
  operator_added: '0xac6fa858e9350a46cec16539926e0fde25b7629f84b5a72bffaae4df888ae86d',
};
const LINKPOOL = '0x8d87cbd8c3632b7ef117a15f8100943a23b7d03b';
const WALLET = '0x00000000000000000000000000000000000000aa';
const VAULT = '0xa000000000000000000000000000000000000002';
const SAFE = '0xb000000000000000000000000000000000000003';

const word = (n: bigint) => n.toString(16).padStart(64, '0');
const wei = (link: number) => BigInt(link) * 10n ** 18n;
const pad = (address: string) => `0x${address.slice(2).padStart(64, '0')}`;

interface RawLog {
  address: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  topics: string[];
  data: string;
  blockTimestamp: string;
}

function log(o: { pool: 'community' | 'operator'; kind: keyof typeof TOPIC; who: string; block: number; ts: string; amounts?: [number, number, number] }): RawLog {
  return {
    address: o.pool === 'community' ? STAKING_COMMUNITY_POOL : STAKING_OPERATOR_POOL,
    blockNumber: `0x${o.block.toString(16)}`,
    transactionHash: `0x${o.block.toString(16)}`,
    logIndex: '0x0',
    topics: [TOPIC[o.kind], pad(o.who)],
    data: o.amounts ? `0x${o.amounts.map((a) => word(wei(a))).join('')}` : '0x',
    blockTimestamp: `0x${(Date.parse(o.ts) / 1000).toString(16)}`,
  };
}

const LOGS = [
  log({ pool: 'community', kind: 'staked', who: WALLET, block: FIRST, ts: '2026-01-01T00:00:00Z', amounts: [40, 40, 40] }),
  log({ pool: 'operator', kind: 'operator_added', who: LINKPOOL, block: FIRST + 1, ts: '2026-01-01T00:00:12Z' }),
  log({ pool: 'operator', kind: 'staked', who: LINKPOOL, block: FIRST + 2, ts: '2026-01-01T00:00:24Z', amounts: [10, 10, 10] }),
  log({ pool: 'community', kind: 'staked', who: VAULT, block: FIRST + 3, ts: '2026-01-02T00:00:00Z', amounts: [40, 40, 80] }),
  log({ pool: 'community', kind: 'staked', who: SAFE, block: FIRST + 4, ts: '2026-01-03T00:00:00Z', amounts: [20, 20, 100] }),
  log({ pool: 'community', kind: 'unbonding', who: WALLET, block: FIRST + 5, ts: '2026-02-20T00:00:00Z' }),
];

const CODE: Record<string, string> = { [WALLET]: '0x', [LINKPOOL]: '0x', [VAULT]: '0x6080', [SAFE]: '0x6080' };
const OWNER: Record<string, string> = { [VAULT]: pad('0xac12290b097f6893322f5430627e472131fbc1b5'), [SAFE]: pad('0x1111111111111111111111111111111111111111') };

function chainResult(to: string, data: string): string {
  const community = to === STAKING_COMMUNITY_POOL;
  switch (data) {
    case '0x0fbc8f5b': return `0x${word(wei(community ? 100 : 20))}`;
    case '0xc4ef722a': return `0x${word(wei(1))}${word(wei(community ? 40 : 10))}`;
    case '0xcd0ef498': return `0x${word(2_419_200n)}${word(604_800n)}`;
    case '0x885491af': return `0x${word(wei(community ? 100 : 10))}`;
    case '0xde0b985a': return `0x${[wei(1), 1_805_259_334n, 0n, wei(1), 1_805_259_334n, 0n, wei(1), 1_805_259_334n, 0n].map(word).join('')}`;
    default: return '0x';
  }
}

interface Call {
  id: number;
  method: string;
  params: any[];
}

function stakingRpc(opts: { head: number; logs?: RawLog[]; down?: boolean; classifyDown?: boolean }) {
  return fakeFetch((_url, init) => {
    if (opts.down) return jsonResponse({}, 503);
    const body = JSON.parse(String(init?.body)) as Call | Call[];
    if (Array.isArray(body)) {
      if (opts.classifyDown && body.some((c) => c.method === 'eth_getCode')) return jsonResponse({}, 503);
      return jsonResponse(
        body.map((c) => {
          if (c.method === 'eth_getCode') return { jsonrpc: '2.0', id: c.id, result: CODE[c.params[0]] ?? '0x' };
          const { to, data } = c.params[0] as { to: string; data: string };
          return { jsonrpc: '2.0', id: c.id, result: data === '0x8da5cb5b' ? (OWNER[to] ?? '0x') : chainResult(to, data) };
        }),
      );
    }
    if (body.method === 'eth_blockNumber') return jsonResponse({ jsonrpc: '2.0', id: 1, result: `0x${opts.head.toString(16)}` });
    if (body.method === 'eth_getLogs') {
      const from = Number(BigInt(body.params[0].fromBlock));
      const to = Number(BigInt(body.params[0].toBlock));
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: (opts.logs ?? []).filter((l) => Number(BigInt(l.blockNumber)) >= from && Number(BigInt(l.blockNumber)) <= to) });
    }
    return jsonResponse({ jsonrpc: '2.0', id: 1, error: { message: `unexpected ${body.method}` } });
  });
}

describe('runStaking', () => {
  it('backfills across runs and publishes only once the events are complete', async () => {
    const perRun = MAX_CHUNKS_PER_RUN * CHUNK_BLOCKS;
    const late = log({ pool: 'community', kind: 'unbonding', who: SAFE, block: FIRST + perRun + 10, ts: '2026-02-21T00:00:00Z' });
    const rpc = stakingRpc({ head: FIRST - 1 + perRun + 5_000 + 12, logs: [...LOGS, late] });

    await runStaking(harness({ now: NOW, fetch: rpc }).c);
    expect(await store.getMeta(env.DB, 'staking_scan_block')).toBe(String(FIRST - 1 + perRun));
    expect(await env.PUBLIC.get('v1/staking.json')).toBeNull();

    await runStaking(harness({ now: NOW, fetch: rpc }).c);
    expect(await store.getMeta(env.DB, 'staking_scan_caught_up')).toBe('1');
    expect((await store.stakingEvents(env.DB)).map((e) => e.kind)).toEqual(['staked', 'operator_added', 'staked', 'staked', 'staked', 'unbonding', 'unbonding']);
    const staking = StakingFileSchema.parse(await readPublic('staking.json'));
    expect(staking.as_of_block).toBe(FIRST - 1 + perRun + 5_000);
    expect(staking.community).toMatchObject({ total: 100, stakers: 3, at_max: 2, full_since: '2026-01-03T00:00:00.000Z' });
    expect(staking.holders).toEqual([
      { kind: 'wallet', stakers: 1, link: 40 },
      { kind: 'smart', stakers: 0, link: 0 },
      { kind: 'stakelink', stakers: 1, link: 40 },
      { kind: 'contract', stakers: 1, link: 20 },
    ]);
    expect(staking.operators).toEqual([
      { address: LINKPOOL, name: 'LinkPool', via: 'wallet', stake: 10, since: '2026-01-01T00:00:24.000Z', status: 'active' },
    ]);
    expect(staking.rewards).toMatchObject({ community_per_s: 1, operator_per_s: 1, delegated_per_s: 1 });
  });

  it('files each staker by the first hex digit of its address', async () => {
    await runStaking(harness({ now: NOW, fetch: stakingRpc({ head: FIRST + 100, logs: LOGS }) }).c);
    const zero = StakersFileSchema.parse(await readPublic('stakers/0.json'));
    expect(zero.stakers).toEqual([[WALLET, 'c', 40, '2026-01-01T00:00:00.000Z', '2026-02-20T00:00:00.000Z', 'wallet', 1, 1, 0]]);
    expect(StakersFileSchema.parse(await readPublic('stakers/8.json')).stakers.map((r) => [r[0], r[1]])).toEqual([[LINKPOOL, 'o']]);
    expect(StakersFileSchema.parse(await readPublic('stakers/a.json')).stakers.map((r) => [r[0], r[5]])).toEqual([[VAULT, 'stakelink']]);
    expect(StakersFileSchema.parse(await readPublic('stakers/5.json')).stakers).toEqual([]);
  });

  it('waits to publish until every staker is classified', async () => {
    await runStaking(harness({ now: NOW, fetch: stakingRpc({ head: FIRST + 100, logs: LOGS, classifyDown: true }) }).c);
    expect(await store.getMeta(env.DB, 'staking_scan_caught_up')).toBe('1');
    expect(await env.PUBLIC.get('v1/staking.json')).toBeNull();
    await runStaking(harness({ now: NOW, fetch: stakingRpc({ head: FIRST + 100, logs: LOGS }) }).c);
    expect((await store.stakingHolders(env.DB)).get(SAFE)).toBe('contract');
    expect(await env.PUBLIC.get('v1/staking.json')).not.toBeNull();
  });

  it('checks a holder again once its classification is 30 days old', async () => {
    await runStaking(harness({ now: NOW, fetch: stakingRpc({ head: FIRST + 100, logs: LOGS }) }).c);
    expect(await store.stakersToClassify(env.DB, NOW, 10)).toEqual([]);
    expect((await store.stakersToClassify(env.DB, '2026-04-01T00:00:00.000Z', 10)).sort()).toEqual([WALLET, LINKPOOL, VAULT, SAFE].sort());
  });
});

describe('scanStaking', () => {
  it('alerts on the third failed run in a row and resets after a good run', async () => {
    const signatures: string[] = [];
    for (let i = 0; i < 3; i++) {
      const h = harness({ now: NOW, fetch: stakingRpc({ head: FIRST + 100, down: true }) });
      await expect(scanStaking(h.c)).resolves.toBeNull();
      signatures.push(...h.alerts.map((a) => a.signature));
    }
    expect(signatures).toEqual(['staking-scan']);
    await scanStaking(harness({ now: NOW, fetch: stakingRpc({ head: FIRST + 100 }) }).c);
    expect(await store.getMeta(env.DB, 'staking_scan_failures')).toBe('0');
  });
});

describe('classifying stakers', () => {
  it('keeps the batches it classified when a later one fails, and checks a contract again once its row is dropped', async () => {
    const rpc = stakingRpc({ head: FIRST + 100, logs: LOGS });
    await runStaking(harness({ now: NOW, fetch: rpc }).c);
    await env.DB.prepare("DELETE FROM staking_holders WHERE kind = 'contract'").run();
    expect(await store.hasUnclassifiedStakers(env.DB)).toBe(true);
    await runStaking(harness({ now: NOW, fetch: rpc }).c);
    expect((await store.stakingHolders(env.DB)).get(SAFE)).toBe('contract');
    expect(await store.hasUnclassifiedStakers(env.DB)).toBe(false);
  });
});
