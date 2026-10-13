import { hasGlint, serialText, type MarineCard, type Tier } from '@ccip-dev/core/linkmarine';
import type { Bot } from './bot';
import type { Attachment } from './discord-api';
import { drawCallsign, drawLore, pickMemes } from './draw';
import { avatarUrl, displayName, invoker, optionValue, type DiscordMember, type DiscordUser, type Interaction } from './interactions';
import { loadMemes, memeKey, stockMemes } from './memes';
import { enlist, findMarine, setCardKey, type Drafted, type Marine } from './store';

export const PLATFORM = 'discord';
/** Discord answers webhook edits faster than this, but the reveal waits at least this long between them. */
export const STEP_MS = 1_000;

export const TEXT = {
  drawing: 'Drawing your callsign… ▮▮▮',
  already: "You're already enlisted, Marine.",
  stamping: (m: Marine) => `You're \`${m.callsign}\`, Marine #${serialText(m.serial)}. Your tag is being stamped; run \`/dogtag\` in a minute.`,
  notEnlisted: (name: string) => `${name} hasn't enlisted yet. \`/enlist\``,
  internal: "Something went wrong. It's been reported.",
} as const;

/** After "Drawing…": the tags stamped one by one, a Rare or Legendary banner on the last. */
export function revealSteps(tags: readonly string[], tier: Tier): string[] {
  const up = tags.map((t) => t.toUpperCase());
  const last = up.join(' · ');
  const banner = tier === 'legendary' ? '⚠ LEGENDARY DRAW' : tier === 'rare' ? '⚠ RARE DRAW' : null;
  return [`${up[0]} ▮▮`, `${up[0]} · ${up[1]} ▮`, banner ? `${banner}\n${last}` : last];
}

export const cardKey = (serial: number, ext: 'png' | 'gif') => `cards/${serial}.${ext}`;
const AVATAR_TIMEOUT_MS = 5_000;
const avatarKey = (serial: number) => `avatars/${serial}.png`;

function draft(bot: Bot): Drafted {
  const draw = drawCallsign(bot.snapshot, bot.random);
  const files = pickMemes(bot.snapshot, draw.tags, draw.callsign);
  return {
    draw,
    memes: draw.tags.map((tag, i) => ({ tag, file: files[i]!, key: memeKey(files[i]!) })),
    blood: drawLore(bot.snapshot.lore.blood, bot.random),
    faith: drawLore(bot.snapshot.lore.faith, bot.random),
  };
}

async function readBytes(bucket: R2Bucket, key: string): Promise<Uint8Array | null> {
  const object = await bucket.get(key);
  return object ? new Uint8Array(await object.arrayBuffer()) : null;
}

/** What to tell the alert chat, held back until the Marine has their reply. */
export interface Report {
  signature: string;
  text: string;
}

/** The stamping line is posted when the card is still not ready this long after the command arrived. */
export const STAMP_DEADLINE_MS = 18_000;
/** No edit waits out a 429 past this long after the command arrived: waitUntil ends at 30 s. */
export const FINAL_EDIT_BY_MS = 28_000;

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function flush(bot: Bot, reports: Report[]): Promise<void> {
  const first = [...new Map(reports.map((r) => [r.signature, r])).values()];
  await Promise.allSettled(first.map((r) => bot.alert(r.signature, r.text)));
}

/** The avatar kept at enlistment; a fresh one is fetched and kept when its URL is known, and a failed fetch leaves the gradient disc. */
async function avatar(bot: Bot, serial: number, url: string | null): Promise<Uint8Array | null> {
  try {
    if (url) {
      const res = await bot.fetch(url, { signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS) });
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
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

/** The card to post, best first: the glint when there is one, then the static PNG. */
type Cards = Attachment[];

async function render(bot: Bot, marine: Marine, pngs: Uint8Array[], avatarBytes: Uint8Array | null): Promise<{ png: Uint8Array; gif: Uint8Array | null }> {
  const count = (tag: string) => bot.snapshot.tags.find((t) => t.tag === tag)?.count ?? 1;
  const card: MarineCard = {
    serial: marine.serial,
    callsign: marine.callsign,
    tier: marine.tier,
    percentile: marine.percentile,
    memes: marine.memes.map((m, i) => ({ tag: m.tag, count: count(m.tag), png: pngs[i]! })),
    blood: marine.blood,
    faith: marine.faith,
    name: marine.displayName,
    enlistedAt: marine.enlistedAt,
    avatar: avatarBytes,
  };
  const [png, gif] = await Promise.all([bot.renderer.renderMarineCard(card), hasGlint(marine.tier) ? bot.renderer.renderMarineGlint(card) : Promise.resolve(null)]);
  return { png, gif };
}

async function keep(bot: Bot, serial: number, rendered: { png: Uint8Array; gif: Uint8Array | null }): Promise<void> {
  await bot.bucket.put(cardKey(serial, 'png'), rendered.png, { httpMetadata: { contentType: 'image/png' } });
  if (rendered.gif) await bot.bucket.put(cardKey(serial, 'gif'), rendered.gif, { httpMetadata: { contentType: 'image/gif' } });
  await setCardKey(bot.db, serial, cardKey(serial, 'png'));
}

/**
 * Stamps a Marine's card: copies the memes (while fetching the avatar), renders the card (and the glint for Rare and
 * up), keeps them in R2 and records the card. Never throws: returns the images to post, or null when it could not,
 * adding what to alert to `reports`. A card that rendered is returned even when R2 would not keep it.
 */
export async function stampCard(bot: Bot, marine: Marine, avatarSource: string | null, reports: Report[]): Promise<Cards | null> {
  try {
    let copyFailure: unknown = null;
    const [, avatarBytes] = await Promise.all([
      stockMemes(bot.bucket, bot.renderer, bot.fetch, bot.snapshot.archive, marine.memes).catch((err: unknown) => void (copyFailure = err)),
      avatar(bot, marine.serial, avatarSource),
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
      rendered = await render(bot, marine, pngs, avatarBytes);
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

/** The stamped card, animated when there is a glint; stamped now when it is missing. */
export async function marineCard(bot: Bot, marine: Marine, avatarSource: string | null, reports: Report[]): Promise<Cards | null> {
  if (marine.cardKey) {
    const [gif, png] = await Promise.all([hasGlint(marine.tier) ? readBytes(bot.bucket, cardKey(marine.serial, 'gif')) : null, readBytes(bot.bucket, marine.cardKey)]);
    const cards: Cards = [];
    if (gif) cards.push({ name: `marine-${marine.serial}.gif`, type: 'image/gif', bytes: gif });
    if (png) cards.push({ name: `marine-${marine.serial}.png`, type: 'image/png', bytes: png });
    if (cards.length > 0) return cards;
  }
  return stampCard(bot, marine, avatarSource, reports);
}

const timeLeft = (bot: Bot, startedAt: number) => Math.max(0, FINAL_EDIT_BY_MS - (bot.now().getTime() - startedAt));

/**
 * The last edit: the card with `text`, else the static card, else the stamping line alone. A refused upload is reported
 * as discord-upload; the stamping line is what a Marine whose draw is saved must always end up with.
 */
async function postCard(bot: Bot, token: string, text: string, cards: Cards | null, marine: Marine, startedAt: number, reports: Report[]): Promise<void> {
  for (const file of cards ?? []) {
    try {
      await bot.discord.editOriginal(token, text, file, timeLeft(bot, startedAt));
      return;
    } catch (err) {
      reports.push({ signature: 'discord-upload', text: `${file.name} could not be posted for Marine #${marine.serial}: ${reason(err)}` });
    }
  }
  await bot.discord.editOriginal(token, TEXT.stamping(marine), null, timeLeft(bot, startedAt));
}

/** A step of the reveal: losing one costs a frame of the animation, never the Marine's card. */
async function softEdit(bot: Bot, token: string, content: string, startedAt: number): Promise<void> {
  try {
    await bot.discord.editOriginal(token, content, null, timeLeft(bot, startedAt));
  } catch (err) {
    console.warn(`reveal edit skipped: ${reason(err)}`);
  }
}

/**
 * The reveal: the draw is already saved; the card stamps while the tags are shown, a second apart, then it is edited
 * in. Whatever fails, the last edit is the card or the stamping line, and the public reveal is never deleted.
 */
export async function reveal(bot: Bot, token: string, marine: Marine, avatarSource: string | null, startedAt: number, reports: Report[]): Promise<void> {
  const stamping = stampCard(bot, marine, avatarSource, reports);
  await softEdit(bot, token, TEXT.drawing, startedAt);
  for (const step of revealSteps(marine.tags, marine.tier)) {
    await bot.sleep(STEP_MS);
    await softEdit(bot, token, step, startedAt);
  }
  const cards = await Promise.race([bot.deadline(startedAt + STAMP_DEADLINE_MS - bot.now().getTime()), Promise.all([stamping, bot.sleep(STEP_MS)]).then(([c]) => c)]);
  try {
    await postCard(bot, token, marine.callsign, cards, marine, startedAt, reports);
  } catch (err) {
    console.error(`Marine #${marine.serial}: the final edit failed: ${reason(err)}`);
  }
}

export async function enlistCommand(bot: Bot, interaction: Interaction, startedAt = bot.now().getTime()): Promise<void> {
  const who = invoker(interaction);
  if (!who) throw new Error('an interaction without a user');
  const reports: Report[] = [];
  const result = await enlist(
    bot.db,
    { platform: PLATFORM, userId: who.user.id, displayName: displayName(who.user, who.member), enlistedAt: bot.now().toISOString(), snapshotVersion: bot.snapshot.version },
    () => draft(bot),
  );
  const source = avatarUrl(who.user, who.member, interaction.guild_id);
  try {
    if (result.kind === 'clashed') {
      reports.push({ signature: 'discord-draw', text: `every one of 20 draws for ${who.user.id} clashed with a callsign already taken` });
      await bot.discord.privateFollowup(interaction.token, TEXT.internal);
    } else if (result.kind === 'already') {
      const cards = await marineCard(bot, result.marine, source, reports);
      await postCard(bot, interaction.token, TEXT.already, cards, result.marine, startedAt, reports);
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
    await (whose.self ? bot.discord.privateFollowup(interaction.token, text) : bot.discord.editOriginal(interaction.token, text));
    return;
  }
  const reports: Report[] = [];
  try {
    const cards = await marineCard(bot, marine, avatarUrl(whose.user, whose.member, interaction.guild_id), reports);
    if (cards) await postCard(bot, interaction.token, marine.callsign, cards, marine, startedAt, reports);
    else await bot.discord.privateFollowup(interaction.token, TEXT.internal);
  } finally {
    await flush(bot, reports);
  }
}
