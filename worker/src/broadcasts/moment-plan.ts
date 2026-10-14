import { addDays, weekStart } from '@ccip-dev/core';
import { broadcastKey, BUDGETED_MOMENTS, newcomerPathOk, type BudgetedMoment, type MomentTarget } from '@ccip-dev/core/broadcasts';
import { moversOf, roundupOf, type MomentsBody } from '@ccip-dev/core/moments';

export const MOMENTS_PER_DAY = 2;
/** A moment that misses its day is planned again on each of the next 2 days, then dropped. */
export const CARRY_DAYS = 2;
/** New senders can arrive many at once, so one a day keeps them from crowding out the weekly moments. */
export const NEWCOMERS_PER_DAY = 1;
export const COUNTDOWN_DAYS = { min: 2, max: 7 } as const;
/** Days from a week's Monday to the day its moment is planned: movers on the Tuesday, the project spotlight on the Wednesday and the spotlight on the Thursday after it, New on CCIP on its own Saturday. */
export const WEEKLY_DUE = { movers: 8, spotlight: 10, project: 9, roundup: 5 } as const;

export interface DueMoment {
  target: Extract<MomentTarget, { kind: BudgetedMoment }>;
  /** The day the moment is planned for; it stays due for CARRY_DAYS more. */
  due: string;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The budgeted moments due today, or carried over from the 2 days before, that the data holds. */
export function dueMoments(m: MomentsBody, today: string): DueMoment[] {
  const inWindow = (due: string) => due >= addDays(today, -CARRY_DAYS) && due <= today;
  const out: DueMoment[] = [];
  for (const c of m.arrivals.chains) {
    const due = addDays(c.day, 1);
    if (inWindow(due)) out.push({ target: { kind: 'welcome', selector: c.selector }, due });
  }
  for (const s of m.arrivals.senders ?? []) {
    const due = addDays(s.day, 1);
    if (inWindow(due) && newcomerPathOk(s.key)) out.push({ target: { kind: 'newcomer', key: s.key }, due });
  }
  for (const c of m.countdowns) {
    if (c.days_left >= COUNTDOWN_DAYS.min && c.days_left <= COUNTDOWN_DAYS.max) out.push({ target: { kind: 'countdown', metric: c.metric, threshold: c.threshold }, due: today });
  }
  for (const w of m.weeks) {
    const movers = addDays(w.week, WEEKLY_DUE.movers);
    if (inWindow(movers) && moversOf(m.weeks, w.week) !== null) out.push({ target: { kind: 'movers', monday: w.week }, due: movers });
    const spotlight = addDays(w.week, WEEKLY_DUE.spotlight);
    if (inWindow(spotlight) && w.spotlight !== null) out.push({ target: { kind: 'spotlight', monday: w.week }, due: spotlight });
    const project = addDays(w.week, WEEKLY_DUE.project);
    if (inWindow(project) && (w.project ?? null) !== null) out.push({ target: { kind: 'project', monday: w.week }, due: project });
  }
  for (const monday of [weekStart(today), addDays(weekStart(today), -7)]) {
    const due = addDays(monday, WEEKLY_DUE.roundup);
    if (inWindow(due) && roundupOf(m, monday) !== null) out.push({ target: { kind: 'roundup', monday }, due });
  }
  return out;
}

/**
 * The moments to post now: those not already sent or seeded, welcome first, then a new sender, countdown, movers, spotlight and the
 * weekly New on CCIP (an older one first within a kind), as many as today's budget still allows, with at most NEWCOMERS_PER_DAY new senders.
 */
export function pickMoments(due: readonly DueMoment[], o: { done: ReadonlySet<string>; sentToday: number }): DueMoment[] {
  let newcomers = 0;
  return due
    .filter((d) => !o.done.has(broadcastKey(d.target)))
    .sort(
      (a, b) =>
        BUDGETED_MOMENTS.indexOf(a.target.kind) - BUDGETED_MOMENTS.indexOf(b.target.kind) ||
        compare(a.due, b.due) ||
        compare(broadcastKey(a.target), broadcastKey(b.target)),
    )
    .filter((d) => d.target.kind !== 'newcomer' || ++newcomers <= NEWCOMERS_PER_DAY)
    .slice(0, Math.max(0, MOMENTS_PER_DAY - o.sentToday));
}
