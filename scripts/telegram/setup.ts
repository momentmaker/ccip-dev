import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stickerPackName, stickerPackUrl } from '@ccip-dev/core/linkmarine';
import { callBot, checkSecret, ownerHasNotStarted, ownerIdFrom, packDoesNotExist, setupCalls } from './requests';

// Never prints the token or the secret.
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('.env: set TELEGRAM_BOT_TOKEN first (see docs/runbook.md, "LinkMarines on Telegram")');
const secret = checkSecret(process.env.TELEGRAM_WEBHOOK_SECRET);
const ownerId = ownerIdFrom(readFileSync(join(import.meta.dirname, '..', '..', 'discord', 'wrangler.toml'), 'utf8'));

for (const call of setupCalls(secret, ownerId)) {
  const answer = await callBot(token, call);
  if (call.method === 'getStickerSet' && packDoesNotExist(answer)) {
    console.log(`${stickerPackName(1)} does not exist yet: the sticker job creates it with Marine #1's sticker once TELEGRAM_BOT is on`);
  } else if (call.method === 'getChat' && ownerHasNotStarted(answer)) {
    throw new Error(`the sticker owner ${ownerId} has not started @ccipdevbot: send it /start from that account, then run this again`);
  } else if (!answer.ok) {
    throw new Error(`${call.method}: Telegram said ${answer.description ?? `HTTP ${answer.status}`}`);
  } else if (call.method === 'getStickerSet') {
    console.log(`${stickerPackName(1)} exists: ${stickerPackUrl(1)}`);
  } else {
    console.log(call.method === 'getChat' ? `sticker owner ${ownerId} has started the bot` : `${call.method}: done`);
  }
}
