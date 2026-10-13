import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import type { LoreLine } from '../../discord/src/draw';
import type { ArchiveMeme } from '../../discord/src/snapshot';

const IMAGE = /\.(?:jpe?g|png|gif)$/i;

/** The archive's memes: each memes/<stem>.toml with its tags and nsfw flag, and the image file beside it. A toml without an image is skipped. */
export function readArchive(archive: string): ArchiveMeme[] {
  const dir = join(archive, 'memes');
  const names = readdirSync(dir).sort();
  const images = new Map(names.filter((n) => IMAGE.test(n)).map((n) => [n.replace(IMAGE, ''), n]));
  return names
    .filter((n) => n.endsWith('.toml') && !n.startsWith('_'))
    .flatMap((n) => {
      const file = images.get(n.slice(0, -'.toml'.length));
      if (!file) return [];
      const meta = parse(readFileSync(join(dir, n), 'utf8')) as { tags?: unknown; nsfw?: unknown };
      const tags = Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === 'string') : [];
      return [{ file, tags, nsfw: meta.nsfw === true }];
    });
}

/** docs/callsigns/tags.toml's [allowed] tags. */
export function readAllowedTags(text: string): string[] {
  const allowed = (parse(text) as { allowed?: { tags?: unknown } }).allowed?.tags;
  if (!Array.isArray(allowed)) throw new Error('tags.toml: no [allowed] tags');
  return allowed.filter((t): t is string => typeof t === 'string');
}

/** docs/callsigns/lore.toml's [blood] and [faith] lines. */
export function readLore(text: string): { blood: LoreLine[]; faith: LoreLine[] } {
  const toml = parse(text) as Record<string, { lines?: unknown } | undefined>;
  const lines = (name: string): LoreLine[] => {
    const list = toml[name]?.lines;
    if (!Array.isArray(list)) throw new Error(`lore.toml: no [${name}] lines`);
    return list.map((l) => ({ text: String((l as { text?: unknown }).text ?? ''), weight: Number((l as { weight?: unknown }).weight) }));
  };
  return { blood: lines('blood'), faith: lines('faith') };
}

/** git run in one checkout, answering its output. */
export type Git = (args: readonly string[]) => string;

export const gitIn = (dir: string): Git => (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

/**
 * The archive commit to pin: HEAD. Refused while memes/ has changes HEAD lacks (the snapshot would list files GitHub never
 * serves at that commit), or while no remote branch has HEAD (raw.githubusercontent.com would 404 every meme copy).
 */
export function pinnedCommit(git: Git): string {
  if (git(['status', '--porcelain', '--', 'memes']).trim() !== '') throw new Error('the chainlinkmeme checkout has uncommitted changes under memes/: commit and push them (or stash them) first');
  if (git(['branch', '-r', '--contains', 'HEAD']).trim() === '') throw new Error("the chainlinkmeme checkout's HEAD is on no remote branch: push it first");
  return git(['rev-parse', 'HEAD']).trim();
}
