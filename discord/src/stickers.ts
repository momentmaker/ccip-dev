import { stickerPackName, stickerPackTitle, stickerPackUrl, stickerVolume } from '@ccip-dev/core/linkmarine';
import { publicCard, reason } from './enlistment';
import { loadMemes, stockMemes } from './memes';
import { claimMeta, stickerQueue, type Marine } from './store';
import type { TelegramResult } from './telegram-api';
import { TELEGRAM_PLATFORM, type TelegramBot } from './telegram-marines';

/**
 * The sticker job: every Marine, from either platform, becomes a sticker in their volume's LinkMarines pack, oldest
 * serial first. A Marine is marked (sticker_set set, sticker_file_id NULL) before its sticker is added and recorded
 * after, one at a time, so the pack holds exactly one sticker per recorded Marine, in the order they were added. A run
 * that gets no sure answer from Telegram leaves the Marine marked, and the next run counts the pack to settle it: never
 * twice. A pack whose count does not fit the Marines recorded in it is never guessed at; the job stalls for the owner.
 */
export const STICKERS_PER_RUN = 10;
export const STICKER_EMOJI = '🎖';
const UPLOAD_TIMEOUT_MS = 15_000;
/** One run at a time: a run holds this lock until it ends, or for 15 minutes at most. */
const RUN_LOCK_MS = 15 * 60_000;
const RUN_LOCK = 'sticker-run';
/** Telegram's answer to creating a pack that exists. */
const NAME_TAKEN = /name is already occupied/i;
/** Telegram's answer to reading a pack that was never created. */
const PACK_UNKNOWN = /STICKERSET_INVALID/;

/** added: recorded. limited: a 429, so the run ends quietly. failed: alert and go on. stalled: alert and end the run, to settle a Marine left marked before any other is touched, or for the owner to look. */
type Outcome = { kind: 'added' } | { kind: 'limited' } | { kind: 'failed'; why: string } | { kind: 'stalled'; why: string };

const isLimited = (r: TelegramResult<unknown>) => !r.ok && r.status === 429;
/** No answer came back (0) or a server or proxy error did (5xx): either can follow a request Telegram carried out, so only the pack can say. */
const isUnknown = (r: TelegramResult<unknown>) => !r.ok && (r.status === 0 || r.status >= 500);
const why = (r: TelegramResult<unknown>) => (r.ok ? 'ok' : `${r.status} ${r.description}`);

async function claimRun(db: D1Database, now: Date): Promise<string | null> {
  return (await claimMeta(db, RUN_LOCK, now.getTime(), RUN_LOCK_MS)) ? now.toISOString() : null;
}

const mark = (db: D1Database, serial: number, set: string | null) => db.prepare('UPDATE marines SET sticker_set = ? WHERE serial = ?').bind(set, serial).run();
const record = (db: D1Database, serial: number, fileId: string) => db.prepare('UPDATE marines SET sticker_file_id = ? WHERE serial = ?').bind(fileId, serial).run();

async function recordedIn(db: D1Database, set: string): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS n FROM marines WHERE sticker_set = ? AND sticker_file_id IS NOT NULL').bind(set).first<{ n: number }>())?.n ?? 0;
}

/** A Telegram Marine hears about their sticker. One who never started the bot can't be messaged, which is fine. */
async function tellMarine(bot: TelegramBot, marine: Marine, fileId: string): Promise<void> {
  if (marine.platform !== TELEGRAM_PLATFORM) return;
  const volume = stickerVolume(marine.serial);
  const told = await bot.tg.call('sendMessage', { chat_id: marine.userId, text: `You're sticker #${marine.serial} in LinkMarines Vol. ${volume}` });
  if (!told.ok) return;
  await bot.tg.call('sendSticker', { chat_id: marine.userId, sticker: fileId, reply_markup: { inline_keyboard: [[{ text: 'Add the pack', url: stickerPackUrl(volume) }]] } });
}

/**
 * Records a marked Marine's sticker, which must be the one sticker the pack holds beyond the recorded ones. Any other
 * count is never guessed at: a pack with more stalls the job for the owner to reconcile, and one with as many as are
 * recorded means the add never happened, which is a stall right after Telegram said it added the sticker and otherwise
 * puts the Marine due again. A pack that cannot be read stalls too, except one that was never created.
 */
async function settle(bot: TelegramBot, marine: Marine, set: string, justAdded: boolean): Promise<Outcome> {
  const pack = await bot.tg.call<{ stickers: { file_id: string }[] }>('getStickerSet', { name: set });
  if (isLimited(pack)) return { kind: 'limited' };
  const recorded = await recordedIn(bot.db, set);
  if (!pack.ok) {
    if (justAdded || recorded > 0 || !PACK_UNKNOWN.test(pack.description)) return { kind: 'stalled', why: `getStickerSet ${set}: ${why(pack)}; the next run settles it` };
    await mark(bot.db, marine.serial, null);
    return { kind: 'failed', why: `${set} was never created (${why(pack)}); it is due again` };
  }
  const { stickers } = pack.result;
  if (stickers.length === recorded + 1) {
    const ours = stickers[recorded]!;
    await record(bot.db, marine.serial, ours.file_id);
    await tellMarine(bot, marine, ours.file_id);
    return { kind: 'added' };
  }
  const holds = `${set} holds ${stickers.length} stickers for ${recorded} recorded Marines`;
  if (stickers.length !== recorded) return { kind: 'stalled', why: `${holds}; the owner must reconcile it` };
  if (justAdded) return { kind: 'stalled', why: `${holds} right after an add` };
  await mark(bot.db, marine.serial, null);
  return { kind: 'failed', why: `${holds}, so the sticker was never added; it is due again` };
}

/** The sticker's PNG, or why it could not be drawn. */
async function drawSticker(bot: TelegramBot, marine: Marine): Promise<Uint8Array | string> {
  try {
    await stockMemes(bot.bucket, bot.renderer, bot.fetch, bot.snapshot.archive, marine.memes);
    const pngs = await loadMemes(bot.bucket, marine.memes);
    return pngs ? await bot.renderer.renderMarineSticker(publicCard(bot, marine, pngs)) : 'memes missing from storage right after copying';
  } catch (err) {
    return `the sticker could not be drawn: ${reason(err)}`;
  }
}

async function addSticker(bot: TelegramBot, marine: Marine, owner: number): Promise<Outcome> {
  const png = await drawSticker(bot, marine);
  if (typeof png === 'string') return { kind: 'failed', why: png };
  const upload = await bot.tg.upload<{ file_id: string }>('uploadStickerFile', { user_id: String(owner), sticker_format: 'static' }, { field: 'sticker', name: `marine-${marine.serial}.png`, type: 'image/png', bytes: png }, UPLOAD_TIMEOUT_MS);
  if (!upload.ok) return isLimited(upload) ? { kind: 'limited' } : { kind: 'failed', why: `uploadStickerFile ${why(upload)}` };
  const volume = stickerVolume(marine.serial);
  const set = stickerPackName(volume);
  const sticker = { sticker: upload.result.file_id, format: 'static', emoji_list: [STICKER_EMOJI] };
  const packExists = (await bot.db.prepare('SELECT 1 FROM marines WHERE sticker_set = ? LIMIT 1').bind(set).first()) !== null;
  await mark(bot.db, marine.serial, set);
  const added = packExists
    ? await bot.tg.call('addStickerToSet', { user_id: owner, name: set, sticker })
    : await bot.tg.call('createNewStickerSet', { user_id: owner, name: set, title: stickerPackTitle(volume), stickers: [sticker] });
  if (!packExists && !added.ok && added.status === 400 && NAME_TAKEN.test(added.description)) {
    await mark(bot.db, marine.serial, null);
    return { kind: 'stalled', why: `the pack ${set} exists but no Marine is recorded in it; the owner must look at it` };
  }
  if (isUnknown(added)) return { kind: 'stalled', why: `adding to ${set}: ${why(added)}; the next run settles it` };
  if (!added.ok) {
    await mark(bot.db, marine.serial, null);
    return isLimited(added) ? { kind: 'limited' } : { kind: 'failed', why: `adding to ${set}: ${why(added)}` };
  }
  return settle(bot, marine, set, true);
}

/**
 * One run of the sticker job: the queue (a Marine a cut-short run left marked, then the next Marines), at most
 * STICKERS_PER_RUN. A 429 ends the run for the next to pick up. Any other failure alerts telegram-sticker:<serial>; the
 * run goes on unless a Marine is left marked. Nothing runs while LinkMarines on Telegram is off or has no owner.
 */
export async function stickerJob(bot: TelegramBot): Promise<void> {
  const owner = bot.settings.ownerId;
  if (!bot.settings.open || owner === null) return;
  const claim = await claimRun(bot.db, bot.now());
  if (!claim) return;
  try {
    for (const { marine, set } of await stickerQueue(bot.db, STICKERS_PER_RUN)) {
      let outcome: Outcome;
      try {
        outcome = set ? await settle(bot, marine, set, false) : await addSticker(bot, marine, owner);
      } catch (err) {
        outcome = { kind: 'stalled', why: reason(err) };
      }
      if (outcome.kind === 'limited') break;
      if (outcome.kind === 'failed' || outcome.kind === 'stalled') await bot.alert(`telegram-sticker:${marine.serial}`, `Marine #${marine.serial}'s sticker: ${outcome.why}`);
      if (outcome.kind === 'stalled') break;
    }
  } finally {
    await bot.db.prepare('DELETE FROM meta WHERE key = ? AND value = ?').bind(RUN_LOCK, claim).run();
  }
}
