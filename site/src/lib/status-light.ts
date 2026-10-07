import type { StatusFile } from '@ccip-dev/core/public';
import { formatDuration } from './format';

export type StatusLevel = 'green' | 'amber' | 'red';

export const AMBER_AFTER_S = 120;
export const RED_AFTER_S = 600;
export const RED_AFTER_FAILURES = 3;

export function ingestLagSeconds(status: Pick<StatusFile, 'last_ingest_ok_at'>, now: Date): number | null {
  if (!status.last_ingest_ok_at) return null;
  return Math.max(0, Math.round((now.getTime() - Date.parse(status.last_ingest_ok_at)) / 1000));
}

export function statusLevel(lagSeconds: number | null, failures: number): StatusLevel {
  if (failures >= RED_AFTER_FAILURES || lagSeconds === null || lagSeconds >= RED_AFTER_S) return 'red';
  return lagSeconds < AMBER_AFTER_S ? 'green' : 'amber';
}

export function statusText(level: StatusLevel, lagSeconds: number | null): string {
  if (lagSeconds === null) return 'Live data unavailable';
  if (level === 'green') return `Live · ${formatDuration(lagSeconds)} behind`;
  return `${level === 'amber' ? 'Delayed' : 'Stalled'} · ${formatDuration(lagSeconds)} behind`;
}
