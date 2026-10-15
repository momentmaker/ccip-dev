/**
 * The Bot API calls LinkMarines on Telegram makes (core.telegram.org/bots/api). It never retries and never sleeps: a
 * request a Marine waits on can't wait out a 429, and the sticker job stops its run on one. It never throws, and no
 * answer it gives carries the token.
 */
export const TELEGRAM_API = 'https://api.telegram.org';
export const TELEGRAM_TIMEOUT_MS = 5_000;

export type TelegramResult<T> = { ok: true; result: T } | { ok: false; status: number; description: string; retryAfter: number | null };

export interface TelegramFile {
  field: string;
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface TelegramApi {
  /** A JSON Bot API method. */
  call<T>(method: string, body: Record<string, unknown>, timeoutMs?: number): Promise<TelegramResult<T>>;
  /** A Bot API method with one file, as multipart; `fields` are its other parameters. */
  upload<T>(method: string, fields: Record<string, string>, file: TelegramFile, timeoutMs?: number): Promise<TelegramResult<T>>;
  /** A file's bytes by the `file_path` getFile gave, or null. */
  download(filePath: string, timeoutMs?: number): Promise<Uint8Array | null>;
}

const failed = (err: unknown): TelegramResult<never> => ({ ok: false, status: 0, description: `request failed (${err instanceof Error ? err.name : 'unknown error'})`, retryAfter: null });

async function answer<T>(res: Response): Promise<TelegramResult<T>> {
  let body: { ok?: boolean; result?: T; description?: unknown; parameters?: { retry_after?: unknown } } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // A body that isn't JSON (a proxy's error page) leaves only the status to report.
  }
  if (res.ok && body.ok === true) return { ok: true, result: body.result as T };
  const retryAfter = typeof body.parameters?.retry_after === 'number' ? body.parameters.retry_after : null;
  return { ok: false, status: res.status, description: typeof body.description === 'string' ? body.description.slice(0, 200) : `HTTP ${res.status}`, retryAfter };
}

export function telegramApi(token: string, fetchFn: typeof fetch): TelegramApi {
  const url = (method: string) => `${TELEGRAM_API}/bot${token}/${method}`;
  return {
    async call<T>(method: string, body: Record<string, unknown>, timeoutMs = TELEGRAM_TIMEOUT_MS) {
      try {
        const res = await fetchFn(url(method), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
        return await answer<T>(res);
      } catch (err) {
        return failed(err);
      }
    },
    async upload<T>(method: string, fields: Record<string, string>, file: TelegramFile, timeoutMs = TELEGRAM_TIMEOUT_MS) {
      const form = new FormData();
      for (const [name, value] of Object.entries(fields)) form.append(name, value);
      form.append(file.field, new Blob([file.bytes], { type: file.type }), file.name);
      try {
        return await answer<T>(await fetchFn(url(method), { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) }));
      } catch (err) {
        return failed(err);
      }
    },
    async download(filePath: string, timeoutMs = TELEGRAM_TIMEOUT_MS) {
      try {
        const res = await fetchFn(`${TELEGRAM_API}/file/bot${token}/${filePath}`, { signal: AbortSignal.timeout(timeoutMs) });
        return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
      } catch {
        return null;
      }
    },
  };
}
