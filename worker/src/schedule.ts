/** The late finalize re-fills yesterday at this hour, so the hourly broadcast retry sits it out rather than caption rows the late run is replacing. */
export const LATE_FINALIZE_HOUR_UTC = 6;

/** The hours a finalize rewrites days: 00:07's run and the late one. Jobs that edit finished days wait them out. */
export function isFinalizeHour(now: Date): boolean {
  const hour = now.getUTCHours();
  return hour === 0 || hour === LATE_FINALIZE_HOUR_UTC;
}
