import { describe, expect, it } from 'vitest';
import { miniAppLink, parseStartParam, stickerPackName, stickerPackTitle, stickerPackUrl, stickerVolume } from '../src/linkmarine';

describe('the LinkMarines sticker packs', () => {
  it('puts 120 Marines in a volume, the plank owners in Vol. 1', () => {
    // #then
    expect([1, 100, 120, 121, 240, 241].map(stickerVolume)).toEqual([1, 1, 1, 2, 2, 3]);
  });

  it('names Vol. 1 linkmarines_by_ccipdevbot and the rest by number', () => {
    // #then
    expect([stickerPackName(1), stickerPackName(2), stickerPackTitle(2), stickerPackUrl(1)]).toEqual([
      'linkmarines_by_ccipdevbot',
      'linkmarines2_by_ccipdevbot',
      'LinkMarines Vol. 2 · ccip.dev',
      'https://t.me/addstickers/linkmarines_by_ccipdevbot',
    ]);
  });
});

describe('the Mini App links', () => {
  it('reads enlist, a Marine and a tag, and nothing else', () => {
    // #then
    expect(['enlist', 'marine_42', 'tag_pepe', 'tag_based_af', 'marine_0', 'marine_007', 'tag_Pepe', 'tag_', 'marine_', 'roster', '', null, undefined].map(parseStartParam)).toEqual([
      { kind: 'enlist' },
      { kind: 'marine', serial: 42 },
      { kind: 'tag', tag: 'pepe' },
      { kind: 'tag', tag: 'based_af' },
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('builds the direct link, with startapp when given', () => {
    // #then
    expect([miniAppLink(), miniAppLink('enlist')]).toEqual(['https://t.me/ccipdevbot/marines', 'https://t.me/ccipdevbot/marines?startapp=enlist']);
  });
});
