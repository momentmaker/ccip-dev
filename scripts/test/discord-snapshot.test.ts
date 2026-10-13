import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CallsignSnapshot } from '../../discord/src/draw';
import { buildSnapshot, checkSnapshot } from '../../discord/src/snapshot';
import { readAllowedTags, readArchive, readLore } from '../discord/archive';

const ARCHIVE = join(import.meta.dirname, 'fixtures', 'meme-archive');
const ALLOWED = 'tags = ["ignored"]\n[allowed]\ntags = ["sergey", "pepe", "comfy", "painting", "space", "weareallinthistogether"]\n[excluded]\n#  "notallowed",\n';
const LORE = '[blood]\nlines = [{ text = "LINK+", weight = 3 }, { text = "O-LINK", weight = 1 }]\n[faith]\nlines = [{ text = "4IR", weight = 1 }]\n';
const input = { repo: 'momentmaker/chainlinkmeme', sha: 'c0ffee', version: 1, draws: 2000 };

describe('the callsign snapshot', () => {
  it("reads the archive's memes: each toml with the image beside it, skipping the underscore files", () => {
    // #when
    const memes = readArchive(ARCHIVE);
    // #then e.toml has no image
    expect(memes).toEqual([
      { file: 'a.jpeg', tags: ['sergey', 'pepe'], nsfw: false },
      { file: 'b.png', tags: ['sergey'], nsfw: false },
      { file: 'c.gif', tags: ['pepe', 'comfy'], nsfw: true },
      { file: 'd.JPG', tags: ['comfy', 'weareallinthistogether'], nsfw: false },
      { file: 'f.jpeg', tags: ['space', 'notallowed'], nsfw: false },
      { file: 'g.jpeg', tags: ['sergey', 'sergey'], nsfw: false },
    ]);
  });

  it('keeps the allowed tags of 13 characters or fewer that an SFW meme carries, with their SFW files', () => {
    // #when
    const snapshot = buildSnapshot({ ...input, allowed: readAllowedTags(ALLOWED), memes: readArchive(ARCHIVE), lore: readLore(LORE) });
    // #then c.gif is NSFW, painting has no image, weareallinthistogether is too long, notallowed is not allowed
    expect({ tags: snapshot.tags, archive: snapshot.archive, version: snapshot.version, lore: snapshot.lore }).toEqual({
      tags: [
        { tag: 'sergey', count: 3, memes: ['a.jpeg', 'b.png', 'g.jpeg'] },
        { tag: 'comfy', count: 1, memes: ['d.JPG'] },
        { tag: 'pepe', count: 1, memes: ['a.jpeg'] },
        { tag: 'space', count: 1, memes: ['f.jpeg'] },
      ],
      archive: { repo: 'momentmaker/chainlinkmeme', sha: 'c0ffee' },
      version: 1,
      lore: { blood: [{ text: 'LINK+', weight: 3 }, { text: 'O-LINK', weight: 1 }], faith: [{ text: '4IR', weight: 1 }] },
    });
  });

  it('simulates the draws into ascending cut-offs and a 1,001-step table, the same every run', () => {
    // #when
    const build = () => buildSnapshot({ ...input, allowed: readAllowedTags(ALLOWED), memes: readArchive(ARCHIVE), lore: readLore(LORE) });
    const [a, b] = [build(), build()];
    // #then
    expect({
      draws: a.draws,
      table: a.quantiles.length,
      ordered: a.cutoffs.uncommon <= a.cutoffs.rare && a.cutoffs.rare <= a.cutoffs.legendary,
      same: JSON.stringify(a) === JSON.stringify(b),
    }).toEqual({ draws: 2000, table: 1001, ordered: true, same: true });
  });

  it('refuses lore that would not fit the tag and a snapshot with fewer than three tags', () => {
    // #given
    const memes = readArchive(ARCHIVE);
    const allowed = readAllowedTags(ALLOWED);
    const lore = (text: string, weight: number) => ({ blood: [{ text, weight }], faith: [{ text: '4IR', weight: 1 }] });
    // #then
    expect(() => buildSnapshot({ ...input, allowed, memes, lore: lore('link+', 1) })).toThrow('lore.toml: [blood] "link+" must be 1–12 of A–Z, 0–9, + and -');
    expect(() => buildSnapshot({ ...input, allowed, memes, lore: lore('FUNDAMENTALLY', 1) })).toThrow('must be 1–12');
    expect(() => buildSnapshot({ ...input, allowed, memes, lore: lore('LINK+', 0) })).toThrow('needs a positive whole weight');
    expect(() => buildSnapshot({ ...input, allowed: ['sergey', 'pepe'], memes, lore: readLore(LORE) })).toThrow('only 2 allowed tags have an SFW meme; a callsign needs 3');
  });

  it("reads the repository's own tags.toml and lore.toml", () => {
    // #when
    const docs = join(import.meta.dirname, '..', '..', 'docs', 'callsigns');
    const allowed = readAllowedTags(readFileSync(join(docs, 'tags.toml'), 'utf8'));
    const lore = readLore(readFileSync(join(docs, 'lore.toml'), 'utf8'));
    // #then
    expect({ allowed: allowed.length, lore }).toEqual({
      allowed: 260,
      lore: {
        blood: [{ text: 'LINK+', weight: 60 }, { text: 'O-LINK', weight: 30 }, { text: '7777777', weight: 10 }],
        faith: [{ text: '4IR', weight: 40 }, { text: 'SERGEY', weight: 30 }, { text: 'STAKING', weight: 20 }, { text: 'FUNDAMENTALS', weight: 10 }],
      },
    });
  });
});

describe('checkSnapshot, the generator guard', () => {
  const good: CallsignSnapshot = {
    version: 1,
    archive: { repo: 'r', sha: 's' },
    tags: [
      { tag: 'a', count: 1, memes: ['a.png'] },
      { tag: 'b', count: 1, memes: ['b.png'] },
      { tag: 'c', count: 1, memes: ['c.png'] },
    ],
    lore: { blood: [{ text: 'LINK+', weight: 1 }], faith: [{ text: '4IR', weight: 1 }] },
    cutoffs: { uncommon: 1, rare: 2, legendary: 3 },
    quantiles: [],
    draws: 10,
  };

  it('passes a snapshot with strictly rising cut-offs, three tags and a meme for every tag', () => {
    // #then
    expect(() => checkSnapshot(good)).not.toThrow();
  });

  it('fails loudly when two cut-offs meet, because a tier would vanish', () => {
    // #given
    const flat = { ...good, cutoffs: { uncommon: 1, rare: 2, legendary: 2 } };
    // #then
    expect(() => checkSnapshot(flat)).toThrow('cut-offs must strictly increase');
  });

  it('fails when the snapshot holds fewer than three tags', () => {
    // #given
    const two = { ...good, tags: good.tags.slice(0, 2) };
    // #then
    expect(() => checkSnapshot(two)).toThrow('at least 3 tags');
  });

  it('fails when a tag has no SFW meme', () => {
    // #given
    const empty = { ...good, tags: [...good.tags.slice(0, 2), { tag: 'c', count: 0, memes: [] }] };
    // #then
    expect(() => checkSnapshot(empty)).toThrow('tag "c" has no SFW meme');
  });
});
