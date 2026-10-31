import type { StakingFile } from './public';
import { addDays } from './time';

const DAY_MS = 86_400_000;
/** Pool events an operator gets its own post for; stake top-ups and unbondings go in the weekly report. */
export const OPERATOR_MOMENT_KINDS = ['added', 'removed', 'unstaked'] as const;
export type OperatorMomentKind = (typeof OPERATOR_MOMENT_KINDS)[number];
/** The operator events the weekly report lists, newest first. */
export const WEEK_OPERATOR_EVENTS = 4;

type OperatorEvent = StakingFile['operator_events'][number];
type Week = StakingFile['weeks'][number];
type Opening = StakingFile['refills']['recent'][number];

export interface Hunter {
  address: string;
  /** Openings it took space in. */
  grabs: number;
  /** Of those, the ones refilled within a block, which makes its grab that quick too. */
  withinABlock: number;
}

/** A top hunter with a single grab is no story, so the weekly post and card name one from this many. */
export const HUNTER_MIN_GRABS = 2;

/** Who took space in the most of these openings, a tie going to the lower address; null when nobody took any. */
export function topHunter(openings: readonly Opening[]): Hunter | null {
  const hunters = new Map<string, Hunter>();
  for (const o of openings) {
    for (const address of new Set(o.grabs)) {
      const h = hunters.get(address) ?? { address, grabs: 0, withinABlock: 0 };
      h.grabs += 1;
      if (o.blocks !== null && o.blocks <= 1) h.withinABlock += 1;
      hunters.set(address, h);
    }
  }
  return [...hunters.values()].sort((a, b) => b.grabs - a.grabs || (a.address < b.address ? -1 : 1))[0] ?? null;
}

export interface StakingWeekFacts {
  monday: string;
  total: number;
  cap: number;
  full: boolean;
  /** Whole days the pool has been full, at the end of the week. */
  fullDays: number | null;
  stakers: number;
  week: Week;
  /** LINK that started unbonding in the week outside stake.link's ladder. */
  askedToLeave: number;
  openings: number;
  /** The quickest refill of an opening in the week, and who took the most space. */
  fastestRefillS: number | null;
  topHunter: Hunter | null;
  conversionPct: number | null;
  likelyToLeave: number;
  communityRatePct: number | null;
  operatorRatePct: number | null;
  operatorEvents: OperatorEvent[];
}

const inWeek = (iso: string, monday: string) => iso >= `${monday}T00:00:00.000Z` && iso < `${addDays(monday, 7)}T00:00:00.000Z`;

/**
 * The week from `monday` (UTC) as the weekly staking report tells it, or null until staking.json covers the whole week.
 * Openings and hunters come from the file's last 7 days of openings, so they cover the week only when it is read soon after.
 */
export function stakingWeekFacts(staking: StakingFile, monday: string): StakingWeekFacts | null {
  const end = `${addDays(monday, 7)}T00:00:00.000Z`;
  if (staking.updated_at < end) return null;
  const c = staking.community;
  const week = staking.weeks.find((w) => w.week === monday) ?? {
    week: monday, staked: 0, unstaked: 0, unbondings: 0, unbonding_link: 0, stakelink_unbonding_link: 0, new_stakers: 0, openings: 0,
  };
  const recent = staking.refills.recent.filter((r) => inWeek(r.opened_at, monday));
  const refills = recent.flatMap((r) => (r.seconds === null ? [] : [r.seconds]));
  const conv = staking.queue.conversion.others;
  return {
    monday,
    total: c.total,
    cap: c.cap,
    full: c.total >= c.cap - 0.001,
    fullDays: c.full_since === null ? null : Math.floor((Date.parse(end) - Date.parse(c.full_since)) / DAY_MS),
    stakers: c.stakers,
    week,
    askedToLeave: Math.max(0, week.unbonding_link - week.stakelink_unbonding_link),
    openings: week.openings,
    fastestRefillS: refills.length === 0 ? null : Math.min(...refills),
    topHunter: topHunter(recent),
    conversionPct: conv.total > 0 ? (conv.left * 100) / conv.total : null,
    likelyToLeave: staking.queue.likely_to_leave,
    communityRatePct: staking.rewards?.community_rate_pct ?? null,
    operatorRatePct: staking.rewards?.operator_rate_pct ?? null,
    operatorEvents: staking.operator_events.filter((e) => inWeek(e.ts, monday)).slice(0, WEEK_OPERATOR_EVENTS),
  };
}

export interface OperatorMomentFacts {
  kind: OperatorMomentKind;
  address: string;
  name: string | null;
  ts: string;
  /** LINK unstaked, or staked when removed. */
  amount: number | null;
  /** The operator's stake after an unstake. */
  stake: number | null;
  via: StakingFile['operators'][number]['via'] | null;
  /** The operator pool after the event's file was published. */
  operators: number;
  operatorTotal: number;
}

const isMoment = (e: OperatorEvent): e is OperatorEvent & { kind: OperatorMomentKind } => (OPERATOR_MOMENT_KINDS as readonly string[]).includes(e.kind);
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** The operator events that get their own post, newest first, each named by its address and Unix time. */
export function operatorMoments(staking: StakingFile): { address: string; at: number; ts: string }[] {
  return staking.operator_events.filter(isMoment).map((e) => ({ address: e.address, at: unix(e.ts), ts: e.ts }));
}

export function operatorMomentFacts(staking: StakingFile, address: string, at: number): OperatorMomentFacts | null {
  const e = staking.operator_events.find((x) => x.address === address && unix(x.ts) === at && isMoment(x));
  if (e === undefined || !isMoment(e)) return null;
  const roster = staking.operators.find((o) => o.address === address);
  return {
    kind: e.kind,
    address,
    name: e.name,
    ts: e.ts,
    amount: e.amount,
    stake: e.stake,
    via: roster?.via ?? null,
    operators: staking.operator.stakers,
    operatorTotal: staking.operator.total,
  };
}
