import { ROSTER_VERSION, type RosterFile, type RosterMarine } from '@ccip-dev/core/roster';
import type { Tier } from '@ccip-dev/core/linkmarine';
import type { Bot } from './bot';
import { tagChances, type CallsignSnapshot } from './draw';
import type { MarineMeme } from './store';

/**
 * The bot's public, read-only routes, which the site's /marines/ pages read: the roster, the meme images and the web
 * cards. Callsigns only. Every query names PUBLIC_COLUMNS, so a Discord name, avatar or id never leaves the bot.
 */
export interface PublicDeps extends Pick<Bot, 'db' | 'bucket' | 'renderer' | 'fetch' | 'snapshot' | 'now'> {
  cache: Pick<Cache, 'match' | 'put'> | null;
  waitUntil: (work: Promise<unknown>) => void;
}

/** The only marines columns a public route reads: never user_id, display_name, platform, card_key or snapshot_version. */
export const PUBLIC_COLUMNS = 'serial, callsign, tags, tier, score, percentile, memes, blood, faith, enlisted_at';

export interface PublicRow {
  serial: number;
  callsign: string;
  tags: string;
  tier: Tier;
  score: number;
  percentile: number;
  memes: string;
  blood: string;
  faith: string;
  enlisted_at: string;
}

export const CORS = { 'Access-Control-Allow-Origin': '*' } as const;
export const NO_STORE = 'no-store';
export const MISSING_MAX_AGE = 60;
const ROSTER_MAX_AGE = 60;

export const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));
const snapshotCount = (snapshot: CallsignSnapshot, tag: string) => snapshot.tags.find((t) => t.tag === tag)?.count ?? 1;

/** A row as the roster shows it: the meme count the card used (the snapshot's, for rows stored before counts were), and the enlistment's UTC date. */
export function rosterMarine(row: PublicRow, snapshot: CallsignSnapshot): RosterMarine {
  const memes = (JSON.parse(row.memes) as MarineMeme[]).map((m) => ({ tag: m.tag, file: m.file, count: m.count ?? snapshotCount(snapshot, m.tag) }));
  return {
    serial: row.serial,
    callsign: row.callsign,
    tags: JSON.parse(row.tags) as RosterMarine['tags'],
    tier: row.tier,
    score: row.score,
    percentile: row.percentile,
    memes: memes as RosterMarine['memes'],
    blood: row.blood,
    faith: row.faith,
    enlisted: row.enlisted_at.slice(0, 10),
  };
}

function rosterSnapshot(snapshot: CallsignSnapshot): RosterFile['snapshot'] {
  const chances = tagChances(snapshot.tags);
  return { version: snapshot.version, tags: snapshot.tags.map((t) => ({ tag: t.tag, count: t.count, chance: Number(chances.get(t.tag)!.toPrecision(6)), meme: t.memes[0]! })) };
}

export async function buildRoster(deps: PublicDeps): Promise<RosterFile> {
  const { results } = await deps.db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM marines ORDER BY serial`).all<PublicRow>();
  return { version: ROSTER_VERSION, updatedAt: deps.now().toISOString(), snapshot: rosterSnapshot(deps.snapshot), marines: results.map((r) => rosterMarine(r, deps.snapshot)) };
}

const json = (body: unknown, status: number, cacheControl: string) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': cacheControl } });

async function rosterResponse(_path: string, deps: PublicDeps): Promise<Response> {
  try {
    return json(await buildRoster(deps), 200, `public, max-age=${ROSTER_MAX_AGE}`);
  } catch (err) {
    console.error(`roster.json: ${reason(err)}`);
    return json({ error: 'roster unavailable' }, 503, NO_STORE);
  }
}

export type Route = (path: string, deps: PublicDeps) => Promise<Response>;

/** Each public path and its answer. */
export const ROUTES: [RegExp, Route][] = [[/^\/roster\.json$/, rosterResponse]];

/** A GET answer from the edge cache, else built; only a 200 or a 404 is kept, for as long as its Cache-Control says. */
async function cached(request: Request, deps: PublicDeps, build: () => Promise<Response>): Promise<Response> {
  const url = new URL(request.url);
  const key = new Request(`${url.origin}${url.pathname}`);
  const hit = await deps.cache?.match(key);
  if (hit) return hit;
  const res = await build();
  if (deps.cache && (res.status === 200 || res.status === 404)) deps.waitUntil(deps.cache.put(key, res.clone()));
  return res;
}

/** The answer to a public path (GET and HEAD only), or null when the path is not one, for the caller's 404. */
export async function publicRoute(request: Request, deps: PublicDeps): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const route = ROUTES.find(([pattern]) => pattern.test(path));
  if (!route) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { ...CORS, Allow: 'GET, HEAD' } });
  const res = await cached(request, deps, () => route[1](path, deps));
  return request.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
}
