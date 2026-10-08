import type { Deps } from './deps';
import { claimMeta, releaseMeta } from './store';
import { sendTelegramMessage } from './telegram';

export type Alert = (signature: string, text: string) => Promise<void>;

const SUPPRESS_MS = 3_600_000;

/**
 * Sends each signature at most once an hour. The suppression row is claimed before sending, so overlapping cron runs
 * raising the same signature send it once; a failed send releases the claim so the next alert retries.
 */
export function createAlerter(db: D1Database, telegram: { token?: string; chatId?: string }, deps: Deps): Alert {
  return async (signature, text) => {
    const key = `alert:${signature}`;
    const now = deps.now();
    const claim = now.toISOString();
    const staleAtOrBefore = new Date(now.getTime() - SUPPRESS_MS).toISOString();
    if (!(await claimMeta(db, key, claim, staleAtOrBefore))) return;

    if (!telegram.token || !telegram.chatId) {
      console.warn(`[alert] ${text}`);
      return;
    }

    const failure = await sendTelegramMessage(
      deps.fetch,
      { token: telegram.token, chatId: telegram.chatId },
      `ccip.dev alert: ${text}`,
    );
    if (failure) {
      console.error(`[alert] ${failure} for signature ${signature}`);
      await releaseMeta(db, key, claim);
    }
  };
}
