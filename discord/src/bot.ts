import type { LinkMarineRenderer } from '@ccip-dev/core/linkmarine';
import { createAlerter, type Alert } from './alerts';
import { publicData, type PublicData } from './data';
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
  data: PublicData;
  alert: Alert;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** Resolves with null after ms, or at once when `signal` aborts: a timer to race work against, which tests drive by their fake clock. */
  deadline: (ms: number, signal?: AbortSignal) => Promise<null>;
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
    data: publicData({ fetch: fetchFn, now: () => Date.now(), cache: caches.default }),
    alert: createAlerter(env.DB, { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_ALERT_CHAT_ID }, { fetch: fetchFn, now }),
    fetch: fetchFn,
    sleep,
    deadline: (ms, signal) =>
      new Promise<null>((resolve) => {
        const timer = setTimeout(() => resolve(null), ms);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve(null);
        });
      }),
    now,
    random: cryptoRandom,
    snapshot: SNAPSHOT,
  };
}
