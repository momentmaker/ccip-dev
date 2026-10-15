import type { LinkMarineRenderer } from '@ccip-dev/core/linkmarine';

export interface Env {
  DB: D1Database;
  MARINES: R2Bucket;
  /** The site Worker's LinkMarineCards entrypoint. */
  SITE: LinkMarineRenderer;
  /** "all", or the server ids allowed (comma-separated); empty turns every command away. */
  DISCORD_SERVERS?: string;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_APPLICATION_ID?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_ALERT_CHAT_ID?: string;
  /** "on" opens LinkMarines on Telegram; anything else keeps it shut. The deploy sets it from the TELEGRAM_BOT variable. */
  TELEGRAM_BOT?: string;
  /** The chats whose members may enlist, comma-separated: "@ccipdev", then LinkMarine group ids. */
  TELEGRAM_GATE_CHATS?: string;
  /** The owner's Telegram user id: owns the sticker packs, may run /id anywhere. */
  TELEGRAM_STICKER_OWNER_ID?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}
