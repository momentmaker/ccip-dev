import { describe, expect, it } from 'vitest';
import { LETTERMARK_BG } from '../src/lib/chain-icons';
import { px } from '../worker/linkmarine/art';
import { chainHexIcon, glowColor, iconBackground } from '../worker/linkmarine/chain-hex';
import { dossierTree, highlight, titleFit, TITLE_WIDTH } from '../worker/linkmarine/dossier-card';
import { textWidthEm } from '../worker/linkmarine/inter-black';
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

  it("takes a gradient background's first stop colour", () => {
    // #when
    const svg = '<svg viewBox="0 0 32 32"><defs><linearGradient id="a" x1="0"><stop stop-color="#102d3c"/><stop offset="1" stop-color="#ffcb67"/></linearGradient></defs><rect width="32" height="32" fill="url(#a)"/></svg>';
    // #then
    expect(iconBackground(svg)).toBe('#102d3c');
  });

  it("draws an icon wider than its hexagon, so the icon's edges fall outside the clip and leave no seam on the sides", () => {
    // #when
    const icon = chainHexIcon(100, 100, 30, { src: 'data:image/svg+xml;base64,AA==', bg: '#627eea', glow: '#9caef2' }, 'Base');
    const style = icon.props.style as { width: number; clipPath: string };
    const [left, right] = [/, ([\d.]+)%? 25%\)$/, /^polygon\(50% 0, ([\d.]+)% 25%/].map((re) => Number(re.exec(style.clipPath)![1]));
    // #then the box is at least 1.76r wide, and the clip still cuts the √3·r hexagon the background fills
    expect({ wide: style.width >= px(1.76 * 30), hexagon: Math.abs((style.width * (right! - left!)) / 100 - px(Math.sqrt(3) * 30)) < 0.2 }).toEqual({ wide: true, hexagon: true });
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

  it('adds the fee rank only for a top-3 chain', () => {
    // #then
    expect(highlight({ ...DOSSIER, rank: 40, feeRank: null })).toBe('#40 of 92 all time');
  });

  it('sizes the title from the real Inter 900 advances', () => {
    // #then
    expect(textWidthEm('BASE', -0.02) * 72).toBeCloseTo(191.6, 0);
  });

  it.each(['BASE', 'ETHEREUM', 'AVALANCHE', 'ZKSYNC', 'ARBITRUM ONE', 'BINANCE SMART CHAIN', 'POLYGON KATANA', 'ZK SYNC ERA MAINNET'])('fits the title %s in its column', (name) => {
    // #when
    const { lines, size } = titleFit(name);
    // #then
    expect(lines.map((l) => textWidthEm(l, -0.02) * size).filter((w) => w > TITLE_WIDTH)).toEqual([]);
  });

  it('keeps a short name on one line at full size, and splits a long one at its best space', () => {
    // #then
    expect([titleFit('BASE'), titleFit('BINANCE SMART CHAIN').lines, titleFit('ETHEREUM').lines.length, titleFit('A'.repeat(30)).size >= 24]).toEqual([
      { lines: ['BASE'], size: 72 },
      ['BINANCE', 'SMART CHAIN'],
      1,
      true,
    ]);
  });

  it('writes no character the card fonts lack', () => {
    // #when
    const words = [...texts(sitrepTree(SITREP, NO_ARTS)), ...texts(dossierTree(DOSSIER, NO_ARTS))];
    // #then
    expect(words.filter((w) => !DRAWABLE_TEXT.test(w))).toEqual([]);
  });
});

describe('names the fonts cannot draw', () => {
  it('falls back to the chain slug in capitals, and draws no stray glyph', () => {
    // #given a chain named in CJK, and one with an emoji
    const cjk = { selector: '42', name: '日本' };
    const emoji = { selector: '7', name: 'Zeta 🚀' };
    // #when
    const words = [...texts(dossierTree({ ...DOSSIER, chain: cjk, partners: [{ chain: emoji, usd: 1 }] }, NO_ARTS)), ...texts(sitrepTree({ ...SITREP, lanes: [{ src: cjk, dst: emoji, usd: 5 }] }, NO_ARTS))];
    // #then
    expect({ title: words.includes('42'), stray: words.filter((w) => !DRAWABLE_TEXT.test(w)) }).toEqual({ title: true, stray: [] });
  });
});

const svgs = (tree: unknown) => [...JSON.stringify(tree).matchAll(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g)].map((m) => atob(m[1]!));

describe('the cards with nothing to draw', () => {
  it('draws the SITREP radar rings only when there are no lanes', () => {
    // #when
    const art = svgs(sitrepTree({ ...SITREP, lanes: [] }, NO_ARTS)).join('');
    // #then
    expect({ rings: art.includes('r="210"'), lanes: art.includes('stroke-linecap="round"'), nan: art.includes('NaN') }).toEqual({ rings: true, lanes: false, nan: false });
  });

  it('draws the dossier without partners', () => {
    // #when
    const tree = dossierTree({ ...DOSSIER, partners: [] }, NO_ARTS);
    // #then
    expect({ nan: svgs(tree).join('').includes('NaN'), title: texts(tree).includes('BASE') }).toEqual({ nan: false, title: true });
  });

  it('draws seven zero bars as stubs, with no NaN', () => {
    // #when
    const art = svgs(dossierTree({ ...DOSSIER, days: DOSSIER.days.map((d) => ({ ...d, messages: 0 })) }, NO_ARTS)).join('');
    // #then
    expect({ stubs: art.match(/height="2" rx="3"/g)?.length, nan: art.includes('NaN') }).toEqual({ stubs: 7, nan: false });
  });
});
