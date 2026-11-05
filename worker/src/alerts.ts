import type { Deps } from './deps';
import { claimMeta, releaseMeta } from './store';
import { sendTelegramMessage } from './telegram';

export type Alert = (signature: string, text: string) => Promise<void>;

const SUPPRESS_MS = 3_600_000;

/**
 * Sends each signature at most once an hour. The suppression row is claimed before sending, so overlapping cron runs
 * raising the same signature send it once; a failed send releases the claim so the next alert retries. When D1 cannot
 * store the claim, the alert goes out unsuppressed: it may be about D1 itself, and a repeat beats silence.
 */
export function createAlerter(db: D1Database, telegram: { token?: string; chatId?: string }, deps: Deps): Alert {
  return async (signature, text) => {
    const key = `alert:${signature}`;
    const now = deps.now();
    const claim = now.toISOString();
    const staleAtOrBefore = new Date(now.getTime() - SUPPRESS_MS).toISOString();
    let claimed = true;
    try {
      if (!(await claimMeta(db, key, claim, staleAtOrBefore))) return;
    } catch (err) {
      claimed = false;
      console.error(`[alert] could not claim ${key}, sending unsuppressed: ${err instanceof Error ? err.message : String(err)}`);
    }

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
      console.error(`[alert] ${failure} for signature ${signature}: ${text}`);
      if (claimed) await releaseMeta(db, key, claim);
      return;
    }
    // One line per sent alert, so Workers Logs lists every alert, the ones D1 kept no suppression row for included.
    console.log(JSON.stringify({ alert_sent: signature, suppressed_for_ms: claimed ? SUPPRESS_MS : 0 }));
  };
}
