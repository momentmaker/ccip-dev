import { ROSTER_VERSION, type RosterFile, type RosterMarine } from '@ccip-dev/core/roster';
import type { MarineWebCard, Tier } from '@ccip-dev/core/linkmarine';
import type { Bot } from './bot';
import { tagChances, type CallsignSnapshot } from './draw';
import { loadMemes, memeKey, stockMemes } from './memes';
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

const IMMUTABLE = 'public, max-age=31536000, immutable';
const WEB_MAX_AGE = 86_400;
const MEME_PATH = /^\/memes\/([^/]+)\.png$/;
const WEB_PATH = /^\/web\/([^/]+)\.png$/;
const SERIAL = /^[1-9][0-9]{0,8}$/;

export const webCardKey = (serial: number) => `web/${serial}.png`;

const png = (body: ReadableStream | Uint8Array, cacheControl: string) => new Response(body, { headers: { ...CORS, 'Content-Type': 'image/png', 'Cache-Control': cacheControl } });
const missing = () => new Response('Not found', { status: 404, headers: { ...CORS, 'Cache-Control': `public, max-age=${MISSING_MAX_AGE}` } });
const unavailable = (what: string) => new Response(`${what} unavailable`, { status: 503, headers: { ...CORS, 'Cache-Control': NO_STORE } });

/** Each snapshot meme file and the tag it came from, built once per snapshot. */
const snapshotFiles = new WeakMap<CallsignSnapshot, Map<string, string>>();

function snapshotMeme(snapshot: CallsignSnapshot, file: string): MarineMeme | null {
  let files = snapshotFiles.get(snapshot);
  if (!files) {
    files = new Map(snapshot.tags.flatMap((t) => t.memes.map((f) => [f, t.tag] as const)));
    snapshotFiles.set(snapshot, files);
  }
  const tag = files.get(file);
  return tag === undefined ? null : { tag, file, key: memeKey(file) };
}

/** A meme's 240 px PNG: from R2, else copied once from the pinned archive when the snapshot has it, else 404. */
async function memeResponse(path: string, deps: PublicDeps): Promise<Response> {
  let file: string;
  try {
    file = decodeURIComponent(MEME_PATH.exec(path)![1]!);
  } catch {
    return missing();
  }
  const kept = await deps.bucket.get(memeKey(file));
  if (kept) return png(kept.body, IMMUTABLE);
  const meme = snapshotMeme(deps.snapshot, file);
  if (!meme) return missing();
  try {
    await stockMemes(deps.bucket, deps.renderer, deps.fetch, deps.snapshot.archive, [meme]);
  } catch (err) {
    console.error(`meme ${file}: ${reason(err)}`);
    return unavailable('meme');
  }
  const stocked = await deps.bucket.get(meme.key);
  return stocked ? png(stocked.body, IMMUTABLE) : unavailable('meme');
}

/** A Marine's web card: from R2, else rendered once through the site (never with a name or avatar) and kept. */
async function webCardResponse(path: string, deps: PublicDeps): Promise<Response> {
  const digits = WEB_PATH.exec(path)![1]!;
  if (!SERIAL.test(digits)) return missing();
  const serial = Number(digits);
  const kept = await deps.bucket.get(webCardKey(serial));
  if (kept) return png(kept.body, `public, max-age=${WEB_MAX_AGE}`);
  const row = await deps.db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM marines WHERE serial = ?`).bind(serial).first<PublicRow>();
  if (!row) return missing();
  try {
    const stored = JSON.parse(row.memes) as MarineMeme[];
    await stockMemes(deps.bucket, deps.renderer, deps.fetch, deps.snapshot.archive, stored);
    const pngs = await loadMemes(deps.bucket, stored);
    if (!pngs) throw new Error('memes missing from storage right after copying');
    const marine = rosterMarine(row, deps.snapshot);
    const card: MarineWebCard = {
      serial,
      callsign: marine.callsign,
      tier: marine.tier,
      percentile: marine.percentile,
      memes: marine.memes.map((m, i) => ({ tag: m.tag, count: m.count, png: pngs[i]! })),
      blood: marine.blood,
      faith: marine.faith,
      enlistedAt: row.enlisted_at,
    };
    const bytes = await deps.renderer.renderMarineWebCard(card);
    await deps.bucket.put(webCardKey(serial), bytes, { httpMetadata: { contentType: 'image/png' } });
    return png(bytes, `public, max-age=${WEB_MAX_AGE}`);
  } catch (err) {
    console.error(`web card #${serial}: ${reason(err)}`);
    return unavailable('card');
  }
}

export type Route = (path: string, deps: PublicDeps) => Promise<Response>;

/** Each public path and its answer. */
export const ROUTES: [RegExp, Route][] = [
  [/^\/roster\.json$/, rosterResponse],
  [MEME_PATH, memeResponse],
  [WEB_PATH, webCardResponse],
];

const POLICY_HEADER = 'x-ccip-cache-control';

/**
 * A GET answer from the edge cache, else built; only a 200 or a 404 is kept, for as long as its Cache-Control says.
 * Cloudflare rewrites a cached response's Cache-Control to the zone's Browser Cache TTL (4 h), so the stored copy
 * carries the route's own policy in a private header and a hit gets it back.
 */
async function cached(request: Request, deps: PublicDeps, build: () => Promise<Response>): Promise<Response> {
  const url = new URL(request.url);
  const key = new Request(`${url.origin}${url.pathname}`);
  const hit = await deps.cache?.match(key);
  if (hit) {
    const headers = new Headers(hit.headers);
    const policy = headers.get(POLICY_HEADER);
    headers.delete(POLICY_HEADER);
    if (policy) headers.set('Cache-Control', policy);
    return new Response(hit.body, { status: hit.status, headers });
  }
  const res = await build();
  if (deps.cache && (res.status === 200 || res.status === 404)) {
    const stored = new Response(res.clone().body, { status: res.status, headers: res.headers });
    stored.headers.set(POLICY_HEADER, res.headers.get('Cache-Control') ?? NO_STORE);
    deps.waitUntil(deps.cache.put(key, stored));
  }
  return res;
}

/** The answer to a public path (GET and HEAD only), or null when the path is not one, for the caller's 404. */
export async function publicRoute(request: Request, deps: PublicDeps): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const route = ROUTES.find(([pattern]) => pattern.test(path));
  if (!route) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { ...CORS, Allow: 'GET, HEAD' } });
  const res = await cached(request, deps, async () => {
    try {
      return await route[1](path, deps);
    } catch (err) {
      console.error(`${path}: ${reason(err)}`);
      return unavailable('route');
    }
  });
  return request.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
}
