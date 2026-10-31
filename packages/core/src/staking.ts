import { z } from 'zod';
import { ethRpc, ethRpcBatch, onFirstEndpoint, toHex, type Fetcher } from './eth-rpc';

/** Chainlink Staking v0.2 on Ethereum (https://blog.chain.link/chainlink-staking-v0-2-now-live). */
export const STAKING_COMMUNITY_POOL = '0xbc10f2e862ed4502144c7d632a3459f49dfcdb5e';
export const STAKING_OPERATOR_POOL = '0xa1d76a7ca72128541e9fcacafbda3a92ef94fdc5';
/** The block of the first v0.2 event, the priority migration from v0.1 on 2023-11-28. */
export const STAKING_FIRST_BLOCK = 18_621_067;
/**
 * stake.link's vault controllers. Every stake.link vault in the pools reports one of these as owner(): its community
 * vaults the first, its operator vaults the second. Etherscan labels the vaults' deployer "stake.link: Deployer".
 */
export const STAKE_LINK_OWNERS: ReadonlySet<string> = new Set(['0xac12290b097f6893322f5430627e472131fbc1b5', '0x4852e48215a4785ee99b640caced5378cc39d2a4']);

const TOPICS = {
  staked: '0xb4caaf29adda3eefee3ad552a8e85058589bf834c7466cae4ee58787f70589ed',
  unstaked: '0x204fccf0d92ed8d48f204adb39b2e81e92bad0dedb93f5716ca9478cfb57de00',
  unbonding: '0x5b9cd1c6f24b416d2354b7b7ad07d92bc1c662a403180e84fac2782414a5f4ed',
  reset: '0x2139bcf9aedec1324f4900a905dca2fa45768477dcef823731813cfb36d86fb8',
  operator_added: '0xac6fa858e9350a46cec16539926e0fde25b7629f84b5a72bffaae4df888ae86d',
  operator_removed: '0xd8572c381824ffffebc7dcf1cc25a094eedc7498e31f3ddfd0a82d4ffa026e9d',
} as const;

export type StakingEventKind = keyof typeof TOPICS;
export type StakingPool = 'community' | 'operator';
/** wallet: an address with no code; smart: an EIP-7702 wallet; stakelink: a stake.link vault; contract: anything else, mostly multisigs. */
export const HOLDER_KINDS = ['wallet', 'smart', 'stakelink', 'contract'] as const;
export type HolderKind = (typeof HOLDER_KINDS)[number];

const KIND_BY_TOPIC = new Map<string, StakingEventKind>(Object.entries(TOPICS).map(([k, t]) => [t, k as StakingEventKind]));

export interface StakingEvent {
  pool: StakingPool;
  kind: StakingEventKind;
  staker: string;
  blockNumber: number;
  logIndex: number;
  txHash: string;
  ts: string;
  /** Raw LINK amounts (18 decimals) as decimal strings: what moved, the staker's principal after it, and the pool's after it. */
  amount: string | null;
  stake: string | null;
  total: string | null;
}

const HexData = z.string().regex(/^0x[0-9a-fA-F]*$/);
const Quantity = z.string().regex(/^0x[0-9a-fA-F]+$/);
const RpcLog = z.object({
  address: z.string(),
  blockNumber: Quantity,
  transactionHash: z.string(),
  logIndex: Quantity,
  topics: z.array(z.string()).min(1),
  data: HexData,
  blockTimestamp: Quantity.optional(),
  removed: z.boolean().optional(),
});
type RpcLog = z.infer<typeof RpcLog>;

const words = (data: string): string[] => {
  const hex = data.slice(2);
  const out: string[] = [];
  for (let i = 0; i + 64 <= hex.length; i += 64) out.push(BigInt(`0x${hex.slice(i, i + 64)}`).toString());
  return out;
};

/** One staking log as an event: null for a log of another kind, from another contract, or removed in a reorg. */
export function decodeStakingLog(log: RpcLog, seconds: number): StakingEvent | null {
  if (log.removed) return null;
  const address = log.address.toLowerCase();
  const pool: StakingPool | null = address === STAKING_COMMUNITY_POOL ? 'community' : address === STAKING_OPERATOR_POOL ? 'operator' : null;
  const kind = KIND_BY_TOPIC.get(log.topics[0]!.toLowerCase());
  const subject = log.topics[1];
  if (pool === null || kind === undefined || subject === undefined) return null;
  const w = words(log.data);
  const moved = kind === 'staked' || kind === 'unstaked';
  return {
    pool,
    kind,
    staker: `0x${subject.slice(-40).toLowerCase()}`,
    blockNumber: Number(BigInt(log.blockNumber)),
    logIndex: Number(BigInt(log.logIndex)),
    txHash: log.transactionHash.toLowerCase(),
    ts: new Date(seconds * 1000).toISOString(),
    amount: moved || kind === 'operator_removed' ? (w[0] ?? null) : null,
    stake: moved ? (w[1] ?? null) : null,
    total: moved ? (w[2] ?? null) : kind === 'operator_removed' ? (w[1] ?? null) : null,
  };
}

/** Both pools' staking events in a block range, in chain order. A log without blockTimestamp costs one block read per block. */
export async function readStakingEvents(deps: Fetcher, rpcUrls: string[], fromBlock: number, toBlock: number): Promise<StakingEvent[]> {
  const filter = { address: [STAKING_COMMUNITY_POOL, STAKING_OPERATOR_POOL], fromBlock: toHex(fromBlock), toBlock: toHex(toBlock), topics: [Object.values(TOPICS)] };
  return onFirstEndpoint(rpcUrls, `Staking scan of blocks ${fromBlock}-${toBlock}`, async (url) => {
    const logs = z.array(RpcLog).parse(await ethRpc(deps, url, 'eth_getLogs', [filter]));
    const times = new Map<string, number>();
    const out: StakingEvent[] = [];
    for (const log of logs) {
      let seconds = log.blockTimestamp === undefined ? times.get(log.blockNumber) : Number(BigInt(log.blockTimestamp));
      if (seconds === undefined) {
        const block = z.object({ timestamp: Quantity }).parse(await ethRpc(deps, url, 'eth_getBlockByNumber', [log.blockNumber, false]));
        seconds = Number(BigInt(block.timestamp));
        times.set(log.blockNumber, seconds);
      }
      const event = decodeStakingLog(log, seconds);
      if (event) out.push(event);
    }
    return out.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  });
}

export interface PoolParams {
  maxPoolSize: number;
  minStake: number;
  maxStake: number;
  unbondingSeconds: number;
  claimSeconds: number;
  totalPrincipal: number;
}

export interface RewardStream {
  /** LINK a second. */
  perSecond: number;
  endsAt: string;
}

export interface StakingChain {
  community: PoolParams;
  operator: PoolParams;
  rewards: { operatorBase: RewardStream; communityBase: RewardStream; operatorDelegated: RewardStream } | null;
}

const SELECTORS = {
  getMaxPoolSize: '0x0fbc8f5b',
  getStakerLimits: '0xc4ef722a',
  getUnbondingParams: '0xcd0ef498',
  getTotalPrincipal: '0x885491af',
  getRewardBuckets: '0xde0b985a',
  owner: '0x8da5cb5b',
} as const;
/** The reward vault both pools report from getRewardVault(). */
export const STAKING_REWARD_VAULT = '0x996913c8c08472f584ab8834e925b06d0eb1d813';

const LINK = 10n ** 18n;
/** A raw 18-decimal amount as LINK, to the wei for any amount the pools can hold. */
export const linkUnits = (raw: bigint | string): number => Number(BigInt(raw) / LINK) + Number(BigInt(raw) % LINK) / 1e18;

function resultWords(value: unknown): bigint[] {
  if (typeof value !== 'string' || !/^0x([0-9a-fA-F]{64})*$/.test(value)) throw new Error('malformed call result');
  const out: bigint[] = [];
  for (let i = 2; i < value.length; i += 64) out.push(BigInt(`0x${value.slice(i, i + 64)}`));
  return out;
}

function poolParams(max: bigint[], limits: bigint[], unbonding: bigint[], total: bigint[]): PoolParams {
  return {
    maxPoolSize: linkUnits(max[0]!),
    minStake: linkUnits(limits[0]!),
    maxStake: linkUnits(limits[1]!),
    unbondingSeconds: Number(unbonding[0]),
    claimSeconds: Number(unbonding[1]),
    totalPrincipal: linkUnits(total[0]!),
  };
}

/** The pools' sizes, limits, unbonding and claim periods and principal, and the reward vault's three emission streams. */
export async function readStakingChain(deps: Fetcher, rpcUrls: string[]): Promise<StakingChain> {
  const poolCalls = (to: string) =>
    (['getMaxPoolSize', 'getStakerLimits', 'getUnbondingParams', 'getTotalPrincipal'] as const).map((s) => ({ method: 'eth_call', params: [{ to, data: SELECTORS[s] }, 'latest'] }));
  const calls = [...poolCalls(STAKING_COMMUNITY_POOL), ...poolCalls(STAKING_OPERATOR_POOL), { method: 'eth_call', params: [{ to: STAKING_REWARD_VAULT, data: SELECTORS.getRewardBuckets }, 'latest'] }];
  return onFirstEndpoint(rpcUrls, 'Staking state read', async (url) => {
    const r = (await ethRpcBatch(deps, url, calls)).map(resultWords);
    const buckets = r[8]!;
    const stream = (i: number): RewardStream => ({ perSecond: linkUnits(buckets[i * 3]!), endsAt: new Date(Number(buckets[i * 3 + 1]) * 1000).toISOString() });
    return {
      community: poolParams(r[0]!, r[1]!, r[2]!, r[3]!),
      operator: poolParams(r[4]!, r[5]!, r[6]!, r[7]!),
      rewards: buckets.length >= 9 ? { operatorBase: stream(0), communityBase: stream(1), operatorDelegated: stream(2) } : null,
    };
  });
}

export const CLASSIFY_BATCH = 100;

/** What holds each address: its code, and for a contract the owner() it reports. Batched, so a few hundred addresses cost a few requests. */
export async function classifyStakers(deps: Fetcher, rpcUrls: string[], addresses: readonly string[]): Promise<Map<string, HolderKind>> {
  const out = new Map<string, HolderKind>();
  for (let i = 0; i < addresses.length; i += CLASSIFY_BATCH) {
    const chunk = addresses.slice(i, i + CLASSIFY_BATCH);
    const codes = await onFirstEndpoint(rpcUrls, 'Staker code read', (url) => ethRpcBatch(deps, url, chunk.map((a) => ({ method: 'eth_getCode', params: [a, 'latest'] }))));
    const contracts: string[] = [];
    chunk.forEach((a, j) => {
      const code = String(codes[j]);
      if (code === '0x') out.set(a, 'wallet');
      else if (code.toLowerCase().startsWith('0xef0100')) out.set(a, 'smart');
      else contracts.push(a);
    });
    if (contracts.length === 0) continue;
    const owners = await onFirstEndpoint(rpcUrls, 'Staker owner read', async (url) => {
      // owner() reverts on contracts without one; read those one at a time so one revert cannot fail the batch.
      try {
        return await ethRpcBatch(deps, url, contracts.map((a) => ({ method: 'eth_call', params: [{ to: a, data: SELECTORS.owner }, 'latest'] })));
      } catch {
        return Promise.all(contracts.map((a) => ethRpc(deps, url, 'eth_call', [{ to: a, data: SELECTORS.owner }, 'latest']).catch(() => '0x')));
      }
    });
    contracts.forEach((a, j) => {
      const value = String(owners[j]);
      const owner = value.length >= 66 ? `0x${value.slice(-40).toLowerCase()}` : null;
      out.set(a, owner !== null && STAKE_LINK_OWNERS.has(owner) ? 'stakelink' : 'contract');
    });
  }
  return out;
}

