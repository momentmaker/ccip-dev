import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PASSPORT_SHARDS, passportShard, type PassportChainRow, type PassportLane, type PassportToken } from '@ccip-dev/core/public-passport';
import { describe, expect, it } from 'vitest';
import { passportSample } from '../passport-sample';

const DAY = '2026-11-25';
const ETH = '5009297550715157269';
const BASE = '15971525489660198786';
const ARB = '4949039107694359620';
const CHAINS = [
  { selector: ETH, name: 'ethereum-mainnet' },
  { selector: BASE, name: 'ethereum-mainnet-base-1' },
  { selector: ARB, name: 'ethereum-mainnet-arbitrum-1' },
];
const EXPLORERS = { 'ethereum-mainnet': 'https://eth.blockscout.com', 'ethereum-mainnet-base-1': 'https://base.blockscout.com/' };

type Kind = NonNullable<PassportChainRow['single_key']>['parties'][number]['kind'];
type Value = 'flagged' | 'clear' | 'not readable';

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const groupId = (n: number) => `${(n % 16).toString(16)}${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`;
const result = (key: string, value: Value, reason: string) => ({ key, value, reason, read_on: DAY, basis: '0123456789abcdef', corrected: false, statements: [] });

interface RowSpec {
  chain: string;
  address: string;
  poolType?: string;
  kinds?: Kind[];
  lanes?: PassportLane[];
}

function row(spec: RowSpec): PassportChainRow {
  const kinds = spec.kinds ?? ['wallet', 'absent'];
  const roles = ['poolOwner', 'registryAdministrator', 'rateLimitAdmin', 'proxyAdmin'] as const;
  return {
    chain: spec.chain,
    address: spec.address,
    pool: addr(0xb000 + Number(BigInt(spec.address) % 4096n)),
    read_on: DAY,
    delisted_on: null,
    unreadable: null,
    single_key: {
      ...result(`single-key/${spec.chain}:${spec.address}`, 'flagged', 'single-key'),
      pool_type: spec.poolType ?? 'BurnMintTokenPool 1.6.1',
      parties: kinds.map((kind, i) => ({
        role: roles[i]!,
        address: kind === 'absent' ? null : addr(0xa000 + i),
        kind,
        signers: kind === 'wallet' ? 1 : kind === 'safe' ? 2 : null,
        keys: kind === 'safe' ? 3 : null,
      })),
      decided_by: ['poolOwner'],
    },
    lanes: spec.lanes ?? [],
  } as PassportChainRow;
}

function rateLane(from: RowSpec, remote: string, value: Value, reason: string): PassportLane {
  return {
    remote_chain: remote,
    rate_limit: { ...result(`rate-limit/${from.chain}:${from.address}/${remote}`, value, reason), per_hour: [{ finality: 'standard', limit: 'off' }], receiving_inbound: 'off', verifiers: [] },
    pointers: [],
  } as PassportLane;
}

function pointerLane(a: RowSpec, b: RowSpec, reason: string, states: [string, string]): PassportLane {
  const value: Value = reason === 'pointer-broken' ? 'flagged' : reason === 'pools-point-at-each-other' ? 'clear' : 'not readable';
  return {
    remote_chain: b.chain,
    rate_limit: null,
    pointers: [{
      ...result(`pool-pointer/${a.chain}:${a.address}/${b.chain}:${b.address}`, value, reason),
      other: { chain: b.chain, address: b.address },
      sides: [
        { from: { chain: a.chain, address: a.address }, to: b.chain, state: states[0] },
        { from: { chain: b.chain, address: b.address }, to: a.chain, state: states[1] },
      ],
    }],
  } as PassportLane;
}

function token(n: number, rows: PassportChainRow[]): PassportToken {
  return {
    id: groupId(n),
    name: `Token ${n}`,
    symbol: `T${n}`,
    project: null,
    chains: [...new Set(rows.map((r) => r.chain))],
    results: { 'single-key': 'flagged', 'rate-limit': null, 'pool-pointer': null },
    rows,
    log: [],
  } as PassportToken;
}

const filler = (n: number) => token(n, [row({ chain: ETH, address: addr(n), lanes: [rateLane({ chain: ETH, address: addr(n) }, BASE, 'flagged', 'limit-off')] })]);

const V14 = 101;
const V15 = 102;
const V20 = 103;
const TIMELOCK = 104;
const DIFF_DAYS = 105;
const ARB_TOKEN = 106;
const ONE_SIDED = 107;
const BOTH_SIDES = 108;

const diffA = { chain: ETH, address: addr(DIFF_DAYS) };
const diffB = { chain: BASE, address: addr(DIFF_DAYS + 1000) };
const arbEth = { chain: ETH, address: addr(ARB_TOKEN) };
const arbRow = { chain: ARB, address: addr(ARB_TOKEN + 1000) };
const oneA = { chain: ETH, address: addr(ONE_SIDED) };
const oneB = { chain: BASE, address: addr(ONE_SIDED + 1000) };
const bothA = { chain: ETH, address: addr(BOTH_SIDES) };
const bothB = { chain: BASE, address: addr(BOTH_SIDES + 1000) };

const TOKENS: PassportToken[] = [
  ...Array.from({ length: 30 }, (_, i) => filler(i + 1)),
  token(V14, [row({ chain: ETH, address: addr(V14), poolType: 'BurnMintTokenPool 1.4.0' })]),
  token(V15, [row({ chain: ETH, address: addr(V15), poolType: 'LockReleaseTokenPool 1.5.1', kinds: ['safe', 'absent'] })]),
  token(V20, [row({ chain: ETH, address: addr(V20), poolType: 'BurnMintTokenPool 2.0.0', kinds: ['mcms', 'absent'] })]),
  token(TIMELOCK, [row({ chain: ETH, address: addr(TIMELOCK), kinds: ['timelock', 'wallet'] })]),
  token(DIFF_DAYS, [row({ ...diffA, lanes: [pointerLane(diffA, diffB, 'read-on-different-days', ['points', 'points'])] }), row(diffB)]),
  token(ARB_TOKEN, [row({ ...arbEth, lanes: [rateLane(arbEth, ARB, 'not readable', 'limit-not-readable')] }), row(arbRow)]),
  token(ONE_SIDED, [row({ ...oneA, lanes: [pointerLane(oneA, oneB, 'pointer-broken', ['points', 'wrong-token'])] }), row(oneB)]),
  token(BOTH_SIDES, [row({ ...bothA, lanes: [pointerLane(bothA, bothB, 'pointer-broken', ['wrong-token', 'pool-not-listed'])] }), row(bothB)]),
];

const VERSIONS = new Map(TOKENS.map((t) => [t.id, t.rows.map((r) => /(\d+\.\d+)/.exec(r.single_key!.pool_type!)![1]!)]));
const KINDS = new Map(TOKENS.map((t) => [t.id, t.rows.flatMap((r) => r.single_key!.parties.map((p) => p.kind))]));

async function dryRun(tokens: readonly PassportToken[]): Promise<{ dir: string; chains: string; endpoints: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'passport-sample-'));
  await mkdir(path.join(dir, 'passport'));
  const envelope = { schema_version: 1, updated_at: `${DAY}T22:00:00.000Z`, attribution: 'Data: Chainlink CCIP API, DefiLlama', day: DAY, since: '2026-11-24' };
  for (const h of PASSPORT_SHARDS) {
    const shard = tokens.filter((t) => passportShard(t.id) === `passport/${h}.json`);
    await writeFile(path.join(dir, `passport/${h}.json`), JSON.stringify({ ...envelope, tokens: shard }));
  }
  const chains = path.join(dir, 'chains.json');
  const chainRows = CHAINS.map((c) => ({ ...c, display_name: null, family: 'EVM', chain_id: null, first_seen: null }));
  await writeFile(chains, JSON.stringify({ schema_version: 1, updated_at: `${DAY}T00:00:00.000Z`, attribution: 'x', chains: chainRows }));
  const endpoints = path.join(dir, 'endpoints.json');
  await writeFile(endpoints, JSON.stringify({ rpc: {}, explorer: EXPLORERS }));
  return { dir, chains, endpoints };
}

const sampledIds = (text: string) => [...text.matchAll(/^## \d+\. .*`([^`]+)`$/gm)].map((m) => m[1]!);

describe('passport sample', () => {
  it('includes a token for each of four pool versions and five party kinds', async () => {
    const files = await dryRun(TOKENS);
    const ids = sampledIds(await passportSample({ ...files, seed: 1 }));
    expect(new Set(ids.flatMap((id) => VERSIONS.get(id)!))).toEqual(new Set(['1.4', '1.5', '1.6', '2.0']));
    expect(new Set(ids.flatMap((id) => KINDS.get(id)!))).toEqual(new Set(['wallet', 'absent', 'safe', 'mcms', 'timelock']));
  });

  it('includes the one token whose result carries a reason code that appears once', async () => {
    const files = await dryRun(TOKENS);
    const text = await passportSample({ ...files, seed: 1 });
    expect(sampledIds(text)).toContain(groupId(DIFF_DAYS));
    expect(text).toContain('read-on-different-days');
  });

  it('gives the same sample for the same input and seed', async () => {
    const files = await dryRun(TOKENS);
    const first = await passportSample({ ...files, seed: 42 });
    expect(await passportSample({ ...files, seed: 42 })).toBe(first);
  });

  it('lists a row on a chain with no explorer entry by its address with no link', async () => {
    const files = await dryRun(TOKENS);
    const lines = (await passportSample({ ...files, seed: 1 })).split('\n');
    const arbitrum = lines.filter((l) => l.includes(arbRow.address));
    expect(arbitrum.length).toBeGreaterThan(0);
    expect(arbitrum.filter((l) => l.includes('http'))).toEqual([]);
    expect(lines.some((l) => l.includes(`[${arbEth.address}](https://eth.blockscout.com/address/${arbEth.address})`))).toBe(true);
  });

  it('lists each pair flagged from one side only, and not a pair flagged from both', async () => {
    const files = await dryRun(TOKENS);
    const text = await passportSample({ ...files, seed: 1 });
    const section = text.slice(text.indexOf('## Pairs flagged from one side only'));
    const firstSample = section.indexOf('\n## 1. ');
    const pairs = firstSample < 0 ? section : section.slice(0, firstSample);
    expect(pairs).toContain(oneB.address);
    expect(pairs).not.toContain(bothB.address);
  });
});
