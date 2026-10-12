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
    const res = await withRetryAfter(deps, post);
    return res.ok ? null : `Telegram returned HTTP ${res.status}${await description(res)}`;
  } catch (error) {
    return failedRequest(error);
  }
}

export interface TelegramPoll {
  question: string;
  options: readonly string[];
}

/**
 * Sends an anonymous poll, as a channel's polls are, with no close time: the next Monday's run closes it. Returns the
 * poll's message id, or what went wrong.
 */
export async function sendTelegramPoll(
  deps: Pick<Deps, 'fetch' | 'sleep'>,
  config: TelegramConfig,
  poll: TelegramPoll,
  timeoutMs = TELEGRAM_TIMEOUT_MS,
): Promise<{ messageId: number } | { problem: string }> {
  const body = { chat_id: config.chatId, question: poll.question, options: poll.options.map((text) => ({ text })), is_anonymous: true };
  const result = await callTelegram(deps, config.token, 'sendPoll', body, timeoutMs);
  if ('problem' in result) return result;
  const messageId = (result.result as { message_id?: unknown } | null)?.message_id;
  return typeof messageId === 'number' ? { messageId } : { problem: 'Telegram answered without a message id' };
}

/** Closes a poll the bot sent and returns each option's voter count, in option order, and the total; or what went wrong. */
export async function stopTelegramPoll(
  deps: Pick<Deps, 'fetch' | 'sleep'>,
  config: TelegramConfig,
  messageId: number,
  timeoutMs = TELEGRAM_TIMEOUT_MS,
): Promise<{ voters: number[]; total: number } | { problem: string }> {
  const result = await callTelegram(deps, config.token, 'stopPoll', { chat_id: config.chatId, message_id: messageId }, timeoutMs);
  if ('problem' in result) return result;
  const poll = result.result as { options?: { voter_count?: unknown }[]; total_voter_count?: unknown } | null;
  const voters = poll?.options?.map((o) => o.voter_count);
  if (!voters || !voters.every((n): n is number => typeof n === 'number') || typeof poll?.total_voter_count !== 'number') {
    return { problem: 'Telegram answered without vote counts' };
  }
  return { voters, total: poll.total_voter_count };
}

/** A JSON Bot API call with the same 429 retry and timeout as sendTelegramPhoto; returns Telegram's `result`, or what went wrong. */
async function callTelegram(
  deps: Pick<Deps, 'fetch' | 'sleep'>,
  token: string,
  method: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ result: unknown } | { problem: string }> {
  const post = () =>
    deps.fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  try {
    const res = await withRetryAfter(deps, post);
    if (!res.ok) return { problem: `Telegram returned HTTP ${res.status}${await description(res)}` };
    return { result: ((await res.json()) as { result?: unknown }).result ?? null };
  } catch (error) {
    return { problem: failedRequest(error) };
  }
}

async function withRetryAfter(deps: Pick<Deps, 'sleep'>, post: () => Promise<Response>): Promise<Response> {
  const res = await post();
  if (res.status !== 429) return res;
  await deps.sleep(Math.min(await retryAfter(res), TELEGRAM_RETRY_CAP_S) * 1000);
  return post();
}

const failedRequest = (error: unknown) => `Telegram request failed (${error instanceof Error ? error.name : 'unknown error'})`;

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
