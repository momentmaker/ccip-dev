import type { PostTarget } from '@ccip-dev/core/broadcasts';
import { clip, parsePollRecord, POLL_OPTION_MAX, POLL_QUESTION_MAX, pollRecordKey, type PollRecord } from '@ccip-dev/core/moments';
import type { RunContext } from '../context';
import type { Env } from '../env';
import * as store from '../store';
import { sendTelegramPhoto, sendTelegramPoll, sendTelegramVideo, type TelegramConfig } from '../telegram';
import { createPost, uploadImage, uploadVideo, type XCredentials } from '../x';
import { noLinks } from './copy';
import type { BroadcastFacts } from './facts';
import type { MomentFacts } from './moment-facts';
import type { MonthlyFacts } from './monthly';

/** What a broadcast posts: its card, or for the monthly broadcast its video. */
export type BroadcastMedia =
  | { kind: 'image'; png: Uint8Array }
  | { kind: 'video'; mp4: Blob; filename: string; width: number; height: number; durationS: number };

export interface Broadcast {
  key: string;
  kind: PostTarget['kind'];
  media: BroadcastMedia;
  facts: BroadcastFacts | MomentFacts | MonthlyFacts;
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
 * `channel` and `xPost` outputs post publicly; `drafts` and `preview` outputs reach only the owner. `preview` shows the channel's
 * caption in drafts mode. A working `xPost` output replaces the X draft in `on` mode. An `xPost` output posts the card and the
 * X text only, never a poll. The poll goes to the chat its card went to: `channelPoll` in on mode, `draftsPoll` in drafts.
 */
export interface OutputSet {
  channel: BroadcastOutput[];
  xPost?: BroadcastOutput[];
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
  return mode === 'on' ? [...set.channel, ...(set.xPost?.length ? set.xPost : set.drafts)] : [...set.drafts, ...set.preview];
}

/** X carries the reports, records, milestones, Reserve deposits and the monthly video, as the post or the owner's draft; moments are Telegram's alone. */
const X_KINDS: ReadonlySet<PostTarget['kind']> = new Set(['daily', 'weekly', 'record', 'milestone', 'reserve', 'monthly']);
const X_OUTPUT_NAMES = new Set(['x-post', 'x-draft']);

export function outputsFor(outputs: readonly BroadcastOutput[], target: PostTarget): BroadcastOutput[] {
  return X_KINDS.has(target.kind) ? [...outputs] : outputs.filter((o) => !X_OUTPUT_NAMES.has(o.name));
}

/** The poll card and then the poll, to one chat. The poll has no X text, so it never goes to X: no X draft and no X post. */
export function selectPollOutputs(set: OutputSet, mode: Exclude<BroadcastMode, 'off'>): BroadcastOutput[] {
  return mode === 'on' ? [...set.channel, ...(set.channelPoll ?? [])] : [...set.preview, ...(set.draftsPoll ?? [])];
}

/** Sends the card as a photo, or the monthly video as a video that plays inline. */
function mediaOutput(c: RunContext, name: string, config: TelegramConfig, caption: (b: Broadcast) => { caption: string; parseMode?: 'HTML' }): BroadcastOutput {
  return {
    name,
    async send(b) {
      const { media } = b;
      const failure =
        media.kind === 'video'
          ? await sendTelegramVideo(c.deps, config, { video: media.mp4, filename: media.filename, width: media.width, height: media.height, durationS: media.durationS, ...caption(b) })
          : await sendTelegramPhoto(c.deps, config, { photo: media.png, ...caption(b) });
      if (failure === null) return 'sent';
      console.error(`[broadcast] ${name} failed for ${b.key}: ${failure}`);
      return 'failed';
    },
  };
}

/** Sends the week's poll after its card, and keeps its message id under `poll:<monday>` so a finalize after its week can close it. */
function pollOutput(c: RunContext, config: TelegramConfig, after: string): BroadcastOutput {
  return {
    name: 'telegram-poll',
    after,
    async send(b) {
      if (b.facts.kind !== 'poll') return 'failed';
      const { poll } = b.facts;
      const key = pollRecordKey(poll.week);
      // The record is written before the output's mark, so a record in this chat means the poll is out and only the mark was lost.
      if (parsePollRecord(await store.getMeta(c.env.DB, key))?.chat_id === config.chatId) return 'sent';
      const sent = await sendTelegramPoll(c.deps, config, {
        question: clip(noLinks(poll.question), POLL_QUESTION_MAX),
        options: poll.options.map((o) => clip(noLinks(o.label), POLL_OPTION_MAX)),
      });
      if ('problem' in sent) {
        console.error(`[broadcast] telegram-poll failed for ${b.key}: ${sent.problem}`);
        return 'failed';
      }
      const record: PollRecord = { chat_id: config.chatId, message_id: sent.messageId, question_kind: poll.question_kind, question: poll.question, options: poll.options };
      await savePollRecord(c, poll.week, record);
      return 'sent';
    },
  };
}

/** The poll is out, so a lost record only costs next week's vote shares; it is never a reason to send the poll again. */
async function savePollRecord(c: RunContext, monday: string, record: PollRecord): Promise<void> {
  const key = pollRecordKey(monday);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await store.setMeta(c.env.DB, key, JSON.stringify(record));
      return;
    } catch (err) {
      console.error(`[broadcast] saving ${key} failed (attempt ${attempt + 1})`, err instanceof Error ? err.name : 'error');
    }
  }
  try {
    await c.alert(`poll-close:${monday}`, `The poll of the week of ${monday} went out, but its record could not be saved, so close it by hand next Monday; its result posts without vote shares`);
  } catch (alertErr) {
    console.error('[broadcast] the poll record alert failed', alertErr instanceof Error ? alertErr.name : 'error');
  }
}

/** The channel gets the card with the Telegram caption; the owner's drafts chat gets it with the X text, ready to paste, and in drafts mode with the channel caption too. */
export function telegramOutputs(c: RunContext): OutputSet {
  const token = c.env.TELEGRAM_BOT_TOKEN;
  const channel = c.env.TELEGRAM_CHANNEL_ID;
  const drafts = c.env.TELEGRAM_DRAFTS_CHAT_ID || c.env.TELEGRAM_ALERT_CHAT_ID;
  return {
    xPost: [],
    channel: token && channel ? [mediaOutput(c, 'telegram-channel', { token, chatId: channel }, (b) => ({ caption: b.telegramHtml, parseMode: 'HTML' }))] : [],
    drafts: token && drafts ? [mediaOutput(c, 'x-draft', { token, chatId: drafts }, (b) => ({ caption: b.xText }))] : [],
    preview: token && drafts ? [mediaOutput(c, 'telegram-preview', { token, chatId: drafts }, (b) => ({ caption: b.telegramHtml, parseMode: 'HTML' }))] : [],
    channelPoll: token && channel ? [pollOutput(c, { token, chatId: channel }, 'telegram-channel')] : [],
    draftsPoll: token && drafts ? [pollOutput(c, { token, chatId: drafts }, 'telegram-preview')] : [],
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
      const uploaded = b.media.kind === 'video' ? await uploadVideo(c.deps, creds, b.media.mp4) : await uploadImage(c.deps, creds, b.media.png);
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
