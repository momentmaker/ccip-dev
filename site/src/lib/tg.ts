import { MINI_APP_LINK, parseStartParam, rarerThan, type EnlistAnswer, type MarineSummary, type SessionAnswer, type StartParam, type Tier } from '@ccip-dev/core/linkmarine';
import { BOT_ORIGIN } from '../config';
import { marineTitle, marineUrl, shareLine } from './marines';
import type { TelegramWebApp } from './telegram-webapp';

/** The LinkMarines Mini App's rules: where it opens, how the draw plays, the tilt, sharing, and its API. */

export const TG_API = `${BOT_ORIGIN}/tg`;
/** The ccip.dev dark theme, for Telegram's header, background and bottom bar. */
export const TG_BACKGROUND = '#0a0f1e';
export const MAIN_BLUE = '#2f62df';
export const MAIN_GOLD = '#f5c451';
export const MAIN_GOLD_TEXT = '#1a1205';
export const CCIPDEV_LINK = 'https://t.me/ccipdev';

export type Screen = { name: 'welcome' } | { name: 'draw' } | { name: 'dogtag' } | { name: 'roster'; marine: number | null; tag: string | null };

/** The startapp value: Telegram's start_param for a direct link, else ?startapp= on the URL the bot's button opens. */
export function startParam(app: Pick<TelegramWebApp, 'initDataUnsafe'>, search: string): StartParam | null {
  return parseStartParam(app.initDataUnsafe.start_param ?? new URLSearchParams(search).get('startapp'));
}

/** Where the app opens: a Marine's or a tag's link opens the roster; otherwise an enlisted Marine's dog tag, else the welcome. */
export function firstScreen(start: StartParam | null, session: SessionAnswer): Screen {
  if (start?.kind === 'marine') return { name: 'roster', marine: start.serial, tag: null };
  if (start?.kind === 'tag') return { name: 'roster', marine: null, tag: start.tag };
  return session.switch === 'on' && session.marine ? { name: 'dogtag' } : { name: 'welcome' };
}

/** One hex locks every 0.8 s, left to right, once the draw's answer is in. */
export const DRAW_STEP_MS = 800;
/** After the last lock, the callsign (and a Rare or Legendary banner) holds this long before the dog tag. */
export const DRAW_HOLD_MS = 1_400;

/** The callsign as the draw fills it in, part by part: the locked tags in capitals, the rest dots. */
export function callsignParts(tags: readonly string[], locked: number): { text: string; locked: boolean }[] {
  return [0, 1, 2].map((i) => (i < locked && tags[i] ? { text: tags[i]!.toUpperCase(), locked: true } : { text: '······', locked: false }));
}

/** A tag's per-draw chance: "4.4%". */
export const chanceText = (chance: number) => `${(chance * 100).toFixed(1)}%`;

/** "RARE · RARER THAN 88%". */
export const tierBanner = (tier: Tier, percentile: number) => `${tier.toUpperCase()} · RARER THAN ${rarerThan(percentile)}%`;

/** Stories are in Telegram's phone apps only, from Bot API 7.8; anywhere else Share to Story becomes the share sheet. */
export function canShareToStory<T extends Pick<TelegramWebApp, 'platform' | 'isVersionAtLeast' | 'shareToStory'>>(app: T): app is T & Required<Pick<TelegramWebApp, 'shareToStory'>> {
  return typeof app.shareToStory === 'function' && app.isVersionAtLeast('7.8') && ['ios', 'android', 'android_x'].includes(app.platform);
}

export const storyUrl = (serial: number) => `${BOT_ORIGIN}/story/${serial}.png`;
export const storyText = (m: Pick<MarineSummary, 'serial' | 'callsign'>) => `${marineTitle(m.serial)} · ${m.callsign.toUpperCase()} · Enlist: ${MINI_APP_LINK.replace('https://', '')}`;
export const STORY_WIDGET = { url: MINI_APP_LINK, name: 'Enlist' } as const;

/** Telegram's share sheet with the Marine's page. */
export function shareLink(m: Pick<MarineSummary, 'serial' | 'callsign' | 'tier'>): string {
  return `https://t.me/share/url?url=${encodeURIComponent(marineUrl(m.serial))}&text=${encodeURIComponent(shareLine(m))}`;
}

/** The card turns at most this many degrees each way. */
export const MAX_TILT = 8;
/** Degrees of phone tilt for one degree of card tilt. */
const TILT_RATIO = 3;
const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));
/** To a tenth of a degree, and never -0. */
const tenth = (v: number) => Math.round(v * 10) / 10 || 0;

/** The card's turn and the light streak's place (0–100%) for the phone's tilt off where it was first held. */
export function tilt(beta: number, gamma: number, rest: { beta: number; gamma: number }): { x: number; y: number; streak: number } {
  const x = clamp(-(beta - rest.beta) / TILT_RATIO, MAX_TILT);
  const y = clamp((gamma - rest.gamma) / TILT_RATIO, MAX_TILT);
  return { x: tenth(x), y: tenth(y), streak: Math.round(50 + (y / MAX_TILT) * 50) };
}

/** The tilt runs only where motion is welcome and the phone reports its orientation. */
export const tiltOn = (reducedMotion: boolean, orientation: boolean) => !reducedMotion && orientation;

export interface MainButtonState {
  text: string;
  color: string;
  textColor: string;
  active: boolean;
  visible: boolean;
  action: 'enlist' | 'story' | 'dogtag' | null;
}

const hidden: MainButtonState = { text: '', color: MAIN_BLUE, textColor: '#ffffff', active: false, visible: false, action: null };
const blue = (text: string, active: boolean, action: MainButtonState['action']): MainButtonState => ({ text, color: MAIN_BLUE, textColor: '#ffffff', active, visible: true, action });

/** Telegram's own bottom button for each screen; hidden while LinkMarines on Telegram is off, where "opens soon" stands instead. */
export function mainButton(screen: Screen['name'], session: SessionAnswer | null): MainButtonState {
  if (session?.switch !== 'on') return hidden;
  const enlist = blue('ENLIST', session.gate === 'ok', 'enlist');
  switch (screen) {
    case 'welcome':
      return enlist;
    case 'draw':
      return blue('DRAWING…', false, null);
    case 'dogtag':
      return { text: 'SHARE TO STORY', color: MAIN_GOLD, textColor: MAIN_GOLD_TEXT, active: true, visible: true, action: 'story' };
    case 'roster':
      return session.marine ? blue('MY DOG TAG', true, 'dogtag') : enlist;
  }
}

export type EnlistReply = EnlistAnswer | { gate: 'join' } | { switch: 'off' };

/** The Mini App API. Every call carries the launch data in its body, never in the URL. */
export function tgApi(initData: string, fetchFn: typeof fetch = (input, init) => fetch(input, init)) {
  const post = (path: string) => fetchFn(`${TG_API}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData }) });
  return {
    async session(): Promise<SessionAnswer> {
      const res = await post('session');
      if (!res.ok) throw new Error(`session: HTTP ${res.status}`);
      return (await res.json()) as SessionAnswer;
    },
    async enlist(): Promise<EnlistReply> {
      const res = await post('enlist');
      if (!res.ok && res.status !== 403 && res.status !== 409) throw new Error(`enlist: HTTP ${res.status}`);
      return (await res.json()) as EnlistReply;
    },
    /** Your card's image, or null while it is still being stamped. */
    async card(): Promise<Blob | null> {
      const res = await post('card');
      if (res.status === 202) return null;
      if (!res.ok) throw new Error(`card: HTTP ${res.status}`);
      return res.blob();
    },
  };
}
