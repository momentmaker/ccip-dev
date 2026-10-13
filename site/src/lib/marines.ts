import { filledPips, seededRandom, serialText, type Tier } from '@ccip-dev/core/linkmarine';
import type { RosterMarine } from '@ccip-dev/core/roster';
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

export const tierName = (tier: Tier) => `${tier[0]!.toUpperCase()}${tier.slice(1)}`;

/** "13 Oct 2026" from "2026-10-13". */
export const enlistedText = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** ◆◆◇: a tag's rarity in three pips, as the card draws it. */
export const pipText = (count: number) => '◆'.repeat(filledPips(count)) + '◇'.repeat(3 - filledPips(count));

/** A rarest-ten bar: 20% at the roster's lowest score, 100% at its highest, to one decimal. */
export function rarestBarPct(score: number, low: number, high: number): number {
  return high === low ? 100 : Math.round((20 + (80 * (score - low)) / (high - low)) * 10) / 10;
}

export const shareLine = (m: Pick<RosterMarine, 'serial' | 'callsign' | 'tier'>) => `${marineTitle(m.serial)} · ${m.callsign} · ${m.tier.toUpperCase()}`;

/** The ticker crawls about 60 px a second; an item runs about 300 px. */
export const TICKER_SECONDS_PER_ITEM = 5;

export interface PlanetFrame {
  cols: number;
  rows: number;
  width: number;
  height: number;
  /** Planet sizes, in px, for the fewest and the most carriers. */
  min: number;
  max: number;
}

export const WIDE_FRAME: PlanetFrame = { cols: 8, rows: 3, width: 1120, height: 420, min: 34, max: 80 };
export const NARROW_FRAME: PlanetFrame = { cols: 3, rows: 4, width: 360, height: 440, min: 26, max: 52 };
/** The room under a planet for its "tag ×N" label. */
export const PLANET_LABEL_H = 18;
/** The widest "tag ×N" label: a 13-character tag and " ×NNNN", 19 characters at 6 px (10 px JetBrains Mono), plus room. */
export const PLANET_LABEL_W = 116;
const PLANET_SEED = 0x5eed;

/**
 * The constellation: each planet in a cell of its own, busiest nearest the middle, nudged off-centre by a fixed seed.
 * Since a planet and its label stay inside their cell, no two overlap and none leaves the frame. Returns each hexagon's
 * centre in the frame's pixels and its size. Expects `carriers` busiest first (as `constellation()` returns it); any past the
 * frame's cell count are dropped.
 */
export function planetLayout(carriers: readonly number[], frame: PlanetFrame): { x: number; y: number; size: number }[] {
  const cellW = frame.width / frame.cols;
  const cellH = frame.height / frame.rows;
  const cells = Array.from({ length: frame.cols * frame.rows }, (_, i) => ({ i, cx: ((i % frame.cols) + 0.5) * cellW, cy: (Math.floor(i / frame.cols) + 0.5) * cellH }))
    .map((c) => ({ ...c, d: Math.hypot(c.cx - frame.width / 2, c.cy - frame.height / 2) }))
    .sort((a, b) => a.d - b.d || a.i - b.i);
  const random = seededRandom(PLANET_SEED);
  const top = Math.max(1, ...carriers);
  return carriers.slice(0, cells.length).map((n, i) => {
    const size = frame.min + (n / top) * (frame.max - frame.min);
    const cell = cells[i]!;
    const slackX = (cellW - Math.max(size, PLANET_LABEL_W)) / 2;
    const slackY = (cellH - size * 1.12 - PLANET_LABEL_H) / 2;
    return { x: cell.cx + slackX * 0.9 * (random() * 2 - 1), y: cell.cy - PLANET_LABEL_H / 2 + slackY * 0.9 * (random() * 2 - 1), size };
  });
}
