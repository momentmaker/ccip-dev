import { ROSTER_FIXTURE } from '@ccip-dev/core/testing';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarinePage } from '../src/components/marines/MarineView';

const html = (props: Partial<Parameters<typeof MarinePage>[0]> = {}) => renderToString(createElement(MarinePage, { roster: ROSTER_FIXTURE, failed: false, serial: 2, ...props }));
const text = (out: string) => out.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('a Marine’s page', () => {
  it('shows the web card with a real alt text', () => {
    // #then
    expect(html()).toMatch(/<img[^>]*src="https:\/\/discord\.ccip\.dev\/web\/2\.png"[^>]*alt="The dog tags of LINK MARINE #0002, painting-space-prophecy, Legendary"/);
  });

  it('heads the facts with the serial, the date, the callsign, the tier, the odds and the rank', () => {
    // #then
    expect(text(html())).toContain('LINK MARINE #0002 · enlisted 13 Oct 2026 painting-space-prophecy LEGENDARY top 3% · rarer than 97 in 100 Marines · rank #1 of 4');
  });

  it('marks each tag’s pips and carriers, and the tags this Marine discovered', () => {
    // #then
    expect(text(html())).toContain('painting ◆◆◆ 3 of 3 pips 1 meme · carried by 2 · discoverer space ◆◆◆ 3 of 3 pips 1 meme · only you carry it · discoverer prophecy ◆◆◇ 2 of 3 pips 3 memes · carried by 2 · discoverer');
  });

  it('prints the lore and shares the page on X with its line', () => {
    // #when
    const out = html();
    // #then
    expect([text(out).includes('BLOOD O-LINK · FAITH SERGEY'), out.includes('https://x.com/intent/post?text=LINK%20MARINE%20%230002%20%C2%B7%20painting-space-prophecy%20%C2%B7%20LEGENDARY&amp;url=https%3A%2F%2Fccip.dev%2Fmarines%2F0002%2F')]).toEqual([true, true]);
  });

  it('says no Marine has the serial yet, and becomes the Marine once a refreshed roster has it', () => {
    // #given a roster without #5, then one with it
    const later = { ...ROSTER_FIXTURE, marines: [...ROSTER_FIXTURE.marines, { ...ROSTER_FIXTURE.marines[0]!, serial: 5, callsign: 'pepe-comfy-sergey' }] };
    // #then
    expect([text(html({ serial: 5 })).includes('No Marine #0005 yet.'), text(html({ serial: 5, roster: later })).includes('pepe-comfy-sergey')]).toEqual([true, true]);
  });

  it('waits for the serial and the roster before saying anything is missing', () => {
    // #then
    expect([text(html({ serial: undefined })), text(html({ roster: null })), text(html({ roster: null, failed: true }))].map((t) => t.includes('No Marine'))).toEqual([false, false, false]);
  });
});
