import { describe, expect, it } from 'vitest';
import type { VNode } from '../worker/h';
import { broadcastTree } from '../worker/cards/broadcast-cards';
import { ctaFor } from '../worker/cards/cta';
import { MISSING_GLYPHS } from '../worker/cards/glyphs';
import { BASE, DAY, loadFixture, MONDAY, RECORD_DAY, texts } from './fixtures/broadcast';

const inputs = { load: loadFixture, icon: async (selector: string) => (selector === BASE ? 'data:image/svg+xml;base64,AAAA' : null) };
const tree = async (target: Parameters<typeof broadcastTree>[0]) => (await broadcastTree(target, inputs)) as VNode;

describe('daily broadcast card', () => {
  it('shows the day against its 7-day average, its leaders, and the busiest lane in the strip', async () => {
    // #when
    const words = texts(await tree({ kind: 'daily', day: DAY }));
    // #then 150 messages against 200, $2M against $8M, $3 against $4; $0.75 of $3 in LINK
    expect(words).toEqual(
      expect.arrayContaining([
        'ccip.dev', 'Daily report · Sat, Oct 10, 2026', 'Yesterday on CCIP',
        'Messages', '150', '25% vs 7d avg', 'Value moved', '$2.0M', '75%', 'Fees', '$3', 'Paid in LINK', '25%', '0.29 LINK',
        'Top token', 'syrupUSDC', '$500.0K', 'Top sender', 'xStocks', '97 msgs', 'Top fee chain', 'Base', '$2 fees',
        'Busiest lane: ', 'Ethereum', ' · $1.2M', `${ctaFor(DAY).lead} `, ctaFor(DAY).path,
      ]),
    );
  });

  it('shows the record a day set in the strip instead', async () => {
    // #when
    const words = texts(await tree({ kind: 'daily', day: RECORD_DAY }));
    // #then
    expect(words).toEqual(expect.arrayContaining(['New record: ', 'Most messages in a day', ' (300)']));
  });

  it('writes no glyph the card fonts lack', async () => {
    // #when
    const words = [...texts(await tree({ kind: 'daily', day: DAY })), ...texts(await tree({ kind: 'weekly', monday: MONDAY }))];
    // #then
    expect(words.filter((w) => MISSING_GLYPHS.test(w))).toEqual([]);
  });

  it('has no card for a day without totals or without leaders', async () => {
    // #when
    const cards = [await broadcastTree({ kind: 'daily', day: '2026-09-01' }, inputs), await broadcastTree({ kind: 'daily', day: '2026-10-09' }, inputs)];
    // #then
    expect(cards).toEqual([null, null]);
  });
});

describe('weekly broadcast card', () => {
  it('shows the week against the one before, its fees by day, and the top 3 fee chains', async () => {
    // #when
    const card = await tree({ kind: 'weekly', monday: MONDAY });
    // #then 1,450 messages against 1,400; $51M against $56M; $29 against $28, $7.25 of it in LINK
    expect(texts(card)).toEqual(
      expect.arrayContaining([
        'Weekly report · Oct 5 – 11, 2026', 'This week on CCIP', '1,450', '3.6% vs last week', '$51.0M', '8.9%', '$29', '3.6%', '25%', '$7 in LINK', 'Fees by day',
        'Top fee chains: ', 'Base', ' $1.8K', ' · ', 'Ethereum', ' $1.6K', 'Arbitrum One', ' $1.0K',
      ]),
    );
    expect(JSON.stringify(card).match(/"backgroundColor":"#4a7ff0"/g)).toHaveLength(7);
  });

  it('has no card for a week day-leaders.json does not list', async () => {
    // #when
    const card = await broadcastTree({ kind: 'weekly', monday: '2026-09-28' }, inputs);
    // #then
    expect(card).toBeNull();
  });
});
