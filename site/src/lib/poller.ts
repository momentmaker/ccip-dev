import type { PublicFile, PublicFileName } from '@ccip-dev/core/public';
import { DataError, fetchPublic, pollDelay } from './data';

export interface Visibility {
  isVisible(): boolean;
  onChange(listener: () => void): () => void;
}

export const documentVisibility: Visibility = {
  isVisible: () => document.visibilityState === 'visible',
  onChange: (listener) => {
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
};

export interface PollerOptions<N extends PublicFileName> {
  name: N;
  onData: (data: PublicFile<N>) => void;
  onError: (error: DataError, failures: number) => void;
  fetch?: typeof fetch;
  base?: string;
  visibility?: Visibility;
}

export interface LoopOptions<T> {
  load: () => Promise<T>;
  onData: (data: T) => void;
  onError: (error: unknown, failures: number) => void;
  /** How long to wait before the next load, given the failures in a row. */
  delayMs: (failures: number) => number;
  visibility?: Visibility;
}

/** Loads at once and then after each delay, only while the page is visible, at once again when it reappears; returns stop. */
export function startLoop<T>(opts: LoopOptions<T>): () => void {
  const visibility = opts.visibility ?? documentVisibility;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let inFlight = false;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    if (stopped || !visibility.isVisible()) return;
    clear();
    timer = setTimeout(() => void tick(), opts.delayMs(failures));
  };
  const tick = async () => {
    timer = null;
    if (stopped || inFlight || !visibility.isVisible()) return;
    inFlight = true;
    try {
      const data = await opts.load();
      failures = 0;
      if (!stopped) opts.onData(data);
    } catch (err) {
      failures += 1;
      if (!stopped) opts.onError(err, failures);
    } finally {
      inFlight = false;
      schedule();
    }
  };

  const unsubscribe = visibility.onChange(() => {
    if (stopped) return;
    clear();
    if (visibility.isVisible()) void tick();
  });
  void tick();

  return () => {
    stopped = true;
    unsubscribe();
    clear();
  };
}

export function startPoller<N extends PublicFileName>(opts: PollerOptions<N>): () => void {
  return startLoop({
    load: () => fetchPublic(opts.name, { fetch: opts.fetch, base: opts.base }),
    onData: opts.onData,
    onError: (err, failures) => opts.onError(err instanceof DataError ? err : new DataError(opts.name, String(err)), failures),
    delayMs: pollDelay,
    visibility: opts.visibility,
  });
}
