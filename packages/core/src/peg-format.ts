import { formatCount } from './format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

export function utcStamp(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** One decimal under 100 LINK, whole numbers from there; 99.96 rounds to "100", not "100.0". */
export function linkAmount(n: number): string {
  const oneDecimal = n.toFixed(1);
  return n < 100 && oneDecimal !== '100.0' ? oneDecimal : formatCount(n);
}

/** When the withdrawal queue next pays: payouts go out at most every few days, and only inside a claim window. */
export function payoutWhen(d: { next_payout_after: string; claim_window_open: boolean }, now: Date): string {
  if (Date.parse(d.next_payout_after) > now.getTime()) return `next payout after ${utcStamp(d.next_payout_after)}${d.claim_window_open ? '' : ' (no claim window open)'}`;
  return d.claim_window_open ? 'next payout possible now' : 'payout possible in the next claim window';
}
