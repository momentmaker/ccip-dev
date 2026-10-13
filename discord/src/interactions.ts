/** The slice of Discord's interaction protocol the bot uses (discord.com/developers/docs/interactions/receiving-and-responding). */

export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, APPLICATION_COMMAND_AUTOCOMPLETE: 4 } as const;
export const ResponseType = { PONG: 1, CHANNEL_MESSAGE_WITH_SOURCE: 4, DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5, APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8 } as const;
export const EPHEMERAL = 1 << 6;

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

export interface DiscordMember {
  user?: DiscordUser;
  nick?: string | null;
  avatar?: string | null;
}

export interface CommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  focused?: boolean;
}

export interface Interaction {
  id: string;
  type: number;
  token: string;
  application_id: string;
  guild_id?: string;
  /** Where it ran: 0 a server, 1 a DM with the app, 2 a private channel. */
  context?: number;
  member?: DiscordMember;
  user?: DiscordUser;
  data?: {
    name: string;
    options?: CommandOption[];
    resolved?: { users?: Record<string, DiscordUser>; members?: Record<string, DiscordMember> };
  };
}

/** Text a member typed or chose, shown as itself: every character Discord's markdown reads is escaped, so nothing becomes a link or breaks a code span. */
export const escapeMarkdown = (text: string) => text.replace(/[\\*_~|>#\-[\]()`]/g, '\\$&');

/** Text cut to `max` characters, the last an ellipsis when it was longer. */
export function clip(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** An immediate private reply, for what is known inside the 3-second window. */
export const privateReply = (content: string) => json({ type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } });

export const deferred = () => json({ type: ResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });

export function optionValue(interaction: Interaction, name: string): string | null {
  const value = interaction.data?.options?.find((o) => o.name === name)?.value;
  return value === undefined ? null : String(value);
}

/** Who ran the command: the member in a server, the user in a DM. */
export function invoker(interaction: Interaction): { user: DiscordUser; member: DiscordMember | null } | null {
  const user = interaction.member?.user ?? interaction.user;
  return user ? { user, member: interaction.member ?? null } : null;
}

/** A display name as Discord shows it in the server: the nickname, else the global name, else the username. */
export function displayName(user: DiscordUser, member: DiscordMember | null): string {
  return member?.nick || user.global_name || user.username;
}

/** The avatar as a 128 px PNG: the server avatar, else the account's, else Discord's default for the account. */
export function avatarUrl(user: DiscordUser, member: DiscordMember | null, guildId: string | undefined): string {
  if (member?.avatar && guildId) return `https://cdn.discordapp.com/guilds/${guildId}/users/${user.id}/avatars/${member.avatar}.png?size=128`;
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
}
