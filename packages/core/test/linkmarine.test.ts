import { describe, expect, it } from 'vitest';
import { callsignSeed, filledPips, hasGlint, rimText, RIM_PHRASES, seededRandom, serialText, TIER_SHARE_PCT, TIERS, tierTopPct } from '../src/linkmarine';

describe('LinkMarine tiers', () => {
  it('shares the draws 60/25/12/3 and prints the share at the tier or rarer', () => {
    // #when
    const known = {
      shares: TIERS.map((t) => TIER_SHARE_PCT[t]),
      top: TIERS.map(tierTopPct),
      glint: TIERS.map(hasGlint),
    };
    // #then
    expect(known).toEqual({ shares: [60, 25, 12, 3], top: [null, 40, 15, 3], glint: [false, false, true, true] });
  });

  it('fills three pips for a tag on one meme and none from fifty', () => {
    // #when
    const pips = [1, 2, 9, 10, 49, 50, 649].map(filledPips);
    // #then
    expect(pips).toEqual([3, 2, 2, 1, 1, 0, 0]);
  });
});

describe('LinkMarine seeds', () => {
  it('seeds from the callsign with FNV-1a, the same on every run', () => {
    // #when
    const seeds = [callsignSeed(''), callsignSeed('a'), callsignSeed('painting-space-prophecy') === callsignSeed('painting-space-prophecy')];
    // #then the published FNV-1a 32-bit vectors
    expect(seeds).toEqual([0x811c9dc5, 0xe40c292c, true]);
  });

  it('draws the same sequence from the same seed, in [0, 1)', () => {
    // #when
    const a = seededRandom(7);
    const b = seededRandom(7);
    const draws = Array.from({ length: 200 }, () => [a(), b()]);
    // #then
    expect({ same: draws.every(([x, y]) => x === y), inRange: draws.every(([x]) => x! >= 0 && x! < 1) }).toEqual({ same: true, inRange: true });
  });

  it('writes the rim with every phrase twice, in an order the seed picks', () => {
    // #when
    const rims = [rimText(1), rimText(2), rimText(1)];
    const phrases = rims[0]!.split(' · ');
    // #then
    expect({
      count: phrases.length,
      each: RIM_PHRASES.every((p) => phrases.filter((x) => x === p).length === 2),
      repeat: phrases.slice(0, 5).join() === phrases.slice(5).join(),
      stable: rims[0] === rims[2],
      seeded: rims[0] !== rims[1],
    }).toEqual({ count: 10, each: true, repeat: true, stable: true, seeded: true });
  });

  it('cuts the rim to whole phrases within a character budget, in the same order', () => {
    // #given a seed and a budget that falls inside a phrase of the full rim
    const full = rimText(1);
    const maxChars = 40;
    // #when
    const rim = rimText(1, maxChars);
    // #then
    const phrases = rim.split(' · ');
    expect({
      fits: rim.length <= maxChars,
      whole: phrases.every((p) => (RIM_PHRASES as readonly string[]).includes(p)),
      sameOrder: full.startsWith(rim),
      full: phrases.length >= 2,
      none: rimText(1, 2),
    }).toEqual({ fits: true, whole: true, sameOrder: true, full: true, none: '' });
  });

  it('repeats the phrases when the budget outruns one round', () => {
    // #when
    const rim = rimText(1, 200);
    // #then
    expect({ fits: rim.length <= 200, repeats: rim.split(' · ').length > 10 }).toEqual({ fits: true, repeats: true });
  });

  it('pads a serial to four digits', () => {
    // #then
    expect([serialText(7), serialText(1234), serialText(12345)]).toEqual(['0007', '1234', '12345']);
  });
});
