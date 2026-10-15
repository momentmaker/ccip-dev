import type { MarineSummary } from '@ccip-dev/core/linkmarine';
import { ROSTER_FIXTURE } from '@ccip-dev/core/testing';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import DogTagScreen from '../src/components/tg/DogTagScreen';
import Draw from '../src/components/tg/Draw';
import Outside from '../src/components/tg/Outside';
import Welcome from '../src/components/tg/Welcome';

const text = (out: string) => out.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
/** The text with no spaces at all: the callsign is set in parts. */
const squashed = (out: string) => text(out).replace(/\s+/g, '');
const noop = () => {};
const MARINE: MarineSummary = {
  serial: 4,
  callsign: 'comfy-painting-sergey',
  tags: ['comfy', 'painting', 'sergey'],
  tier: 'rare',
  percentile: 88.2,
  memes: [
    { tag: 'comfy', file: 'comfy.jpeg', count: 25 },
    { tag: 'painting', file: 'painting.jpeg', count: 1 },
    { tag: 'sergey', file: 'sergey.jpeg', count: 400 },
  ],
  volume: 1,
  cardReady: true,
};

describe('screen 1: welcome and gate', () => {
  const welcome = (props: Partial<Parameters<typeof Welcome>[0]> = {}) => renderToString(createElement(Welcome, { roster: ROSTER_FIXTURE, gate: 'ok', open: true, notice: null, onJoin: noop, onCheck: noop, ...props }));

  it('says what enlisting is, seats the plank owners and counts the Marines and the tags', () => {
    // #when
    const out = welcome();
    // #then
    expect({
      copy: text(out).includes('ccip.dev · LinkMarines Enlist, Marine. Three tags from the LinkMarine meme vault become your callsign. One draw, forever. Rarer tags, rarer tier.'),
      seats: out.match(/class="tg-seat[ "]/g)?.length,
      taken: out.match(/class="tg-seat mr-metal-/g)?.length,
      left: text(out).includes('Plank-owner seats: 96 of 100 left'),
      counts: text(out).includes('4 Marines 8 tags in the vault'),
      gate: text(out).includes('Not in @ccipdev'),
    }).toEqual({ copy: true, seats: 30, taken: 4, left: true, counts: true, gate: false });
  });

  it('asks someone outside the gate chats to join @ccipdev, then check again', () => {
    // #then
    expect(text(welcome({ gate: 'join' }))).toContain('Not in @ccipdev yet? Join the channel to enlist, then Check again . Join Check again');
  });

  it('says it opens soon while the switch is off, and asks nobody to join', () => {
    // #when
    const out = text(welcome({ open: false, gate: 'join' }));
    // #then
    expect([out.includes('LinkMarines on Telegram opens soon'), out.includes('Not in @ccipdev')]).toEqual([true, false]);
  });

  it('says in a status line why the last enlist did not go through', () => {
    // #when
    const out = welcome({ notice: "Couldn't enlist just now. Try again." });
    // #then
    expect([out.includes('<p class="tg-notice" role="status">'), text(out).includes("Couldn't enlist just now. Try again.")]).toEqual([true, true]);
  });

  it('shows no status line when there is nothing to say', () => {
    // #then
    expect(welcome().includes('tg-notice')).toBe(false);
  });
});

describe('screen 2: the draw', () => {
  const draw = (locked: number, marine: MarineSummary | null = MARINE, banner: 'rare' | 'legendary' | null = 'rare') => renderToString(createElement(Draw, { marine, roster: ROSTER_FIXTURE, locked, banner }));

  it('spins all three hexes until the draw is in', () => {
    // #when
    const out = draw(0, null);
    // #then
    expect([out.match(/tg-hex tg-spin/g)?.length, squashed(out).includes('······-······-······')]).toEqual([3, true]);
  });

  it('locks the hexes left to right, each with its meme, count and chance', () => {
    // #when
    const out = draw(2);
    // #then
    expect({ spinning: out.match(/tg-hex tg-spin/g)?.length, memes: [...out.matchAll(/memes\/([a-z]+)\.jpeg\.png/g)].map((m) => m[1]) }).toEqual({ spinning: 1, memes: ['comfy', 'painting'] });
    expect(squashed(out)).toContain('COMFY-PAINTING-······');
    expect(text(out)).toContain('comfy · 25 memes · 10.0% painting · 1 meme · 5.0%');
  });

  it('never prints a tag before its hex locks, in the tag row, the callsign, the memes or the odds line', () => {
    // #then
    expect([0, 1, 2].map((locked) => MARINE.tags.slice(locked).filter((tag) => draw(locked).toLowerCase().includes(tag)))).toEqual([[], [], []]);
  });

  it('ends a Rare draw on its banner, and a Common one without', () => {
    // #then
    expect([text(draw(3)).includes('⚠ RARE DRAW'), text(draw(2)).includes('RARE DRAW'), text(draw(3, MARINE, null)).includes('DRAW ')]).toEqual([true, false, false]);
  });
});

describe('screen 3: your dog tag', () => {
  const dogtag = (cardUrl: string | null, ownCard = true) => renderToString(createElement(DogTagScreen, { marine: MARINE, cardUrl, ownCard, tilt: null, onPack: noop, onShare: noop, onRoster: noop }));

  it('shows the tier banner, your card, the serial and callsign, the three buttons and who sees this card', () => {
    // #when
    const out = dogtag('blob:https://ccip.dev/card');
    // #then
    expect(text(out)).toContain('RARE · RARER THAN 88% LINK MARINE #0004 COMFY-PAINTING-SERGEY 🎖 Add the LinkMarines sticker pack 🔗 Share my page 🪖 See the roster Your card here shows your Telegram name and photo; only you see this version.');
    expect(out).toContain('src="blob:https://ccip.dev/card"');
  });

  it('keeps the name-and-photo footnote off the public web card, which carries neither', () => {
    // #when
    const out = dogtag('https://discord.ccip.dev/web/4.png', false);
    // #then
    expect([text(out).includes('Your card here shows your Telegram name and photo'), out.includes('src="https://discord.ccip.dev/web/4.png"')]).toEqual([false, true]);
  });

  it('shows the draw’s last frame while the card is being stamped', () => {
    // #when
    const out = dogtag(null);
    // #then
    expect([squashed(out).includes('COMFY-PAINTING-SERGEYStampingyourdogtag…'), out.includes('tg-spin'), out.includes('<img')]).toEqual([true, false, false]);
  });

  it('keeps the name-and-photo footnote off until your card is on show', () => {
    // #when
    const out = dogtag(null, true);
    // #then
    expect(text(out).includes('Your card here shows your Telegram name and photo')).toBe(false);
  });
});

describe('outside Telegram', () => {
  it('points to the Mini App in Telegram', () => {
    // #when
    const out = renderToString(createElement(Outside));
    // #then
    expect([text(out).includes('Open in Telegram'), out.includes('href="https://t.me/ccipdevbot/marines"')]).toEqual([true, true]);
  });
});
