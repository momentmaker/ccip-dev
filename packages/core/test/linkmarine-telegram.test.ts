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
    expect(['enlist', 'marine_42', 'tag_pepe', 'tag_based', 'marine_0', 'marine_007', 'tag_Pepe', 'tag_', 'marine_', 'roster', '', null, undefined].map(parseStartParam)).toEqual([
      { kind: 'enlist' },
      { kind: 'marine', serial: 42 },
      { kind: 'tag', tag: 'pepe' },
      { kind: 'tag', tag: 'based' },
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

  it('refuses a tag the vocabulary cannot hold: an underscore, or more than 13 characters', () => {
    // #then
    expect(['tag_based_af', 'tag__', 'tag_abcdefghijklmn', 'tag_abcdefghijklm'].map(parseStartParam)).toEqual([null, null, null, { kind: 'tag', tag: 'abcdefghijklm' }]);
  });

  it('builds the direct link, with startapp when given', () => {
    // #then
    expect([miniAppLink(), miniAppLink('enlist')]).toEqual(['https://t.me/ccipdevbot/marines', 'https://t.me/ccipdevbot/marines?startapp=enlist']);
  });

  it('leaves out a startapp Telegram would not accept, so no query can ride on the link', () => {
    // #then
    expect(['a&b=1', 'two words', 'x'.repeat(65), 'marine_7#x'].map(miniAppLink)).toEqual(Array(4).fill('https://t.me/ccipdevbot/marines'));
  });

  it('keeps a startapp of 64 letters, digits, underscores and hyphens', () => {
    // #then
    expect(miniAppLink('Tag_a-9'.padEnd(64, 'z'))).toBe(`https://t.me/ccipdevbot/marines?startapp=${'Tag_a-9'.padEnd(64, 'z')}`);
  });
});
