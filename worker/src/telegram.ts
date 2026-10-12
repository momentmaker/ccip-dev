import type { Deps } from './deps';

const MAX_TEXT_LENGTH = 3500;

export interface TelegramConfig {
  token: string;
  chatId: string;
}

export async function sendTelegramMessage(
  fetchFn: typeof fetch,
  { token, chatId }: TelegramConfig,
  text: string,
): Promise<string | null> {
  try {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, MAX_TEXT_LENGTH) }),
    });
    return res.ok ? null : `Telegram returned HTTP ${res.status}`;
  } catch (error) {
    return `Telegram request failed (${error instanceof Error ? error.name : 'unknown error'})`;
  }
}

export const TELEGRAM_RETRY_CAP_S = 30;

export interface TelegramPhoto {
  photo: string;
  caption: string;
  parseMode?: 'HTML';
}

/** Sends a photo by URL. A 429 is retried once after Telegram's retry_after, at most 30 s. Returns null, or what went wrong. */
export async function sendTelegramPhoto(deps: Pick<Deps, 'fetch' | 'sleep'>, { token, chatId }: TelegramConfig, msg: TelegramPhoto): Promise<string | null> {
  const body = JSON.stringify({ chat_id: chatId, photo: msg.photo, caption: msg.caption, ...(msg.parseMode ? { parse_mode: msg.parseMode } : {}) });
  const post = () => deps.fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  try {
    let res = await post();
    if (res.status === 429) {
      await deps.sleep(Math.min(await retryAfter(res), TELEGRAM_RETRY_CAP_S) * 1000);
      res = await post();
    }
    return res.ok ? null : `Telegram returned HTTP ${res.status}${await description(res)}`;
  } catch (error) {
    return `Telegram request failed (${error instanceof Error ? error.name : 'unknown error'})`;
  }
}

async function retryAfter(res: Response): Promise<number> {
  try {
    const seconds = ((await res.json()) as { parameters?: { retry_after?: unknown } }).parameters?.retry_after;
    return typeof seconds === 'number' && seconds > 0 ? seconds : 1;
  } catch {
    return 1;
  }
}

async function description(res: Response): Promise<string> {
  try {
    const text = ((await res.json()) as { description?: unknown }).description;
    return typeof text === 'string' ? `: ${text.slice(0, 200)}` : '';
  } catch {
    return '';
  }
}
