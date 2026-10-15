import { MINI_APP_URL, miniAppLink, parseStartParam, TELEGRAM_BOT_USERNAME } from '@ccip-dev/core/linkmarine';
import { cappedBody } from './body';
import { reason } from './enlistment';
import type { TelegramBot } from './telegram-marines';

// The thin bot behind @ccipdevbot's webhook, POST /telegram: /start opens the Mini App, /id names a chat for the owner or
// a gate chat, and the bot leaves a group unless the owner added it or it is on the gate list. Everything else happens in the Mini App.

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  username?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: { from?: { id: number }; chat: TelegramChat; text?: string };
  my_chat_member?: { from: { id: number }; chat: TelegramChat; new_chat_member: { status: string } };
}

export const START_TEXT = 'Enlist and get your LinkMarine dog tag.';
export const OPEN_BUTTON = 'Open LinkMarines';
/** A handled update's claim is kept this long; Telegram stops redelivering long before. */
const CLAIM_KEEP_MS = 86_400_000;

const sha256 = async (text: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));

/** Both sides are hashed first: timingSafeEqual throws on unequal lengths, and a digest does not give the secret's length away. */
export async function webhookSecretMatches(expected: string, got: string | null): Promise<boolean> {
  if (!expected || got === null) return false;
  const [a, b] = await Promise.all([sha256(expected), sha256(got)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/** The setting is text, so ids compare as strings; usernames compare without case, as Telegram's do. */
export function onGateList(chat: TelegramChat, gateChats: readonly string[]): boolean {
  return gateChats.some((entry) => (entry.startsWith('@') ? chat.username?.toLowerCase() === entry.slice(1).toLowerCase() : entry === String(chat.id)));
}

/** Any whole-word /command addressed to this bot or to no bot, with its first argument; the handler ignores names it does not know. */
export function parseCommand(text: string): { name: string; payload: string | null } | null {
  const match = /^\/([a-z]+)(?:@(\w+))?(?=\s|$)(?:\s+(\S+))?/i.exec(text.trim());
  if (!match || (match[2] !== undefined && match[2].toLowerCase() !== TELEGRAM_BOT_USERNAME)) return null;
  return { name: match[1]!.toLowerCase(), payload: match[3] ?? null };
}

/** Claims an update before any work, so a redelivery, even one arriving while the first is still running, does nothing. */
export async function claimUpdate(db: D1Database, updateId: number, now: Date): Promise<boolean> {
  const res = await db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').bind(`tg-update:${updateId}`, now.toISOString()).run();
  return res.meta.changes > 0;
}

/** A claim is only needed for a day; the cron drops it after that so meta stays small. */
export async function pruneClaims(db: D1Database, now: Date): Promise<void> {
  const before = new Date(now.getTime() - CLAIM_KEEP_MS).toISOString();
  await db.prepare("DELETE FROM meta WHERE (key LIKE 'tg-update:%' OR key LIKE 'tg-stamp:%') AND value < ?").bind(before).run();
}

/** tg.call never throws, so a refusal would leave no trace. It is warned, not alerted: a user who blocked the bot is routine. */
async function callOrWarn(bot: TelegramBot, method: 'sendMessage' | 'leaveChat', body: Record<string, unknown>): Promise<void> {
  const res = await bot.tg.call(method, body);
  if (!res.ok) console.warn(`telegram ${method} failed (${res.status}): ${res.description}`);
}

/** Telegram allows web_app buttons only in private chats, so a group gets a link. Only a known payload rides along as startapp. */
async function start(bot: TelegramBot, chat: TelegramChat, payload: string | null): Promise<void> {
  const startapp = payload !== null && parseStartParam(payload) ? payload : undefined;
  const button = chat.type === 'private' ? { text: OPEN_BUTTON, web_app: { url: startapp ? `${MINI_APP_URL}?startapp=${startapp}` : MINI_APP_URL } } : { text: OPEN_BUTTON, url: miniAppLink(startapp) };
  await callOrWarn(bot, 'sendMessage', { chat_id: chat.id, text: START_TEXT, reply_markup: { inline_keyboard: [[button]] } });
}

export async function handleUpdate(bot: TelegramBot, update: TelegramUpdate): Promise<void> {
  const owner = bot.settings.ownerId;
  const allowed = (chat: TelegramChat, from: number | undefined) => chat.type === 'private' || onGateList(chat, bot.settings.gateChats) || (owner !== null && from === owner);
  const joined = update.my_chat_member;
  if (joined) {
    // A group that restricts new members adds the bot as restricted, which is still being in the chat.
    const inChat = joined.new_chat_member.status !== 'left' && joined.new_chat_member.status !== 'kicked';
    if (inChat && !allowed(joined.chat, joined.from.id)) await callOrWarn(bot, 'leaveChat', { chat_id: joined.chat.id });
    return;
  }
  const message = update.message;
  const command = message?.text ? parseCommand(message.text) : null;
  if (!message || !command) return;
  if (!allowed(message.chat, message.from?.id)) {
    await callOrWarn(bot, 'leaveChat', { chat_id: message.chat.id });
    return;
  }
  if (command.name === 'start') await start(bot, message.chat, command.payload);
  const mayAskId = (owner !== null && message.from?.id === owner) || (message.chat.type !== 'private' && onGateList(message.chat, bot.settings.gateChats));
  if (command.name === 'id' && mayAskId) await callOrWarn(bot, 'sendMessage', { chat_id: message.chat.id, text: `This chat's ID: ${message.chat.id}` });
}

async function processUpdate(bot: TelegramBot, update: TelegramUpdate): Promise<void> {
  try {
    if (!(await claimUpdate(bot.db, update.update_id, bot.now()))) return;
    await handleUpdate(bot, update);
  } catch (err) {
    console.error(`telegram update ${update.update_id}: ${reason(err)}`);
    await bot.alert('telegram-update', `update ${update.update_id} failed: ${reason(err)}`);
  }
}

/** Telegram retries anything but a 2xx, so once the secret checks out every answer is 200 and the work runs in waitUntil. */
export async function telegramWebhook(request: Request, bot: TelegramBot, secret: string, waitUntil: (work: Promise<unknown>) => void): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  if (!(await webhookSecretMatches(secret, request.headers.get('X-Telegram-Bot-Api-Secret-Token')))) return new Response('Unauthorized', { status: 401 });
  const body = await cappedBody(request);
  if (body === null) return new Response('ok');
  let update: TelegramUpdate;
  try {
    update = JSON.parse(body) as TelegramUpdate;
  } catch {
    return new Response('ok');
  }
  if (bot.settings.open && Number.isSafeInteger(update?.update_id)) waitUntil(processUpdate(bot, update));
  return new Response('ok');
}
