import { miniAppLink, stickerPackUrl, stickerVolume } from '@ccip-dev/core/linkmarine';
import type { RosterFile } from '@ccip-dev/core/roster';

/** LinkMarines on Telegram shows on the site once the TELEGRAM_BOT GitHub variable is "on": the site build reads it. */
export const telegramOpen = (value: string | undefined) => value === 'on';

export const TELEGRAM_ENLIST_URL = miniAppLink('enlist');

export function stickerPacks(roster: RosterFile): { volume: number; url: string }[] {
  const newest = Math.max(0, ...roster.marines.map((m) => m.serial));
  return Array.from({ length: newest === 0 ? 0 : stickerVolume(newest) }, (_, i) => ({ volume: i + 1, url: stickerPackUrl(i + 1) }));
}

export function tagFromSearch(search: string): string | null {
  const tag = new URLSearchParams(search).get('tag');
  return tag !== null && /^[a-z0-9_]{1,13}$/.test(tag) ? tag : null;
}
