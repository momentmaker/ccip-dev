import type { LinkMarineRenderer } from '@ccip-dev/core/linkmarine';

export interface Env {
  DB: D1Database;
  MARINES: R2Bucket;
  /** The site Worker's LinkMarineCards entrypoint. */
  SITE: LinkMarineRenderer;
  DISCORD_GUILD_ID: string;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_APPLICATION_ID?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_ALERT_CHAT_ID?: string;
}
