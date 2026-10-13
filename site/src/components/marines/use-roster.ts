import type { RosterFile } from '@ccip-dev/core/roster';
import { useEffect, useState } from 'react';
import { startLoop } from '../../lib/poller';
import { fetchRoster, ROSTER_POLL_MS, rosterSource } from '../../lib/roster';

export interface RosterState {
  /** The last roster loaded; it stays on screen through a failed refresh. */
  roster: RosterFile | null;
  /** The latest load failed. */
  failed: boolean;
}

/** The roster, loaded at once and every minute while the page is visible. */
export function useRoster(): RosterState {
  const [state, setState] = useState<RosterState>({ roster: null, failed: false });
  useEffect(() => {
    const url = rosterSource(window.location);
    return startLoop({
      load: () => fetchRoster(url),
      onData: (roster) => setState({ roster, failed: false }),
      onError: (err) => {
        console.warn(`roster: ${err instanceof Error ? err.message : String(err)}`);
        setState((s) => ({ ...s, failed: true }));
      },
      delayMs: () => ROSTER_POLL_MS,
    });
  }, []);
  return state;
}
