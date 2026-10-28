/** Today's totals as the home page's live island last read them, for the other islands on the page to show without polling again. */
export interface LiveToday {
  messages: number;
  usd: number;
  fees: number | null;
}

type Listener = (today: LiveToday) => void;

let current: LiveToday | null = null;
const listeners = new Set<Listener>();

export function publishToday(today: LiveToday): void {
  current = today;
  for (const listener of listeners) listener(today);
}

/** Calls `listener` with the latest totals at once, if any, and on every publish after; returns unsubscribe. */
export function subscribeToday(listener: Listener): () => void {
  listeners.add(listener);
  if (current) listener(current);
  return () => {
    listeners.delete(listener);
  };
}
