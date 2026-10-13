import type { Env } from './env';
import { deferred, InteractionType, json, privateReply, ResponseType, type Interaction } from './interactions';
import { verifyDiscordRequest } from './verify';

export const ONLY_HERE = 'LinkMarine only serves the LinkMarine server.';

export interface Handlers {
  /** Each command's work, run after the deferred reply. */
  commands: Readonly<Record<string, (interaction: Interaction) => Promise<void>>>;
  autocomplete(interaction: Interaction): Promise<{ name: string; value: string }[]>;
}

const choices = (list: { name: string; value: string }[]) => json({ type: ResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT, data: { choices: list } });

/**
 * Answers a verified interaction: PING with PONG, autocomplete at once, and a command with a deferred reply while its
 * work runs in `waitUntil`. A command from anywhere but the LinkMarine server is turned away privately.
 */
export async function handleInteraction(interaction: Interaction, guildId: string, handlers: Handlers, waitUntil: (work: Promise<unknown>) => void): Promise<Response> {
  if (interaction.type === InteractionType.PING) return json({ type: ResponseType.PONG });
  const here = guildId !== '' && interaction.guild_id === guildId;
  if (interaction.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
    if (!here) return choices([]);
    try {
      return choices(await handlers.autocomplete(interaction));
    } catch (err) {
      console.error(`autocomplete: ${err instanceof Error ? err.message : String(err)}`);
      return choices([]);
    }
  }
  if (interaction.type !== InteractionType.APPLICATION_COMMAND) return new Response('Unsupported interaction', { status: 400 });
  if (!here) return privateReply(ONLY_HERE);
  const name = interaction.data?.name ?? '';
  const command = handlers.commands[name];
  if (!command) return privateReply(`Unknown command /${name}.`);
  waitUntil(command(interaction));
  return deferred();
}

/** Until the commands exist: none, and no suggestions. */
export const NO_HANDLERS: Handlers = { commands: {}, autocomplete: async () => [] };

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/interactions') return new Response('Not found', { status: 404 });
    const body = await request.text();
    const valid = await verifyDiscordRequest(env.DISCORD_PUBLIC_KEY ?? '', request.headers.get('X-Signature-Ed25519'), request.headers.get('X-Signature-Timestamp'), body);
    if (!valid) return new Response('Invalid request signature', { status: 401 });
    return handleInteraction(JSON.parse(body) as Interaction, env.DISCORD_GUILD_ID, NO_HANDLERS, (work) => ctx.waitUntil(work));
  },
} satisfies ExportedHandler<Env>;
