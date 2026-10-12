import type { BroadcastTarget } from '@ccip-dev/core/broadcasts';
import type { RunContext } from '../context';
import type { Env } from '../env';
import { sendTelegramPhoto, type TelegramConfig } from '../telegram';
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
  send(b: Broadcast): Promise<'sent' | 'failed'>;
}

/** `channel` outputs post publicly; `drafts` and `preview` outputs reach only the owner. `preview` shows the channel's caption in drafts mode. */
export interface OutputSet {
  channel: BroadcastOutput[];
  drafts: BroadcastOutput[];
  preview: BroadcastOutput[];
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

/** The channel gets the card with the Telegram caption; the owner's drafts chat gets it with the X text, ready to paste, and in drafts mode with the channel caption too. */
export function telegramOutputs(c: RunContext): OutputSet {
  const token = c.env.TELEGRAM_BOT_TOKEN;
  const channel = c.env.TELEGRAM_CHANNEL_ID;
  const drafts = c.env.TELEGRAM_DRAFTS_CHAT_ID || c.env.TELEGRAM_ALERT_CHAT_ID;
  return {
    channel: token && channel ? [photoOutput(c, 'telegram-channel', { token, chatId: channel }, (b) => ({ caption: b.telegramHtml, parseMode: 'HTML' }))] : [],
    drafts: token && drafts ? [photoOutput(c, 'x-draft', { token, chatId: drafts }, (b) => ({ caption: b.xText }))] : [],
    preview: token && drafts ? [photoOutput(c, 'telegram-preview', { token, chatId: drafts }, (b) => ({ caption: b.telegramHtml, parseMode: 'HTML' }))] : [],
  };
}
