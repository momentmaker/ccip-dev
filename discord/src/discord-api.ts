import { EPHEMERAL } from './interactions';

export const DISCORD_API = 'https://discord.com/api/v10';
/** At most this long on one 429, whatever retry_after says: the interaction token outlives it many times over. */
const RETRY_CAP_MS = 10_000;

export interface Attachment {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface DiscordApi {
  /** Edits the deferred reply: text, and an image to replace any before it. A 429 is waited out for at most maxWaitMs, and each request is abandoned after timeoutMs. */
  editOriginal(token: string, content: string, file?: Attachment | null, maxWaitMs?: number, timeoutMs?: number): Promise<void>;
  /** A reply only the invoker sees. After a public defer, the loading message is deleted first, or Discord would edit it instead. */
  privateFollowup(token: string, content: string): Promise<void>;
}

export class DiscordError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Discord returned HTTP ${status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    this.name = 'DiscordError';
  }
}

const NO_MENTIONS = { parse: [] as string[] };

/** What a 429's retry leaves of the budget unspent, for the answer to come back. */
const RETRY_MARGIN_MS = 500;

export function discordApi(applicationId: string, deps: { fetch: typeof fetch; sleep: (ms: number) => Promise<void>; now?: () => number }): DiscordApi {
  const webhook = (token: string) => `${DISCORD_API}/webhooks/${applicationId}/${token}`;
  const now = deps.now ?? Date.now;

  /**
   * timeoutMs is one budget for the whole call: both requests share one abort signal, and a 429 is retried only when
   * its wait fits in what the budget has left. maxWaitMs additionally caps that wait.
   */
  async function send(url: string, build: () => RequestInit, maxWaitMs = RETRY_CAP_MS, timeoutMs?: number): Promise<void> {
    const startedAt = now();
    const signal = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
    const init = () => (signal ? { signal, ...build() } : build());
    let res = await deps.fetch(url, init());
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as { retry_after?: unknown };
      const seconds = typeof body.retry_after === 'number' && body.retry_after > 0 ? body.retry_after : 1;
      const room = timeoutMs === undefined ? Infinity : timeoutMs - (now() - startedAt) - RETRY_MARGIN_MS;
      const wait = Math.min(seconds * 1000, RETRY_CAP_MS, maxWaitMs);
      if (wait <= 0 || wait > room) throw new DiscordError(429, '');
      await deps.sleep(wait);
      res = await deps.fetch(url, init());
    }
    if (!res.ok) throw new DiscordError(res.status, await res.text().catch(() => ''));
    await res.body?.cancel();
  }

  return {
    editOriginal(token, content, file = null, maxWaitMs, timeoutMs) {
      return send(`${webhook(token)}/messages/@original`, () => {
        if (!file) return { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, allowed_mentions: NO_MENTIONS, attachments: [] }) };
        const form = new FormData();
        form.append('payload_json', JSON.stringify({ content, allowed_mentions: NO_MENTIONS, attachments: [{ id: 0, filename: file.name }] }));
        form.append('files[0]', new Blob([file.bytes], { type: file.type }), file.name);
        return { method: 'PATCH', body: form };
      }, maxWaitMs, timeoutMs);
    },
    async privateFollowup(token, content) {
      try {
        await send(`${webhook(token)}/messages/@original`, () => ({ method: 'DELETE' }));
      } catch (err) {
        console.warn(`the loading message was not deleted: ${err instanceof Error ? err.message : String(err)}`);
      }
      await send(webhook(token), () => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, flags: EPHEMERAL, allowed_mentions: NO_MENTIONS }) }));
    },
  };
}
