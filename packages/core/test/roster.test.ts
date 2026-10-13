import { describe, expect, it } from 'vitest';
import { rarerThan } from '../src/linkmarine';
import { callsignsPerTag, census, rankOf, ranked, ROSTER_SCHEMA, tagBoard, tagFacts } from '../src/roster';
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
