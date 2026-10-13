import { serialText } from '@ccip-dev/core/linkmarine';
import { BOT_ORIGIN, SITE_URL } from '../config';

/** The static page every /marines/<serial>/ is served from; the site Worker rewrites its head. Never linked. */
export const MARINE_TEMPLATE_PATH = '/marines/marine/';
export const MARINE_DESCRIPTION = "A LinkMarine's dog tags on ccip.dev: the callsign, its tier and the memes behind it.";

export const marinePath = (serial: number) => `/marines/${serialText(serial)}/`;
export const marineUrl = (serial: number) => `${SITE_URL}${marinePath(serial)}`;
export const marineTitle = (serial: number) => `LINK MARINE #${serialText(serial)}`;
export const webCardUrl = (serial: number) => `${BOT_ORIGIN}/web/${serial}.png`;
export const memeUrl = (file: string) => `${BOT_ORIGIN}/memes/${encodeURIComponent(file)}.png`;

const MARINE_PATH = /^\/marines\/(\d{1,9})\/?$/;

/** The serial in a Marine page's path, however it is padded; null for anything else, serial 0 included. */
export function serialFromPath(path: string): number | null {
  const match = MARINE_PATH.exec(path);
  if (!match) return null;
  const serial = Number(match[1]);
  return serial >= 1 ? serial : null;
}
