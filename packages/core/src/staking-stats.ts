import type { StakersFile, StakingFile } from './public';
import { HOLDER_KINDS, linkUnits, type HolderKind, type StakingChain, type StakingEvent } from './staking';
import { dayOf, weekStart } from './time';

const DAY_S = 86_400;
const YEAR_S = 365 * DAY_S;
/** Under a thousandth of a LINK from the cap counts as full: the pool's own total carries wei-level dust. */
const FULL_TOLERANCE = 0.001;
/** A staker within a cent of the per-staker maximum counts as maxed out: there is no meaningful room left. */
const MAX_TOLERANCE = 0.01;
/** Openings, closed claim windows and leaders look back this far. */
export const RECENT_DAYS = 7;
export const LEADERS = 10;
const SIZE_EDGES = [100, 1_000, 5_000] as const;

export type StakingBody = Omit<StakingFile, 'schema_version' | 'updated_at' | 'attribution'>;

export interface StakingStatsInput {
  /** Every staking event, in chain order. */
  events: readonly StakingEvent[];
  chain: StakingChain;
  holders: ReadonlyMap<string, HolderKind>;
  /** Node operator names by lowercase staking address (labels/staking-operators.json). */
  names: Readonly<Record<string, string>>;
  now: Date;
  asOfBlock: number;
}

interface Staker {
  stake: number;
  first: string | null;
  unbondingAt: string | null;
  /** Principal when the unbonding started. */
  unbondingLink: number;
}

interface UnbondStart {
  staker: string;
  at: string;
  link: number;
}

interface Opening {
  openedAt: string;
  openedBlock: number;
  gap: number;
  filledAt: string | null;
  filledBlock: number | null;
  grabs: { staker: string; at: string; link: number }[];
}

const seconds = (iso: string) => Date.parse(iso) / 1000;
const median = (xs: readonly number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const percentile = (xs: readonly number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};
const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Replays every event into each pool's stakers, the community pool's openings and unbonding starts, and the operator allowlist. */
function replay(events: readonly StakingEvent[], communityCap: number) {
  const pools = { community: new Map<string, Staker>(), operator: new Map<string, Staker>() };
  const allowlist = new Map<string, 'active' | 'removed'>();
  const starts: UnbondStart[] = [];
  const unstakes = new Map<string, { at: string; link: number }[]>();
  const openings: Opening[] = [];
  let open: Opening | null = null;
  let filled = false;
  let fullSince: string | null = null;
  const get = (pool: 'community' | 'operator', who: string) => {
    let s = pools[pool].get(who);
    if (!s) {
      s = { stake: 0, first: null, unbondingAt: null, unbondingLink: 0 };
      pools[pool].set(who, s);
    }
    return s;
  };
  for (const e of events) {
    if (e.kind === 'operator_added') {
      allowlist.set(e.staker, 'active');
      continue;
    }
    if (e.kind === 'operator_removed') {
      allowlist.set(e.staker, 'removed');
      continue;
    }
    const s = get(e.pool, e.staker);
    if (e.kind === 'unbonding') {
      s.unbondingAt = e.ts;
      s.unbondingLink = s.stake;
      if (e.pool === 'community') starts.push({ staker: e.staker, at: e.ts, link: s.stake });
      continue;
    }
    if (e.kind === 'reset') {
      s.unbondingAt = null;
      continue;
    }
    const amount = linkUnits(e.amount ?? '0');
    s.stake = linkUnits(e.stake ?? '0');
    if (e.kind === 'staked') s.first ??= e.ts;
    else {
      s.unbondingAt = null;
      if (e.pool === 'community') unstakes.set(e.staker, [...(unstakes.get(e.staker) ?? []), { at: e.ts, link: amount }]);
    }
    if (e.pool !== 'community' || e.total === null) continue;
    const total = linkUnits(e.total);
    const full = total >= communityCap - FULL_TOLERANCE;
    if (full && !filled) {
      filled = true;
      fullSince = e.ts;
    }
    if (!filled) continue;
    if (!full && open === null) {
      open = { openedAt: e.ts, openedBlock: e.blockNumber, gap: communityCap - total, filledAt: null, filledBlock: null, grabs: [] };
      openings.push(open);
    } else if (open !== null) {
      open.gap = Math.max(open.gap, communityCap - total);
      if (e.kind === 'staked') open.grabs.push({ staker: e.staker, at: e.ts, link: amount });
      if (full) {
        open.filledAt = e.ts;
        open.filledBlock = e.blockNumber;
        open = null;
      }
    }
  }
  return { pools, allowlist, starts, unstakes, openings, fullSince };
}

const kindOf = (holders: ReadonlyMap<string, HolderKind>, who: string): HolderKind => holders.get(who) ?? 'wallet';

/** Whether an unbonding that started at `at` ended in an unstake inside its claim window. */
function leftInWindow(unstakes: readonly { at: string }[] | undefined, at: string, unbondingS: number, claimS: number): boolean {
  const opens = seconds(at) + unbondingS;
  return (unstakes ?? []).some((u) => seconds(u.at) >= opens - 3_600 && seconds(u.at) <= opens + claimS + 3_600);
}

export function stakingStats(input: StakingStatsInput): StakingBody {
  const { chain, holders, names, now } = input;
  const nowS = now.getTime() / 1000;
  const cap = chain.community.maxPoolSize;
  const { unbondingSeconds: unbondingS, claimSeconds: claimS } = chain.community;
  const r = replay(input.events, cap);
  const community = [...r.pools.community].filter(([, s]) => s.stake > 0);
  const stakes = community.map(([, s]) => s.stake);
  const launch = input.events[0]?.ts ?? now.toISOString();
  const maxStake = chain.community.maxStake;

  const holderRows = HOLDER_KINDS.map((kind) => {
    const rows = community.filter(([who]) => kindOf(holders, who) === kind);
    return { kind, stakers: rows.length, link: round(rows.reduce((s, [, x]) => s + x.stake, 0)) };
  });
  const edges = [0, ...SIZE_EDGES, maxStake];
  const sizes = edges.map((min, i) => {
    const max = i + 1 < edges.length ? edges[i + 1]! : null;
    const rows = stakes.filter((v) => (max === null ? v >= min - MAX_TOLERANCE : v >= min && v < max - MAX_TOLERANCE));
    return { min, max, stakers: rows.length, link: round(rows.reduce((s, v) => s + v, 0)) };
  });

  const firstMonth = seconds(launch) + 30 * DAY_S;
  const tenures = community.map(([, s]) => (s.first ? (nowS - seconds(s.first)) / DAY_S : 0));
  const byYear = new Map<string, number>();
  for (const [, s] of community) if (s.first) byYear.set(s.first.slice(0, 4), (byYear.get(s.first.slice(0, 4)) ?? 0) + 1);

  // The exit queue: unbonding now, claim windows open now, and the days LINK becomes claimable.
  const split = () => ({ stakers: 0, link: 0, stakelink_stakers: 0, stakelink_link: 0 });
  const unbonding = split();
  const claimable = split();
  const days = new Map<string, { link: number; stakelink_link: number; stakers: number }>();
  let lapsed = 0;
  for (const [who, s] of community) {
    if (s.unbondingAt === null) continue;
    const opens = seconds(s.unbondingAt) + unbondingS;
    const sl = kindOf(holders, who) === 'stakelink';
    if (nowS < opens) {
      const bucket = sl ? 'stakelink' : 'others';
      if (bucket === 'stakelink') {
        unbonding.stakelink_stakers += 1;
        unbonding.stakelink_link += s.stake;
      } else {
        unbonding.stakers += 1;
        unbonding.link += s.stake;
      }
      const day = dayOf(new Date(opens * 1000));
      const d = days.get(day) ?? { link: 0, stakelink_link: 0, stakers: 0 };
      if (sl) d.stakelink_link += s.stake;
      else d.link += s.stake;
      d.stakers += 1;
      days.set(day, d);
    } else if (nowS < opens + claimS) {
      if (sl) {
        claimable.stakelink_stakers += 1;
        claimable.stakelink_link += s.stake;
      } else {
        claimable.stakers += 1;
        claimable.link += s.stake;
      }
    } else lapsed += 1;
  }
  const ratio = () => ({ left: 0, total: 0 });
  const conversion = { others: ratio(), stakelink: ratio() };
  const closed = new Map<string, { left: number; stayed: number; stakelink_stayed: number }>();
  for (const st of r.starts) {
    const closes = seconds(st.at) + unbondingS + claimS;
    if (closes > nowS) continue;
    const left = leftInWindow(r.unstakes.get(st.staker), st.at, unbondingS, claimS);
    const sl = kindOf(holders, st.staker) === 'stakelink';
    const c = sl ? conversion.stakelink : conversion.others;
    c.total += 1;
    if (left) c.left += 1;
    if (closes >= nowS - RECENT_DAYS * DAY_S) {
      const day = dayOf(new Date(closes * 1000));
      const row = closed.get(day) ?? { left: 0, stayed: 0, stakelink_stayed: 0 };
      if (left) row.left += st.link;
      else if (sl) row.stakelink_stayed += st.link;
      else row.stayed += st.link;
      closed.set(day, row);
    }
  }
  const othersRate = conversion.others.total ? conversion.others.left / conversion.others.total : 0;

  // Openings: every time the full community pool dropped below its cap, until it was full again.
  const done = r.openings.filter((o) => o.filledAt !== null);
  const refillS = done.map((o) => seconds(o.filledAt!) - seconds(o.openedAt));
  const blocks = done.map((o) => o.filledBlock! - o.openedBlock);
  const hunters = new Map<string, { grabs: number; link: number; fastest: number }>();
  for (const o of r.openings) {
    for (const g of o.grabs) {
      const h = hunters.get(g.staker) ?? { grabs: 0, link: 0, fastest: Infinity };
      h.grabs += 1;
      h.link += g.link;
      h.fastest = Math.min(h.fastest, seconds(g.at) - seconds(o.openedAt));
      hunters.set(g.staker, h);
    }
  }
  const recentFrom = nowS - RECENT_DAYS * DAY_S;

  // Weeks, by Monday (UTC).
  const weeks = new Map<string, { staked: number; unstaked: number; unbondings: number; unbonding_link: number; new_stakers: number; openings: number }>();
  const week = (iso: string) => {
    const w = weekStart(iso);
    let row = weeks.get(w);
    if (!row) {
      row = { staked: 0, unstaked: 0, unbondings: 0, unbonding_link: 0, new_stakers: 0, openings: 0 };
      weeks.set(w, row);
    }
    return row;
  };
  for (const e of input.events) {
    if (e.pool !== 'community') continue;
    if (e.kind === 'staked') week(e.ts).staked += linkUnits(e.amount ?? '0');
    if (e.kind === 'unstaked') week(e.ts).unstaked += linkUnits(e.amount ?? '0');
  }
  for (const st of r.starts) {
    week(st.at).unbondings += 1;
    week(st.at).unbonding_link += st.link;
  }
  for (const [, s] of r.pools.community) if (s.first) week(s.first).new_stakers += 1;
  for (const o of r.openings) week(o.openedAt).openings += 1;

  // Node operators.
  const opStakers = r.pools.operator;
  const operators = [...r.allowlist].map(([address, status]) => {
    const s = opStakers.get(address);
    return { address, name: names[address] ?? null, via: kindOf(holders, address), stake: round(s?.stake ?? 0), since: s?.first ?? null, status };
  });
  operators.sort((a, b) => (a.status === b.status ? b.stake - a.stake || (a.address < b.address ? -1 : 1) : a.status === 'active' ? -1 : 1));
  const activeStaked = operators.filter((o) => o.status === 'active' && o.stake > 0);
  const operatorEvents = input.events
    .filter((e) => e.pool === 'operator' && e.kind !== 'reset')
    .map((e) => ({
      ts: e.ts,
      kind: e.kind === 'operator_added' ? ('added' as const) : e.kind === 'operator_removed' ? ('removed' as const) : (e.kind as 'staked' | 'unstaked' | 'unbonding'),
      address: e.staker,
      name: names[e.staker] ?? null,
      amount: e.amount === null ? null : round(linkUnits(e.amount)),
      stake: e.stake === null ? null : round(linkUnits(e.stake)),
    }))
    .reverse();

  const slCommunity = community.filter(([who]) => kindOf(holders, who) === 'stakelink');
  const slOperators = activeStaked.filter((o) => o.via === 'stakelink');
  const rewards = chain.rewards;
  const opTotal = chain.operator.totalPrincipal;
  const cTotal = chain.community.totalPrincipal;

  return {
    as_of_block: input.asOfBlock,
    since: launch,
    periods: { unbonding_s: unbondingS, claim_s: claimS },
    community: {
      total: round(cTotal),
      cap,
      min_stake: chain.community.minStake,
      max_stake: maxStake,
      stakers: community.length,
      ever: [...r.pools.community.values()].filter((s) => s.first !== null).length,
      at_max: stakes.filter((v) => v >= maxStake - MAX_TOLERANCE).length,
      median: round(median(stakes)),
      mean: round(stakes.length ? stakes.reduce((a, b) => a + b, 0) / stakes.length : 0),
      full_since: r.fullSince,
    },
    operator: {
      total: round(opTotal),
      cap: chain.operator.maxPoolSize,
      min_stake: chain.operator.minStake,
      max_stake: chain.operator.maxStake,
      stakers: activeStaked.length,
      allowlisted: operators.filter((o) => o.status === 'active').length,
      removed: operators.filter((o) => o.status === 'removed').length,
      at_max: activeStaked.filter((o) => o.stake >= chain.operator.maxStake - MAX_TOLERANCE).length,
    },
    rewards:
      rewards === null
        ? null
        : {
            community_per_s: rewards.communityBase.perSecond,
            operator_per_s: rewards.operatorBase.perSecond,
            delegated_per_s: rewards.operatorDelegated.perSecond,
            ends_at: rewards.communityBase.endsAt,
            community_rate_pct: cTotal > 0 ? round((rewards.communityBase.perSecond * YEAR_S * 100) / cTotal) : null,
            operator_rate_pct: opTotal > 0 ? round(((rewards.operatorBase.perSecond + rewards.operatorDelegated.perSecond) * YEAR_S * 100) / opTotal) : null,
          },
    holders: holderRows,
    sizes,
    tenure: {
      first_month: community.filter(([, s]) => s.first !== null && seconds(s.first) < firstMonth).length,
      median_days: Math.round(median(tenures)),
      by_year: [...byYear].sort(([a], [b]) => (a < b ? -1 : 1)).map(([year, stakers]) => ({ year, stakers })),
    },
    queue: {
      unbonding: { ...unbonding, link: round(unbonding.link), stakelink_link: round(unbonding.stakelink_link) },
      claimable: { ...claimable, link: round(claimable.link), stakelink_link: round(claimable.stakelink_link) },
      days: [...days].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, d]) => ({ day, link: round(d.link), stakelink_link: round(d.stakelink_link), stakers: d.stakers })),
      closed: [...closed].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, d]) => ({ day, left: round(d.left), stayed: round(d.stayed), stakelink_stayed: round(d.stakelink_stayed) })),
      conversion,
      likely_to_leave: round(unbonding.link * othersRate),
      lapsed,
    },
    refills: {
      openings: done.length,
      median_s: Math.round(median(refillS)),
      p90_s: Math.round(percentile(refillS, 0.9)),
      same_block: blocks.filter((b) => b === 0).length,
      next_block: blocks.filter((b) => b === 1).length,
      hunters: hunters.size,
      leaders: [...hunters]
        .sort(([a, x], [b, y]) => y.grabs - x.grabs || y.link - x.link || (a < b ? -1 : 1))
        .slice(0, LEADERS)
        .map(([address, h]) => ({ address, grabs: h.grabs, link: round(h.link), fastest_s: Math.round(h.fastest) })),
      recent: r.openings
        .filter((o) => seconds(o.openedAt) >= recentFrom)
        .map((o) => ({
          opened_at: o.openedAt,
          gap: round(o.gap),
          seconds: o.filledAt === null ? null : Math.round(seconds(o.filledAt) - seconds(o.openedAt)),
          blocks: o.filledBlock === null ? null : o.filledBlock - o.openedBlock,
          grabs: [...new Set(o.grabs.map((g) => g.staker))],
        })),
    },
    weeks: [...weeks].sort(([a], [b]) => (a < b ? -1 : 1)).map(([w, x]) => ({ week: w, staked: round(x.staked), unstaked: round(x.unstaked), unbondings: x.unbondings, unbonding_link: round(x.unbonding_link), new_stakers: x.new_stakers, openings: x.openings })),
    operators,
    operator_events: operatorEvents,
    stakelink: {
      community_vaults: slCommunity.length,
      community_link: round(slCommunity.reduce((s, [, x]) => s + x.stake, 0)),
      operator_vaults: slOperators.length,
      operator_link: round(slOperators.reduce((s, o) => s + o.stake, 0)),
    },
  };
}

/** Every current staker in both pools: address, pool, principal, first stake, unbonding start and holder, for the staker cards and reminders. */
export function stakerRows(input: Pick<StakingStatsInput, 'events' | 'holders' | 'chain'>): StakersFile['stakers'] {
  const r = replay(input.events, input.chain.community.maxPoolSize);
  const rows: StakersFile['stakers'] = [];
  for (const [pool, tag] of [['community', 'c'], ['operator', 'o']] as const) {
    for (const [address, s] of r.pools[pool]) {
      if (s.stake <= 0 || s.first === null) continue;
      rows.push([address, tag, round(s.stake, 4), s.first, s.unbondingAt, kindOf(input.holders, address)]);
    }
  }
  return rows.sort((a, b) => (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : a[0] < b[0] ? -1 : 1));
}
