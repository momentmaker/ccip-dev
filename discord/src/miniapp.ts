import { hasGlint, type EnlistAnswer, type SessionAnswer, type Tier } from '@ccip-dev/core/linkmarine';
import { cappedBody } from './body';
import { cardKey, enlistMarine, readBytes, reason } from './enlistment';
import { findMarine, type Marine } from './store';
import { verifyLaunchData, type TelegramUser } from './telegram-auth';
import { checkGate, claimStamp, marineSummary, stampTelegram, TELEGRAM_PLATFORM, telegramName, type TelegramBot } from './telegram-marines';

/**
 * The Mini App's API on discord.ccip.dev: POST /tg/session, /tg/enlist and /tg/card. Each request carries Telegram's
 * launch data in its body, never in a URL; the user is the one the verified launch data names, and no route takes any
 * other. Only https://ccip.dev may call it from a browser.
 */
export const MINI_APP_ORIGIN = 'https://ccip.dev';

/** verifyLaunchData refuses launch data past 8192 characters and the JSON around it adds little, so a larger body is no launch. */
const MAX_REQUEST_BYTES = 16 * 1024;

const CORS = { 'Access-Control-Allow-Origin': MINI_APP_ORIGIN, Vary: 'Origin' } as const;
const PREFLIGHT = { ...CORS, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400' } as const;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const OFF = () => json({ switch: 'off' }, 409);
const banner = (tier: Tier): EnlistAnswer['banner'] => (tier === 'rare' || tier === 'legendary' ? tier : null);

type Waiter = (work: Promise<unknown>) => void;

async function stampLater(bot: TelegramBot, marine: Marine, user: TelegramUser, waitUntil: Waiter): Promise<void> {
  if (await claimStamp(bot.db, marine.serial, bot.now())) waitUntil(stampTelegram(bot, marine, user));
}

async function session(bot: TelegramBot, user: TelegramUser): Promise<Response> {
  if (!bot.settings.open) return json({ switch: 'off' } satisfies SessionAnswer);
  const marine = await findMarine(bot.db, TELEGRAM_PLATFORM, String(user.id));
  if (marine) return json({ switch: 'on', marine: marineSummary(bot, marine), gate: 'ok' } satisfies SessionAnswer);
  return json({ switch: 'on', marine: null, gate: await checkGate(bot, user.id) } satisfies SessionAnswer);
}

async function enlist(bot: TelegramBot, user: TelegramUser, waitUntil: Waiter): Promise<Response> {
  if (!bot.settings.open) return OFF();
  const existing = await findMarine(bot.db, TELEGRAM_PLATFORM, String(user.id));
  if (existing) {
    if (existing.cardKey === null) await stampLater(bot, existing, user, waitUntil);
    return json({ already: true, marine: marineSummary(bot, existing), banner: null } satisfies EnlistAnswer);
  }
  if ((await checkGate(bot, user.id)) === 'join') return json({ gate: 'join' }, 403);
  const result = await enlistMarine(bot, { platform: TELEGRAM_PLATFORM, userId: String(user.id), displayName: telegramName(user) });
  if (result.kind === 'clashed') {
    await bot.alert('telegram-api:enlist', 'every one of 20 draws for a Telegram recruit clashed with a callsign already taken');
    return json({ error: 'draw' }, 503);
  }
  if (result.marine.cardKey === null) await stampLater(bot, result.marine, user, waitUntil);
  const already = result.kind === 'already';
  return json({ already, marine: marineSummary(bot, result.marine), banner: already ? null : banner(result.marine.tier) } satisfies EnlistAnswer);
}

async function card(bot: TelegramBot, user: TelegramUser, waitUntil: Waiter): Promise<Response> {
  if (!bot.settings.open) return OFF();
  const marine = await findMarine(bot.db, TELEGRAM_PLATFORM, String(user.id));
  if (!marine) return json({ error: 'not enlisted' }, 404);
  if (marine.cardKey) {
    const gif = hasGlint(marine.tier) ? await readBytes(bot.bucket, cardKey(marine.serial, 'gif')) : null;
    const image = gif ?? (await readBytes(bot.bucket, marine.cardKey));
    if (image) return new Response(image, { headers: { ...CORS, 'Content-Type': gif ? 'image/gif' : 'image/png', 'Cache-Control': 'private, no-store' } });
  }
  await stampLater(bot, marine, user, waitUntil);
  return json({ stamping: true }, 202);
}

const ROUTES: Record<string, (bot: TelegramBot, user: TelegramUser, waitUntil: Waiter) => Promise<Response>> = {
  '/tg/session': (bot, user) => session(bot, user),
  '/tg/enlist': enlist,
  '/tg/card': card,
};

async function launchUser(request: Request, bot: TelegramBot): Promise<TelegramUser | Response> {
  const body = await cappedBody(request, MAX_REQUEST_BYTES);
  if (body === null) return json({ error: 'too large' }, 413);
  let initData: unknown;
  try {
    initData = (JSON.parse(body) as { initData?: unknown }).initData;
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (typeof initData !== 'string') return json({ error: 'bad request' }, 400);
  const launch = await verifyLaunchData(initData, bot.settings.botToken, bot.now().getTime());
  return launch ? launch.user : json({ error: 'launch' }, 401);
}

/** Answers a request under /tg/. A failure nobody expected answers 500 and alerts telegram-api:<route>; the launch data is never logged. */
export async function miniAppRoute(request: Request, bot: TelegramBot, waitUntil: Waiter): Promise<Response> {
  const path = new URL(request.url).pathname;
  const route = ROUTES[path];
  if (!route) return new Response('Not found', { status: 404, headers: CORS });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: PREFLIGHT });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' } });
  try {
    const user = await launchUser(request, bot);
    if (user instanceof Response) return user;
    return await route(bot, user, waitUntil);
  } catch (err) {
    const name = path.slice('/tg/'.length);
    console.error(`/tg/${name} failed: ${reason(err)}`);
    await bot.alert(`telegram-api:${name}`, `/tg/${name} failed: ${reason(err)}`);
    return json({ error: 'internal' }, 500);
  }
}
