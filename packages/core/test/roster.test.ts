import { describe, expect, it } from 'vitest';
import { rarerThan } from '../src/linkmarine';
import { ALL_MARINES, callsignsPerTag, census, constellation, marineTags, mostWanted, plankSeats, rankOf, ranked, ROSTER_SCHEMA, tagBoard, tagFacts, tagsDrawn, tickerItems, wallMarines } from '../src/roster';
import { ROSTER_FIXTURE } from '../src/testing';

const serials = (marines: { serial: number }[]) => marines.map((m) => m.serial);

describe('the roster file', () => {
  it('accepts the fixture as a version 1 roster', () => {
    // #then
    expect(ROSTER_SCHEMA.safeParse(ROSTER_FIXTURE).success).toBe(true);
  });

  it('refuses a Marine carrying any field beyond the allowlist, such as a display name', () => {
    // #given a Marine with a leaked name
    const leaked = { ...ROSTER_FIXTURE, marines: [{ ...ROSTER_FIXTURE.marines[0]!, displayName: 'moment maker' }] };
    // #then
    expect(ROSTER_SCHEMA.safeParse(leaked).success).toBe(false);
  });

  it('refuses an enlistment that is not a bare UTC date', () => {
    // #given an enlistment time
    const timed = { ...ROSTER_FIXTURE, marines: [{ ...ROSTER_FIXTURE.marines[0]!, enlisted: '2026-10-13T10:40:00.000Z' }] };
    // #then
    expect(ROSTER_SCHEMA.safeParse(timed).success).toBe(false);
  });
});

describe('tag facts', () => {
  it(`counts each drawn tag's carriers and credits the lowest serial as its discoverer`, () => {
    // #when
    const facts = tagFacts(ROSTER_FIXTURE.marines);
    // #then
    expect([...facts].map(([tag, f]) => [tag, f.carriers, f.discoverer.serial])).toEqual([
      ['sergey', 3, 1],
      ['pepe', 2, 1],
      ['comfy', 2, 1],
      ['painting', 2, 2],
      ['space', 1, 2],
      ['prophecy', 2, 2],
    ]);
  });

  it('credits the discoverer by serial, whatever order the Marines arrive in', () => {
    // #when
    const facts = tagFacts([...ROSTER_FIXTURE.marines].reverse());
    // #then
    expect(facts.get('painting')!.discoverer.serial).toBe(2);
  });

  it('puts about 1 in N callsigns on a tag, from its per-pick chance', () => {
    // #then
    expect([0.4, 0.2, 0.1, 0.05].map(callsignsPerTag)).toEqual([1, 2, 4, 7]);
  });
});

describe('ranking', () => {
  it('orders by score, rarest first', () => {
    // #then
    expect(serials(ranked(ROSTER_FIXTURE.marines))).toEqual([2, 4, 3, 1]);
  });

  it('breaks a tied score by the lower serial', () => {
    // #given two Marines on the same score
    const tied = ROSTER_FIXTURE.marines.map((m) => ({ ...m, score: 15 }));
    // #then
    expect(serials(ranked(tied))).toEqual([1, 2, 3, 4]);
  });

  it('gives a Marine its 1-based rank, and null for a serial not on the roster', () => {
    // #then
    expect([rankOf(ROSTER_FIXTURE.marines, 4), rankOf(ROSTER_FIXTURE.marines, 99)]).toEqual([2, null]);
  });

  it('says "rarer than N" for N from 0 to 99, as the card does', () => {
    // #then
    expect([0.4, 31.5, 97.9, 100].map(rarerThan)).toEqual([0, 31, 97, 99]);
  });
});

describe('the census', () => {
  it('counts each tier rarest first, beside the 3/12/25/60 odds', () => {
    // #then
    expect(census(ROSTER_FIXTURE.marines)).toEqual([
      { tier: 'legendary', count: 1, sharePct: 25, expectedPct: 3 },
      { tier: 'rare', count: 1, sharePct: 25, expectedPct: 12 },
      { tier: 'uncommon', count: 1, sharePct: 25, expectedPct: 25 },
      { tier: 'common', count: 1, sharePct: 25, expectedPct: 60 },
    ]);
  });

  it('shares nothing out on an empty roster', () => {
    // #then
    expect(census([]).map((t) => t.sharePct)).toEqual([0, 0, 0, 0]);
  });
});

describe('the tag board', () => {
  it(`lists every snapshot tag commonest first, ties by name, with its carriers and discoverer`, () => {
    // #when
    const board = tagBoard(ROSTER_FIXTURE);
    // #then
    expect(board.map((t) => [t.tag, t.carriers, t.discoverer?.serial ?? null])).toEqual([
      ['sergey', 3, 1],
      ['pepe', 2, 1],
      ['comfy', 2, 1],
      ['prophecy', 2, 2],
      ['painting', 2, 2],
      ['samurai', 0, null],
      ['space', 1, 2],
      ['zoomer', 0, null],
    ]);
  });

  it(`leaves out a tag a Marine carries but the current snapshot lacks`, () => {
    // #given a Marine from an older snapshot carrying "ghost"
    const old = { ...ROSTER_FIXTURE.marines[0]!, serial: 5, tags: ['ghost', 'pepe', 'comfy'] as [string, string, string] };
    // #when
    const board = tagBoard({ ...ROSTER_FIXTURE, marines: [...ROSTER_FIXTURE.marines, old] });
    // #then
    expect(board.map((t) => t.tag)).not.toContain('ghost');
  });
});

describe('tags drawn', () => {
  it('counts snapshot tags carried by at least one Marine, excluding old snapshot tags', () => {
    // #then
    expect(tagsDrawn(ROSTER_FIXTURE)).toBe(6);
  });

  it('excludes snapshot tags not carried and counts only snapshot tags even if a Marine carries old ones', () => {
    // #given the only Marine carries an old "ghost" tag not in the snapshot
    const ghost = { ...ROSTER_FIXTURE, marines: [{ ...ROSTER_FIXTURE.marines[0]!, tags: ['ghost', 'zoomer', 'samurai'] as [string, string, string] }] };
    // #then
    expect(tagsDrawn(ghost)).toBe(2);
  });

  it('reflects tags drawn correctly in the ticker stat', () => {
    // #given the only Marine carries "ghost" not in the snapshot, plus two snapshot tags
    const ghost = { ...ROSTER_FIXTURE, marines: [{ ...ROSTER_FIXTURE.marines[0]!, tags: ['ghost', 'zoomer', 'samurai'] as [string, string, string] }] };
    // #when
    const ticker = tickerItems(ghost);
    // #then the TAGS DRAWN stat should be 2/8, not 3/8
    const tagStat = ticker.find((i) => i.kind === 'stat' && i.label === 'TAGS DRAWN');
    expect(tagStat).toEqual({ kind: 'stat', label: 'TAGS DRAWN', value: '2/8' });
  });
});

const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const empty = { ...ROSTER_FIXTURE, marines: [] };

describe("today's most wanted", () => {
  it('posts the rarest undrawn tags, five at most', () => {
    // #then only zoomer and samurai are undrawn in the fixture
    expect(mostWanted(ROSTER_FIXTURE, day('2026-10-13')).map((t) => t.tag)).toEqual(['zoomer', 'samurai']);
  });

  it('breaks ties at equal odds by a hash of the UTC day, so the five change at midnight', () => {
    // #when nothing is drawn: four one-meme tags tie at 0.05, then comfy and prophecy at 0.1
    const picks = ['2026-10-13', '2026-10-14'].map((d) => mostWanted(empty, day(d)).map((t) => t.tag));
    // #then
    expect(picks).toEqual([
      ['space', 'zoomer', 'samurai', 'painting', 'comfy'],
      ['zoomer', 'painting', 'samurai', 'space', 'prophecy'],
    ]);
  });

  it('keeps the same five all day', () => {
    // #then
    expect(mostWanted(empty, new Date('2026-10-13T00:00:01.000Z'))).toEqual(mostWanted(empty, new Date('2026-10-13T23:59:59.000Z')));
  });
});

describe('the ticker', () => {
  it('runs newest first: recruits, a Legendary, first sightings, and a stat after every third Marine', () => {
    // #then
    expect(tickerItems(ROSTER_FIXTURE)).toEqual([
      { kind: 'recruit', serial: 4, callsign: 'comfy-painting-sergey', tier: 'rare' },
      { kind: 'recruit', serial: 3, callsign: 'pepe-sergey-prophecy', tier: 'uncommon' },
      { kind: 'legendary', serial: 2, callsign: 'painting-space-prophecy', rarerThan: 97 },
      { kind: 'sighting', serial: 2, tag: 'painting', oneIn: 7 },
      { kind: 'stat', label: 'MARINES', value: '4' },
      { kind: 'recruit', serial: 1, callsign: 'sergey-pepe-comfy', tier: 'common' },
      { kind: 'sighting', serial: 1, tag: 'comfy', oneIn: 4 },
    ]);
  });

  it('shows only the stats on an empty roster, the plank-owner seats included', () => {
    // #then
    expect(tickerItems(empty)).toEqual([
      { kind: 'stat', label: 'MARINES', value: '0' },
      { kind: 'stat', label: 'TAGS DRAWN', value: '0/8' },
      { kind: 'stat', label: 'LEGENDARIES', value: '0' },
      { kind: 'stat', label: 'PLANK-OWNER SEATS LEFT', value: '100' },
    ]);
  });

  it('drops the seats stat once all 100 are taken', () => {
    // #given 100 Marines
    const full = { ...ROSTER_FIXTURE, marines: Array.from({ length: 100 }, (_, i) => ({ ...ROSTER_FIXTURE.marines[0]!, serial: i + 1 })) };
    // #then
    expect(tickerItems(full).filter((i) => i.kind === 'stat').map((i) => (i.kind === 'stat' ? i.label : ''))).not.toContain('PLANK-OWNER SEATS LEFT');
  });

  it('skips a first sighting for a tag the snapshot lacks', () => {
    // #given the only Marine carries "ghost", not in the snapshot
    const ghost = { ...ROSTER_FIXTURE, marines: [{ ...ROSTER_FIXTURE.marines[0]!, tags: ['ghost', 'zoomer', 'samurai'] as [string, string, string] }] };
    // #when
    const sightings = tickerItems(ghost).filter((i) => i.kind === 'sighting');
    // #then the rarest known tag it discovered is named, never ghost
    expect(sightings).toEqual([{ kind: 'sighting', serial: 1, tag: 'samurai', oneIn: 7 }]);
  });
});

describe('the wall', () => {
  const find = (query: Partial<typeof ALL_MARINES>) => serials(wallMarines(ROSTER_FIXTURE.marines, { ...ALL_MARINES, ...query }));

  it('orders by rarity, then serial; NEWEST by serial descending', () => {
    // #then
    expect([find({}), find({ order: 'newest' })]).toEqual([
      [2, 4, 3, 1],
      [4, 3, 2, 1],
    ]);
  });

  it('matches part of a callsign, ignoring case and outer spaces', () => {
    // #then
    expect([find({ text: 'sergey' }), find({ text: ' SERGEY ' }), find({ text: 'paint' })]).toEqual([
      [4, 3, 1],
      [4, 3, 1],
      [2, 4],
    ]);
  });

  it('finds a serial typed as #2, 2 or 0002, and digits inside a callsign too (so 2 also finds 216-judges-butter)', () => {
    // #given a Marine whose callsign holds digits
    const digits = [...ROSTER_FIXTURE.marines, { ...ROSTER_FIXTURE.marines[0]!, serial: 5, callsign: '216-judges-butter' }];
    const q = (text: string) => serials(wallMarines(digits, { ...ALL_MARINES, text }));
    // #then
    expect([q('#2'), q('2'), q('0002'), q('216')]).toEqual([[2], [2, 5], [2], [5]]);
  });

  it('filters by tier and by an exact tag', () => {
    // #then
    expect([find({ tier: 'common' }), find({ tag: 'painting' }), find({ tag: 'paint' })]).toEqual([[1], [2, 4], []]);
  });
});

describe('the constellation', () => {
  it("picks the most-carried tags, ties by name, each showing its discoverer's meme", () => {
    // #then
    expect(constellation(ROSTER_FIXTURE)).toEqual([
      { tag: 'sergey', carriers: 3, meme: 'sergey.jpeg', oneMeme: false },
      { tag: 'comfy', carriers: 2, meme: 'comfy.jpeg', oneMeme: false },
      { tag: 'painting', carriers: 2, meme: 'painting.jpeg', oneMeme: true },
      { tag: 'pepe', carriers: 2, meme: 'pepe.jpeg', oneMeme: false },
      { tag: 'prophecy', carriers: 2, meme: 'prophecy.jpeg', oneMeme: false },
      { tag: 'space', carriers: 1, meme: 'space.jpeg', oneMeme: true },
    ]);
  });
});

describe("a Marine's tags", () => {
  it("says who else carries each tag and which ones this Marine discovered", () => {
    // #then
    expect([marineTags(ROSTER_FIXTURE, ROSTER_FIXTURE.marines[1]!), marineTags(ROSTER_FIXTURE, ROSTER_FIXTURE.marines[3]!)]).toEqual([
      [
        { tag: 'painting', file: 'painting.jpeg', count: 1, carriers: 2, discoverer: true },
        { tag: 'space', file: 'space.jpeg', count: 1, carriers: 1, discoverer: true },
        { tag: 'prophecy', file: 'prophecy.jpeg', count: 3, carriers: 2, discoverer: true },
      ],
      [
        { tag: 'comfy', file: 'comfy.jpeg', count: 25, carriers: 2, discoverer: false },
        { tag: 'painting', file: 'painting.jpeg', count: 1, carriers: 2, discoverer: false },
        { tag: 'sergey', file: 'sergey.jpeg', count: 400, carriers: 3, discoverer: false },
      ],
    ]);
  });
});

describe('the plank owners', () => {
  it('seats serial n in seat n, and leaves the rest of the hundred open', () => {
    // #when
    const seats = plankSeats(ROSTER_FIXTURE.marines);
    // #then
    expect({ size: seats.length, taken: seats.slice(0, 5).map((m) => m?.serial ?? null) }).toEqual({ size: 100, taken: [1, 2, 3, 4, null] });
  });
});
