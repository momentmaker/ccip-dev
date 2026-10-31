import type { ReserveFile } from '@ccip-dev/core/public';
import { dayOf } from '@ccip-dev/core/time';
import { formatCountdown } from './format';

export const DEPOSIT_PAST_DUE = 'Deposit expected — watching';
export const OVERDUE_GRACE_MS = 24 * 3_600_000;
const MILLION = 1_000_000;

export type Countdown =
  | { kind: 'none' }
  | { kind: 'counting'; text: string }
  | { kind: 'expected'; text: string }
  | { kind: 'overdue'; text: string };

export function vaultFill(link: number | null | undefined): { target: number; fraction: number } | null {
  if (link === null || link === undefined) return null;
  const target = (Math.floor(link / MILLION) + 1) * MILLION;
  return { target, fraction: link / target };
}

export function countdown(nextIso: string | null, overdueFlag: boolean, nowMs: number): Countdown {
  if (nextIso === null) return { kind: 'none' };
  const due = Date.parse(nextIso);
  if (overdueFlag || nowMs - due > OVERDUE_GRACE_MS) {
    return { kind: 'overdue', text: `Overdue by ${Math.max(1, Math.floor((nowMs - due) / 3_600_000))} h` };
  }
  if (nowMs >= due) return { kind: 'expected', text: DEPOSIT_PAST_DUE };
  return { kind: 'counting', text: formatCountdown(due - nowMs) };
}

export interface DepositWeek {
  week: string;
  link: number;
  /** The average price the Reserve paid that week, in USD per LINK. */
  price: number | null;
}

/** Each week the Reserve deposited, with the price it paid. */
export function depositWeeks(weekly: ReserveFile['weekly']): DepositWeek[] {
  return weekly.filter((w) => w.deposits > 0).map((w) => ({ week: w.week, link: w.link, price: w.link > 0 ? w.usd / w.link : null }));
}

export interface Crossing {
  link: number;
  ts: string;
  /** Days since the million before, or since the first transfer for the first million. */
  days: number;
}

const DAY_MS = 86_400_000;

/** When the Reserve's balance first reached each whole million, replaying its transfers in time order. */
export function millionCrossings(transfers: ReserveFile['transfers']): Crossing[] {
  const ordered = [...transfers].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const out: Crossing[] = [];
  let balance = 0;
  let previous = ordered[0]?.ts ?? null;
  for (const t of ordered) {
    balance += t.direction === 'in' ? t.link : -t.link;
    const reached = out.at(-1)?.link ?? 0;
    for (let m = reached + MILLION; m <= balance; m += MILLION) {
      out.push({ link: m, ts: t.ts, days: Math.round((Date.parse(t.ts) - Date.parse(previous!)) / DAY_MS) });
      previous = t.ts;
    }
  }
  return out;
}

export interface RoadStop {
  link: number;
  reached: boolean;
  /** The UTC day it was reached, or is expected at this pace; null ahead without a pace. */
  day: string | null;
  /** Days the million took, for the ones reached. */
  days: number | null;
}

/**
 * The road to 1% of all LINK: each million the Reserve has reached, with the day and how long it took, then the ones
 * ahead dated at the 4-week pace from the latest balance.
 */
export function roadTo(reserve: Pick<ReserveFile, 'latest' | 'pace' | 'transfers'>): RoadStop[] {
  const latest = reserve.latest;
  const pace = reserve.pace;
  if (latest === null || pace === null || pace.supply_share_pct <= 0) return [];
  const onePercent = Math.max(MILLION, Math.round(latest.link / pace.supply_share_pct / MILLION) * MILLION);
  const reached: RoadStop[] = millionCrossings(reserve.transfers).map((c) => ({ link: c.link, reached: true, day: dayOf(c.ts), days: c.days }));
  const weekly = pace.avg_weekly_link_4w;
  const ahead: RoadStop[] = [];
  for (let m = (Math.floor(latest.link / MILLION) + 1) * MILLION; m <= onePercent; m += MILLION) {
    const day =
      pace.next_milestone?.link === m
        ? pace.next_milestone.eta
        : weekly !== null && weekly > 0
          ? dayOf(new Date(Date.parse(latest.ts) + ((m - latest.link) / weekly) * 7 * DAY_MS))
          : null;
    ahead.push({ link: m, reached: false, day, days: null });
  }
  return [...reached, ...ahead];
}

export interface Stack {
  deposits: number;
  invested: number;
  link: number;
  value: number | null;
  changePct: number | null;
}

/** Buying `perDeposit` dollars of LINK every week the Reserve deposited, at the price it paid: what you'd hold now. */
export function stackWithReserve(weeks: DepositWeek[], perDeposit: number, priceNow: number | null): Stack {
  const priced = weeks.filter((w) => w.price !== null && w.price > 0);
  const link = priced.reduce((sum, w) => sum + perDeposit / w.price!, 0);
  const invested = perDeposit * priced.length;
  const value = priceNow === null ? null : link * priceNow;
  return { deposits: priced.length, invested, link, value, changePct: value === null || invested <= 0 ? null : ((value - invested) * 100) / invested };
}

/** Seconds the Reserve takes to stack `bag` LINK at `weeklyLink` a week; null without a pace. */
export function timeToStack(bag: number, weeklyLink: number | null): number | null {
  return weeklyLink === null || weeklyLink <= 0 ? null : (bag / weeklyLink) * 7 * 86_400;
}

/** Transfers under this many LINK are test-sized dust, hidden unless asked for. */
export const DUST_LINK = 10;
const RECENT_TRANSFERS = 10;

/** The transfers the table shows, newest first: the latest 10 above the dust line, or all of them, dust only when asked. */
export function shownTransfers<T extends { ts: string; link: number }>(transfers: readonly T[], opts: { all: boolean; dust: boolean }): T[] {
  const newest = [...transfers].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)).filter((t) => opts.dust || t.link >= DUST_LINK);
  return opts.all ? newest : newest.slice(0, RECENT_TRANSFERS);
}
