export interface PickerChain {
  selector: string;
  name: string;
  value: number;
  icon: string | null;
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');

export function filterChains(query: string, chains: readonly PickerChain[]): PickerChain[] {
  const q = squash(query);
  return q === '' ? [...chains] : chains.filter((c) => squash(c.name).includes(q));
}

export function pickableChains<T extends { selector: string }>(chains: readonly T[], slugs: Readonly<Record<string, string>>): T[] {
  return chains.filter((c) => Object.hasOwn(slugs, c.selector));
}

export function activeAfterSearch(query: string, resultCount: number): number {
  return query.trim() === '' || resultCount === 0 ? 0 : 1;
}

export function moveIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (((current + delta) % count) + count) % count;
}

export function nearestMark(marks: readonly { time: number }[], time: number, length: number, tolerance = 0.015): number {
  let best = -1;
  let bestGap = tolerance * length;
  marks.forEach((m, i) => {
    const gap = Math.abs(m.time - time);
    if (gap <= bestGap) {
      best = i;
      bestGap = gap;
    }
  });
  return best;
}

export function spacedTicks<T extends { time: number }>(ticks: readonly T[], length: number, widthPx: number, minPx: number): T[] {
  if (widthPx <= 0 || length <= 0) return [...ticks];
  const kept: T[] = [];
  for (const tick of [...ticks].sort((a, b) => b.time - a.time)) {
    const next = kept[kept.length - 1];
    if (!next || ((next.time - tick.time) / length) * widthPx >= minPx) kept.push(tick);
  }
  return kept.reverse();
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const BAR_IDLE_MS = 2500;

export function barVisible(input: { playing: boolean; recording: boolean; lastActivityMs: number; nowMs: number }): boolean {
  if (!input.playing && !input.recording) return true;
  return input.nowMs - input.lastActivityMs <= BAR_IDLE_MS;
}
