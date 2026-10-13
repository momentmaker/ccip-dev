import { describe, expect, it } from 'vitest';
import { textWidthEm } from '../worker/linkmarine/inter-black';
import { medalFitWidth, medalSize, recordsTree } from '../worker/linkmarine/records-card';
import { dueText, FIGURE_TRACKING, FIGURE_WIDTH, figureSize, vaultTree } from '../worker/linkmarine/vault-card';
import { texts } from './fixtures/broadcast';
import { DRAWABLE_TEXT, RECORDS, VAULT } from './fixtures/linkmarine';

describe('the vault card', () => {
  it('shows the LINK held, its gain on cost, the streak, the last and next deposits and the milestone', () => {
    // #when
    const words = texts(vaultTree(VAULT));
    // #then
    expect(words).toEqual(
      expect.arrayContaining([
        'CHAINLINK RESERVE', '6,204,682', 'LINK held', '$79.8M', ' at $12.86', '15.7%', ' on its $69.0M cost', '62', '-week deposit streak · ~', '85.7K', ' a week',
        'last ', '82,480 LINK', ' on Thu 8 Oct', 'next one due ~Thu 15 Oct', 'LINK DEPOSITED A WEEK · LAST 6 MONTHS', '7,000,000 LINK ETA 17 DEC 2026', 'AS OF 13 OCT 2026 · 11:00 UTC',
      ]),
    );
  });

  it('says when a deposit is overdue, and nothing when none is expected', () => {
    // #then
    expect([dueText({ ...VAULT, overdue: true }), dueText({ ...VAULT, nextDue: null })]).toEqual(['overdue since Thu 15 Oct', null]);
  });

  it('sizes the big LINK figure to stay inside its column, up to ten digits', () => {
    // #given the held amount as the card prints it
    const figures = ['0', '6,204,682', '99,999,999', '9,999,999,999'];
    // #when
    const sizes = figures.map(figureSize);
    // #then the usual figure keeps its full size and none runs past the column
    expect({
      usual: sizes[1],
      overflowing: figures.filter((f, i) => textWidthEm(f, FIGURE_TRACKING) * sizes[i]! > FIGURE_WIDTH),
      shrinks: sizes[3]! < sizes[1]!,
    }).toEqual({ usual: 52, overflowing: [], shrinks: true });
  });
});

describe('the hall of records card', () => {
  it('shows the five all-time records with their days, the newest raised, and the all-time totals', () => {
    // #when
    const words = texts(recordsTree(RECORDS));
    // #then
    expect({
      words,
      newest: words.filter((w) => w === 'NEWEST').length,
    }).toEqual({
      words: expect.arrayContaining([
        'HALL OF RECORDS · CCIP ALL TIME', '47,414', 'MESSAGES', 'IN ONE DAY', '22 FEB 2026', '$330.2M', 'MOVED', '20 APR 2026', '$57.3K', 'IN FEES', '9 JUL 2026',
        '$9.0K', 'ONE FEE', 'WEMIX', 'ETHEREUM', '19 AUG 2025', '100%', 'PAID IN LINK', '8 JUL 2023', '1,578,970 messages · ', '$24.3B', ' moved since 6 Jul 2023', 'AS OF 13 OCT 2026 · 06:01 UTC',
      ]),
      newest: 1,
    });
  });

  it('shrinks a long value to stay inside its medal, the raised one a little larger', () => {
    // #then
    expect(['47,414', '$57.3K', '$330.2M'].flatMap((v) => [medalSize(v, false), medalSize(v, true)])).toEqual([20, 24, 20, 24, 16, 20]);
  });

  it('keeps even a huge value inside its medal, raised or not', () => {
    // #given values far beyond today's records
    const values = ['1,578,970', '99,999,999', '9,999,999,999', '$999.9B', '$1,234.5T'];
    // #when
    const widths = values.flatMap((v) => [false, true].map((raised) => textWidthEm(v, 0) * medalSize(v, raised) - medalFitWidth(raised)));
    // #then
    expect(widths.filter((w) => w > 0)).toEqual([]);
  });

  it('writes no character the card fonts lack', () => {
    // #when
    const words = [...texts(vaultTree(VAULT)), ...texts(recordsTree(RECORDS))];
    // #then
    expect(words.filter((w) => !DRAWABLE_TEXT.test(w))).toEqual([]);
  });
});
