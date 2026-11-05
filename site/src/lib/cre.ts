import { shortAddress } from '@ccip-dev/core/names';
import type { DayTotals, TopFile } from '@ccip-dev/core/public';

export const CRE_DAYS = 90;

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
