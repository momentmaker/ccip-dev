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
  /** Edits the deferred reply: text, and an image to replace any before it. A 429 is waited out for at most maxWaitMs. */
  editOriginal(token: string, content: string, file?: Attachment | null, maxWaitMs?: number): Promise<void>;
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

export function discordApi(applicationId: string, deps: { fetch: typeof fetch; sleep: (ms: number) => Promise<void> }): DiscordApi {
  const webhook = (token: string) => `${DISCORD_API}/webhooks/${applicationId}/${token}`;

  async function send(url: string, init: () => RequestInit, maxWaitMs = RETRY_CAP_MS): Promise<void> {
    let res = await deps.fetch(url, init());
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as { retry_after?: unknown };
      const seconds = typeof body.retry_after === 'number' && body.retry_after > 0 ? body.retry_after : 1;
      const wait = Math.min(seconds * 1000, RETRY_CAP_MS, maxWaitMs);
      if (wait <= 0) throw new DiscordError(429, '');
      await deps.sleep(wait);
      res = await deps.fetch(url, init());
    }
    if (!res.ok) throw new DiscordError(res.status, await res.text().catch(() => ''));
    await res.body?.cancel();
  }

  return {
    editOriginal(token, content, file = null, maxWaitMs) {
      return send(`${webhook(token)}/messages/@original`, () => {
        if (!file) return { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, allowed_mentions: NO_MENTIONS, attachments: [] }) };
        const form = new FormData();
        form.append('payload_json', JSON.stringify({ content, allowed_mentions: NO_MENTIONS, attachments: [{ id: 0, filename: file.name }] }));
        form.append('files[0]', new Blob([file.bytes], { type: file.type }), file.name);
        return { method: 'PATCH', body: form };
      }, maxWaitMs);
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
