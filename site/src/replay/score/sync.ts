export type SyncAction = { kind: 'start'; offset: number } | { kind: 'stop' } | { kind: 'none' };

export function scoreKey(show: { length: number; focus: string | null }, lastDay: string): string {
  return `${show.length}|${show.focus ?? 'all'}|${lastDay}`;
}

export function syncAction(
  prev: { playing: boolean; soundOn: boolean; t: number },
  next: { playing: boolean; soundOn: boolean; t: number; scrubbed: boolean },
): SyncAction {
  const wasAudible = prev.playing && prev.soundOn;
  const isAudible = next.playing && next.soundOn;
  if (!isAudible) return wasAudible ? { kind: 'stop' } : { kind: 'none' };
  if (!wasAudible || next.scrubbed) return { kind: 'start', offset: next.t };
  return { kind: 'none' };
}

export function audioStartOffset(playhead: number, latency: { outputLatency?: number; baseLatency?: number }, duration: number): number {
  const lead = latency.outputLatency || latency.baseLatency || 0;
  return Math.min(Math.max(0, playhead + lead), duration);
}

const MIN_PREFETCH_MEMORY_GB = 4;

export function idlePrefetchAllowed(env: { audioSupported: boolean; saveData?: boolean; deviceMemory?: number }): boolean {
  if (!env.audioSupported || env.saveData) return false;
  return env.deviceMemory === undefined || env.deviceMemory >= MIN_PREFETCH_MEMORY_GB;
}

export function soundPending(state: { soundOn: boolean; playing: boolean; ready: boolean; live: boolean }): boolean {
  if (!state.soundOn) return false;
  return !state.ready || (state.playing && !state.live);
}

export class ScoreCache {
  private entry: { key: string; buffer: Promise<AudioBuffer | null> } | null = null;

  constructor(private readonly onFail: (err: unknown) => void) {}

  get(key: string, render: () => Promise<AudioBuffer>): Promise<AudioBuffer | null> {
    if (this.entry?.key === key) return this.entry.buffer;
    const entry = {
      key,
      buffer: Promise.resolve()
        .then(render)
        .catch((err: unknown) => {
          if (this.entry === entry) this.entry = null;
          this.onFail(err);
          return null;
        }),
    };
    this.entry = entry;
    return entry.buffer;
  }

  holds(key: string): boolean {
    return this.entry?.key === key;
  }
}
