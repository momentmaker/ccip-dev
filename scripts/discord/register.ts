import { parseRegisterArgs, registerRequest } from './commands';

/**
 * `pnpm discord:register [--guild <id> | --clear-guild <id>]`: PUTs the six commands, with the owner's
 * DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN. No flag registers them globally.
 */
const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
if (!applicationId || !botToken) throw new Error('set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in this shell first (see docs/runbook.md, "Discord bot")');
const target = parseRegisterArgs(process.argv.slice(2));
const { url, init } = registerRequest(applicationId, target, botToken);
const res = await fetch(url, init);
if (!res.ok) throw new Error(`Discord returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
const registered = (await res.json()) as { name: string }[];
const list = registered.map((c) => `/${c.name}`).join(', ');
if (target.clearGuild) console.log(`cleared server ${target.clearGuild}'s commands`);
else if (target.guild) console.log(`registered ${list} in server ${target.guild}`);
else console.log(`registered ${list} globally`);
