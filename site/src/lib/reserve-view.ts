import type { ReserveFile } from '@ccip-dev/core/public';
import { formatCountdown, formatUsd } from './format';

export const DEPOSIT_PAST_DUE = 'Deposit expected — watching';
export const OVERDUE_GRACE_MS = 24 * 3_600_000;
export const MAX_COINS = 24;
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

export function depositCoins(weekly: ReserveFile['weekly']): { week: string; link: number; usd: number }[] {
  return weekly
    .filter((w) => w.deposits > 0)
    .slice(-MAX_COINS)
    .map((w) => ({ week: w.week, link: w.link, usd: w.usd }));
}

export function valueAtPriceText(valueUsd: number | null | undefined, priceUsd: number | null | undefined): string {
  if (valueUsd == null || priceUsd == null) return '';
  return `≈ ${formatUsd(valueUsd)} at $${priceUsd.toFixed(2)} per LINK`;
}
