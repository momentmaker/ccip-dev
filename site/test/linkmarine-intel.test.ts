import { describe, expect, it } from 'vitest';
import { LETTERMARK_BG } from '../src/lib/chain-icons';
import { glowColor, iconBackground } from '../worker/linkmarine/chain-hex';
import { dossierTree, highlight, titleSize } from '../worker/linkmarine/dossier-card';
import { dayFraction, placeLanes, roughCount, sitrepTree } from '../worker/linkmarine/sitrep-card';
import { texts } from './fixtures/broadcast';
import { DOSSIER, DRAWABLE_TEXT, SITREP } from './fixtures/linkmarine';

const NO_ARTS = new Map();

describe('the chain hexagons', () => {
  it("fills a hexagon with the icon's own background: its first shape's fill", () => {
    // #when
    const fills = [
      iconBackground('<svg viewBox="0 0 32 32"><g clip-path="url(#a)"><rect width="32" height="32" fill="#627eea" rx="4"/><path fill="#fff" d="M0 0"/></g></svg>'),
      iconBackground('<svg viewBox="0 0 32 32"><path fill="#cf0" d="M0 4"/></svg>'),
      iconBackground('<svg viewBox="0 0 200 200"><path d="M0 0h200v200H0z"/><path fill="#c0ff72" d="M1 1"/></svg>'),
      iconBackground('<svg viewBox="0 0 32 32"><path fill="url(#g)" d="M0 4"/></svg>'),
    ];
    // #then
    expect(fills).toEqual(['#627eea', '#cf0', '#000000', LETTERMARK_BG]);
  });

  it('glows in the background\'s hue, lit enough for the night sky, and pale blue for a grey', () => {
    // #then
    expect(['#627eea', '#e84142', '#001a19', '#808080', '#ffffff'].map(glowColor)).toEqual(['#9caef2', '#f08586', '#3dfff8', '#cfe0ff', '#cfe0ff']);
  });
});

describe('the SITREP card', () => {
  it('shows today so far, its pace against yesterday and the top lanes, as the mockup does', () => {
    // #when
    const words = texts(sitrepTree(SITREP, NO_ARTS));
    // #then
    expect(words).toEqual(
      expect.arrayContaining([
        'LIVE', 'SITREP · TUE 13 OCT 2026 · 11:28 UTC', 'ccip.dev', '685', 'messages so far today', '12%', ' on pace for ~1,430 · yesterday ', '1,625',
        '$44.1M', ' moved', '$419', ' in fees · ', '0.3%', ' in LINK', '211', ' senders · median delivery ', '13m 40s', 'TOP LANES TODAY', '$16.3M', '$10.7M', '$6.8M', '00:00', '24:00 UTC',
      ]),
    );
  });

  it('says "early in the day" before 01:00, and leaves out yesterday when it is not in history.json', () => {
    // #when
    const early = texts(sitrepTree({ ...SITREP, pace: null }, NO_ARTS));
    const noYesterday = texts(sitrepTree({ ...SITREP, pace: { projected: 1433.7, yesterday: null } }, NO_ARTS));
    // #then
    expect({ early: early.includes('early in the day'), pace: noYesterday.includes('on pace for ~1,430'), yesterday: noYesterday.some((w) => w.includes('yesterday')) }).toEqual({ early: true, pace: true, yesterday: false });
  });

  it('rounds the projection to three figures and knows how far into the UTC day it is', () => {
    // #then
    expect([roughCount(1433.66), roughCount(636), roughCount(12_345.6), dayFraction('2026-10-13T12:00:00.000Z')]).toEqual([1430, 636, 12_300, 0.5]);
  });

  it('seats the busiest chains first, and drops a lane whose chain finds no seat', () => {
    // #given nine chains across five lanes
    const chain = (n: number) => ({ selector: String(n), name: `C${n}` });
    const lanes = [1, 2, 3, 4, 5].map((n) => ({ src: chain(n * 2 - 1), dst: chain(n * 2), usd: 100 - n }));
    // #when
    const seated = placeLanes(SITREP.lanes);
    const crowded = placeLanes(lanes);
    // #then Ethereum ($33.8M of these lanes) takes the first seat and Monad ($30.5M) the second; the lanes between them run both ways
    expect({
      first: [seated[0]!.lane.src.name, seated[0]!.a, seated[0]!.b],
      reversed: [seated[1]!.a, seated[1]!.b],
      crowded: crowded.length,
    }).toEqual({ first: ['Monad', { x: 690, y: 215 }, { x: 585, y: 120 }], reversed: [{ x: 585, y: 120 }, { x: 690, y: 215 }], crowded: 4 });
  });
});

describe('the dossier card', () => {
  it("shows the chain's rank, its all-time numbers, its week and its partners", () => {
    // #when
    const words = texts(dossierTree(DOSSIER, NO_ARTS));
    // #then
    expect(words).toEqual(
      expect.arrayContaining([
        'CHAIN DOSSIER · CCIP', 'BASE', '#3 of 92 all time · #1 in fees this week', '552,062', ' messages · ', '$3.8B', ' moved', '$356.7K', ' in fees, all time',
        '7 days: ', '3,881', '$16.2M', '$5.8M', '$5.3M', '$2.1M', '$1.5M', 'LAST 7 DAYS · MESSAGES A DAY', 'ON CCIP SINCE 16 SEP 2023', 'AS OF 13 OCT 2026 · 06:01 UTC',
      ]),
    );
  });

  it('adds the fee rank only for a top-3 chain, and shrinks a long name to fit', () => {
    // #then
    expect({ plain: highlight({ ...DOSSIER, rank: 40, feeRank: null }), sizes: ['BASE', 'ETHEREUM', 'ARBITRUM ONE', 'BINANCE SMART CHAIN'].map(titleSize) }).toEqual({
      plain: '#40 of 92 all time',
      sizes: [72, 56, 42, 32],
    });
  });

  it('writes no character the card fonts lack', () => {
    // #when
    const words = [...texts(sitrepTree(SITREP, NO_ARTS)), ...texts(dossierTree(DOSSIER, NO_ARTS))];
    // #then
    expect(words.filter((w) => !DRAWABLE_TEXT.test(w))).toEqual([]);
  });
});
