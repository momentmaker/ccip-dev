import { describe, expect, it } from 'vitest';
import { px } from '../worker/linkmarine/art';
import { dossierTree } from '../worker/linkmarine/dossier-card';
import { bright, COLUMN_WIDTH, ellipsize, fitRow, monoWidth } from '../worker/linkmarine/intel-frame';
import { laneNames, LANE_NAME_BUDGET, recordsTree, TOTALS_WIDTH } from '../worker/linkmarine/records-card';
import { sitrepTree, TEXT_WIDTH } from '../worker/linkmarine/sitrep-card';
import { vaultTree } from '../worker/linkmarine/vault-card';
import { texts } from './fixtures/broadcast';
import { DOSSIER, RECORDS, SITREP, VAULT } from './fixtures/linkmarine';

interface Node {
  props?: { style?: Record<string, unknown>; children?: unknown; width?: number };
}
const kids = (n: unknown): unknown[] => {
  const c = (n as Node | null)?.props?.children;
  return Array.isArray(c) ? c : c === undefined ? [] : [c];
};
const walk = (n: unknown): Node[] => (typeof n === 'object' && n !== null ? [n as Node, ...kids(n).flatMap(walk)] : []);

/** Every single-line mono row of a card, with its width in card pixels: its characters plus the images (bullets, glyphs) in it. */
function rows(tree: unknown): { text: string; width: number }[] {
  return walk(tree)
    .filter((n) => n.props?.style?.whiteSpace === 'pre' && n.props.style.fontFamily === 'JetBrains Mono')
    .map((n) => {
      const style = n.props!.style!;
      const chars = texts(n).join('').length;
      const images = walk(n).filter((c) => typeof c.props?.width === 'number').length;
      return { text: texts(n).join(''), width: chars * (0.6 * (style.fontSize as number) + (style.letterSpacing as number)) + images * px(17) };
    });
}
const widest = (tree: unknown) => Math.max(...rows(tree).map((r) => r.width));

const worstVault = { ...VAULT, streak: 112, avgWeeklyLink: 185700.4, lastDeposit: { link: 1234567.8, day: '2026-10-08' }, overdue: true };
const worstDossier = { ...DOSSIER, chain: { selector: '1', name: 'POLYGON KATANA' }, rank: 12, feeRank: 1, messages: 123456789, usd: 123.4e9, feesUsd: 123.4e9, week: { messages: 123456789, usd: 123.4e9 } };
const worstSitrep = { ...SITREP, messages: 12345678, pace: { projected: 12345678, yesterday: 9999999 }, usd: 123.4e9, feesUsd: 123.4e9, senders: 1234567, medianDeliveryS: 86399 };

describe('fitRow', () => {
  it('shrinks a slightly long row, to no less than 85%, before it drops or cuts anything', () => {
    // #given 40 characters in a box that holds 38 at 12.5
    // #when
    const fit = fitRow([[`${'x'.repeat(20)}`], [`${'y'.repeat(20)}`]], 12.5, 0, 38 * 7.5);
    // #then
    expect({ chars: fit.chars, small: fit.size < 12.5 && fit.size >= 12.5 * 0.85, fits: monoWidth(fit.chars, fit.size, 0) <= 38 * 7.5 }).toEqual({ chars: 40, small: true, fits: true });
  });

  it('drops the trailing segment before it cuts the first', () => {
    // #given a streak far too long, whose second segment is the average
    const fit = fitRow([[bright('112'), '-week deposit streak'], [' · ~', bright('185.7K'), ' a week']], 12.5, 0, 200);
    // #then
    expect(fit.pieces.map((p) => (typeof p === 'string' ? p : 'bright'))).toEqual(['bright', '-week deposit streak']);
  });

  it('ellipsizes the last piece, to at least six characters, when one segment is still too long', () => {
    // #when
    const fit = fitRow([['x'.repeat(80)]], 12.5, 0, 100);
    // #then
    expect({ text: fit.pieces, short: ellipsize('abcdefghij', 2) }).toEqual({ text: ['xxxxxxxxxxxxxx…'], short: 'abcde…' });
  });
});

describe('the intel cards keep every row inside its box', () => {
  it('holds the vault rows to the column, with a 112-week streak and ~185.7K a week', () => {
    // #when
    const tree = vaultTree(worstVault);
    // #then
    expect({ widest: widest(tree) <= px(COLUMN_WIDTH), streak: texts(tree).some((t) => t.includes('-week deposit streak')), kept: texts(tree).join('').includes('185.7K a week') }).toEqual({ widest: true, streak: true, kept: true });
  });

  it('holds the dossier rows to the column, shrinking the two-digit rank row rather than cutting it', () => {
    // #when
    const tree = dossierTree(worstDossier, new Map());
    const words = texts(tree).join('');
    // #then
    expect({ widest: widest(tree) <= px(COLUMN_WIDTH), rank: words.includes('#12 of 92 all time'), feeRank: words.includes('in fees this week') }).toEqual({ widest: true, rank: true, feeRank: true });
  });

  it('holds the dossier highlight of the fixtures to the column too', () => {
    // #then
    expect(widest(dossierTree(DOSSIER, new Map())) <= px(COLUMN_WIDTH)).toBe(true);
  });

  it('holds the SITREP rows to the left column with large numbers', () => {
    // #then
    expect(widest(sitrepTree(worstSitrep, new Map())) <= px(TEXT_WIDTH)).toBe(true);
  });

  it('shares the lane name budget in proportion, so Binance Smart Chain to Ethereum stays inside its medal slot', () => {
    // #when
    const [src, dst] = laneNames('BINANCE SMART CHAIN', 'ETHEREUM');
    const [a, c] = laneNames('A VERY LONG CHAIN NAME', 'ANOTHER VERY LONG ONE');
    // #then
    expect({ budget: src.length + dst.length <= LANE_NAME_BUDGET, ends: [src.endsWith('…'), dst], long: [a.length, c.length].every((n) => n >= 6) }).toEqual({ budget: true, ends: [true, 'ETHEREUM'], long: true });
  });

  it('draws the records lane and totals within their boxes', () => {
    // #given the BSC lane and a huge total
    const card = { ...RECORDS, messages: 123456789, usd: 123.4e9, medals: RECORDS.medals.map((m) => (m.lane ? { ...m, lane: { src: 'BINANCE SMART CHAIN', dst: 'Ethereum' } } : m)) };
    // #when
    const found = rows(recordsTree(card));
    // #then
    expect(found.filter((r) => r.width > px(TOTALS_WIDTH))).toEqual([]);
  });
});

describe('renderIntelCard inputs the bot may send badly', () => {
  it('draws only the five medal slots', () => {
    // #given seven medals
    const extra = [...RECORDS.medals, { kind: 'messages' as const, value: 777, day: '2026-01-01', lane: null }, { kind: 'messages' as const, value: 888, day: '2026-01-01', lane: null }];
    // #then
    expect(texts(recordsTree({ ...RECORDS, medals: extra })).filter((t) => t === '777' || t === '888')).toEqual([]);
  });

  it('draws a vault with no weekly series', () => {
    // #then
    expect(() => vaultTree({ ...VAULT, weekly: undefined as never })).not.toThrow();
  });

  it('drops the value row when the value is missing', () => {
    // #when
    const words = texts(vaultTree({ ...VAULT, valueUsd: undefined as never }));
    // #then
    expect(words.includes('$79.8M')).toBe(false);
  });
});
