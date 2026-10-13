import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadMemes, memeKey, rawMemeUrl, stockMemes } from '../src/memes';
import { fakeFetch, fakeRenderer, PNG_BYTES, resetStorage } from './helpers';

const ARCHIVE = { repo: 'momentmaker/chainlinkmeme', sha: 'c0ffee' };
const memes = ['a.jpeg', 'b c.gif'].map((file) => ({ tag: 't', file, key: memeKey(file) }));
const RAW = 'https://raw.githubusercontent.com/momentmaker/chainlinkmeme/c0ffee/memes/';

beforeEach(resetStorage);

describe('the meme copy', () => {
  it('copies each meme from the archive at the pinned commit, as the PNG the site makes of it', async () => {
    // #given
    const fetch = fakeFetch({ [RAW]: () => new Response(new Uint8Array([0xff, 0xd8, 0xff])) });
    const renderer = fakeRenderer();
    // #when
    await stockMemes(env.MARINES, renderer, fetch, ARCHIVE, memes);
    // #then
    const stored = await loadMemes(env.MARINES, memes);
    expect({ urls: fetch.urls, prepared: renderer.calls, stored: stored?.map((b) => [...b]), type: (await env.MARINES.head('memes/a.jpeg.png'))?.httpMetadata?.contentType }).toEqual({
      urls: [`${RAW}a.jpeg`, `${RAW}b%20c.gif`],
      prepared: ['prepareMeme', 'prepareMeme'],
      stored: [[...PNG_BYTES], [...PNG_BYTES]],
      type: 'image/png',
    });
  });

  it('copies only what R2 lacks, so a retry fetches the rest', async () => {
    // #given
    await env.MARINES.put(memeKey('a.jpeg'), PNG_BYTES);
    const fetch = fakeFetch({ [RAW]: () => new Response(new Uint8Array([0xff, 0xd8, 0xff])) });
    // #when
    await stockMemes(env.MARINES, fakeRenderer(), fetch, ARCHIVE, memes);
    // #then
    expect(fetch.urls).toEqual([`${RAW}b%20c.gif`]);
  });

  it('fails when GitHub does, leaving loadMemes empty-handed', async () => {
    // #when
    const copying = stockMemes(env.MARINES, fakeRenderer(), fakeFetch(), ARCHIVE, memes);
    // #then
    await expect(copying).rejects.toThrow(/^meme (a\.jpeg|b c\.gif): HTTP 404$/);
    expect(await loadMemes(env.MARINES, memes)).toBeNull();
  });

  it('pins the raw URL to the commit and escapes the file name', () => {
    // #then
    expect(rawMemeUrl('momentmaker/chainlinkmeme', 'c0ffee', 'a b#.jpeg')).toBe(`${RAW}a%20b%23.jpeg`);
  });
});
