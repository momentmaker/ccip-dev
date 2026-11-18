import { ethRpcBatchSettled, isRevert, onFirstEndpoint, type Fetcher } from './eth-rpc';
import { PEG_POOL, STLINK_TOKEN } from './peg';
import { linkUnits } from './staking';

export const PRIORITY_POOL = '0xddc796a66e8b83d0bccd97df33a6ccfba8fd60ea';
export const WITHDRAWAL_POOL = '0xa60b5146e44ff755e32bd51532842ceb41d0c248';
export const FUND_FLOW_CONTROLLER = '0xd2e7381d8d3fcc97c1b4d88761bdbc8dd26a0200';
/** Swap sizes quoted each check, in LINK (or stLINK) in. */
export const PEG_LADDER = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000] as const;

const SELECTOR = {
  getP: '0xec023862',
  priceOracle: '0x68727653',
  getDy: '0x5e0d443f',
  poolStatus: '0xf0228692',
  totalQueued: '0x53ac4b66',
  canDeposit: '0xe78a5875',
  strategyDepositRoom: '0x050b4d13',
  unusedDeposits: '0x50be8596',
  unusedDepositLimit: '0xb68c7462',
  allowInstantWithdrawals: '0x73ccbcc4',
  canWithdraw: '0xb51459fe',
  totalQueuedWithdrawals: '0xf990f4bf',
  timeOfLastWithdrawal: '0x19855690',
  minTimeBetweenWithdrawals: '0xb9cbd8c4',
  claimPeriodActive: '0xfa8b3d30',
} as const;

const word = (n: bigint) => n.toString(16).padStart(64, '0');
const WEI = 10n ** 18n;
const call = (to: string, data: string) => ({ method: 'eth_call', params: [{ to, data }, 'latest'] });
const getDy = (i: number, j: number, size: number) => call(PEG_POOL, `${SELECTOR.getDy}${word(BigInt(i))}${word(BigInt(j))}${word(BigInt(size) * WEI)}`);

/** In decodePegReading's order: Curve prices and ladders, then the mint route, then the redeem route. */
export function pegCalls() {
  return [
    call(PEG_POOL, `${SELECTOR.getP}${word(0n)}`),
    call(PEG_POOL, `${SELECTOR.priceOracle}${word(0n)}`),
    ...PEG_LADDER.map((size) => getDy(0, 1, size)),
    ...PEG_LADDER.map((size) => getDy(1, 0, size)),
    call(PRIORITY_POOL, SELECTOR.poolStatus),
    call(PRIORITY_POOL, SELECTOR.totalQueued),
    call(STLINK_TOKEN, SELECTOR.canDeposit),
    call(STLINK_TOKEN, SELECTOR.strategyDepositRoom),
    call(STLINK_TOKEN, SELECTOR.unusedDeposits),
    call(STLINK_TOKEN, SELECTOR.unusedDepositLimit),
    call(PRIORITY_POOL, SELECTOR.allowInstantWithdrawals),
    call(STLINK_TOKEN, SELECTOR.canWithdraw),
    call(WITHDRAWAL_POOL, SELECTOR.totalQueuedWithdrawals),
    call(WITHDRAWAL_POOL, SELECTOR.timeOfLastWithdrawal),
    call(WITHDRAWAL_POOL, SELECTOR.minTimeBetweenWithdrawals),
    call(FUND_FLOW_CONTROLLER, SELECTOR.claimPeriodActive),
  ];
}

export interface PegReading {
  spot: number;
  ema: number;
  buySt: number[];
  sellSt: number[];
  poolStatus: number;
  totalQueued: number;
  canDeposit: number;
  strategyDepositRoom: number;
  unusedDeposits: number;
  unusedDepositLimit: number;
  allowInstantWithdrawals: boolean;
  canWithdraw: number;
  queuedWithdrawals: number;
  lastWithdrawalAt: string;
  minWithdrawalGapS: number;
  claimPeriodActive: boolean;
}

function oneWord(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('malformed call result');
  return BigInt(value);
}

export function decodePegReading(w: readonly bigint[]): PegReading {
  const n = PEG_LADDER.length;
  const at = (i: number) => w[i]!;
  const link = (i: number) => linkUnits(at(i));
  const s = 2 + 2 * n;
  return {
    spot: link(0),
    ema: link(1),
    buySt: PEG_LADDER.map((_, k) => link(2 + k)),
    sellSt: PEG_LADDER.map((_, k) => link(2 + n + k)),
    poolStatus: Number(at(s)),
    totalQueued: link(s + 1),
    canDeposit: link(s + 2),
    strategyDepositRoom: link(s + 3),
    unusedDeposits: link(s + 4),
    unusedDepositLimit: link(s + 5),
    allowInstantWithdrawals: at(s + 6) !== 0n,
    canWithdraw: link(s + 7),
    queuedWithdrawals: link(s + 8),
    lastWithdrawalAt: new Date(Number(at(s + 9)) * 1000).toISOString(),
    minWithdrawalGapS: Number(at(s + 10)),
    claimPeriodActive: at(s + 11) !== 0n,
  };
}

/** A ladder rung the pool cannot fill reverts; it reads as nothing out, so it is simply not profitable. Any other failed call fails the endpoint. */
export async function readPegLive(deps: Fetcher, rpcUrls: string[]): Promise<PegReading> {
  const calls = pegCalls();
  const rungs = 2 * PEG_LADDER.length;
  return onFirstEndpoint(rpcUrls, 'stLINK peg read', async (url) => {
    const settled = await ethRpcBatchSettled(deps, url, calls);
    return decodePegReading(
      settled.map((s, i) => {
        if (s.ok) return oneWord(s.result);
        if (i >= 2 && i < 2 + rungs && isRevert(s.message)) return 0n;
        throw new Error(`call ${i} failed: ${s.message}`);
      }),
    );
  });
}

/** The largest ladder rung whose swap returns more than it puts in. Pool fees are inside get_dy; gas is not. */
export function curveDepth(outs: readonly number[]): { size: number; profit: number } | null {
  let best: { size: number; profit: number } | null = null;
  for (const [k, size] of PEG_LADDER.entries()) {
    const profit = outs[k]! - size;
    if (profit > 0) best = { size, profit };
  }
  return best;
}

/** Profit at `x`, linear between rungs and from zero below the first. */
export function profitAt(outs: readonly number[], x: number): number {
  let fromSize = 0;
  let fromProfit = 0;
  for (const [k, size] of PEG_LADDER.entries()) {
    const profit = outs[k]! - size;
    if (x <= size) return fromProfit + ((profit - fromProfit) * (x - fromSize)) / (size - fromSize);
    fromSize = size;
    fromProfit = profit;
  }
  return fromProfit;
}

/** stLINK → LINK at 1:1 now (PriorityPool._withdraw): queued LINK first, then the pool only with instant withdrawals on and nobody waiting. */
export function redeemInstant(r: PegReading): number {
  if (r.poolStatus === 2) return 0;
  return r.totalQueued + (r.allowInstantWithdrawals && r.queuedWithdrawals === 0 ? r.canWithdraw : 0);
}

/**
 * LINK → stLINK at 1:1 now (PriorityPool._deposit): only while nothing is queued, first into the withdrawal queue, then into
 * the pool's room. The room's cap by unusedDepositLimit is read from StakingPool.deposit's InvalidDeposit check, not simulated.
 */
export function mintInstant(r: PegReading): number {
  if (r.poolStatus !== 0 || r.totalQueued > 0) return 0;
  const room = Math.min(r.canDeposit, r.strategyDepositRoom + Math.max(0, r.unusedDepositLimit - r.unusedDeposits));
  return r.queuedWithdrawals + room;
}

export interface PegRouteView {
  depth: number | null;
  profit: number | null;
  instant: number;
  tradeable: number;
  tradeable_profit: number | null;
  queued_ahead: number;
}

export interface PegLiveBody {
  pool: string;
  spot: number;
  ema: number;
  gap: number;
  ladder: { size: number; buy_st: number; sell_st: number }[];
  discount: PegRouteView & { next_payout_after: string; claim_window_open: boolean };
  premium: PegRouteView;
  routes: { pool_status: 'open' | 'draining' | 'closed'; instant_withdrawals: boolean };
}

const POOL_STATUS = ['open', 'draining', 'closed'] as const;

function route(outs: readonly number[], instant: number, queuedAhead: number): PegRouteView {
  const depth = curveDepth(outs);
  const tradeable = depth === null ? 0 : Math.min(depth.size, instant);
  return {
    depth: depth?.size ?? null,
    profit: depth?.profit ?? null,
    instant,
    tradeable,
    tradeable_profit: tradeable > 0 ? profitAt(outs, tradeable) : null,
    queued_ahead: queuedAhead,
  };
}

/** A discount is bought on Curve and redeemed at 1:1; a premium is minted at 1:1 and sold on Curve. */
export function pegLiveBody(r: PegReading): PegLiveBody {
  return {
    pool: PEG_POOL,
    spot: r.spot,
    ema: r.ema,
    gap: r.spot - 1,
    ladder: PEG_LADDER.map((size, k) => ({ size, buy_st: r.buySt[k]!, sell_st: r.sellSt[k]! })),
    discount: {
      ...route(r.buySt, redeemInstant(r), r.queuedWithdrawals),
      next_payout_after: new Date(Date.parse(r.lastWithdrawalAt) + r.minWithdrawalGapS * 1000).toISOString(),
      claim_window_open: r.claimPeriodActive,
    },
    premium: route(r.sellSt, mintInstant(r), r.totalQueued),
    routes: { pool_status: POOL_STATUS[r.poolStatus] ?? 'closed', instant_withdrawals: r.allowInstantWithdrawals },
  };
}
