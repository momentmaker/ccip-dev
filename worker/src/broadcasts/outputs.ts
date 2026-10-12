import type { BroadcastTarget } from '@ccip-dev/core/broadcasts';
import type { RunContext } from '../context';
import type { Env } from '../env';
import { sendTelegramPhoto, type TelegramConfig } from '../telegram';
import { createPost, uploadImage, type XCredentials } from '../x';
import type { BroadcastFacts } from './facts';

export interface Broadcast {
  key: string;
  kind: BroadcastTarget['kind'];
  image: Uint8Array;
  facts: BroadcastFacts;
  xText: string;
  telegramHtml: string;
}

export interface BroadcastOutput {
  name: string;
  send(b: Broadcast): Promise<'sent' | 'failed'>;
}

/**
 * `channel` and `xPost` outputs post publicly; `drafts` and `preview` outputs reach only the owner. `preview` shows the channel's
 * caption in drafts mode. A working `xPost` output replaces the X draft in `on` mode. An `xPost` output posts the card and the
 * X text only, never a poll.
 */
export interface OutputSet {
  channel: BroadcastOutput[];
  xPost?: BroadcastOutput[];
  drafts: BroadcastOutput[];
  preview: BroadcastOutput[];
}

export type BroadcastMode = 'off' | 'drafts' | 'on';

export function broadcastMode(env: Pick<Env, 'BROADCASTS'>): BroadcastMode {
  return env.BROADCASTS === 'drafts' || env.BROADCASTS === 'on' ? env.BROADCASTS : 'off';
}

export function selectOutputs(set: OutputSet, mode: Exclude<BroadcastMode, 'off'>): BroadcastOutput[] {
  return mode === 'on' ? [...set.channel, ...(set.xPost?.length ? set.xPost : set.drafts)] : [...set.drafts, ...set.preview];
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
    xPost: [],
    channel: token && channel ? [photoOutput(c, 'telegram-channel', { token, chatId: channel }, (b) => ({ caption: b.telegramHtml, parseMode: 'HTML' }))] : [],
    drafts: token && drafts ? [photoOutput(c, 'x-draft', { token, chatId: drafts }, (b) => ({ caption: b.xText }))] : [],
    preview: token && drafts ? [photoOutput(c, 'telegram-preview', { token, chatId: drafts }, (b) => ({ caption: b.telegramHtml, parseMode: 'HTML' }))] : [],
  };
}

function xCredentials(env: Env): XCredentials | null {
  const { X_API_KEY: apiKey, X_API_SECRET: apiSecret, X_ACCESS_TOKEN: accessToken, X_ACCESS_SECRET: accessSecret } = env;
  return apiKey && apiSecret && accessToken && accessSecret && env.X_POSTS !== 'off' ? { apiKey, apiSecret, accessToken, accessSecret } : null;
}

/** Once X times out, fails to connect or answers 5xx, `down` makes the rest of the run's sends fail without calling X again. */
function xPostOutput(c: RunContext, creds: XCredentials, circuit: { down: boolean }): BroadcastOutput {
  const name = 'x-post';
  return {
    name,
    async send(b) {
      if (b.xText.trim() === '') return failed(name, b.key, 'the broadcast has no X text, so it is not posted to X');
      if (circuit.down) return failed(name, b.key, 'X failed earlier in this run, so it is not called again');
      const uploaded = await uploadImage(c.deps, creds, b.image);
      if ('problem' in uploaded) {
        circuit.down = uploaded.outage;
        return failed(name, b.key, `upload: ${uploaded.problem}`);
      }
      const posted = await createPost(c.deps, creds, { text: b.xText, mediaIds: [uploaded.mediaId] });
      if ('duplicate' in posted) {
        console.log(`[broadcast] X already has ${b.key} (duplicate content); counting it as sent`);
        return 'sent';
      }
      if ('problem' in posted) {
        circuit.down = posted.outage;
        return failed(name, b.key, `post: ${posted.problem}`);
      }
      console.log(`[broadcast] ${name} posted ${b.key} as ${posted.postId}`);
      return 'sent';
    },
  };
}

function failed(name: string, key: string, problem: string): 'failed' {
  console.error(`[broadcast] ${name} failed for ${key}: ${problem}`);
  return 'failed';
}

/** The X post replaces the owner's X draft once all four keys are set; `X_POSTS = "off"` brings the drafts back. */
/** The circuit state lives in this call's closure, and `broadcastOutputs(c)` runs once per run, so a trip lasts one run. */
export function xOutputs(c: RunContext): BroadcastOutput[] {
  const creds = xCredentials(c.env);
  return creds ? [xPostOutput(c, creds, { down: false })] : [];
}

export function broadcastOutputs(c: RunContext): OutputSet {
  return { ...telegramOutputs(c), xPost: xOutputs(c) };
}
