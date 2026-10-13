import { ROSTER_FIXTURE } from '@ccip-dev/core/testing';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RosterPage } from '../src/components/marines/RosterView';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const html = (props: Partial<Parameters<typeof RosterPage>[0]> = {}) => renderToString(createElement(RosterPage, { roster: ROSTER_FIXTURE, failed: false, now: NOW, ...props }));
/** The page's text without tags or React's comment markers, entities decoded. */
const text = (out: string) => out.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('the roster page', () => {
  it('counts Marines, Legendaries and tags drawn out of the snapshot', () => {
    // #then
    expect(text(html())).toContain('Marines 4 Legendary 1 Tags drawn 6 /8');
  });

  it('crawls the ticker twice, the repeat hidden from screen readers', () => {
    // #when
    const out = html();
    // #then
    expect({ label: out.includes('LIVE · ROSTER'), runs: out.match(/class="mr-ticker-run"/g)?.length, hidden: /<ul[^>]*aria-hidden="true"/.test(out), sighting: text(out).includes('FIRST SIGHTING “painting” about 1 in 7 · discovered by #0002') }).toEqual({ label: true, runs: 1, hidden: true, sighting: true });
  });

  it('bars each tier against its odds', () => {
    // #then
    expect(text(html())).toContain('LEGENDARY 1 · 25% / 3 RARE 1 · 25% / 12 UNCOMMON 1 · 25% / 25 COMMON 1 · 25% / 60');
  });

  it('lights one hexagon per drawn tag on the board, gold for one-meme tags', () => {
    // #when
    const out = html();
    // #then
    expect({ hexes: out.match(/class="mr-hex[ "]/g)?.length, lit: out.match(/class="mr-hex mr-on[ "]/g)?.length, label: text(out).includes('TAGS DRAWN · 6 OF 8') }).toEqual({ hexes: 8, lit: 6, label: true });
  });

  it('posts today’s most wanted with their odds and the reward', () => {
    // #then
    expect(text(html())).toContain('2 tags are still undrawn, 2 of them one-of-a-kind.');
    expect(text(html())).toMatch(/WANTED zoomer ABOUT 1 IN 7 CALLSIGNS ONE MEME IN THE ARCHIVE REWARD · DISCOVERER CREDIT/);
  });

  it('counts the hero’s tags drawn like the board, ignoring a tag the snapshot lacks', () => {
    // #given a Marine carrying "ghost", which the snapshot dropped, and "zoomer", which it holds
    const ghost = { ...ROSTER_FIXTURE.marines[0]!, serial: 5, callsign: 'ghost-zoomer-pepe', tags: ['ghost', 'zoomer', 'pepe'] as [string, string, string] };
    const out = text(html({ roster: { ...ROSTER_FIXTURE, marines: [...ROSTER_FIXTURE.marines, ghost] } }));
    // #then
    expect({ hero: out.includes('Tags drawn 7 /8'), board: out.includes('TAGS DRAWN · 7 OF 8') }).toEqual({ hero: true, board: true });
  });

  it('says the board is full when every tag is drawn', () => {
    // #given every tag drawn
    const full = { ...ROSTER_FIXTURE, snapshot: { ...ROSTER_FIXTURE.snapshot, tags: ROSTER_FIXTURE.snapshot.tags.filter((t) => t.tag !== 'zoomer' && t.tag !== 'samurai') } };
    // #then
    expect(text(html({ roster: full }))).toContain('Every tag has been drawn. The board is full.');
  });

  it('shows loading, then the out-of-reach state, before any roster arrives', () => {
    // #then
    expect([text(html({ roster: null })).includes('Loading the roster'), text(html({ roster: null, failed: true })).includes('The roster is out of reach right now. Retrying…')]).toEqual([true, true]);
  });
});

describe('the roster page, part 2', () => {
  it('ranks the rarest ten by score, each linking to the Marine', () => {
    // #when
    const out = html();
    // #then
    expect([...out.matchAll(/class="mr-rarest-row" href="([^"]+)"/g)].map((m) => m[1])).toEqual(['/marines/0002/', '/marines/0004/', '/marines/0003/', '/marines/0001/']);
  });

  it('seats the first four plank owners and leaves 96 seats open', () => {
    // #when
    const out = html();
    // #then
    expect({ taken: out.match(/class="mr-seat mr-metal-/g)?.length, open: out.match(/class="mr-seat"/g)?.length }).toEqual({ taken: 4, open: 96 });
  });

  it('hangs every Marine on the wall by rarity, each a labelled link to its page', () => {
    // #when
    const out = html();
    // #then
    expect([...out.matchAll(/class="mr-wall-link" href="([^"]+)" aria-label="([^"]+)"/g)].map((m) => [m[1], m[2]])).toEqual([
      ['/marines/0002/', 'LINK MARINE #0002, painting-space-prophecy, Legendary'],
      ['/marines/0004/', 'LINK MARINE #0004, comfy-painting-sergey, Rare'],
      ['/marines/0003/', 'LINK MARINE #0003, pepe-sergey-prophecy, Uncommon'],
      ['/marines/0001/', 'LINK MARINE #0001, sergey-pepe-comfy, Common'],
    ]);
  });

  it('loads no meme on a tag’s back until it first flips', () => {
    // #then the wall has no meme images; only the posters and planets do
    expect(html().match(/<li><a class="mr-wall-link"[\s\S]*?<\/a><\/li>/g)?.some((li) => li.includes('<img'))).toBe(false);
  });

  it('draws a planet per carried tag, in both the wide and the narrow sky', () => {
    // #when
    const out = html();
    // #then six tags are carried: six wide planets, and the same six narrow (up to twelve)
    expect(out.match(/class="mr-planet"/g)?.length).toBe(12);
  });

  it('says there are no Marines yet on an empty roster, and hides the rarest ten and the sky', () => {
    // #when
    const out = text(html({ roster: { ...ROSTER_FIXTURE, marines: [] } }));
    // #then
    expect([out.includes('No Marines yet. Be #0001: /enlist'), out.includes('The hardest draws in the corps.'), out.includes('The meme constellation.')]).toEqual([true, false, false]);
  });
});
