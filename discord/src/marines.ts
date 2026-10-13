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

/** The avatar kept at enlistment; a fresh one is fetched and kept when its URL is known, and a failed fetch leaves the gradient disc. */
async function avatar(bot: Bot, serial: number, url: string | null): Promise<Uint8Array | null> {
  if (url) {
    try {
      const res = await bot.fetch(url, { signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS) });
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        await bot.bucket.put(avatarKey(serial), bytes, { httpMetadata: { contentType: 'image/png' } });
        return bytes;
      }
    } catch (err) {
      console.warn(`avatar for Marine ${serial}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return readBytes(bot.bucket, avatarKey(serial));
}

/**
 * Stamps a Marine's card: copies the memes, renders the card (and the glint for Rare and up), keeps them in R2 and
 * records the card. Returns the image to post, or null when it could not, having alerted.
 */
export async function stampCard(bot: Bot, marine: Marine, avatarSource: string | null): Promise<Attachment | null> {
  try {
    await stockMemes(bot.bucket, bot.renderer, bot.fetch, bot.snapshot.archive, marine.memes);
  } catch (err) {
    await bot.alert('discord-memes', `memes for Marine #${marine.serial} could not be copied: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const pngs = await loadMemes(bot.bucket, marine.memes);
  if (!pngs) return null;
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
    avatar: await avatar(bot, marine.serial, avatarSource),
  };
  try {
    const [png, gif] = await Promise.all([bot.renderer.renderMarineCard(card), hasGlint(marine.tier) ? bot.renderer.renderMarineGlint(card) : Promise.resolve(null)]);
    await bot.bucket.put(cardKey(marine.serial, 'png'), png, { httpMetadata: { contentType: 'image/png' } });
    if (gif) await bot.bucket.put(cardKey(marine.serial, 'gif'), gif, { httpMetadata: { contentType: 'image/gif' } });
    await setCardKey(bot.db, marine.serial, cardKey(marine.serial, 'png'));
    return gif ? { name: `marine-${marine.serial}.gif`, type: 'image/gif', bytes: gif } : { name: `marine-${marine.serial}.png`, type: 'image/png', bytes: png };
  } catch (err) {
    await bot.alert('discord-render:marine', `Marine #${marine.serial}'s card failed to render: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** The stamped card, animated when there is a glint; stamped now when it is missing. */
export async function marineCard(bot: Bot, marine: Marine, avatarSource: string | null): Promise<Attachment | null> {
  if (marine.cardKey) {
    const gif = hasGlint(marine.tier) ? await readBytes(bot.bucket, cardKey(marine.serial, 'gif')) : null;
    if (gif) return { name: `marine-${marine.serial}.gif`, type: 'image/gif', bytes: gif };
    const png = await readBytes(bot.bucket, marine.cardKey);
    if (png) return { name: `marine-${marine.serial}.png`, type: 'image/png', bytes: png };
  }
  return stampCard(bot, marine, avatarSource);
}

/** The reveal: the draw is already saved; the card renders while the tags are stamped, a second apart, then it is edited in. */
export async function reveal(bot: Bot, token: string, marine: Marine, avatarSource: string | null): Promise<void> {
  const stamping = stampCard(bot, marine, avatarSource);
  await bot.discord.editOriginal(token, TEXT.drawing);
  for (const step of revealSteps(marine.tags, marine.tier)) {
    await bot.sleep(STEP_MS);
    await bot.discord.editOriginal(token, step);
  }
  const [card] = await Promise.all([stamping, bot.sleep(STEP_MS)]);
  await bot.discord.editOriginal(token, card ? marine.callsign : TEXT.stamping(marine), card);
}

export async function enlistCommand(bot: Bot, interaction: Interaction): Promise<void> {
  const who = invoker(interaction);
  if (!who) throw new Error('an interaction without a user');
  const result = await enlist(
    bot.db,
    { platform: PLATFORM, userId: who.user.id, displayName: displayName(who.user, who.member), enlistedAt: bot.now().toISOString(), snapshotVersion: bot.snapshot.version },
    () => draft(bot),
  );
  const source = avatarUrl(who.user, who.member, interaction.guild_id);
  if (result.kind === 'clashed') {
    await bot.alert('discord-draw', `every one of 20 draws for ${who.user.id} clashed with a callsign already taken`);
    await bot.discord.privateFollowup(interaction.token, TEXT.internal);
  } else if (result.kind === 'already') {
    const card = await marineCard(bot, result.marine, source);
    await bot.discord.editOriginal(interaction.token, card ? TEXT.already : TEXT.stamping(result.marine), card);
  } else {
    await reveal(bot, interaction.token, result.marine, source);
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

export async function dogtagCommand(bot: Bot, interaction: Interaction): Promise<void> {
  const whose = target(interaction);
  if (!whose) throw new Error('/dogtag without a resolvable user');
  const marine = await findMarine(bot.db, PLATFORM, whose.user.id);
  if (!marine) {
    const text = TEXT.notEnlisted(displayName(whose.user, whose.member));
    await (whose.self ? bot.discord.privateFollowup(interaction.token, text) : bot.discord.editOriginal(interaction.token, text));
    return;
  }
  const card = await marineCard(bot, marine, avatarUrl(whose.user, whose.member, interaction.guild_id));
  if (card) await bot.discord.editOriginal(interaction.token, marine.callsign, card);
  else await bot.discord.privateFollowup(interaction.token, TEXT.internal);
}
