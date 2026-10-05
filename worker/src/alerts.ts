import type { Deps } from './deps';
import { getMeta, setMeta } from './store';

export type Alert = (signature: string, text: string) => Promise<void>;

const SUPPRESS_MS = 3_600_000;

export function createAlerter(db: D1Database, telegram: { token?: string; chatId?: string }, deps: Deps): Alert {
  return async (signature, text) => {
    const key = `alert:${signature}`;
    const now = deps.now();
    const last = await getMeta(db, key);
    if (last !== null && now.getTime() - Date.parse(last) < SUPPRESS_MS) return;

    if (!telegram.token || !telegram.chatId) {
      console.warn(`[alert] ${text}`);
      await setMeta(db, key, now.toISOString());
      return;
    }

    try {
      const res = await deps.fetch(`https://api.telegram.org/bot${telegram.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: telegram.chatId, text: `ccip.dev alert: ${text}`.slice(0, 3500) }),
      });
      if (!res.ok) {
        console.error(`[alert] Telegram returned HTTP ${res.status} for signature ${signature}`);
        return;
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : 'unknown error';
      console.error(`[alert] Telegram request failed (${name}) for signature ${signature}`);
      return;
    }
    await setMeta(db, key, now.toISOString());
  };
}
