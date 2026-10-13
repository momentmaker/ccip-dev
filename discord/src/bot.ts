import type { LinkMarineRenderer } from '@ccip-dev/core/linkmarine';
import { createAlerter, type Alert } from './alerts';
import { discordApi, type DiscordApi } from './discord-api';
import { cryptoRandom, type CallsignSnapshot } from './draw';
import type { Env } from './env';
import snapshot from './data/callsigns.json';

/** Everything a command needs, so tests can hand it fakes. */
export interface Bot {
  db: D1Database;
  bucket: R2Bucket;
  renderer: LinkMarineRenderer;
  discord: DiscordApi;
  alert: Alert;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** Resolves with null after ms: a timer to race work against, which tests drive by their fake clock. */
  deadline: (ms: number) => Promise<null>;
  now: () => Date;
  random: () => number;
  snapshot: CallsignSnapshot;
}

const FETCH_TIMEOUT_MS = 15_000;

export const SNAPSHOT = snapshot as CallsignSnapshot;

export function createBot(env: Env): Bot {
  const fetchFn: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const now = () => new Date();
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  return {
    db: env.DB,
    bucket: env.MARINES,
    renderer: env.SITE,
    discord: discordApi(env.DISCORD_APPLICATION_ID ?? '', { fetch: fetchFn, sleep }),
    alert: createAlerter(env.DB, { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_ALERT_CHAT_ID }, { fetch: fetchFn, now }),
    fetch: fetchFn,
    sleep,
    deadline: (ms) => sleep(ms).then(() => null),
    now,
    random: cryptoRandom,
    snapshot: SNAPSHOT,
  };
}
