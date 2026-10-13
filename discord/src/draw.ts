import { callsignSeed, seededRandom, type Tier } from '@ccip-dev/core/linkmarine';

/** The committed snapshot the draw reads (discord/src/data/callsigns.json, written by pnpm discord:snapshot). */
export interface CallsignSnapshot {
  version: number;
  archive: { repo: string; sha: string };
  /** Allowed tags with at least one SFW meme: their count and their SFW meme files. */
  tags: { tag: string; count: number; memes: string[] }[];
  lore: { blood: LoreLine[]; faith: LoreLine[] };
  /** Scores at the 60th, 85th and 97th percentiles of the simulated draws: where Uncommon, Rare and Legendary start. */
  cutoffs: { uncommon: number; rare: number; legendary: number };
  /** Simulated scores at every 0.1% (1,001 values, ascending): the percentile table. */
  quantiles: number[];
  draws: number;
}

export interface LoreLine {
  text: string;
  weight: number;
}

export interface Draw {
  tags: [string, string, string];
  callsign: string;
  tagKey: string;
  score: number;
  tier: Tier;
  percentile: number;
}

export const MAX_CLASHES = 20;
/** The share of draws below each tier's cut-off: 60% Common, then 25% Uncommon, 12% Rare and 3% Legendary. */
export const TIER_CUTS = { uncommon: 0.6, rare: 0.85, legendary: 0.97 } as const;

/** Each tag's chance in one draw: √count over the sum of √counts (docs/callsigns/rules.md). */
export function tagChances(tags: readonly { tag: string; count: number }[]): Map<string, number> {
  const total = tags.reduce((s, t) => s + Math.sqrt(t.count), 0);
  return new Map(tags.map((t) => [t.tag, Math.sqrt(t.count) / total]));
}

/** Three different tags, each drawn with weight √count from those left, in draw order. */
export function drawTags(tags: readonly { tag: string; count: number }[], random: () => number): [string, string, string] {
  const pool = tags.map((t) => ({ tag: t.tag, weight: Math.sqrt(t.count) }));
  const picked: string[] = [];
  while (picked.length < 3) {
    const total = pool.reduce((s, t) => s + t.weight, 0);
    let roll = random() * total;
    let i = 0;
    while (i < pool.length - 1 && roll >= pool[i]!.weight) roll -= pool[i++]!.weight;
    picked.push(pool[i]!.tag);
    pool.splice(i, 1);
  }
  return picked as [string, string, string];
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * How surprising the three tags are together: the sum of −ln(chance), to 6 decimals like the cut-offs. Summed in tag
 * order, so the same three tags score exactly the same whatever order they were drawn in.
 */
export function scoreOf(tags: readonly string[], chances: ReadonlyMap<string, number>): number {
  return round6([...tags].sort().reduce((s, t) => s - Math.log(chances.get(t)!), 0));
}

/** A score equal to a cut-off takes the rarer tier. */
export function tierOf(score: number, cutoffs: CallsignSnapshot['cutoffs']): Tier {
  if (score >= cutoffs.legendary) return 'legendary';
  if (score >= cutoffs.rare) return 'rare';
  if (score >= cutoffs.uncommon) return 'uncommon';
  return 'common';
}

/** The share of simulated draws that scored below `score`, in percent, to the table's 0.1%. */
export function percentileOf(score: number, quantiles: readonly number[]): number {
  let below = 0;
  while (below < quantiles.length && quantiles[below]! < score) below++;
  return Math.min(100, (Math.max(0, below - 1) * 100) / (quantiles.length - 1));
}

export const tagKey = (tags: readonly string[]) => [...tags].sort().join('-');

export function drawCallsign(snapshot: CallsignSnapshot, random: () => number): Draw {
  const tags = drawTags(snapshot.tags, random);
  const score = scoreOf(tags, tagChances(snapshot.tags));
  return { tags, callsign: tags.join('-'), tagKey: tagKey(tags), score, tier: tierOf(score, snapshot.cutoffs), percentile: percentileOf(score, snapshot.quantiles) };
}

/** A lore line by weight. */
export function drawLore(lines: readonly LoreLine[], random: () => number): string {
  const total = lines.reduce((s, l) => s + l.weight, 0);
  let roll = random() * total;
  for (const line of lines) {
    if (roll < line.weight) return line.text;
    roll -= line.weight;
  }
  return lines.at(-1)!.text;
}

/** One meme file per tag, picked by the callsign's own generator; a file another tag already took is passed over when the tag has others. */
export function pickMemes(snapshot: CallsignSnapshot, tags: readonly string[], callsign: string): string[] {
  const random = seededRandom(callsignSeed(callsign));
  const taken = new Set<string>();
  return tags.map((tag) => {
    const files = snapshot.tags.find((t) => t.tag === tag)?.memes ?? [];
    const fresh = files.filter((f) => !taken.has(f));
    const pool = fresh.length > 0 ? fresh : files;
    const file = pool[Math.floor(random() * pool.length)]!;
    taken.add(file);
    return file;
  });
}

/**
 * The cut-off whose share of draws scoring below it is nearest `below`. Scores come in steps (three tags of one meme
 * each always score the same), so a step that straddles the share goes wholly to whichever side lands nearer.
 */
export function cutAt(sorted: Float64Array, below: number): number {
  const n = sorted.length;
  const value = sorted[Math.min(n - 1, Math.floor(below * n))]!;
  let first = 0;
  while (sorted[first]! < value) first++;
  let next = first;
  while (next < n && sorted[next] === value) next++;
  if (next === n) return value;
  return Math.abs(first / n - below) <= Math.abs(next / n - below) ? value : sorted[next]!;
}

/** Seeded draws (200,000 for the snapshot, as rules.md says): the tier cut-offs and the percentile table. */
export function simulate(tags: readonly { tag: string; count: number }[], draws: number, seed: number): Pick<CallsignSnapshot, 'cutoffs' | 'quantiles' | 'draws'> {
  const random = seededRandom(seed);
  const chances = tagChances(tags);
  const scores = Float64Array.from({ length: draws }, () => scoreOf(drawTags(tags, random), chances)).sort();
  const at = (share: number) => scores[Math.min(draws - 1, Math.floor(share * draws))]!;
  return {
    cutoffs: { uncommon: cutAt(scores, TIER_CUTS.uncommon), rare: cutAt(scores, TIER_CUTS.rare), legendary: cutAt(scores, TIER_CUTS.legendary) },
    quantiles: Array.from({ length: 1001 }, (_, i) => at(i / 1000)),
    draws,
  };
}

/** Randomness for the draw itself: crypto.getRandomValues, in [0, 1). */
export function cryptoRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 4294967296;
}
