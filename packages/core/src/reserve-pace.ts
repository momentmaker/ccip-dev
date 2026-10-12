import { dayOf } from './time';

export const DEPOSIT_MIN_LINK = 1_000;
export const MILESTONE_STEP_LINK = 1_000_000;
export const DEPOSIT_STREAK_MAX_GAP_DAYS = 8;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Inbound transfers below DEPOSIT_MIN_LINK are tests and gifts, not deposits. */
export function isDeposit(t: { direction: 'in' | 'out'; link: number }): boolean {
  return t.direction === 'in' && t.link >= DEPOSIT_MIN_LINK;
}

/** Deposits in a row, counted back from the last, while each gap is at most DEPOSIT_STREAK_MAX_GAP_DAYS. `timestamps` are oldest first. */
export function depositStreak(timestamps: readonly string[]): number {
  if (timestamps.length === 0) return 0;
  let streak = 1;
  for (let i = timestamps.length - 1; i > 0; i--) {
    if ((Date.parse(timestamps[i]!) - Date.parse(timestamps[i - 1]!)) / DAY_MS > DEPOSIT_STREAK_MAX_GAP_DAYS) break;
    streak++;
  }
  return streak;
}

/** The next whole million above `held`, and the day the weekly pace reaches it, counting from `from`. */
export function nextMilestone(held: number, avgWeeklyLink: number | null, from: Date): { link: number; eta: string } | null {
  if (avgWeeklyLink === null || avgWeeklyLink <= 0) return null;
  const link = (Math.floor(held / MILESTONE_STEP_LINK) + 1) * MILESTONE_STEP_LINK;
  return { link, eta: dayOf(new Date(from.getTime() + ((link - held) / avgWeeklyLink) * WEEK_MS)) };
}
