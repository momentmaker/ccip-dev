import type { Deps } from './deps';
import { getMeta, setMeta } from './store';
import { sendTelegramMessage } from './telegram';

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

    const failure = await sendTelegramMessage(
      deps.fetch,
      { token: telegram.token, chatId: telegram.chatId },
      `ccip.dev alert: ${text}`,
    );
    if (failure) {
      console.error(`[alert] ${failure} for signature ${signature}`);
      return;
    }
    await setMeta(db, key, now.toISOString());
  };
}
