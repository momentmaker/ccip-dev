import { describe, expect, it } from 'vitest';
import { marinePath, marineTitle, marineUrl, memeUrl, serialFromPath, webCardUrl } from '../src/lib/marines';

describe('Marine URLs', () => {
  it('pads the page path, and keeps the web card on the bare serial', () => {
    // #then
    expect([marinePath(7), marineUrl(7), marineTitle(7), webCardUrl(7), marinePath(12345)]).toEqual([
      '/marines/0007/',
      'https://ccip.dev/marines/0007/',
      'LINK MARINE #0007',
      'https://discord.ccip.dev/web/7.png',
      '/marines/12345/',
    ]);
  });

  it('escapes a meme file name for the bot', () => {
    // #then
    expect(memeUrl('b c#1.gif')).toBe('https://discord.ccip.dev/memes/b%20c%231.gif.png');
  });

  it('reads the serial from a Marine page path, and nothing else', () => {
    // #then
    expect(['/marines/0007/', '/marines/7', '/marines/0/', '/marines/marine/', '/marines/', '/marines/1234567890/'].map(serialFromPath)).toEqual([7, 7, null, null, null, null]);
  });
});
