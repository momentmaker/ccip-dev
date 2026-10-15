import { hasGlint, type MarineCard } from '@ccip-dev/core/linkmarine';
import type { Bot } from './bot';
import type { Attachment } from './discord-api';
import { drawCallsign, drawLore, pickMemes } from './draw';
import { loadMemes, memeKey, stockMemes } from './memes';
import { enlist, setCardKey, type Drafted, type EnlistResult, type Marine } from './store';

/**
 * Enlistment for any platform: the draw, the record and the stamped card. A Marine is one per (platform, user id);
 * callsigns and serials are shared by every platform.
 */

export const cardKey = (serial: number, ext: 'png' | 'gif') => `cards/${serial}.${ext}`;
export const avatarKey = (serial: number) => `avatars/${serial}.png`;

export const snapshotCount = (bot: Pick<Bot, 'snapshot'>, tag: string) => bot.snapshot.tags.find((t) => t.tag === tag)?.count ?? 1;

export function draft(bot: Bot): Drafted {
  const draw = drawCallsign(bot.snapshot, bot.random);
  const files = pickMemes(bot.snapshot, draw.tags, draw.callsign);
  return {
    draw,
    memes: draw.tags.map((tag, i) => ({ tag, file: files[i]!, key: memeKey(files[i]!), count: snapshotCount(bot, tag), sha: bot.snapshot.archive.sha })),
    blood: drawLore(bot.snapshot.lore.blood, bot.random),
    faith: drawLore(bot.snapshot.lore.faith, bot.random),
  };
}

export interface Enlistee {
  platform: string;
  userId: string;
  /** The name stamped on the card, once. */
  displayName: string;
}

/** Finds the account's Marine, or draws and records one: never two per account, never a callsign another Marine holds. */
export function enlistMarine(bot: Bot, who: Enlistee): Promise<EnlistResult> {
  return enlist(bot.db, { ...who, enlistedAt: bot.now().toISOString(), snapshotVersion: bot.snapshot.version }, () => draft(bot));
}

export async function readBytes(bucket: R2Bucket, key: string): Promise<Uint8Array | null> {
  const object = await bucket.get(key);
  return object ? new Uint8Array(await object.arrayBuffer()) : null;
}

/** What to tell the alert chat, held back until the Marine has their reply. */
export interface Report {
  signature: string;
  text: string;
}

export const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Each signature once, so one failure seen twice is one alert. */
export async function flush(bot: Pick<Bot, 'alert'>, reports: Report[]): Promise<void> {
  const first = [...new Map(reports.map((r) => [r.signature, r])).values()];
  await Promise.allSettled(first.map((r) => bot.alert(r.signature, r.text)));
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const isPng = (bytes: Uint8Array) => PNG_SIGNATURE.every((b, i) => bytes[i] === b);

/** The card to post, best first: the glint when there is one, then the static PNG. */
export type Cards = Attachment[];

/** The avatar to stamp as PNG bytes, or null for the gradient disc. Never rejects. */
export type AvatarSource = () => Promise<Uint8Array | null>;

/** The card, and the glint for Rare and up; a failed glint is reported and leaves the static card to post. */
async function render(bot: Bot, marine: Marine, pngs: Uint8Array[], avatarBytes: Uint8Array | null, reports: Report[]): Promise<{ png: Uint8Array; gif: Uint8Array | null }> {
  const card: MarineCard = {
    serial: marine.serial,
    callsign: marine.callsign,
    tier: marine.tier,
    percentile: marine.percentile,
    memes: marine.memes.map((m, i) => ({ tag: m.tag, count: m.count ?? snapshotCount(bot, m.tag), png: pngs[i]! })),
    blood: marine.blood,
    faith: marine.faith,
    name: marine.displayName,
    enlistedAt: marine.enlistedAt,
    avatar: avatarBytes,
  };
  const glintFailed = (why: string) => reports.push({ signature: 'discord-render:marine', text: `glint for Marine #${marine.serial} failed: ${why}` });
  try {
    const images = await bot.renderer.renderMarineCards(card);
    if (images.glintError !== null) glintFailed(images.glintError);
    return { png: images.png, gif: images.gif };
  } catch (err) {
    if (!hasGlint(marine.tier)) throw err;
    // The glint can take the whole call down with it (the site isolate's memory, a deploy): the static card alone still stands.
    const png = await bot.renderer.renderMarineCard(card);
    glintFailed(reason(err));
    return { png, gif: null };
  }
}

async function keep(bot: Bot, serial: number, rendered: { png: Uint8Array; gif: Uint8Array | null }): Promise<void> {
  await bot.bucket.put(cardKey(serial, 'png'), rendered.png, { httpMetadata: { contentType: 'image/png' } });
  if (rendered.gif) await bot.bucket.put(cardKey(serial, 'gif'), rendered.gif, { httpMetadata: { contentType: 'image/gif' } });
  await setCardKey(bot.db, serial, cardKey(serial, 'png'));
}

/**
 * Stamps a Marine's card: copies the memes (while getting the avatar), renders the card (and the glint for Rare and
 * up), keeps them in R2 and records the card. Never throws: returns the images to post, or null when it could not,
 * adding what to alert to `reports`. A card that rendered is returned even when R2 would not keep it.
 */
export async function stampCard(bot: Bot, marine: Marine, avatar: AvatarSource, reports: Report[]): Promise<Cards | null> {
  try {
    let copyFailure: unknown = null;
    const [, avatarBytes] = await Promise.all([
      stockMemes(bot.bucket, bot.renderer, bot.fetch, bot.snapshot.archive, marine.memes).catch((err: unknown) => void (copyFailure = err)),
      avatar(),
    ]);
    if (copyFailure) {
      reports.push({ signature: 'discord-memes', text: `memes for Marine #${marine.serial} could not be copied: ${reason(copyFailure)}` });
      return null;
    }
    const pngs = await loadMemes(bot.bucket, marine.memes);
    if (!pngs) {
      reports.push({ signature: 'discord-render:marine', text: `Marine #${marine.serial}'s memes were missing from storage right after copying` });
      return null;
    }
    let rendered;
    try {
      rendered = await render(bot, marine, pngs, avatarBytes, reports);
    } catch (err) {
      reports.push({ signature: 'discord-render:marine', text: `Marine #${marine.serial}'s card failed to render: ${reason(err)}` });
      return null;
    }
    try {
      await keep(bot, marine.serial, rendered);
    } catch (err) {
      reports.push({ signature: 'discord-store:marine', text: `Marine #${marine.serial}'s card could not be kept in storage: ${reason(err)}` });
    }
    const still: Attachment = { name: `marine-${marine.serial}.png`, type: 'image/png', bytes: rendered.png };
    return rendered.gif ? [{ name: `marine-${marine.serial}.gif`, type: 'image/gif', bytes: rendered.gif }, still] : [still];
  } catch (err) {
    reports.push({ signature: 'discord-render:marine', text: `Marine #${marine.serial}'s card could not be stamped: ${reason(err)}` });
    return null;
  }
}
