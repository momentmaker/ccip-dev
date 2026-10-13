import { ROSTER_SCHEMA, type RosterFile } from '@ccip-dev/core/roster';
import { ROSTER_URL } from '../config';

/** The bot keeps roster.json for a minute, so the page asks no more often. */
export const ROSTER_POLL_MS = 60_000;

export async function fetchRoster(url: string = ROSTER_URL, fetchFn: typeof fetch = fetch): Promise<RosterFile> {
  const res = await fetchFn(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`roster.json: HTTP ${res.status}`);
  const parsed = ROSTER_SCHEMA.safeParse(await res.json());
  if (!parsed.success) throw new Error(`roster.json: unexpected shape at ${parsed.error.issues[0]?.path.join('.') || '(root)'}`);
  return parsed.data;
}

/** Where to load the roster from: ?roster=<url> on localhost only, for a visual check before shipping; the bot anywhere else. */
export function rosterSource(location: { hostname: string; search: string }): string {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    const override = new URLSearchParams(location.search).get('roster');
    if (override) return override;
  }
  return ROSTER_URL;
}
