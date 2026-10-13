import { RIM_PHRASES, TIERS } from '@ccip-dev/core/linkmarine';
import { describe, expect, it } from 'vitest';
import { cardName, BACK_TAG, FRONT_TAG, loreRows, loreSize, marineTree, onTag, webCardOf, RIM_BUDGET, skyChoices } from '../worker/linkmarine/marine-card';
import { DRAWABLE_TEXT, MARINES, marine, webMarine } from './fixtures/linkmarine';
import { texts } from './fixtures/broadcast';

const PNG = new Uint8Array([137, 80, 78, 71]);

describe('the dog tag card', () => {
  it('stamps the callsign, the lore, the odds and the planets as the mockup does', () => {
    // #when
    const words = texts(marineTree(marine('legendary', [PNG])));
    // #then
    expect(words).toEqual(
      expect.arrayContaining([
        'momentmaker', 'LEGENDARY', 'top 3% · rarer than 97 in 100 Marines', 'PAINTING', 'SPACE', 'PROPHECY', 'LM 0007 · BLOOD LINK+', 'FAITH 4IR · 13 OCT 2026',
        'LINK MARINES · ccip.dev', 'painting', 'space', 'prophecy', '1 meme', '3 memes', 'LINK MARINE #0007', 'ccip.dev',
      ]),
    );
  });

  it('prints a share only from Uncommon up: "top 100%" would say nothing', () => {
    // #when
    const odds = TIERS.map((tier) => texts(marineTree(marine(tier, [PNG]))).find((w) => w.includes('in 100 Marines')));
    // #then
    expect(odds).toEqual(['rarer than 17 in 100 Marines', 'top 40% · rarer than 76 in 100 Marines', 'top 15% · rarer than 95 in 100 Marines', 'top 3% · rarer than 97 in 100 Marines']);
  });

  it('says "rarer than N" only for N from 1 to 99: never 0, never 100', () => {
    // #given the lowest scores, and one past the simulation's highest
    const odds = (tier: 'common' | 'uncommon' | 'legendary', percentile: number) => texts(marineTree({ ...marine(tier, [PNG]), percentile })).filter((w) => w.includes('rarer than') || w.startsWith('top '));
    // #when
    const lines = [odds('common', 0.4), odds('uncommon', 0.9), odds('common', 1), odds('legendary', 100)];
    // #then
    expect(lines).toEqual([[], ['top 40%'], ['rarer than 1 in 100 Marines'], ['top 3% · rarer than 99 in 100 Marines']]);
  });

  it('writes no character the card fonts lack, and a name of emoji alone as "Marine"', () => {
    // #given a stamped name the fonts cannot draw
    const card = { ...marine('rare', [PNG]), name: '🚀🚀 日本' };
    // #when
    const words = texts(marineTree(card));
    // #then
    expect({ missing: words.filter((w) => !DRAWABLE_TEXT.test(w)), names: [cardName('🚀🚀'), cardName('Zoë 🚀')], shown: words.includes('Marine') }).toEqual({ missing: [], names: ['Marine', 'Zoë'], shown: true });
  });

  it('shrinks the lore rows only when a long line would run off the tag', () => {
    // #when
    const sizes = [loreSize(loreRows(marine('legendary', [PNG]))), loreSize(loreRows(marine('common', [PNG])))];
    // #then "FAITH FUNDAMENTALS · 13 OCT 2026" (32 characters) fits the 222 px column at 9.9
    expect(sizes).toEqual([11, 9.9]);
  });

  it("hangs the ball chain into each tag's hole, the tags turned -11° and 5°", () => {
    // #when
    const holes = [onTag(BACK_TAG, 32, 88), onTag(FRONT_TAG, 32, 88)].map((p) => [Math.round(p.x), Math.round(p.y)]);
    // #then
    expect(holes).toEqual([[92, 203], [128, 228]]);
  });

  it("draws the sky's layout and halo turn from the callsign, the same every time", () => {
    // #when
    const choices = Object.values(MARINES).map((m) => skyChoices(m.callsign));
    // #then the four samples use all three layouts; the halo turns within ±6°
    expect({
      layouts: choices.map((c) => c.layout),
      turns: choices.every((c) => Math.abs(c.haloTurn) <= 6),
      stable: skyChoices('painting-space-prophecy').layout === choices[0]!.layout,
    }).toEqual({ layouts: [2, 1, 0, 0], turns: true, stable: true });
  });

  it('runs the rim microtext as whole phrases inside the bottom rim, never to the rounded corners', () => {
    // #when
    const rims = TIERS.map((tier) => texts(marineTree(marine(tier, [PNG]))).find((w) => w.includes(' · ') && w.split(' · ').every((p) => (RIM_PHRASES as readonly string[]).includes(p))));
    // #then 300 px tag less two 40 px corners and a 6 px inset a side is 208 px, at 6.5 × 0.82 = 5.33 px a character
    expect({ budget: RIM_BUDGET, fits: rims.every((r) => r !== undefined && r.length <= RIM_BUDGET), shown: rims[0] !== undefined && rims[0].length > 20 }).toEqual({ budget: 39, fits: true, shown: true });
  });
});

describe('the web card', () => {
  it('draws the same card without the stamped name, keeping the tier word and the odds', () => {
    // #when
    const words = texts(marineTree(webMarine('legendary', [PNG])));
    // #then
    expect({ name: words.includes('momentmaker'), kept: ['LEGENDARY', 'top 3% · rarer than 97 in 100 Marines', 'LINK MARINE #0007', 'ccip.dev'].every((w) => words.includes(w)) }).toEqual({ name: false, kept: true });
  });

  it('drops the name and avatar from a full card handed to it, drawing no name', () => {
    // #given a full card with its stamped name
    const web = webCardOf(marine('legendary', [PNG]));
    // #then
    expect({ keys: Object.keys(web).filter((k) => k === 'name' || k === 'avatar'), name: texts(marineTree(web)).includes('momentmaker') }).toEqual({ keys: [], name: false });
  });
});
