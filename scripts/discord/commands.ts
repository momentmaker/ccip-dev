import { COMMANDS } from '../../discord/src/commands';

export const DISCORD_API = 'https://discord.com/api/v10';

/** Where the six commands go: everywhere by default, or one server (`guild`), or removed from one server (`clearGuild`). */
export type RegisterTarget = { guild?: string; clearGuild?: string };

function serverId(id: string | undefined, flag: string): string {
  if (id === undefined || id.startsWith('--')) throw new Error(`${flag} needs a server id`);
  if (!/^\d{17,20}$/.test(id)) throw new Error(`${flag}: the server id must be 17 to 20 digits`);
  return id;
}

/** `pnpm discord:register`'s arguments: none (global), `--guild <id>` or `--clear-guild <id>`. */
export function parseRegisterArgs(args: string[]): RegisterTarget {
  const target: RegisterTarget = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--guild') target.guild = serverId(args[++i], flag);
    else if (flag === '--clear-guild') target.clearGuild = serverId(args[++i], flag);
    else throw new Error(`Unknown argument ${flag}. Use --guild <id> or --clear-guild <id>, or neither to register globally`);
  }
  if (target.guild && target.clearGuild) throw new Error('Use one of --guild and --clear-guild, not both');
  return target;
}

/**
 * Bulk Overwrite: the six commands become the whole list, globally, or in one server for instant testing. An empty list
 * in a server removes its own copies, so the global ones are not shown twice.
 */
export function registerRequest(applicationId: string, target: RegisterTarget, botToken: string): { url: string; init: RequestInit } {
  const guild = target.clearGuild ?? target.guild;
  const base = `${DISCORD_API}/applications/${applicationId}`;
  return {
    url: guild === undefined ? `${base}/commands` : `${base}/guilds/${serverId(guild, 'server id')}/commands`,
    init: {
      method: 'PUT',
      headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(target.clearGuild === undefined ? COMMANDS : []),
    },
  };
}
