import { hasGlint, serialText, stickerPackUrl, stickerVolume, type Tier } from '@ccip-dev/core/linkmarine';
import type { Bot } from './bot';
import { avatarKey, cardKey, enlistMarine, flush, isPng, readBytes, reason, stampCard, type Cards, type Report } from './enlistment';
import { avatarUrl, displayName, escapeMarkdown, invoker, optionValue, type DiscordMember, type DiscordUser, type Interaction } from './interactions';
import { findMarine, type Marine } from './store';

export const PLATFORM = 'discord';
/** Discord answers webhook edits faster than this, but the reveal waits at least this long between them. */
export const STEP_MS = 1_000;

export const TEXT = {
  drawing: 'Drawing your callsign… ▮▮▮',
  already: "You're already enlisted, Marine.",
  stamping: (m: Marine) => `You're \`${m.callsign}\`, Marine #${serialText(m.serial)}. Your tag is being stamped; run \`/dogtag\` in a minute.`,
  notEnlisted: (name: string) => `${escapeMarkdown(name)} hasn't enlisted yet. \`/enlist\``,
  tagStamping: (name: string) => `${escapeMarkdown(name)}'s tag is being stamped; try \`/dogtag\` again in a minute.`,
  internal: "Something went wrong. It's been reported.",
} as const;

/** After "Drawing…": the tags stamped one by one, a Rare or Legendary banner on the last. */
export function revealSteps(tags: readonly string[], tier: Tier): string[] {
  const up = tags.map((t) => t.toUpperCase());
  const last = up.join(' · ');
  const banner = tier === 'legendary' ? '⚠ LEGENDARY DRAW' : tier === 'rare' ? '⚠ RARE DRAW' : null;
  return [`${up[0]} ▮▮`, `${up[0]} · ${up[1]} ▮`, banner ? `${banner}\n${last}` : last];
}

export function cardText(bot: Pick<Bot, 'telegramOpen'>, marine: Pick<Marine, 'callsign' | 'serial'>): string {
  if (!bot.telegramOpen) return marine.callsign;
  const volume = stickerVolume(marine.serial);
  return `${marine.callsign}\n🎖 Sticker: LinkMarines Vol. ${volume} <${stickerPackUrl(volume)}>`;
}

const AVATAR_TIMEOUT_MS = 5_000;

/** The stamping line is posted when the card is still not ready this long after the command arrived. */
export const STAMP_DEADLINE_MS = 18_000;
/** No edit waits out a 429 past this long after the command arrived: waitUntil ends at 30 s. */
export const FINAL_EDIT_BY_MS = 28_000;

/**
 * The avatar kept at enlistment; a fresh one is fetched and kept when its URL is known, and a failed fetch leaves the
 * gradient disc. Bytes that are not a PNG are neither kept nor drawn (they would fail the whole card): the disc again.
 */
async function avatar(bot: Bot, serial: number, url: string | null): Promise<Uint8Array | null> {
  try {
    if (url) {
      const res = await bot.fetch(url, { signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS) });
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (!isPng(bytes)) {
          console.warn(`avatar for Marine ${serial}: not a PNG`);
          return null;
        }
        await bot.bucket.put(avatarKey(serial), bytes, { httpMetadata: { contentType: 'image/png' } });
        return bytes;
      }
    }
    return await readBytes(bot.bucket, avatarKey(serial));
  } catch (err) {
    console.warn(`avatar for Marine ${serial}: ${reason(err)}`);
    return null;
  }
}

/** The stamped card, animated when there is a glint; stamped now when it is missing. */
export async function marineCard(bot: Bot, marine: Marine, avatarSource: string | null, reports: Report[]): Promise<Cards | null> {
  if (marine.cardKey) {
    const [gif, png] = await Promise.all([hasGlint(marine.tier) ? readBytes(bot.bucket, cardKey(marine.serial, 'gif')) : null, readBytes(bot.bucket, marine.cardKey)]);
    const cards: Cards = [];
    if (gif) cards.push({ name: `marine-${marine.serial}.gif`, type: 'image/gif', bytes: gif });
    if (png) cards.push({ name: `marine-${marine.serial}.png`, type: 'image/png', bytes: png });
    if (cards.length > 0) return cards;
  }
  return stampCard(bot, marine, () => avatar(bot, marine.serial, avatarSource), reports);
}

const timeLeft = (bot: Bot, startedAt: number) => Math.max(0, FINAL_EDIT_BY_MS - (bot.now().getTime() - startedAt));
const elapsed = (bot: Bot, startedAt: number) => bot.now().getTime() - startedAt;

/** The card if it is ready by the stamping deadline, else 'late', which is reported. */
async function byDeadline(bot: Bot, stamping: Promise<Cards | null>, marine: Marine, startedAt: number, reports: Report[]): Promise<Cards | null | 'late'> {
  const outcome = await Promise.race([bot.deadline(startedAt + STAMP_DEADLINE_MS - bot.now().getTime()).then(() => 'late' as const), stamping]);
  if (outcome === 'late') reports.push({ signature: 'discord-render:marine', text: `stamping Marine #${marine.serial}'s card passed the deadline` });
  return outcome;
}

/**
 * Waits, until 28 s after the command arrived, for a card that passed the deadline. Work still running when the command
 * returns is cancelled with the invocation, so this is what lets a late card be kept and its reports flushed.
 */
async function finishLate(bot: Bot, stamping: Promise<unknown>, startedAt: number): Promise<void> {
  await Promise.race([stamping, bot.deadline(startedAt + FINAL_EDIT_BY_MS - bot.now().getTime())]);
}

/** A cosmetic step is abandoned after this long, and never waits out a 429. */
const STEP_TIMEOUT_MS = 3_000;
/** A card upload leaves at least this long for the next fallback. */
const FALLBACK_ROOM_MS = 3_000;
const MIN_ATTEMPT_MS = 1_000;
/** A private reply's budget: what is left before 28 s, and never under a second, so even a late one can still land. */
export const replyBudget = (bot: Bot, startedAt: number) => Math.max(MIN_ATTEMPT_MS, timeLeft(bot, startedAt));

/**
 * The last edit: the card with `text`, else the static card, else `fallback` alone. A refused upload is reported as
 * discord-upload. Each card attempt is cut short so the next one still has room before waitUntil ends.
 */
async function postCard(bot: Bot, token: string, text: string, cards: Cards | null, fallback: string, marine: Marine, startedAt: number, reports: Report[]): Promise<void> {
  for (const file of cards ?? []) {
    const left = timeLeft(bot, startedAt);
    try {
      await bot.discord.editOriginal(token, text, file, left, Math.max(MIN_ATTEMPT_MS, left - FALLBACK_ROOM_MS));
      return;
    } catch (err) {
      reports.push({ signature: 'discord-upload', text: `${file.name} could not be posted for Marine #${marine.serial}: ${reason(err)}` });
    }
  }
  const left = timeLeft(bot, startedAt);
  await bot.discord.editOriginal(token, fallback, null, left, Math.max(MIN_ATTEMPT_MS, left));
}

/** A step of the reveal: losing one costs a frame of the animation, never the Marine's card. */
async function softEdit(bot: Bot, token: string, content: string): Promise<void> {
  try {
    await bot.discord.editOriginal(token, content, null, 0, STEP_TIMEOUT_MS);
  } catch (err) {
    console.warn(`reveal edit skipped: ${reason(err)}`);
  }
}

/**
 * The reveal: the draw is already saved; the card stamps while the tags are shown, a second apart, then it is edited
 * in. Steps are cosmetic: each is cut at 3 s, and none starts within a second of the stamping deadline. The card races
 * the deadline alone; a text-only edit after the card would wipe it, so the steps always finish first. Whatever fails,
 * the last edit is the card or the stamping line, and the public reveal is never deleted.
 */
export async function reveal(bot: Bot, token: string, marine: Marine, avatarSource: string | null, startedAt: number, reports: Report[]): Promise<void> {
  const stamping = stampCard(bot, marine, () => avatar(bot, marine.serial, avatarSource), reports);
  const stepsOver = () => elapsed(bot, startedAt) >= STAMP_DEADLINE_MS - STEP_MS;
  let lastStepAt = bot.now().getTime();
  for (const step of [TEXT.drawing, ...revealSteps(marine.tags, marine.tier)]) {
    if (stepsOver()) break;
    if (step !== TEXT.drawing) await bot.sleep(STEP_MS);
    if (stepsOver()) break;
    await softEdit(bot, token, step);
    lastStepAt = bot.now().getTime();
  }
  const outcome = await byDeadline(bot, stamping, marine, startedAt, reports);
  const cards = outcome === 'late' ? null : outcome;
  if (cards && bot.now().getTime() - lastStepAt < STEP_MS) await bot.sleep(STEP_MS - (bot.now().getTime() - lastStepAt));
  try {
    await postCard(bot, token, cardText(bot, marine), cards, TEXT.stamping(marine), marine, startedAt, reports);
  } catch (err) {
    console.error(`Marine #${marine.serial}: the final edit failed: ${reason(err)}`);
  }
  if (outcome === 'late') await finishLate(bot, stamping, startedAt);
}

/** The Marine's stored card, stamped now when missing. Never rejects: a failed read is reported and gives null. */
function storedCard(bot: Bot, marine: Marine, source: string, reports: Report[]): Promise<Cards | null> {
  return marineCard(bot, marine, source, reports).catch((err: unknown) => {
    reports.push({ signature: 'discord-render:marine', text: `Marine #${marine.serial}'s card could not be read: ${reason(err)}` });
    return null;
  });
}

export async function enlistCommand(bot: Bot, interaction: Interaction, startedAt = bot.now().getTime()): Promise<void> {
  const who = invoker(interaction);
  if (!who) throw new Error('an interaction without a user');
  const reports: Report[] = [];
  const result = await enlistMarine(bot, { platform: PLATFORM, userId: who.user.id, displayName: displayName(who.user, who.member) });
  const source = avatarUrl(who.user, who.member, interaction.guild_id);
  try {
    if (result.kind === 'clashed') {
      reports.push({ signature: 'discord-draw', text: `every one of 20 draws for ${who.user.id} clashed with a callsign already taken` });
      await bot.discord.privateFollowup(interaction.token, TEXT.internal, replyBudget(bot, startedAt));
    } else if (result.kind === 'already') {
      const stamping = storedCard(bot, result.marine, source, reports);
      const stored = await byDeadline(bot, stamping, result.marine, startedAt, reports);
      await postCard(bot, interaction.token, TEXT.already, stored === 'late' ? null : stored, TEXT.stamping(result.marine), result.marine, startedAt, reports);
      if (stored === 'late') await finishLate(bot, stamping, startedAt);
    } else {
      await reveal(bot, interaction.token, result.marine, source, startedAt, reports);
    }
  } finally {
    await flush(bot, reports);
  }
}

function target(interaction: Interaction): { user: DiscordUser; member: DiscordMember | null; self: boolean } | null {
  const who = invoker(interaction);
  const id = optionValue(interaction, 'marine');
  if (!who) return null;
  if (!id || id === who.user.id) return { ...who, self: true };
  const user = interaction.data?.resolved?.users?.[id];
  return user ? { user, member: interaction.data?.resolved?.members?.[id] ?? null, self: false } : null;
}

export async function dogtagCommand(bot: Bot, interaction: Interaction, startedAt = bot.now().getTime()): Promise<void> {
  const whose = target(interaction);
  if (!whose) throw new Error('/dogtag without a resolvable user');
  const marine = await findMarine(bot.db, PLATFORM, whose.user.id);
  if (!marine) {
    const text = TEXT.notEnlisted(displayName(whose.user, whose.member));
    await (whose.self ? bot.discord.privateFollowup(interaction.token, text, replyBudget(bot, startedAt)) : bot.discord.editOriginal(interaction.token, text));
    return;
  }
  const reports: Report[] = [];
  try {
    const stamping = storedCard(bot, marine, avatarUrl(whose.user, whose.member, interaction.guild_id), reports);
    const cards = await byDeadline(bot, stamping, marine, startedAt, reports);
    const fallback = whose.self ? TEXT.stamping(marine) : TEXT.tagStamping(displayName(whose.user, whose.member));
    if (cards) await postCard(bot, interaction.token, cardText(bot, marine), cards === 'late' ? null : cards, fallback, marine, startedAt, reports);
    else await bot.discord.privateFollowup(interaction.token, TEXT.internal, replyBudget(bot, startedAt));
    if (cards === 'late') await finishLate(bot, stamping, startedAt);
  } finally {
    await flush(bot, reports);
  }
}
