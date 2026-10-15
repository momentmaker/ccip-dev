import { parseStartParam } from '@ccip-dev/core/linkmarine';
import type { RosterFile } from '@ccip-dev/core/roster';
import { ROSTER_FIXTURE } from '@ccip-dev/core/testing';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarinePage } from '../src/components/marines/MarineView';
import { RosterPage } from '../src/components/marines/RosterView';
import { stickerPacks, tagFromSearch, telegramOpen } from '../src/lib/telegram';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const text = (out: string) => out.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const roster = (props: Partial<Parameters<typeof RosterPage>[0]> = {}) => renderToString(createElement(RosterPage, { roster: ROSTER_FIXTURE, failed: false, now: NOW, ...props }));
const TELEGRAM = 'href="https://t.me/ccipdevbot/marines?startapp=enlist"';
/** The fixture with one more Marine, #121: the first of Vol. 2. */
const VOL2: RosterFile = { ...ROSTER_FIXTURE, marines: [...ROSTER_FIXTURE.marines, { ...ROSTER_FIXTURE.marines[0]!, serial: 121, callsign: 'samurai-zoomer-pepe', tags: ['samurai', 'zoomer', 'pepe'] }] };

describe('enlisting from the site', () => {
  it('keeps the roster page as it is, Discord alone, until LinkMarines opens on Telegram', () => {
    // #when
    const out = roster();
    // #then
    expect([text(out).includes('Enlist in any server with /enlist'), out.includes(TELEGRAM), text(out).includes('Add ccip.dev to Discord'), out.includes('t.me/addstickers')]).toEqual([true, false, true, false]);
  });

  it('then names both platforms in the hero and the call to enlist, with Enlist on Discord and Enlist on Telegram side by side', () => {
    // #when
    const out = roster({ telegram: true });
    // #then
    expect({
      lead: text(out).includes('Every Marine who has enlisted with the ccip.dev bot, on Discord or Telegram, by callsign.'),
      discordOnly: text(out).includes('Enlist in any server'),
      telegram: out.split(TELEGRAM).length - 1,
      discord: out.split('href="/discord/">Enlist on Discord').length - 1,
    }).toEqual({ lead: true, discordOnly: false, telegram: 2, discord: 2 });
  });

  it('links every sticker pack that holds Marines', () => {
    // #when
    const out = roster({ roster: VOL2, telegram: true });
    // #then
    expect(text(out)).toContain('Every Marine is a sticker: LinkMarines Vol. 1 · LinkMarines Vol. 2');
    expect(out).toContain('href="https://t.me/addstickers/linkmarines2_by_ccipdevbot"');
  });

  it('offers both on a Marine’s page', () => {
    // #when
    const [off, on] = [false, true].map((telegram) => renderToString(createElement(MarinePage, { roster: ROSTER_FIXTURE, failed: false, serial: 2, telegram })));
    // #then
    expect([text(off!).includes('Enlist yours'), off!.includes(TELEGRAM), text(on!).includes('Enlist on Discord Enlist on Telegram'), text(on!).includes('Enlist yours')]).toEqual([true, false, true, false]);
  });

  it('reads the build’s TELEGRAM_BOT', () => {
    // #then
    expect([telegramOpen('on'), telegramOpen('off'), telegramOpen(undefined)]).toEqual([true, false, false]);
  });
});

describe('the roster page’s ?tag=', () => {
  it('opens the wall on the tag', () => {
    // #then
    expect(text(roster({ tag: 'pepe' }))).toContain('2 Marines carry “pepe”');
  });

  it('reads only what can be a tag', () => {
    // #then
    expect(['?tag=pepe', '?tag=based_af', '?tag=Pepe', '?tag=%3Cscript%3E', '?other=1', ''].map(tagFromSearch)).toEqual(['pepe', null, null, null, null, null]);
  });

  it('accepts and refuses the same tags as a tag_ deep link into the Mini App', () => {
    // #given
    const tags = ['pepe', 'based', 'abcdefghijklm', '4ir', 'based_af', '_', 'abcdefghijklmn', 'Pepe', '', 'a-b', 'a b'];
    // #when
    const fromSearch = tags.map((tag) => tagFromSearch(`?tag=${encodeURIComponent(tag)}`) !== null);
    const fromLink = tags.map((tag) => parseStartParam(`tag_${tag}`)?.kind === 'tag');
    // #then
    expect({ fromSearch, fromLink }).toEqual({ fromSearch: fromLink, fromLink: [true, true, true, true, false, false, false, false, false, false, false] });
  });
});

describe('the sticker packs', () => {
  it('runs from Vol. 1 to the newest Marine’s volume, and none on an empty roster', () => {
    // #then
    expect([stickerPacks(ROSTER_FIXTURE).map((p) => p.volume), stickerPacks(VOL2).map((p) => p.volume), stickerPacks({ ...ROSTER_FIXTURE, marines: [] })]).toEqual([[1], [1, 2], []]);
  });
});
