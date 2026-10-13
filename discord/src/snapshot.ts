import { simulate, type CallsignSnapshot, type LoreLine } from './draw';

export const SIMULATED_DRAWS = 200_000;
/** The simulation's fixed seed, so the same archive always gives the same snapshot. */
export const SIMULATION_SEED = 0x4c4d;
export const MAX_TAG_LENGTH = 13;
/** The longest lore line that still fits the front tag's lore row beside the date. */
export const MAX_LORE_LENGTH = 12;
const LORE_TEXT = /^[A-Z0-9+\-]+$/;

export interface ArchiveMeme {
  file: string;
  tags: readonly string[];
  nsfw: boolean;
}

export interface SnapshotInput {
  allowed: readonly string[];
  memes: readonly ArchiveMeme[];
  lore: { blood: readonly LoreLine[]; faith: readonly LoreLine[] };
  repo: string;
  sha: string;
  version: number;
  draws?: number;
}

function checkLore(name: string, lines: readonly LoreLine[]): LoreLine[] {
  if (lines.length === 0) throw new Error(`lore.toml: [${name}] has no lines`);
  for (const l of lines) {
    if (!LORE_TEXT.test(l.text) || l.text.length > MAX_LORE_LENGTH) throw new Error(`lore.toml: [${name}] "${l.text}" must be 1–${MAX_LORE_LENGTH} of A–Z, 0–9, + and -`);
    if (!Number.isInteger(l.weight) || l.weight <= 0) throw new Error(`lore.toml: [${name}] "${l.text}" needs a positive whole weight`);
  }
  return lines.map((l) => ({ text: l.text, weight: l.weight }));
}

/**
 * The callsign snapshot: the allowed tags of 13 characters or fewer that some SFW meme carries, each with its SFW meme
 * files (sorted), the lore, and the cut-offs and percentile table from SIMULATED_DRAWS seeded draws.
 */
export function buildSnapshot(input: SnapshotInput): CallsignSnapshot {
  const allowed = new Set(input.allowed.filter((t) => t.length <= MAX_TAG_LENGTH));
  const files = new Map<string, string[]>();
  for (const meme of input.memes) {
    if (meme.nsfw) continue;
    for (const tag of new Set(meme.tags)) {
      if (!allowed.has(tag)) continue;
      files.set(tag, [...(files.get(tag) ?? []), meme.file]);
    }
  }
  const tags = [...files]
    .map(([tag, memes]) => ({ tag, count: memes.length, memes: [...memes].sort() }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1));
  if (tags.length < 3) throw new Error(`only ${tags.length} allowed tags have an SFW meme; a callsign needs 3`);
  return {
    version: input.version,
    archive: { repo: input.repo, sha: input.sha },
    tags,
    lore: { blood: checkLore('blood', input.lore.blood), faith: checkLore('faith', input.lore.faith) },
    ...simulate(tags, input.draws ?? SIMULATED_DRAWS, SIMULATION_SEED),
  };
}

/**
 * The generator's guard on a real snapshot, kept apart from buildSnapshot because a tiny fixture archive has too few
 * distinct scores to separate the tiers. Fails loudly rather than ship odds where a tier can never be drawn.
 */
export function checkSnapshot(snapshot: CallsignSnapshot): void {
  if (snapshot.tags.length < 3) throw new Error(`snapshot needs at least 3 tags, has ${snapshot.tags.length}`);
  for (const t of snapshot.tags) if (t.memes.length < 1) throw new Error(`snapshot tag "${t.tag}" has no SFW meme`);
  const { uncommon, rare, legendary } = snapshot.cutoffs;
  if (!(uncommon < rare && rare < legendary)) throw new Error(`snapshot cut-offs must strictly increase, got ${uncommon} / ${rare} / ${legendary}: a tier would vanish`);
}
