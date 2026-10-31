import type { CardRoute } from '../src/lib/card-paths';
import { addDays } from '../src/lib/days';

export const BROADCAST_MAX_AGE = 900;

export function cardMaxAge(route: CardRoute, lastFinalizeDay: string | null): number {
  switch (route.kind) {
    case 'home':
      return 300;
    case 'daily':
      return 600;
    case 'day':
      return lastFinalizeDay !== null && route.day < addDays(lastFinalizeDay, -1) ? 604_800 : 600;
    case 'reserve':
    case 'staking':
      return 900;
    case 'broadcast':
      return BROADCAST_MAX_AGE;
    default:
      return 1_800;
  }
}
