import type { BroadcastTarget } from '@ccip-dev/core/broadcasts';
import { clip, POLL_OPTION_MAX, POLL_QUESTION_MAX, pollRecordKey, type PollRecord } from '@ccip-dev/core/moments';
import type { RunContext } from '../context';
import type { Env } from '../env';
import * as store from '../store';
import { sendTelegramPhoto, sendTelegramPoll, type TelegramConfig } from '../telegram';
import { noLinks } from './copy';
import type { BroadcastFacts } from './facts';
import type { MomentFacts } from './moment-facts';

export interface Broadcast {
  key: string;
  kind: BroadcastTarget['kind'];
  image: Uint8Array;
  facts: BroadcastFacts | MomentFacts;
  xText: string;
  telegramHtml: string;
}

export interface BroadcastOutput {
  name: string;
  /** An output that follows another sends only once that one has sent the broadcast, in this run or an earlier one. */
  after?: string;
  send(b: Broadcast): Promise<'sent' | 'failed'>;
}

/**
 * `channel` outputs post publicly; `drafts` and `preview` outputs reach only the owner. `preview` shows the channel's
 * caption in drafts mode. The poll goes to the chat its card went to: `channelPoll` in on mode, `draftsPoll` in drafts.
 */
export interface OutputSet {
  channel: BroadcastOutput[];
  drafts: BroadcastOutput[];
  preview: BroadcastOutput[];
  channelPoll?: BroadcastOutput[];
  draftsPoll?: BroadcastOutput[];
}

export type BroadcastMode = 'off' | 'drafts' | 'on';

export function broadcastMode(env: Pick<Env, 'BROADCASTS'>): BroadcastMode {
  return env.BROADCASTS === 'drafts' || env.BROADCASTS === 'on' ? env.BROADCASTS : 'off';
}

/** Moments post only as far as both switches allow: off in either is off, and drafts in either is drafts. */
export function momentMode(env: Pick<Env, 'BROADCASTS' | 'MOMENTS'>): BroadcastMode {
  const broadcasts = broadcastMode(env);
  const moments = broadcastMode({ BROADCASTS: env.MOMENTS });
  if (broadcasts === 'off' || moments === 'off') return 'off';
  return broadcasts === 'drafts' || moments === 'drafts' ? 'drafts' : 'on';
}

export function selectOutputs(set: OutputSet, mode: Exclude<BroadcastMode, 'off'>): BroadcastOutput[] {
  return mode === 'on' ? [...set.channel, ...set.drafts] : [...set.drafts, ...set.preview];
}

/** The poll card and then the poll, to one chat; the poll has no X draft. */
export function selectPollOutputs(set: OutputSet, mode: Exclude<BroadcastMode, 'off'>): BroadcastOutput[] {
  return mode === 'on' ? [...set.channel, ...(set.channelPoll ?? [])] : [...set.preview, ...(set.draftsPoll ?? [])];
}

function photoOutput(c: RunContext, name: string, config: TelegramConfig, caption: (b: Broadcast) => { caption: string; parseMode?: 'HTML' }): BroadcastOutput {
  return {
    name,
    async send(b) {
      const failure = await sendTelegramPhoto(c.deps, config, { photo: b.image, ...caption(b) });
      if (failure === null) return 'sent';
      console.error(`[broadcast] ${name} failed for ${b.key}: ${failure}`);
      return 'failed';
    },
  };
}

/** Sends the week's poll after its card, and keeps its message id under `poll:<monday>` so next Monday's run can close it. */
function pollOutput(c: RunContext, config: TelegramConfig, after: string): BroadcastOutput {
  return {
    name: 'telegram-poll',
    after,
    async send(b) {
      if (b.facts.kind !== 'poll') return 'failed';
      const { poll } = b.facts;
      const sent = await sendTelegramPoll(c.deps, config, {
        question: clip(noLinks(poll.question), POLL_QUESTION_MAX),
        options: poll.options.map((o) => clip(noLinks(o.label), POLL_OPTION_MAX)),
      });
      if ('problem' in sent) {
        console.error(`[broadcast] telegram-poll failed for ${b.key}: ${sent.problem}`);
        return 'failed';
      }
      const record: PollRecord = { chat_id: config.chatId, message_id: sent.messageId, question_kind: poll.question_kind, question: poll.question, options: poll.options };
      await savePollRecord(c, pollRecordKey(poll.week), record);
      return 'sent';
    },
  };
}

/** The poll is out, so a lost record only costs next week's vote shares; it is never a reason to send the poll again. */
async function savePollRecord(c: RunContext, key: string, record: PollRecord): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await store.setMeta(c.env.DB, key, JSON.stringify(record));
      return;
    } catch (err) {
      console.error(`[broadcast] saving ${key} failed (attempt ${attempt + 1})`, err instanceof Error ? err.name : 'error');
    }
  }
}

/** The channel gets the card with the Telegram caption; the owner's drafts chat gets it with the X text, ready to paste, and in drafts mode with the channel caption too. */
export function telegramOutputs(c: RunContext): OutputSet {
  const token = c.env.TELEGRAM_BOT_TOKEN;
  const channel = c.env.TELEGRAM_CHANNEL_ID;
  const drafts = c.env.TELEGRAM_DRAFTS_CHAT_ID || c.env.TELEGRAM_ALERT_CHAT_ID;
  return {
    channel: token && channel ? [photoOutput(c, 'telegram-channel', { token, chatId: channel }, (b) => ({ caption: b.telegramHtml, parseMode: 'HTML' }))] : [],
    drafts: token && drafts ? [photoOutput(c, 'x-draft', { token, chatId: drafts }, (b) => ({ caption: b.xText }))] : [],
    preview: token && drafts ? [photoOutput(c, 'telegram-preview', { token, chatId: drafts }, (b) => ({ caption: b.telegramHtml, parseMode: 'HTML' }))] : [],
    channelPoll: token && channel ? [pollOutput(c, { token, chatId: channel }, 'telegram-channel')] : [],
    draftsPoll: token && drafts ? [pollOutput(c, { token, chatId: drafts }, 'telegram-preview')] : [],
  };
}
