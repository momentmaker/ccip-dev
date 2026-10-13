import { z } from 'zod';
import { callsignSeed, rarerThan, TIER_SHARE_PCT, TIERS, type Tier } from './linkmarine';

/**
 * The public LinkMarines roster the bot serves at discord.ccip.dev/roster.json, and every rule the site derives from it.
 * Callsigns only: the schema is strict, so a Discord name, avatar or id can never ride along.
 */
export const ROSTER_VERSION = 1;
/** The first hundred serials: the plank owners. */
export const PLANK_SEATS = 100;

const MEME = z.strictObject({ tag: z.string(), file: z.string(), count: z.number().int().positive() });

export const ROSTER_SCHEMA = z.strictObject({
  version: z.literal(ROSTER_VERSION),
  updatedAt: z.string(),
  snapshot: z.strictObject({
    version: z.number().int(),
    tags: z.array(z.strictObject({ tag: z.string(), count: z.number().int().positive(), chance: z.number().positive(), meme: z.string() })),
  }),
  marines: z.array(
    z.strictObject({
      serial: z.number().int().positive(),
      callsign: z.string(),
      tags: z.tuple([z.string(), z.string(), z.string()]),
      tier: z.enum(TIERS),
      score: z.number(),
      percentile: z.number(),
      memes: z.tuple([MEME, MEME, MEME]),
      blood: z.string(),
      faith: z.string(),
      enlisted: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  ),
});

export type RosterFile = z.infer<typeof ROSTER_SCHEMA>;
export type RosterMarine = RosterFile['marines'][number];
export type RosterTag = RosterFile['snapshot']['tags'][number];
export type RosterMeme = RosterMarine['memes'][number];

export const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** About 1 in N callsigns carry a tag: three picks at its per-pick chance (an approximation, since picks never repeat a tag). */
export function callsignsPerTag(chance: number): number {
  return Math.round(1 / (1 - (1 - chance) ** 3));
}

export interface TagFacts {
  carriers: number;
  /** The Marine with the lowest serial carrying the tag. Serials only grow, so a discoverer never changes. */
  discoverer: RosterMarine;
}

/** Every drawn tag, in the order its discoverer drew it: how many Marines carry it, and who drew it first. */
export function tagFacts(marines: readonly RosterMarine[]): Map<string, TagFacts> {
  const facts = new Map<string, TagFacts>();
  for (const marine of [...marines].sort((a, b) => a.serial - b.serial)) {
    for (const tag of marine.tags) {
      const known = facts.get(tag);
      if (known) known.carriers += 1;
      else facts.set(tag, { carriers: 1, discoverer: marine });
    }
  }
  return facts;
}

/** Rarest first: score descending, then the lower serial. */
export function ranked(marines: readonly RosterMarine[]): RosterMarine[] {
  return [...marines].sort((a, b) => b.score - a.score || a.serial - b.serial);
}

/** A Marine's 1-based place in `ranked`, or null when the serial is not on the roster. */
export function rankOf(marines: readonly RosterMarine[], serial: number): number | null {
  const at = ranked(marines).findIndex((m) => m.serial === serial);
  return at < 0 ? null : at + 1;
}

export interface TierCount {
  tier: Tier;
  count: number;
  /** The share of Marines in the tier, 0–100. */
  sharePct: number;
  /** The tier's share of all draws (TIER_SHARE_PCT). */
  expectedPct: number;
}

/** Marines per tier, rarest first, beside the odds. */
export function census(marines: readonly RosterMarine[]): TierCount[] {
  return [...TIERS].reverse().map((tier) => {
    const count = marines.filter((m) => m.tier === tier).length;
    return { tier, count, sharePct: marines.length === 0 ? 0 : (count / marines.length) * 100, expectedPct: TIER_SHARE_PCT[tier] };
  });
}

export interface BoardTag extends RosterTag {
  carriers: number;
  discoverer: RosterMarine | null;
}

/** Every tag in the snapshot, commonest first (chance descending, then name), with who carries it. */
export function tagBoard(roster: RosterFile): BoardTag[] {
  const facts = tagFacts(roster.marines);
  return [...roster.snapshot.tags]
    .sort((a, b) => b.chance - a.chance || byName(a.tag, b.tag))
    .map((t) => ({ ...t, carriers: facts.get(t.tag)?.carriers ?? 0, discoverer: facts.get(t.tag)?.discoverer ?? null }));
}

/** How many of the snapshot's tags at least one Marine carries: the "n" of "n/N tags drawn". */
export function tagsDrawn(roster: RosterFile): number {
  const facts = tagFacts(roster.marines);
  return roster.snapshot.tags.filter((t) => facts.has(t.tag)).length;
}

export const MOST_WANTED = 5;

/** "2026-10-13": the UTC day, which the most-wanted posters turn over on. */
export const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/**
 * Today's most wanted: the rarest tags nobody carries yet, ties broken by FNV-1a of "<UTC day>:<tag>" (callsignSeed),
 * so every visitor sees the same five all day and a new five at 00:00 UTC.
 */
export function mostWanted(roster: RosterFile, now: Date): RosterTag[] {
  const drawn = tagFacts(roster.marines);
  const today = utcDay(now);
  return roster.snapshot.tags
    .filter((t) => !drawn.has(t.tag))
    .map((t) => ({ t, key: callsignSeed(`${today}:${t.tag}`) }))
    .sort((a, b) => a.t.chance - b.t.chance || a.key - b.key || byName(a.t.tag, b.t.tag))
    .slice(0, MOST_WANTED)
    .map(({ t }) => t);
}

export const TICKER_MARINES = 20;

export type TickerItem =
  | { kind: 'legendary'; serial: number; callsign: string; rarerThan: number }
  | { kind: 'recruit'; serial: number; callsign: string; tier: Tier }
  | { kind: 'sighting'; serial: number; tag: string; oneIn: number }
  | { kind: 'stat'; label: string; value: string };

const stat = (label: string, value: string): TickerItem => ({ kind: 'stat', label, value });

function tickerStats(roster: RosterFile): TickerItem[] {
  const seatsLeft = PLANK_SEATS - roster.marines.filter((m) => m.serial <= PLANK_SEATS).length;
  const stats = [
    stat('MARINES', String(roster.marines.length)),
    stat('TAGS DRAWN', `${tagsDrawn(roster)}/${roster.snapshot.tags.length}`),
    stat('LEGENDARIES', String(roster.marines.filter((m) => m.tier === 'legendary').length)),
  ];
  return seatsLeft > 0 ? [...stats, stat('PLANK-OWNER SEATS LEFT', String(seatsLeft))] : stats;
}

/**
 * The ticker's crawl, from the 20 newest Marines: each one's enlistment (a Legendary gets its own line), the rarest
 * tag it discovered if any, and a stat in rotation after every third Marine. With no stat placed, the stats alone.
 */
export function tickerItems(roster: RosterFile): TickerItem[] {
  const facts = tagFacts(roster.marines);
  const chance = new Map(roster.snapshot.tags.map((t) => [t.tag, t.chance]));
  const stats = tickerStats(roster);
  const items: TickerItem[] = [];
  let placed = 0;
  [...roster.marines]
    .sort((a, b) => b.serial - a.serial)
    .slice(0, TICKER_MARINES)
    .forEach((m, i) => {
      items.push(m.tier === 'legendary' ? { kind: 'legendary', serial: m.serial, callsign: m.callsign, rarerThan: rarerThan(m.percentile) } : { kind: 'recruit', serial: m.serial, callsign: m.callsign, tier: m.tier });
      const found = m.tags
        .filter((t) => chance.has(t) && facts.get(t)?.discoverer.serial === m.serial)
        .sort((a, b) => chance.get(a)! - chance.get(b)! || byName(a, b))[0];
      if (found !== undefined) items.push({ kind: 'sighting', serial: m.serial, tag: found, oneIn: callsignsPerTag(chance.get(found)!) });
      if (i % 3 === 2) items.push(stats[placed++ % stats.length]!);
    });
  return placed === 0 ? [...items, ...stats] : items;
}

export type WallOrder = 'rarity' | 'newest';

export interface WallQuery {
  /** A callsign fragment, or a serial as "#7", "7" or "0007". */
  text: string;
  tier: Tier | null;
  /** An exact tag, set by clicking the board or a planet. */
  tag: string | null;
  order: WallOrder;
}

export const ALL_MARINES: WallQuery = { text: '', tier: null, tag: null, order: 'rarity' };

const RARITY: Readonly<Record<Tier, number>> = { legendary: 0, rare: 1, uncommon: 2, common: 3 };

/** The wall's Marines for a query: every filter applies, then rarity (Legendary first) and serial, or newest first. */
export function wallMarines(marines: readonly RosterMarine[], query: WallQuery): RosterMarine[] {
  const text = query.text.trim().toLowerCase();
  const serial = /^#?\d+$/.test(text) ? Number(text.replace('#', '')) : null;
  return marines
    .filter((m) => (query.tier === null || m.tier === query.tier) && (query.tag === null || m.tags.includes(query.tag)) && (text === '' || m.callsign.includes(text) || m.serial === serial))
    .sort(query.order === 'newest' ? (a, b) => b.serial - a.serial : (a, b) => RARITY[a.tier] - RARITY[b.tier] || a.serial - b.serial);
}

export const CONSTELLATION_SIZE = 24;

export interface Planet {
  tag: string;
  carriers: number;
  /** The meme file its discoverer drew for this tag. */
  meme: string;
  /** The tag exists in a single meme: it glows gold. */
  oneMeme: boolean;
}

/** The most-carried tags (ties by name), up to CONSTELLATION_SIZE. */
export function constellation(roster: RosterFile): Planet[] {
  return [...tagFacts(roster.marines)]
    .sort(([a, fa], [b, fb]) => fb.carriers - fa.carriers || byName(a, b))
    .slice(0, CONSTELLATION_SIZE)
    .map(([tag, f]) => {
      const meme = f.discoverer.memes[f.discoverer.tags.indexOf(tag)]!;
      return { tag, carriers: f.carriers, meme: meme.file, oneMeme: meme.count === 1 };
    });
}

export interface MarineTag {
  tag: string;
  file: string;
  count: number;
  carriers: number;
  /** This Marine drew the tag first. */
  discoverer: boolean;
}

/** A Marine's three tags, in draw order, with who else carries each. */
export function marineTags(roster: RosterFile, marine: RosterMarine): MarineTag[] {
  const facts = tagFacts(roster.marines);
  return marine.memes.map((m) => ({ tag: m.tag, file: m.file, count: m.count, carriers: facts.get(m.tag)?.carriers ?? 1, discoverer: facts.get(m.tag)?.discoverer.serial === marine.serial }));
}

/** The hundred plank-owner seats: seat n holds serial n, or null while open. */
export function plankSeats(marines: readonly RosterMarine[]): (RosterMarine | null)[] {
  const bySerial = new Map(marines.map((m) => [m.serial, m]));
  return Array.from({ length: PLANK_SEATS }, (_, i) => bySerial.get(i + 1) ?? null);
}
