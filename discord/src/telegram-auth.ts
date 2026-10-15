/** The Telegram user a Mini App's launch data names (core.telegram.org/bots/webapps#webappuser). */
export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

export interface LaunchData {
  user: TelegramUser;
  /** Unix seconds, when Telegram opened the Mini App. */
  authDate: number;
}

/** Launch data older than this is refused: a copied launch string can't be used for long. */
export const LAUNCH_MAX_AGE_S = 86_400;
/** Telegram's clock and ours may disagree by a little; a launch from further in the future is refused. */
const CLOCK_SKEW_S = 300;

const encoder = new TextEncoder();
const HASH = /^[0-9a-f]{64}$/;

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));

async function hmacKey(secret: Uint8Array, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

function parseUser(raw: string | null): TelegramUser | null {
  try {
    const user = JSON.parse(raw ?? '') as Partial<TelegramUser>;
    if (!Number.isSafeInteger(user.id) || typeof user.first_name !== 'string') return null;
    return user as TelegramUser;
  } catch {
    return null;
  }
}

/**
 * The verified launch data, or null. Telegram signs every field but `hash`: sorted by key as `key=value` lines, with
 * HMAC-SHA256 under the key HMAC-SHA256("WebAppData", bot token). crypto.subtle.verify compares in constant time.
 */
export async function verifyLaunchData(initData: string, botToken: string, nowMs: number): Promise<LaunchData | null> {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash') ?? '';
  if (!HASH.test(hash)) return null;
  const dataCheck = [...params]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(encoder.encode('WebAppData'), 'sign'), encoder.encode(botToken)));
  if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), hexBytes(hash), encoder.encode(dataCheck)))) return null;
  const authDate = Number(params.get('auth_date'));
  const age = nowMs / 1000 - authDate;
  if (!Number.isInteger(authDate) || age > LAUNCH_MAX_AGE_S || age < -CLOCK_SKEW_S) return null;
  const user = parseUser(params.get('user'));
  return user ? { user, authDate } : null;
}
