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
