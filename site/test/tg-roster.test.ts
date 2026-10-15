import { ROSTER_FIXTURE } from '@ccip-dev/core/testing';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RarestTen from '../src/components/marines/RarestTen';
import { MarineSheet, TagSheet } from '../src/components/tg/Sheets';
import TgRoster from '../src/components/tg/TgRoster';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const text = (out: string) => out.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const noop = () => {};
const roster = (tab: 'wall' | 'constellation' | 'rarest', open = true) => renderToString(createElement(TgRoster, { roster: ROSTER_FIXTURE, tab, now: NOW, open, onTab: noop, onPickTag: noop, onPickMarine: noop }));

describe('screen 4: the roster', () => {
  it('has the Wall, Constellation and Rarest tabs over the ticker, the Wall on', () => {
    // #when
    const out = roster('wall');
    // #then
    expect({ tabs: [...out.matchAll(/role="tab"[^>]*>([A-Za-z]+)</g)].map((m) => m[1]), on: /aria-selected="true" class="on">Wall/.test(out), ticker: out.includes('mr-ticker') }).toEqual({
      tabs: ['Wall', 'Constellation', 'Rarest'],
      on: true,
      ticker: true,
    });
  });

  it('lists the Marines newest first, each with its first meme, tier and odds', () => {
    // #when
    const rows = [...roster('wall').matchAll(/class="tg-cs">(.*?)<\/span><span class="tg-muted">(.*?)<\/span>/g)].map((m) => text(`${m[1]} / ${m[2]}`).trim());
    // #then
    expect(rows).toEqual(['#0004 COMFY-PAINTING-SERGEY / Rare · rarer than 88%', '#0003 PEPE-SERGEY-PROPHECY / Uncommon · rarer than 66%', '#0002 PAINTING-SPACE-PROPHECY / Legendary · rarer than 97%', '#0001 SERGEY-PEPE-COMFY / Common · rarer than 31%']);
  });

  it('shows the site’s constellation and rarest ten on their tabs', () => {
    // #then
    expect([text(roster('constellation')).includes('The meme constellation.'), text(roster('rarest')).includes('The hardest draws in the corps.')]).toEqual([true, true]);
  });

  it('chips today’s most wanted tags, and says it opens soon while the switch is off', () => {
    // #when
    const out = roster('wall', false);
    // #then
    expect([text(out).includes('Today’s most wanted'), out.match(/class="tg-chip"/g)?.length, text(out).includes('LinkMarines on Telegram opens soon')]).toEqual([true, 2, true]);
  });
});

describe('the roster’s sheets', () => {
  it('gives a tag its memes, its chance per draw, its first discoverer and its carriers', () => {
    // #then
    expect(text(renderToString(createElement(TagSheet, { roster: ROSTER_FIXTURE, tag: 'pepe', onClose: noop })))).toContain('pepe · 100 memes · 20.0% per draw First discoverer: #0001 SERGEY-PEPE-COMFY · 2 Marines carry it');
  });

  it('says nobody has drawn an undrawn tag yet', () => {
    // #then
    expect(text(renderToString(createElement(TagSheet, { roster: ROSTER_FIXTURE, tag: 'zoomer', onClose: noop })))).toContain('zoomer · 1 meme · 5.0% per draw Nobody has drawn it yet.');
  });

  it('shows a Marine’s public web card, never their name', () => {
    // #when
    const out = renderToString(createElement(MarineSheet, { roster: ROSTER_FIXTURE, serial: 2, onClose: noop }));
    // #then
    expect([out.includes('src="https://discord.ccip.dev/web/2.png"'), text(out).includes('#0002 PAINTING-SPACE-PROPHECY Legendary · rarer than 97%')]).toEqual([true, true]);
  });

  it('opens nothing for a tag or a Marine the roster lacks', () => {
    // #then
    expect([renderToString(createElement(TagSheet, { roster: ROSTER_FIXTURE, tag: 'nope', onClose: noop })), renderToString(createElement(MarineSheet, { roster: ROSTER_FIXTURE, serial: 99, onClose: noop }))]).toEqual(['', '']);
  });
});

describe('the rarest ten, shared with the site', () => {
  it('still links each row to the Marine’s page', () => {
    // #then
    expect(renderToString(createElement(RarestTen, { roster: ROSTER_FIXTURE, onPickMarine: noop }))).toContain('href="/marines/0002/"');
  });
});

describe('the Mini App page', () => {
  it('may be framed by Telegram’s web clients, unlike the rest of the site', () => {
    // #given
    const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
    // #then
    expect(headers).toContain('/tg/*\n  ! X-Frame-Options\n  ! Content-Security-Policy\n');
  });
});
