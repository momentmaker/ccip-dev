import type { PublicFileName } from '@ccip-dev/core/public';
import sponsor from '../sponsor.json';
import { parseCardPath, type CardRoute } from '../src/lib/card-paths';
import { fetchPublic } from '../src/lib/data';
import { chainNameMap } from '../src/lib/names';
import { sponsorView } from '../src/lib/sponsor';
import type { CardCoin } from '../src/sky/card-coins';
import { cardMaxAge } from './cache';
import { dayCard, flowCard, historyCard, homeCard, recordsCard, replayCard, replayChainCard, reserveCard, topCard, type CardSpec, type ReplayCardEntry } from './cards/content';
import { cardTree, SPARK_H, SPARK_W, sparkSvg } from './cards/frame';
import type { VNode } from './h';

export const FALLBACK_MAX_AGE = 60;
const CARD_PATH = /^\/og\/(.+)\.png$/;

export interface OgEnv {
  ASSETS: { fetch(request: Request | string): Promise<Response> };
}

export interface OgDeps {
  fetch: typeof fetch;
  renderPng: (tree: VNode) => Promise<Uint8Array>;
  cache: Pick<Cache, 'match' | 'put'> | null;
}

interface Built {
  spec: CardSpec;
  maxAge: number;
}

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;

async function skyDataUri(env: OgEnv, origin: string): Promise<string | null> {
  const res = await env.ASSETS.fetch(new Request(`${origin}/card-sky.svg`));
  return res.ok ? toDataUri(await res.text()) : null;
}

function isCardCoin(value: unknown): value is CardCoin {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  const finite = (k: string) => typeof c[k] === 'number' && Number.isFinite(c[k]);
  return finite('x') && finite('y') && finite('d') && typeof c.src === 'string' && c.src.startsWith('data:image/');
}

async function coinLayer(env: OgEnv, origin: string): Promise<CardCoin[]> {
  const res = await env.ASSETS.fetch(new Request(`${origin}/card-coins.json`));
  if (!res.ok) return [];
  try {
    const body = (await res.json()) as { coins?: unknown };
    return Array.isArray(body.coins) ? body.coins.filter(isCardCoin) : [];
  } catch (err) {
    console.warn(`card-coins.json is unreadable: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isReplayCardEntry(value: unknown): value is ReplayCardEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  const count = (k: string) => typeof e[k] === 'number' && Number.isFinite(e[k]) && (e[k] as number) >= 0;
  return (
    typeof e.name === 'string' &&
    e.name.length > 0 &&
    typeof e.since === 'string' &&
    DAY_RE.test(e.since) &&
    count('usd') &&
    count('messages') &&
    count('partners') &&
    (e.coin === null || (typeof e.coin === 'string' && e.coin.startsWith('data:image/')))
  );
}

const replayCards = new Map<string, Promise<Record<string, unknown>>>();

async function readReplayCards(env: OgEnv, origin: string): Promise<Record<string, unknown>> {
  const res = await env.ASSETS.fetch(new Request(`${origin}/replay-cards.json`));
  if (!res.ok) throw new Error(`replay-cards.json: HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

function replayCardEntries(env: OgEnv, origin: string): Promise<Record<string, unknown>> {
  let pending = replayCards.get(origin);
  if (!pending) {
    pending = readReplayCards(env, origin);
    replayCards.set(origin, pending);
    pending.catch(() => {
      if (replayCards.get(origin) === pending) replayCards.delete(origin);
    });
  }
  return pending;
}

async function build(route: CardRoute, deps: OgDeps, env: OgEnv, origin: string): Promise<Built | null> {
  const load = <N extends PublicFileName>(name: N) => fetchPublic(name, { fetch: deps.fetch });
  switch (route.kind) {
    case 'home':
      return { spec: homeCard(await load('today.json')), maxAge: cardMaxAge(route, null) };
    case 'daily':
    case 'day': {
      const [history, status] = await Promise.all([load('history.json'), load('status.json')]);
      const day = route.kind === 'day' ? route.day : status.last_finalize_day;
      const spec = day ? dayCard(history, day) : null;
      return spec ? { spec, maxAge: cardMaxAge(route, status.last_finalize_day) } : null;
    }
    case 'history':
      return { spec: historyCard(await load('history.json'), route.range), maxAge: cardMaxAge(route, null) };
    case 'top': {
      const [top, chains] = await Promise.all([load(`top/${route.dim}.json`), load('chains.json')]);
      return { spec: topCard(top, route.dim, route.window, chainNameMap(chains.chains)), maxAge: cardMaxAge(route, null) };
    }
    case 'flow': {
      const [top, chains] = await Promise.all([load('top/lane.json'), load('chains.json')]);
      return { spec: flowCard(top, route.window, chainNameMap(chains.chains)), maxAge: cardMaxAge(route, null) };
    }
    case 'reserve':
      return { spec: reserveCard(await load('reserve.json')), maxAge: cardMaxAge(route, null) };
    case 'replay':
      return { spec: replayCard(await load('history.json')), maxAge: cardMaxAge(route, null) };
    case 'replay-chain': {
      const entries = await replayCardEntries(env, origin);
      const entry = Object.hasOwn(entries, route.slug) ? entries[route.slug] : undefined;
      return isReplayCardEntry(entry) ? { spec: replayChainCard(entry, route.slug), maxAge: cardMaxAge(route, null) } : null;
    }
    case 'records':
      return { spec: recordsCard(await load('history.json')), maxAge: cardMaxAge(route, null) };
  }
}

async function fallback(env: OgEnv, origin: string): Promise<Response> {
  const asset = await env.ASSETS.fetch(new Request(`${origin}/og-default.png`));
  return new Response(asset.body, {
    status: asset.ok ? 200 : 404,
    headers: { 'content-type': 'image/png', 'cache-control': `public, max-age=${FALLBACK_MAX_AGE}` },
  });
}

export async function handleOg(request: Request, env: OgEnv, ctx: { waitUntil(p: Promise<unknown>): void }, deps: OgDeps): Promise<Response> {
  const url = new URL(request.url);
  const match = CARD_PATH.exec(url.pathname);
  const route = match ? parseCardPath(match[1]!) : null;
  if (!route) return new Response('Not found', { status: 404 });

  const cacheKey = new Request(`${url.origin}${url.pathname}`);

  try {
    const cached = await deps.cache?.match(cacheKey);
    if (cached) return cached;
    const built = await build(route, deps, env, url.origin);
    if (!built) return route.kind === 'daily' ? fallback(env, url.origin) : new Response('Not found', { status: 404 });
    const spark = built.spec.spark ? sparkSvg(built.spec.spark, SPARK_W, SPARK_H) : null;
    const [sky, coins] = await Promise.all([skyDataUri(env, url.origin), coinLayer(env, url.origin)]);
    const png = await deps.renderPng(
      cardTree(built.spec, {
        skyDataUri: sky,
        coins,
        sparkDataUri: spark ? toDataUri(spark) : null,
        sponsorLine: sponsorView(sponsor).cardLine,
      }),
    );
    const response = new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': `public, max-age=${built.maxAge}` } });
    if (deps.cache) ctx.waitUntil(deps.cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    console.error(`card ${url.pathname} failed: ${err instanceof Error ? err.message : String(err)}`);
    return fallback(env, url.origin);
  }
}
