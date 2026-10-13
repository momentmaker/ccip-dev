import { z } from 'zod';
import { TIER_SHARE_PCT, TIERS, type Tier } from './linkmarine';

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
