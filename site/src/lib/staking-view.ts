import { HOLDER_KINDS, type HolderKind, type StakingFile } from '@ccip-dev/core/public';

export type HiveKind = HolderKind | 'open';

export const HIVE_RINGS = 9;
const SQRT3 = Math.sqrt(3);

export const HOLDER_LABEL: Record<HolderKind, string> = {
  wallet: 'Wallets',
  smart: 'Smart wallets',
  stakelink: 'stake.link vaults',
  contract: 'Multisigs and other contracts',
};

/** One holder as the operator roster says it: what stakes for the operator. */
export const VIA_LABEL: Record<HolderKind, string> = {
  wallet: 'Wallet',
  smart: 'Smart wallet',
  stakelink: 'stake.link vault',
  contract: 'Multisig',
};

/** The centers of a hexagonal honeycomb of `rings` rings around one cell, center first then ring by ring, for cells of radius 1. */
export function hiveCenters(rings: number = HIVE_RINGS): { x: number; y: number }[] {
  const out = [{ x: 0, y: 0 }];
  // Axial directions of a pointy-top hex grid, walked around each ring.
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const;
  for (let r = 1; r <= rings; r++) {
    let q = -r;
    let s = r;
    for (const [dq, ds] of dirs) {
      for (let k = 0; k < r; k++) {
        out.push({ x: SQRT3 * (q + s / 2), y: 1.5 * s });
        q += dq;
        s += ds;
      }
    }
  }
  return out;
}

/** Splits `count` cells between the parts in proportion to their weights, by largest remainder. */
export function apportion(weights: readonly number[], count: number): number[] {
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return weights.map((_, i) => (i === weights.length - 1 ? count : 0));
  const exact = weights.map((w) => (Math.max(0, w) * count) / total);
  const out = exact.map(Math.floor);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const short = count - out.reduce((a, b) => a + b, 0);
  for (let k = 0; k < short; k++) out[order[k]![1]]! += 1;
  return out;
}

/** A deterministic shuffle (mulberry32), so the hive looks the same on every render of the same data. */
function shuffled<T>(items: T[], seed: number): T[] {
  let t = seed >>> 0;
  const rand = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4_294_967_296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Each cell of the community pool's hive by who holds that share of the cap. Any space still open takes the outermost
 * cells; the holders are scattered over the rest.
 */
export function hiveKinds(staking: Pick<StakingFile, 'community' | 'holders'>, count: number): HiveKind[] {
  const open = Math.max(0, staking.community.cap - staking.community.total);
  const link = HOLDER_KINDS.map((k) => staking.holders.find((h) => h.kind === k)?.link ?? 0);
  const cells = apportion([...link, open], count);
  const openCells = cells[HOLDER_KINDS.length]!;
  const held = shuffled(HOLDER_KINDS.flatMap((k, i) => Array.from({ length: cells[i]! }, () => k)), 2_023_11_28);
  return [...held, ...Array.from({ length: openCells }, () => 'open' as const)];
}

export interface ReplayStep {
  openedAt: string;
  gap: number;
  seconds: number | null;
  blocks: number | null;
  grabs: string[];
  /** Cells to darken: one per cell's worth of LINK, at least one. */
  cells: number;
  /** How long the gap shows on screen: a tenth of its real time, between 0.8 and 4 seconds. */
  holdMs: number;
}

export function replaySteps(recent: StakingFile['refills']['recent'], linkPerCell: number): ReplayStep[] {
  return recent
    .filter((r) => r.seconds !== null)
    .map((r) => ({
      openedAt: r.opened_at,
      gap: r.gap,
      seconds: r.seconds,
      blocks: r.blocks,
      grabs: r.grabs,
      cells: Math.max(1, Math.min(6, Math.round(r.gap / linkPerCell))),
      holdMs: Math.max(800, Math.min(4_000, (r.seconds ?? 0) * 100)),
    }));
}

export type BoardStatus = 'GATE OPEN' | 'BOARDING' | 'LADDER' | 'DEPARTED' | 'STAYED';

export interface BoardRow {
  day: string | null;
  status: BoardStatus;
  link: number;
  stakers: number | null;
  note: string;
}

/**
 * The departures board: claim windows open now, then each coming day a window opens (stake.link's ladder apart), then
 * the last week's closed windows, newest first, as LINK that left and LINK that stayed: `upcoming` days and `past` rows.
 */
export function boardRows(queue: StakingFile['queue'], upcoming = 7, past = 7): BoardRow[] {
  const rows: BoardRow[] = [];
  if (queue.claimable.link > 0) {
    rows.push({ day: null, status: 'GATE OPEN', link: queue.claimable.link, stakers: queue.claimable.stakers, note: 'claim window open now' });
  }
  for (const d of queue.days.slice(0, upcoming)) {
    const others = d.link - d.stakelink_link;
    if (others > 0) rows.push({ day: d.day, status: 'BOARDING', link: others, stakers: null, note: 'claim window opens' });
    if (d.stakelink_link > 0) rows.push({ day: d.day, status: 'LADDER', link: d.stakelink_link, stakers: null, note: 'stake.link vaults, which restake' });
  }
  const closed: BoardRow[] = [];
  for (const d of [...queue.closed].reverse()) {
    if (d.left > 0) closed.push({ day: d.day, status: 'DEPARTED', link: d.left, stakers: null, note: 'unstaked in its window' });
    const stayed = d.stayed + d.stakelink_stayed;
    if (stayed > 0) closed.push({ day: d.day, status: 'STAYED', link: stayed, stakers: null, note: d.stakelink_stayed > 0 ? 'window closed, stake.link included' : 'window closed, still staked' });
  }
  return [...rows, ...closed.slice(0, past)];
}

export interface DialDot {
  /** Days into the 28-day unbonding and 7-day claim window. */
  elapsed: number;
  link: number;
  stakelink: boolean;
}

/**
 * Where each cohort sits on the 35-day dial: a staker whose claim window opens in d days started unbonding 28 − d days
 * ago. Stakers with a window open now sit mid-window.
 */
export function dialDots(queue: StakingFile['queue'], periods: StakingFile['periods'], now: Date): DialDot[] {
  const unbondingDays = periods.unbonding_s / 86_400;
  const claimDays = periods.claim_s / 86_400;
  const today = Date.parse(now.toISOString().slice(0, 10));
  const dots: DialDot[] = [];
  for (const d of queue.days) {
    const daysUntil = Math.max(0, (Date.parse(`${d.day}T00:00:00Z`) - today) / 86_400_000);
    const elapsed = Math.max(0, unbondingDays - daysUntil);
    if (d.link - d.stakelink_link > 0) dots.push({ elapsed, link: d.link - d.stakelink_link, stakelink: false });
    if (d.stakelink_link > 0) dots.push({ elapsed, link: d.stakelink_link, stakelink: true });
  }
  const mid = unbondingDays + claimDays / 2;
  if (queue.claimable.link > 0) dots.push({ elapsed: mid, link: queue.claimable.link, stakelink: false });
  if (queue.claimable.stakelink_link > 0) dots.push({ elapsed: mid, link: queue.claimable.stakelink_link, stakelink: true });
  return dots;
}

/** A point on a circle, clockwise from 12 o'clock, for `fraction` of a turn. */
export function onDial(fraction: number, r: number, cx = 0, cy = 0): { x: number; y: number } {
  const a = fraction * 2 * Math.PI - Math.PI / 2;
  return { x: Math.round((cx + r * Math.cos(a)) * 10) / 10, y: Math.round((cy + r * Math.sin(a)) * 10) / 10 };
}

export function sharePct(part: number, whole: number): number | null {
  return whole > 0 ? (part * 100) / whole : null;
}

/** LINK a year a stake earns at a yearly rate. */
export function yearlyReward(stake: number, ratePct: number | null): number | null {
  return ratePct === null ? null : (stake * ratePct) / 100;
}

/** A community stake clamped to the pool's limits. */
export function clampStake(value: number, community: Pick<StakingFile['community'], 'min_stake' | 'max_stake'>): number {
  if (!Number.isFinite(value)) return community.min_stake;
  return Math.min(community.max_stake, Math.max(community.min_stake, value));
}

export function etherscanAddress(address: string): string {
  return `https://etherscan.io/address/${address}`;
}

/** A staker's card on ccip.dev. */
export function stakerHref(address: string): string {
  return `/staking/${address.toLowerCase()}/`;
}

export function shortHex(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** LINK that started unbonding in a week outside stake.link's ladder: the tape's trace. */
export const tapeAsked = (w: StakingFile['weeks'][number]) => Math.max(0, w.unbonding_link - w.stakelink_unbonding_link);

/**
 * The tape's top in LINK a week: the busiest ordinary week in or out, or the most LINK that asked to leave in a week,
 * whichever is higher, so the trace always fits. The launch weeks moved the whole pool, so they run off the top.
 */
export function tapeMax(weeks: StakingFile['weeks']): number {
  const flows = weeks.flatMap((w) => [w.staked, w.unstaked]).sort((a, b) => a - b);
  const busiest = flows[Math.floor(flows.length * 0.97)] ?? 0;
  return Math.max(1, busiest, ...weeks.map(tapeAsked)) * 1.08;
}

const TAPE_GRIDS = [5_000_000, 2_000_000, 1_000_000, 500_000, 200_000, 100_000, 50_000, 20_000, 10_000];

/** The tape's gridline: the largest round amount that sits well below its top. */
export function tapeGrid(max: number): number {
  return TAPE_GRIDS.find((g) => g <= max * 0.85) ?? TAPE_GRIDS.at(-1)!;
}

/** Weekly tape bars, newest last, up to `weeks` of them. */
export function tapeWeeks(weeks: StakingFile['weeks'], count: number): StakingFile['weeks'] {
  return weeks.slice(-count);
}

/** Days until an ISO time, rounded down, never negative. */
export function daysUntil(iso: string, now: Date): number {
  return Math.max(0, Math.floor((Date.parse(iso) - now.getTime()) / 86_400_000));
}

export interface TimelapseFrame {
  week: string;
  /** LINK in the community pool at the week's end. */
  level: number;
  /** Everyone who had staked by the week's end. */
  stakers: number;
  staked: number;
  unstaked: number;
  /** LINK that asked to leave outside stake.link's ladder. */
  asked: number;
}

/** The community pool week by week, from its running sums: what the timelapse plays. */
export function timelapseFrames(weeks: StakingFile['weeks'], cap: number): TimelapseFrame[] {
  let level = 0;
  let stakers = 0;
  return weeks.map((w) => {
    level = Math.min(cap, Math.max(0, level + w.staked - w.unstaked));
    stakers += w.new_stakers;
    return { week: w.week, level, stakers, staked: w.staked, unstaked: w.unstaked, asked: Math.max(0, w.unbonding_link - w.stakelink_unbonding_link) };
  });
}
