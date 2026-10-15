import { cappedBody } from './body';
import { createBot, SNAPSHOT, type Bot } from './bot';
import type { Env } from './env';
import { chainActivity, chainChoices } from './intel';
import { COMMAND_KINDS, intelCommand } from './intel-commands';
import { deferred, InteractionType, json, privateReply, ResponseType, type Interaction } from './interactions';
import { dogtagCommand, enlistCommand, replyBudget, TEXT } from './marines';
import { miniAppRoute } from './miniapp';
import { publicRoute, type PublicDeps } from './public';
import { stickerJob } from './stickers';
import { createTelegramBot } from './telegram-marines';
import { verifyDiscordRequest } from './verify';

export const NOT_HERE = 'ccip.dev isn’t available here.';

const GUILD_CONTEXT = 0;

/**
 * Whether LinkMarine serves this interaction: only inside a server (never a DM or a user-installed context), and only a
 * server the setting allows. `all` allows any; otherwise a comma-separated list of server ids; empty or missing allows none.
 */
export function serverAllowed(setting: string | undefined, interaction: Interaction): boolean {
  if (!interaction.guild_id) return false;
  if (interaction.context !== undefined && interaction.context !== GUILD_CONTEXT) return false;
  const allowed = (setting ?? '').trim();
  if (allowed === 'all') return true;
  return allowed.split(',').some((id) => id.trim() !== '' && id.trim() === interaction.guild_id);
}

export interface Handlers {
  /** Each command's work, run after the deferred reply. */
  commands: Readonly<Record<string, (interaction: Interaction) => Promise<void>>>;
  autocomplete(interaction: Interaction): Promise<{ name: string; value: string }[]>;
}

const choices = (list: { name: string; value: string }[]) => json({ type: ResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT, data: { choices: list } });

/**
 * Answers a verified interaction: PING with PONG, autocomplete at once, and a command with a deferred reply while its
 * work runs in `waitUntil`. A command from a server the `servers` setting does not allow, or from a DM, is turned away privately.
 */
export async function handleInteraction(interaction: Interaction, servers: string | undefined, handlers: Handlers, waitUntil: (work: Promise<unknown>) => void): Promise<Response> {
  if (interaction.type === InteractionType.PING) return json({ type: ResponseType.PONG });
  const here = serverAllowed(servers, interaction);
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
  if (!here) return privateReply(NOT_HERE);
  const name = interaction.data?.name ?? '';
  const command = handlers.commands[name];
  if (!command) return privateReply(`Unknown command /${name}.`);
  waitUntil(command(interaction));
  return deferred();
}

/** A command that fails unexpectedly is reported to the alert chat and answered privately. */
function guarded(bot: Bot, command: (bot: Bot, interaction: Interaction, startedAt: number) => Promise<void>): (interaction: Interaction) => Promise<void> {
  return async (interaction) => {
    const startedAt = bot.now().getTime();
    try {
      await command(bot, interaction, startedAt);
    } catch (err) {
      const name = interaction.data?.name ?? 'unknown';
      console.error(`/${name} failed: ${err instanceof Error ? err.stack : String(err)}`);
      try {
        await bot.discord.privateFollowup(interaction.token, TEXT.internal, replyBudget(bot, startedAt));
      } catch (replyErr) {
        console.error(`/${name}: the private reply failed: ${replyErr instanceof Error ? replyErr.message : String(replyErr)}`);
      }
      await bot.alert(`discord-command:${name}`, `/${name} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

/** Discord drops an autocomplete not answered in 3 s; chains.json gets this long on a cold cache. */
const AUTOCOMPLETE_BUDGET_MS = 2_000;

export function botHandlers(bot: Bot): Handlers {
  const intel = Object.fromEntries(Object.entries(COMMAND_KINDS).map(([name, kind]) => [name, guarded(bot, (b, i, startedAt) => intelCommand(b, i, kind, startedAt))]));
  return {
    commands: { enlist: guarded(bot, enlistCommand), dogtag: guarded(bot, dogtagCommand), ...intel },
    autocomplete: async (interaction) => {
      const typed = String(interaction.data?.options?.find((o) => o.focused)?.value ?? '');
      const done = new AbortController();
      try {
        const timeout = bot.deadline(AUTOCOMPLETE_BUDGET_MS, done.signal);
        const top = bot.data.load('top/src_chain.json').catch(() => null);
        const [chains, sources] = await Promise.all([Promise.race([bot.data.load('chains.json'), timeout]), Promise.race([top, timeout])]);
        if (!chains) return [];
        return chainChoices(chains, typed, sources ? chainActivity(sources) : undefined);
      } finally {
        done.abort();
      }
    },
  };
}

/** A verified body as an interaction; null when it is not a JSON object. */
function parseInteraction(body: string): Interaction | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Interaction) : null;
  } catch {
    return null;
  }
}

function publicDeps(env: Env, ctx: ExecutionContext): PublicDeps {
  return {
    db: env.DB,
    bucket: env.MARINES,
    renderer: env.SITE,
    fetch: (input, init) => fetch(input, init),
    snapshot: SNAPSHOT,
    now: () => new Date(),
    cache: caches.default,
    waitUntil: (work) => ctx.waitUntil(work),
  };
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/tg/')) return miniAppRoute(request, createTelegramBot(env), (work) => ctx.waitUntil(work));
    if (path !== '/interactions') return (await publicRoute(request, publicDeps(env, ctx))) ?? new Response('Not found', { status: 404 });
    if (request.method !== 'POST') return new Response('Not found', { status: 404 });
    const body = await cappedBody(request);
    if (body === null) return new Response('Request body too large', { status: 413 });
    const valid = await verifyDiscordRequest(env.DISCORD_PUBLIC_KEY ?? '', request.headers.get('X-Signature-Ed25519'), request.headers.get('X-Signature-Timestamp'), body);
    if (!valid) return new Response('Invalid request signature', { status: 401 });
    const interaction = parseInteraction(body);
    if (!interaction) return new Response('Invalid interaction', { status: 400 });
    return handleInteraction(interaction, env.DISCORD_SERVERS, botHandlers(createBot(env)), (work) => ctx.waitUntil(work));
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(stickerJob(createTelegramBot(env)));
  },
} satisfies ExportedHandler<Env>;
