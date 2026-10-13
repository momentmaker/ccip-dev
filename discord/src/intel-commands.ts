import type { IntelCards, IntelKind } from '@ccip-dev/core/linkmarine';
import { shortChainName } from '@ccip-dev/core/names';
import type { Bot } from './bot';
import { DataError } from './data';
import { dossierCard, findChain, recordsCard, sitrepCard, vaultCard } from './intel';
import { clip, escapeMarkdown, optionValue, type Interaction } from './interactions';
import { FINAL_EDIT_BY_MS, replyBudget, TEXT } from './marines';

/** An intel card is drawn at most once in this long per command and argument; within it, R2's copy is posted. */
export const INTEL_TTL_MS = 5 * 60_000;

/** The most of a typed chain an error echoes back. */
const MAX_ECHO = 64;

export const INTEL_TEXT = {
  noData: 'Intel is unavailable right now, try again in a minute.',
  unknownChain: (query: string) => `No chain called '${escapeMarkdown(clip(query, MAX_ECHO))}' on CCIP.`,
  noTraffic: (name: string) => `${escapeMarkdown(name)} has no CCIP traffic yet.`,
} as const;

export const COMMAND_KINDS: Readonly<Record<string, IntelKind>> = { cciptoday: 'sitrep', ccipchain: 'dossier', linkreserve: 'vault', cciprecords: 'records' };

type Built = { [K in IntelKind]: { kind: K; card: IntelCards[K] } }[IntelKind];

class UnknownChain extends Error {}
/** A chain CCIP lists that no message has crossed yet; its message is the chain's name. */
class NoTraffic extends Error {}

async function build(bot: Bot, kind: IntelKind, query: string | null): Promise<Built> {
  switch (kind) {
    case 'sitrep': {
      const [today, history, chains] = await Promise.all([bot.data.load('today.json'), bot.data.load('history.json'), bot.data.load('chains.json')]);
      return { kind, card: sitrepCard(today, history, chains) };
    }
    case 'dossier': {
      const chains = await bot.data.load('chains.json');
      const chain = findChain(chains, query ?? '');
      if (!chain) throw new UnknownChain(query ?? '');
      const [replay, sources] = await Promise.all([bot.data.load('replay.json'), bot.data.load('top/src_chain.json')]);
      const card = dossierCard(chain.selector, replay, sources, chains);
      if (!card) throw new NoTraffic(shortChainName(chain));
      return { kind, card };
    }
    case 'vault': {
      const card = vaultCard(await bot.data.load('reserve.json'));
      if (!card) throw new DataError('reserve.json', 'the Reserve has no balance yet');
      return { kind, card };
    }
    case 'records': {
      const [history, chains] = await Promise.all([bot.data.load('history.json'), bot.data.load('chains.json')]);
      return { kind, card: recordsCard(history, chains) };
    }
  }
}

/** The R2 key of a command's card: per command, and per typed chain for /ccipchain. */
export function intelKey(kind: IntelKind, query: string | null): string {
  return query === null ? `intel/${kind}.png` : `intel/${kind}/${encodeURIComponent(query.trim().toLowerCase())}.png`;
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** R2's copy of a card if it is under 5 minutes old; a failed read is a miss. */
async function keptCard(bot: Bot, key: string): Promise<Uint8Array | null> {
  try {
    const object = await bot.bucket.get(key);
    if (!object || bot.now().getTime() - object.uploaded.getTime() >= INTEL_TTL_MS) return null;
    return new Uint8Array(await object.arrayBuffer());
  } catch (err) {
    console.warn(`${key} could not be read from R2: ${reason(err)}`);
    return null;
  }
}

/**
 * /cciptoday, /ccipchain, /linkreserve and /cciprecords: R2's copy while it is under 5 minutes old, else the card drawn
 * from the public files. A private error is sent first and its alert after, so a slow alert never delays the reply.
 */
export async function intelCommand(bot: Bot, interaction: Interaction, kind: IntelKind, startedAt = bot.now().getTime()): Promise<void> {
  const query = kind === 'dossier' ? (optionValue(interaction, 'chain') ?? '') : null;
  const key = intelKey(kind, query);
  const post = (bytes: Uint8Array) => {
    const left = Math.max(0, FINAL_EDIT_BY_MS - (bot.now().getTime() - startedAt));
    return bot.discord.editOriginal(interaction.token, '', { name: `${kind}.png`, type: 'image/png', bytes }, left, Math.max(1_000, left));
  };
  const kept = await keptCard(bot, key);
  if (kept) return post(kept);

  let failure: { reply: string; signature: string; text: string } | { reply: string } | null = null;
  let png: Uint8Array | null = null;
  try {
    const built = await build(bot, kind, query);
    try {
      png = await bot.renderer.renderIntelCard(built.kind, built.card as never);
    } catch (err) {
      failure = { reply: TEXT.internal, signature: `discord-render:${kind}`, text: `the ${kind} card failed to render: ${reason(err)}` };
    }
  } catch (err) {
    if (err instanceof UnknownChain) failure = { reply: INTEL_TEXT.unknownChain(err.message) };
    else if (err instanceof NoTraffic) failure = { reply: INTEL_TEXT.noTraffic(err.message) };
    else if (err instanceof DataError) failure = { reply: INTEL_TEXT.noData, signature: `discord-data:${err.file}`, text: `${err.message} (for /${interaction.data?.name})` };
    else throw err;
  }

  if (png) {
    await bot.bucket.put(key, png, { httpMetadata: { contentType: 'image/png' } }).catch((err: unknown) => console.warn(`${key} was not kept in R2: ${reason(err)}`));
    return post(png);
  }
  if (!failure) return;
  try {
    await bot.discord.privateFollowup(interaction.token, failure.reply, replyBudget(bot, startedAt));
  } finally {
    if ('signature' in failure) await bot.alert(failure.signature, failure.text);
  }
}
