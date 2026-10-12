export interface Env {
  DB: D1Database;
  PUBLIC: R2Bucket;
  ARCHIVE: R2Bucket;
  CCIP_API_BASE: string;
  RPC_ETHEREUM?: string;
  RPC_FALLBACKS?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_ALERT_CHAT_ID?: string;
  BROADCASTS?: string;
  MOMENTS?: string;
  TELEGRAM_CHANNEL_ID?: string;
  TELEGRAM_DRAFTS_CHAT_ID?: string;
  X_POSTS?: string;
  X_API_KEY?: string;
  X_API_SECRET?: string;
  X_ACCESS_TOKEN?: string;
  X_ACCESS_SECRET?: string;
  GITHUB_DISPATCH_TOKEN?: string;
}
