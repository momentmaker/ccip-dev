import type { Deps } from './deps';

const API = 'https://api.x.com/2';
export const X_TIMEOUT_MS = 30_000;
export const X_RETRY_CAP_S = 30;

export interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

/** `outage` is true for a timeout, a network error or a 5xx: X itself is not answering, so more sends this run would fail too. */
export type XProblem = { problem: string; outage: boolean };
type XDeps = Pick<Deps, 'fetch' | 'sleep' | 'clock'>;

/** RFC 3986: encodeURIComponent leaves !*'() alone. */
const encode = (s: string) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

async function hmacSha1Base64(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message)));
  return btoa(String.fromCharCode(...signature));
}

/**
 * OAuth 1.0a Authorization header. Only the oauth_* fields and the URL's query params are signed; the JSON and multipart
 * bodies X takes here are not part of the signature.
 */
export async function oauth1Header(
  method: string,
  url: string,
  creds: XCredentials,
  { nonce, timestamp }: { nonce: string; timestamp: string },
): Promise<string> {
  const parsed = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };
  const pairs = [...Object.entries(oauth), ...parsed.searchParams.entries()].map(([k, v]) => [encode(k), encode(v)] as const);
  const parameterString = pairs
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const base = [method.toUpperCase(), encode(`${parsed.origin}${parsed.pathname}`), encode(parameterString)].join('&');
  const signature = await hmacSha1Base64(`${encode(creds.apiSecret)}&${encode(creds.accessSecret)}`, base);
  const fields = Object.entries({ ...oauth, oauth_signature: signature }).sort(([a], [b]) => (a < b ? -1 : 1));
  return `OAuth ${fields.map(([k, v]) => `${encode(k)}="${encode(v)}"`).join(', ')}`;
}

function freshNonce(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function detail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown; title?: unknown };
    return (typeof body.detail === 'string' ? body.detail : typeof body.title === 'string' ? body.title : '').slice(0, 200);
  } catch {
    return '';
  }
}

/** Seconds until x-rate-limit-reset (epoch seconds), or null when X sent none. */
function secondsUntilReset(res: Response, nowMs: number): number | null {
  const header = res.headers.get('x-rate-limit-reset');
  const reset = header === null ? Number.NaN : Number(header);
  return Number.isFinite(reset) && reset > 0 ? Math.max(0, reset - nowMs / 1000) : null;
}

/**
 * A signed POST. `request` runs per attempt because a retry must re-send the whole body, and each attempt gets its own nonce.
 * A 429 is retried once when x-rate-limit-reset is at most 30 s away; with a later reset or none it is given up at once. Returns the response
 * body of a 2xx, or what went wrong. The problem text never holds a key, the Authorization header or the URL.
 */
async function signedPost(
  deps: XDeps,
  creds: XCredentials,
  path: string,
  request: () => { body: BodyInit; headers?: Record<string, string> },
  timeoutMs: number,
): Promise<{ json: unknown } | (XProblem & { duplicate: boolean })> {
  const url = `${API}${path}`;
  const attempt = async () => {
    const { body, headers } = request();
    const authorization = await oauth1Header('POST', url, creds, { nonce: freshNonce(), timestamp: String(Math.floor(deps.clock() / 1000)) });
    return deps.fetch(url, { method: 'POST', headers: { ...headers, authorization }, body, signal: AbortSignal.timeout(timeoutMs) });
  };
  try {
    let res = await attempt();
    if (res.status === 429) {
      const wait = secondsUntilReset(res, deps.clock());
      if (wait !== null && wait <= X_RETRY_CAP_S) {
        await res.body?.cancel();
        await deps.sleep(wait * 1000);
        res = await attempt();
      }
    }
    if (!res.ok) {
      const why = await detail(res);
      return { problem: `X returned HTTP ${res.status}${why === '' ? '' : `: ${why}`}`, outage: res.status >= 500, duplicate: res.status === 403 && /duplicate/i.test(why) };
    }
    return { json: await res.json().catch(() => null) };
  } catch (error) {
    return { problem: `X request failed (${error instanceof Error ? error.name : 'unknown error'})`, outage: true, duplicate: false };
  }
}

/** Ids are strings only: a 19-digit JSON number has already lost precision. */
const idOf = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** Uploads a PNG card for a post. Reads the id from `data.id`, then `id`, then `media_id_string`. */
export async function uploadImage(deps: XDeps, creds: XCredentials, png: Uint8Array, timeoutMs = X_TIMEOUT_MS): Promise<{ mediaId: string } | XProblem> {
  const sent = await signedPost(
    deps,
    creds,
    '/media/upload',
    () => {
      const form = new FormData();
      form.append('media', new Blob([png], { type: 'image/png' }), 'card.png');
      form.append('media_category', 'tweet_image');
      return { body: form };
    },
    timeoutMs,
  );
  if ('problem' in sent) return { problem: sent.problem, outage: sent.outage };
  const json = (sent.json ?? {}) as { data?: { id?: unknown }; id?: unknown; media_id_string?: unknown };
  const mediaId = idOf(json.data?.id) ?? idOf(json.id) ?? idOf(json.media_id_string);
  return mediaId === null ? { problem: 'X accepted the upload but sent no media id', outage: false } : { mediaId };
}

/**
 * Any 2xx means the post exists, so an unreadable id still counts as posted. A 403 that calls the text a duplicate means X
 * already has it.
 */
export async function createPost(
  deps: XDeps,
  creds: XCredentials,
  { text, mediaIds }: { text: string; mediaIds: string[] },
  timeoutMs = X_TIMEOUT_MS,
): Promise<{ postId: string } | { duplicate: true } | XProblem> {
  const sent = await signedPost(
    deps,
    creds,
    '/tweets',
    () => ({ body: JSON.stringify({ text, media: { media_ids: mediaIds } }), headers: { 'content-type': 'application/json' } }),
    timeoutMs,
  );
  if ('problem' in sent) return sent.duplicate ? { duplicate: true } : { problem: sent.problem, outage: sent.outage };
  const postId = idOf((sent.json as { data?: { id?: unknown } } | null)?.data?.id);
  if (postId !== null) return { postId };
  console.error('[x] the post was accepted but its id could not be read');
  return { postId: 'unknown' };
}
