import type { CardRoute } from '../src/lib/card-paths';
import { addDays } from '../src/lib/days';

export function cardMaxAge(route: CardRoute, lastFinalizeDay: string | null): number {
  switch (route.kind) {
    case 'home':
      return 300;
    case 'daily':
      return 600;
    case 'day':
      return lastFinalizeDay !== null && route.day < addDays(lastFinalizeDay, -1) ? 604_800 : 600;
    case 'reserve':
      return 900;
    default:
      return 1_800;
  }
}
