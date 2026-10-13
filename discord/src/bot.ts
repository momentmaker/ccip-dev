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
  now: () => Date;
  random: () => number;
  snapshot: CallsignSnapshot;
}

export const SNAPSHOT = snapshot as CallsignSnapshot;

export function createBot(env: Env): Bot {
  const fetchFn: typeof fetch = (input, init) => fetch(input, init);
  const now = () => new Date();
  return {
    db: env.DB,
    bucket: env.MARINES,
    renderer: env.SITE,
    discord: discordApi(env.DISCORD_APPLICATION_ID ?? '', { fetch: fetchFn, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }),
    alert: createAlerter(env.DB, { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_ALERT_CHAT_ID }, { fetch: fetchFn, now }),
    fetch: fetchFn,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now,
    random: cryptoRandom,
    snapshot: SNAPSHOT,
  };
}
