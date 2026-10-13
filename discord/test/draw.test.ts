import { seededRandom } from '@ccip-dev/core/linkmarine';
import { describe, expect, it } from 'vitest';
import { cutAt, drawCallsign, drawLore, drawTags, percentileOf, pickMemes, scoreOf, simulate, tagChances, tagKey, tierOf } from '../src/draw';
import { SNAPSHOT } from './helpers';

const TAGS = [
  { tag: 'big', count: 400 },
  { tag: 'mid', count: 100 },
  { tag: 'small', count: 25 },
  { tag: 'one', count: 1 },
];

describe('the draw', () => {
  it('draws each tag with weight √count: 20:10:5:1 here', () => {
    // #given
    const random = seededRandom(1);
    const firsts = new Map<string, number>();
    // #when
    for (let i = 0; i < 36_000; i++) {
      const [first] = drawTags(TAGS, random);
      firsts.set(first, (firsts.get(first) ?? 0) + 1);
    }
    // #then within 5% of 20,000, 10,000, 5,000 and 1,000
    const expected = { big: 20_000, mid: 10_000, small: 5_000, one: 1_000 };
    expect(Object.entries(expected).every(([tag, n]) => Math.abs(firsts.get(tag)! - n) < n * 0.05)).toBe(true);
  });

  it('draws three different tags, in draw order', () => {
    // #when
    const random = seededRandom(2);
    const draws = Array.from({ length: 2000 }, () => drawTags(TAGS, random));
    // #then
    expect(draws.every((d) => new Set(d).size === 3)).toBe(true);
  });

  it('scores −Σ ln(chance), the same in any order, and keys the tags sorted', () => {
    // #given chances 20/36, 10/36, 5/36, 1/36
    const chances = tagChances(TAGS);
    // #when
    const scores = [scoreOf(['big', 'mid', 'one'], chances), scoreOf(['one', 'big', 'mid'], chances)];
    // #then
    expect({ score: scores[0], same: scores[0] === scores[1], key: tagKey(['one', 'big', 'mid']) }).toEqual({
      score: Math.round(-(Math.log(20 / 36) + Math.log(10 / 36) + Math.log(1 / 36)) * 1e6) / 1e6,
      same: true,
      key: 'big-mid-one',
    });
  });

  it('cuts the simulated scores at 60/85/97% into tiers, and reads a percentile off the table', () => {
    // #given thirty tags, so that three of them make many different scores
    const sim = simulate(Array.from({ length: 30 }, (_, i) => ({ tag: `t${i}`, count: i + 1 })), 10_000, 3);
    // #when
    const tiers = [sim.quantiles[100]!, sim.quantiles[700]!, sim.quantiles[900]!, sim.quantiles[990]!].map((s) => tierOf(s, sim.cutoffs));
    const atCuts = [sim.cutoffs.uncommon, sim.cutoffs.rare, sim.cutoffs.legendary].map((s) => tierOf(s, sim.cutoffs));
    // #then
    expect({
      tiers,
      atCuts,
      table: sim.quantiles.length,
      ascending: sim.quantiles.every((q, i) => i === 0 || q >= sim.quantiles[i - 1]!),
      percentiles: [percentileOf(sim.quantiles[0]! - 1, sim.quantiles), percentileOf(sim.quantiles[1000]! + 1, sim.quantiles)],
    }).toEqual({ tiers: ['common', 'uncommon', 'rare', 'legendary'], atCuts: ['uncommon', 'rare', 'legendary'], table: 1001, ascending: true, percentiles: [0, 100] });
  });

  it('puts a cut-off between steps of equal scores, on the side nearer the share', () => {
    // #given half the draws score 1, a third 2 and a sixth 3
    const sorted = Float64Array.from([1, 1, 1, 2, 2, 3]);
    // #when
    const cuts = [0.1, 0.4, 0.5, 0.9, 0.99].map((below) => cutAt(sorted, below));
    // #then 40% below lands nearer the 50% of the 1s than the 0% before them
    expect(cuts).toEqual([1, 2, 2, 3, 3]);
  });

  it('draws lore by weight: a weight of 1 against 9 comes up about a tenth of the time', () => {
    // #given
    const random = seededRandom(4);
    const lines = [{ text: 'LINK+', weight: 9 }, { text: '7777777', weight: 1 }];
    // #when
    const rare = Array.from({ length: 10_000 }, () => drawLore(lines, random)).filter((t) => t === '7777777').length;
    // #then
    expect(Math.abs(rare - 1000) < 100).toBe(true);
  });

  it('picks one meme per tag from the callsign alone, and not the same file twice when the tag has another', () => {
    // #when painting's only meme is shared.gif, which pepe also carries
    const picks = [pickMemes(SNAPSHOT, ['painting', 'pepe', 'space'], 'painting-pepe-space'), pickMemes(SNAPSHOT, ['painting', 'pepe', 'space'], 'painting-pepe-space')];
    // #then
    expect({ same: picks[0]!.join() === picks[1]!.join(), files: picks[0] }).toEqual({ same: true, files: ['shared.gif', 'p1.jpeg', 'sp1.jpeg'] });
  });

  it('draws a whole callsign: tags joined by hyphens, its key, score, tier and percentile', () => {
    // #when
    const draw = drawCallsign(SNAPSHOT, seededRandom(5));
    // #then
    expect({
      callsign: draw.callsign === draw.tags.join('-'),
      key: draw.tagKey === [...draw.tags].sort().join('-'),
      tier: draw.tier === tierOf(draw.score, SNAPSHOT.cutoffs),
      percentile: draw.percentile === percentileOf(draw.score, SNAPSHOT.quantiles),
    }).toEqual({ callsign: true, key: true, tier: true, percentile: true });
  });
});
