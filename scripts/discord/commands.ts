import { parse } from 'smol-toml';
import { COMMANDS } from '../../discord/src/commands';

export const DISCORD_API = 'https://discord.com/api/v10';

/** The LinkMarine server's id, from discord/wrangler.toml's [vars], so the Worker and the commands agree on it. */
export function guildIdFrom(wranglerToml: string): string {
  const id = (parse(wranglerToml) as { vars?: { DISCORD_GUILD_ID?: unknown } }).vars?.DISCORD_GUILD_ID;
  if (typeof id !== 'string' || !/^\d{17,20}$/.test(id)) throw new Error('discord/wrangler.toml: set [vars] DISCORD_GUILD_ID to the LinkMarine server id first');
  return id;
}

/** Bulk Overwrite Guild Application Commands: the six commands become the server's whole list. */
export function registerRequest(applicationId: string, guildId: string, botToken: string): { url: string; init: RequestInit } {
  return {
    url: `${DISCORD_API}/applications/${applicationId}/guilds/${guildId}/commands`,
    init: { method: 'PUT', headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' }, body: JSON.stringify(COMMANDS) },
  };
}
