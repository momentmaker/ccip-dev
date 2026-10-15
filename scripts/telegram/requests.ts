import { MINI_APP_URL, stickerPackName } from '@ccip-dev/core/linkmarine';
import { parse } from 'smol-toml';

/** What `pnpm telegram:setup` asks the Bot API, in order (core.telegram.org/bots/api). */
export const WEBHOOK_URL = 'https://discord.ccip.dev/telegram';
export const ALLOWED_UPDATES = ['message', 'my_chat_member'];
export const BOT_COMMANDS = [{ command: 'start', description: 'Enlist and get your LinkMarine dog tag' }];
/** Telegram's rule for a webhook's secret_token. */
const SECRET = /^[A-Za-z0-9_-]{1,256}$/;

export interface SetupCall {
  method: string;
  body: Record<string, unknown>;
}

export interface BotAnswer {
  ok: boolean;
  description?: string;
  status: number;
}

/** The sticker owner's Telegram user id, from discord/wrangler.toml's [vars], so the Worker and the setup agree on it. */
export function ownerIdFrom(wranglerToml: string): number {
  const id = (parse(wranglerToml) as { vars?: { TELEGRAM_STICKER_OWNER_ID?: unknown } }).vars?.TELEGRAM_STICKER_OWNER_ID;
  if (typeof id !== 'string' || !/^[1-9]\d{4,15}$/.test(id)) {
    throw new Error('discord/wrangler.toml: set [vars] TELEGRAM_STICKER_OWNER_ID to your Telegram user id first (docs/runbook.md, "LinkMarines on Telegram": message @ccipdevbot, then read message.from.id from getUpdates)');
  }
  return Number(id);
}

export function checkSecret(secret: string | undefined): string {
  if (!secret || !SECRET.test(secret)) throw new Error('.env: TELEGRAM_WEBHOOK_SECRET must be 1-256 letters, digits, _ or - (see docs/runbook.md, "LinkMarines on Telegram")');
  return secret;
}

/** The webhook, the commands, the menu button, then two checks: that the owner has started the bot, and whether Vol. 1 exists yet. */
export function setupCalls(secret: string, ownerId: number): SetupCall[] {
  return [
    { method: 'setWebhook', body: { url: WEBHOOK_URL, secret_token: secret, allowed_updates: ALLOWED_UPDATES, drop_pending_updates: true } },
    { method: 'setMyCommands', body: { commands: BOT_COMMANDS } },
    { method: 'setChatMenuButton', body: { menu_button: { type: 'web_app', text: 'LinkMarines', web_app: { url: MINI_APP_URL } } } },
    { method: 'getChat', body: { chat_id: ownerId } },
    { method: 'getStickerSet', body: { name: stickerPackName(1) } },
  ];
}

export const botUrl = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

export async function callBot(token: string, { method, body }: SetupCall, send: typeof fetch = fetch): Promise<BotAnswer> {
  let res: Response;
  try {
    res = await send(botUrl(token, method), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch (err) {
    // A rejected fetch can carry the URL, and the URL carries the token, so only the error's name gets out.
    throw new Error(`${method}: request failed (${err instanceof Error ? err.name : 'unknown'})`);
  }
  const answer = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  return { ok: answer.ok === true, description: answer.description, status: res.status };
}
