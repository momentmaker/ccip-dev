import type { HolderKind, StakersFile, StakingFile } from '@ccip-dev/core/public';

const DAY_MS = 86_400_000;
export const STAKER_TEMPLATE_PATH = '/staking/staker/';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const STAKER_PATH = /^\/staking\/(0x[0-9a-fA-F]{40})\/?$/;

export const isAddress = (s: string) => ADDRESS.test(s.trim());
export const stakerPath = (address: string) => `/staking/${address.trim().toLowerCase()}/`;
/** The address a staker page is for, from its path; null for any other path. */
export function addressFromPath(path: string): string | null {
  const m = STAKER_PATH.exec(path);
  return m ? m[1]!.toLowerCase() : null;
}
export const stakerTitle = (address: string) => `Staker ${address.slice(0, 6)}…${address.slice(-4)}`;
export const STAKER_DESCRIPTION = 'A Chainlink staker on ccip.dev: since when, how much, its place in the pool and its exit clock.';

export type StakerStatus =
  | { kind: 'staked' }
  | { kind: 'unbonding'; opensAt: string; days: number }
  | { kind: 'claimable'; closesAt: string; days: number }
  | { kind: 'lapsed'; closedAt: string };

export interface StakerFacts {
  address: string;
  pool: 'community' | 'operator';
  stake: number;
  maxStake: number;
  atMax: boolean;
  /** Stakers at the pool's max, all sharing first place by size: set for a staker at the max. */
  atMaxCount: number | null;
  since: string;
  days: number;
  /** Place among the pool's current stakers by first stake, and by principal; 1 is the earliest and the largest. */
  sinceRank: number;
  stakeRank: number;
  poolStakers: number;
  /** Staked within the first month after staking opened. */
  dayOne: boolean;
  holder: HolderKind;
  grabs: number;
  status: StakerStatus;
  /** LINK a year at the pool's current rate. */
  yearly: number | null;
  operatorName: string | null;
}

type Row = StakersFile['stakers'][number];

export function findStaker(file: Pick<StakersFile, 'stakers'>, address: string): Row | null {
  const a = address.toLowerCase();
  return file.stakers.find((r) => r[0] === a) ?? null;
}

function statusOf(unbondingAt: string | null, periods: StakingFile['periods'], now: Date): StakerStatus {
  if (unbondingAt === null) return { kind: 'staked' };
  const opens = Date.parse(unbondingAt) + periods.unbonding_s * 1000;
  const closes = opens + periods.claim_s * 1000;
  const t = now.getTime();
  if (t < opens) return { kind: 'unbonding', opensAt: new Date(opens).toISOString(), days: Math.ceil((opens - t) / DAY_MS) };
  if (t < closes) return { kind: 'claimable', closesAt: new Date(closes).toISOString(), days: Math.ceil((closes - t) / DAY_MS) };
  return { kind: 'lapsed', closedAt: new Date(closes).toISOString() };
}

export function stakerFacts(row: Row, staking: StakingFile, now: Date): StakerFacts {
  const [address, tag, stake, first, unbondingAt, holder, sinceRank, stakeRank, grabs] = row;
  const pool = tag === 'c' ? ('community' as const) : ('operator' as const);
  const p = staking[pool];
  const rate = pool === 'community' ? (staking.rewards?.community_rate_pct ?? null) : (staking.rewards?.operator_rate_pct ?? null);
  return {
    address,
    pool,
    stake,
    maxStake: p.max_stake,
    atMax: stake >= p.max_stake - 0.01,
    atMaxCount: stake >= p.max_stake - 0.01 ? p.at_max : null,
    since: first,
    days: Math.max(0, Math.floor((now.getTime() - Date.parse(first)) / DAY_MS)),
    sinceRank,
    stakeRank,
    poolStakers: p.stakers,
    dayOne: Date.parse(first) < Date.parse(staking.since) + 30 * DAY_MS,
    holder,
    grabs,
    status: statusOf(unbondingAt, staking.periods, now),
    yearly: rate === null ? null : (stake * rate) / 100,
    operatorName: pool === 'operator' ? (staking.operators.find((o) => o.address === address)?.name ?? null) : null,
  };
}

/** "top 15%" by principal, for a staker in the top half; null below it. */
export function topShare(f: Pick<StakerFacts, 'stakeRank' | 'poolStakers'>): string | null {
  if (f.poolStakers === 0) return null;
  const pct = (f.stakeRank * 100) / f.poolStakers;
  if (pct > 50) return null;
  return `top ${pct < 1 ? '1' : String(Math.ceil(pct))}%`;
}

/** Where a staker stands by size: "one of 1,329 at the max", or "#1,203 by size (top 15%)". */
export function sizeText(f: Pick<StakerFacts, 'atMaxCount' | 'stakeRank' | 'poolStakers'>): string {
  if (f.atMaxCount !== null && f.atMaxCount > 1) return `one of ${f.atMaxCount.toLocaleString('en-US')} at the max`;
  const top = topShare(f);
  return `#${f.stakeRank.toLocaleString('en-US')} by size${top ? ` (${top})` : ''}`;
}
