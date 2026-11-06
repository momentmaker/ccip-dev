import { formatShare, formatUtcDay } from '@ccip-dev/core/format';
import { shortAddress } from '@ccip-dev/core/names';
import type { DayTotals, ReplayFile, TopFile } from '@ccip-dev/core/public';

export const CRE_DAYS = 90;

export const hasCreReplay = (replay: Pick<ReplayFile, 'cre'> | null): boolean => (replay?.cre?.length ?? 0) > 0;

export interface CrePoint {
  day: string;
  messages: number;
  sharePct: number;
}

export interface CreLeader {
  name: string;
  slug: string | null;
  messages: number;
}

export function creSeries(days: readonly DayTotals[], n = CRE_DAYS): CrePoint[] {
  return days.slice(-n).map((d) => {
    const messages = d.cre_messages ?? 0;
    return { day: d.day, messages, sharePct: d.messages > 0 ? (messages / d.messages) * 100 : 0 };
  });
}

/** The home CRE band's series and its last day (history.json's last finalized day), or null to hide the band: no CRE message in the series. */
export function creBand(days: readonly DayTotals[], n = CRE_DAYS): { series: CrePoint[]; latest: CrePoint } | null {
  const series = creSeries(days, n);
  const latest = series.at(-1);
  return latest !== undefined && series.some((p) => p.messages > 0) ? { series, latest } : null;
}

/** The band's share for its last day, named by its date: history.json ends at the last finalized day, not today. */
export const creLatestCaption = (latest: CrePoint): string => `latest day (${formatUtcDay(latest.day)}) ${formatShare(latest.sharePct)}`;

export const creTotal = (days: readonly DayTotals[]): number => days.reduce((n, d) => n + (d.cre_messages ?? 0), 0);

export function creLeaders(top: TopFile | null, projects: ReadonlySet<string>, limit = 5): CreLeader[] {
  return (top?.identities?.['30d'] ?? []).slice(0, limit).map((e) => {
    const slug = e.key.startsWith('project:') ? e.key.slice('project:'.length) : null;
    return { name: e.label ?? shortAddress(e.key.replace(/^address:/, '')), slug: slug !== null && projects.has(slug) ? slug : null, messages: e.messages };
  });
}

/** SVG polyline points for the shares, x across the width and the highest share at y = 0. */
export function creSparkPoints(points: readonly CrePoint[], width: number, height: number): string {
  const max = Math.max(...points.map((p) => p.sharePct), 0);
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  return points.map((p, i) => `${Math.round(i * step)},${max === 0 ? height : Math.round(height - (p.sharePct / max) * height)}`).join(' ');
}
