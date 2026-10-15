import { stickerVolume, type Gate, type MarineSummary } from '@ccip-dev/core/linkmarine';
import { createBot, type Bot } from './bot';
import { avatarKey, publicCard, readBytes, reason, snapshotCount, stampCard, type Report } from './enlistment';
import type { Env } from './env';
import { loadMemes } from './memes';
import { storyKey, webCardKey } from './public';
import { claimMeta, type Marine } from './store';
import type { TelegramUser } from './telegram-auth';
import { telegramApi, type TelegramApi } from './telegram-api';

export const TELEGRAM_PLATFORM = 'telegram';

export interface TelegramSettings {
  /** TELEGRAM_BOT is "on". */
  open: boolean;
  /** TELEGRAM_GATE_CHATS: a member of any of them may enlist. */
  gateChats: string[];
  /** TELEGRAM_STICKER_OWNER_ID, or null while unset. */
  ownerId: number | null;
  botToken: string;
}

/** The bot as LinkMarines on Telegram uses it: the shared enlistment's dependencies, the Bot API and the settings. */
export interface TelegramBot extends Bot {
  tg: TelegramApi;
  settings: TelegramSettings;
}

export function telegramSettings(env: Env): TelegramSettings {
  const owner = Number(env.TELEGRAM_STICKER_OWNER_ID ?? '');
  return {
    open: env.TELEGRAM_BOT === 'on',
    gateChats: (env.TELEGRAM_GATE_CHATS ?? '').split(',').map((c) => c.trim()).filter((c) => c !== ''),
    ownerId: Number.isSafeInteger(owner) && owner > 0 ? owner : null,
    botToken: env.TELEGRAM_BOT_TOKEN ?? '',
  };
}

export function createTelegramBot(env: Env): TelegramBot {
  const bot = createBot(env);
  const settings = telegramSettings(env);
  return { ...bot, tg: telegramApi(settings.botToken, bot.fetch), settings };
}

/** Launch data is cast to TelegramUser, never checked past the id and first name, so any other field may be of any type. */
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function telegramName(user: Pick<TelegramUser, 'first_name' | 'last_name' | 'username'>): string {
  const full = [text(user.first_name), text(user.last_name)].filter((part) => part !== '').join(' ');
  if (full !== '') return full;
  const username = text(user.username);
  return username !== '' ? `@${username}` : 'Marine';
}

const PHOTO_TIMEOUT_MS = 5_000;
/** The largest profile photo size fetched: the card draws the avatar at 41 px, from a 240 px copy. */
const PHOTO_MAX_PX = 640;

interface PhotoSize {
  file_id: string;
  width: number;
}

/** The launch data's photo, when it is a JPEG on Telegram's own host (it can also be an SVG, which the card can't draw). */
function launchPhotoUrl(user: TelegramUser): string | null {
  if (typeof user.photo_url !== 'string') return null;
  try {
    const url = new URL(user.photo_url);
    return url.protocol === 'https:' && url.hostname === 't.me' && /\.jpe?g$/i.test(url.pathname) ? url.href : null;
  } catch {
    return null;
  }
}

/** The launch photo's bytes, or null when the download fails, is refused or is not a JPEG: the profile photo is the fallback. */
async function downloadLaunchPhoto(bot: TelegramBot, url: string): Promise<Uint8Array | null> {
  try {
    const res = await bot.fetch(url, { signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
    return res.ok && res.headers.get('content-type')?.startsWith('image/jpeg') ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch (err) {
    console.warn(`telegram launch photo download failed (${err instanceof Error ? err.name : 'unknown error'})`);
    return null;
  }
}

/** The user's profile photo bytes: the launch data's photo, else the newest profile photo up to 640 px. Null when hidden or missing. */
async function profilePhoto(bot: TelegramBot, user: TelegramUser): Promise<Uint8Array | null> {
  const fromLaunch = launchPhotoUrl(user);
  if (fromLaunch) {
    const launched = await downloadLaunchPhoto(bot, fromLaunch);
    if (launched) return launched;
  }
  const photos = await bot.tg.call<{ photos: PhotoSize[][] }>('getUserProfilePhotos', { user_id: user.id, limit: 1 }, PHOTO_TIMEOUT_MS);
  const sizes = photos.ok ? (photos.result.photos[0] ?? []) : [];
  const fits = sizes.filter((s) => s.width <= PHOTO_MAX_PX);
  const best = fits.length > 0 ? fits.reduce((a, b) => (b.width > a.width ? b : a)) : sizes.reduce<PhotoSize | null>((a, b) => (a === null || b.width < a.width ? b : a), null);
  if (!best) return null;
  const file = await bot.tg.call<{ file_path?: string }>('getFile', { file_id: best.file_id }, PHOTO_TIMEOUT_MS);
  return file.ok && file.result.file_path ? bot.tg.download(file.result.file_path, PHOTO_TIMEOUT_MS) : null;
}

/**
 * The avatar to stamp: the profile photo as the 240 px PNG the site makes of a meme, kept in R2 as the Discord
 * avatars are; else the one kept before; else null, the gradient disc. Never rejects.
 */
export async function telegramAvatar(bot: TelegramBot, serial: number, user: TelegramUser): Promise<Uint8Array | null> {
  try {
    const photo = await profilePhoto(bot, user);
    if (photo) {
      const png = await bot.renderer.prepareMeme(photo);
      await bot.bucket.put(avatarKey(serial), png, { httpMetadata: { contentType: 'image/png' } });
      return png;
    }
    return await readBytes(bot.bucket, avatarKey(serial));
  } catch (err) {
    console.warn(`telegram avatar for Marine ${serial}: ${reason(err)}`);
    return null;
  }
}

/** A stamp runs at most once a minute per Marine, however often the Mini App asks for the card. */
export const STAMP_CLAIM_MS = 60_000;

export function claimStamp(db: D1Database, serial: number, now: Date): Promise<boolean> {
  return claimMeta(db, `tg-stamp:${serial}`, now.getTime(), STAMP_CLAIM_MS);
}

/** Renders and keeps the web and Story cards from the public fields, each on its own so one that fails does not cost the other. */
async function stampPublicCards(bot: TelegramBot, marine: Marine, reports: Report[]): Promise<void> {
  const pngs = await loadMemes(bot.bucket, marine.memes);
  if (!pngs) return;
  const card = publicCard(bot, marine, pngs);
  const cards = [
    { what: 'web card', key: webCardKey(marine.serial), render: () => bot.renderer.renderMarineWebCard(card) },
    { what: 'Story card', key: storyKey(marine.serial), render: () => bot.renderer.renderMarineStory(card) },
  ];
  const kept = await Promise.allSettled(cards.map(async ({ key, render }) => bot.bucket.put(key, await render(), { httpMetadata: { contentType: 'image/png' } })));
  kept.forEach((result, i) => {
    if (result.status === 'rejected') reports.push({ signature: 'telegram-stamp', text: `the ${cards[i]!.what} failed: ${reason(result.reason)}` });
  });
}

/**
 * Stamps a Telegram Marine: the card with their name and photo (and the glint), then the public web card and the
 * Story card, which carry neither. Anything that fails is told to the alert chat as telegram-stamp:<serial>, once.
 */
export async function stampTelegram(bot: TelegramBot, marine: Marine, user: TelegramUser): Promise<void> {
  const reports: Report[] = [];
  await stampCard(bot, marine, () => telegramAvatar(bot, marine.serial, user), reports);
  try {
    await stampPublicCards(bot, marine, reports);
  } catch (err) {
    reports.push({ signature: 'telegram-stamp', text: `the web and Story cards could not be made: ${reason(err)}` });
  }
  if (reports.length > 0) await bot.alert(`telegram-stamp:${marine.serial}`, `Marine #${marine.serial}: ${reports.map((r) => r.text).join('; ')}`);
}

export function marineSummary(bot: Pick<Bot, 'snapshot'>, marine: Marine): MarineSummary {
  return {
    serial: marine.serial,
    callsign: marine.callsign,
    tags: marine.tags,
    tier: marine.tier,
    percentile: marine.percentile,
    memes: marine.memes.map((m) => ({ tag: m.tag, file: m.file, count: m.count ?? snapshotCount(bot, m.tag) })),
    volume: stickerVolume(marine.serial),
    cardReady: marine.cardKey !== null,
  };
}

const GATE_TIMEOUT_MS = 4_000;
const MEMBER = new Set(['creator', 'administrator', 'member']);
/** Telegram's answers for a user who is simply not in the chat: an answer, not a failure of the check. */
const NOT_IN_CHAT = /user not found|participant_id_invalid|member not found/i;

/**
 * Whether the user is in any gate chat; anything else is 'join'. Every check runs at once. A chat that errors with
 * anything but "not in the chat" (the bot was removed from it, a chat id is wrong, Telegram is down) is alerted as
 * telegram-gate:<chat> even when another chat lets the user in, so one broken chat is noticed while the rest work.
 */
export async function checkGate(bot: TelegramBot, userId: number): Promise<Gate> {
  const chats = bot.settings.gateChats;
  const answers = await Promise.all(chats.map((chat) => bot.tg.call<{ status: string; is_member?: boolean }>('getChatMember', { chat_id: chat, user_id: userId }, GATE_TIMEOUT_MS)));
  const alerts = answers.flatMap((a, i) => (!a.ok && !(a.status === 400 && NOT_IN_CHAT.test(a.description)) ? [bot.alert(`telegram-gate:${chats[i]}`, `gate chat ${chats[i]} could not be checked: ${a.description}`)] : []));
  if (chats.length === 0) alerts.push(bot.alert('telegram-gate', 'TELEGRAM_GATE_CHATS is empty, so nobody can enlist'));
  await Promise.all(alerts);
  return answers.some((a) => a.ok && (MEMBER.has(a.result.status) || (a.result.status === 'restricted' && a.result.is_member === true))) ? 'ok' : 'join';
}
