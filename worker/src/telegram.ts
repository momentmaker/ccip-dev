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
export const TELEGRAM_TIMEOUT_MS = 30_000;

export interface TelegramPhoto {
  photo: Uint8Array;
  caption: string;
  parseMode?: 'HTML';
}

/** Uploads a PNG. A 429 is retried once after Telegram's retry_after, at most 30 s; each request times out after `timeoutMs`. Returns null, or what went wrong. */
export async function sendTelegramPhoto(
  deps: Pick<Deps, 'fetch' | 'sleep'>,
  { token, chatId }: TelegramConfig,
  msg: TelegramPhoto,
  timeoutMs = TELEGRAM_TIMEOUT_MS,
): Promise<string | null> {
  // Built per request: a retry must re-send the whole body.
  const post = () => {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', msg.caption);
    if (msg.parseMode) form.append('parse_mode', msg.parseMode);
    form.append('photo', new Blob([msg.photo], { type: 'image/png' }), 'card.png');
    return deps.fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
  };
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
