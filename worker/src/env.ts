export interface Env {
  DB: D1Database;
  PUBLIC: R2Bucket;
  ARCHIVE: R2Bucket;
  CCIP_API_BASE: string;
  RPC_ETHEREUM?: string;
  RPC_FALLBACKS?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_ALERT_CHAT_ID?: string;
}
