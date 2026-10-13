export type Alert = (signature: string, text: string) => Promise<void>;

const SUPPRESS_MS = 3_600_000;
const MAX_TEXT_LENGTH = 3500;

/**
 * Each signature goes to the alert chat at most once an hour, as the data Worker's alerts do: the suppression row in
 * meta is claimed before sending, and released when the send fails so the next alert retries. Without the Telegram
 * secrets the alert is only logged.
 */
export function createAlerter(db: D1Database, telegram: { token?: string; chatId?: string }, deps: { fetch: typeof fetch; now: () => Date }): Alert {
  return async (signature, text) => {
    const key = `alert:${signature}`;
    const now = deps.now();
    const claim = now.toISOString();
    const stale = new Date(now.getTime() - SUPPRESS_MS).toISOString();
    const claimed = await db
      .prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE meta.value <= ?3')
      .bind(key, claim, stale)
      .run();
    if (claimed.meta.changes === 0) return;
    if (!telegram.token || !telegram.chatId) {
      console.warn(`[alert] ${text}`);
      return;
    }
    let failure: string | null = null;
    try {
      const res = await deps.fetch(`https://api.telegram.org/bot${telegram.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: telegram.chatId, text: `ccip.dev discord alert: ${text}`.slice(0, MAX_TEXT_LENGTH) }),
      });
      if (!res.ok) failure = `Telegram returned HTTP ${res.status}`;
    } catch (err) {
      failure = `Telegram request failed (${err instanceof Error ? err.name : 'unknown error'})`;
    }
    if (failure) {
      console.error(`[alert] ${failure} for ${signature}: ${text}`);
      await db.prepare('DELETE FROM meta WHERE key = ? AND value = ?').bind(key, claim).run();
    }
  };
}
