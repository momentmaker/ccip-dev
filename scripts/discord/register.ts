import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { guildIdFrom, registerRequest } from './commands';

/** `pnpm discord:register`: PUTs the six commands to the LinkMarine server, with the owner's DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN. */
const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
if (!applicationId || !botToken) throw new Error('set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in this shell first (see docs/runbook.md, "Discord bot")');
const guildId = guildIdFrom(readFileSync(join(import.meta.dirname, '..', '..', 'discord', 'wrangler.toml'), 'utf8'));
const { url, init } = registerRequest(applicationId, guildId, botToken);
const res = await fetch(url, init);
if (!res.ok) throw new Error(`Discord returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
const registered = (await res.json()) as { name: string }[];
console.log(`registered ${registered.map((c) => `/${c.name}`).join(', ')} in server ${guildId}`);
