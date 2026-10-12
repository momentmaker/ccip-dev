import { describe, expect, it } from 'vitest';
import type { VNode } from '../worker/h';
import { broadcastTree } from '../worker/cards/broadcast-cards';
import { ctaFor } from '../worker/cards/cta';
import { MISSING_GLYPHS } from '../worker/cards/glyphs';
import { BASE, DAY, DEPOSIT_TX, loadFixture, MONDAY, RECORD_DAY, texts } from './fixtures/broadcast';

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

describe('record broadcast card', () => {
  it('shows the new record big, the one it beat and how long that stood, what drove it, and the all-time total', async () => {
    // #when
    const card = await tree({ kind: 'record', record: 'messages', day: RECORD_DAY });
    // #then 300 messages beat Sep 28's 200; the busiest lane drove it; 12 × 200 + 150 + 300 messages so far
    expect(texts(card)).toEqual(
      expect.arrayContaining([
        'New all-time record · Sun, Oct 11, 2026', 'NEW RECORD', 'Most messages in a day', '300',
        'Previous record ', '200', ' on Sep 28, 2026 · stood 13 days', 'Driven by ', 'Ethereum', 'Base', ': 30 messages',
        'All-time messages now ', '2,850', 'Every record: ', 'ccip.dev/records',
      ]),
    );
    expect(JSON.stringify(card)).toContain('rgba(255,207,90,0.9)');
  });

  it("names each record's own driver: the top fee lane for fees, the route and token for the largest fee", async () => {
    // #when
    const fees = texts(await tree({ kind: 'record', record: 'fees', day: RECORD_DAY }));
    const largest = texts(await tree({ kind: 'record', record: 'largest_fee', day: RECORD_DAY }));
    // #then
    expect({ fees, largest }).toEqual({
      fees: expect.arrayContaining(['Most fees paid to CCIP in a day', '$6', '$4', 'Driven by ', 'Base', 'Arbitrum One', ': 5,712 messages', 'All-time fees now ', '$57']),
      largest: expect.arrayContaining(['Largest single fee', '$120.00', '$80.00', ' on Sep 30, 2026 · stood 11 days', 'Paid on ', 'Ethereum', ', paid in LINK']),
    });
  });

  it('has no card for a record the day did not set', async () => {
    expect([
      await broadcastTree({ kind: 'record', record: 'link_share', day: RECORD_DAY }, inputs),
      await broadcastTree({ kind: 'record', record: 'messages', day: DAY }, inputs),
    ]).toEqual([null, null]);
  });
});

describe('milestone broadcast card', () => {
  it('shows the threshold and the day it was crossed', async () => {
    // #when 200 messages a day reach 2,000 on the tenth day, Oct 7
    const card = await tree({ kind: 'milestone', metric: 'messages', threshold: 2000 });
    // #then
    expect(texts(card)).toEqual(
      expect.arrayContaining(['Milestone · Wed, Oct 7, 2026', 'MILESTONE', 'All-time messages on CCIP', '2,000', 'Crossed on Oct 7, 2026', 'All-time messages now ']),
    );
  });

  it('has no card for a threshold not crossed yet', async () => {
    expect(await broadcastTree({ kind: 'milestone', metric: 'messages', threshold: 5000 }, inputs)).toBeNull();
  });
});

describe('Reserve broadcast card', () => {
  it('shows the deposit, its value then and now, the balance, the streak, the pace and the weekly bars', async () => {
    // #when
    const card = await tree({ kind: 'reserve', tx: DEPOSIT_TX });
    // #then 210,004 LINK held after it; three deposits in a row; 75,000 LINK a week reaches 1M on Nov 28
    const bars = atob(String((card.props.children as { props: { src?: string } }[])[0]!.props.src).split(',')[1]!);
    expect({
      words: texts(card),
      bars: (bars.match(/<rect x="/g) ?? []).length,
      current: bars.includes('fill="#7de3ff" opacity="1"'),
    }).toEqual({
      words: expect.arrayContaining([
        'Chainlink Reserve · Tue, Sep 15, 2026', 'New deposit into the Reserve', '+60,000', 'LINK',
        '$750.0K', ' at deposit', ' · ', '$900.0K', ' today (+20.0%)',
        '210.0K', 'LINK held', '3', 'weeks in a row', 'Nov 28', 'On pace for 1M', 'LINK ADDED PER WEEK · 3 WEEKS',
        'Weekly average: ', '75,000 LINK', ' ($800.0K) over 4 weeks', 'Track it: ', 'ccip.dev/reserve',
      ]),
      bars: 3,
      current: true,
    });
  });

  it('has no card for a gift, an outflow or an unknown transaction', async () => {
    expect([
      await broadcastTree({ kind: 'reserve', tx: '0x02' }, inputs),
      await broadcastTree({ kind: 'reserve', tx: '0x04' }, inputs),
      await broadcastTree({ kind: 'reserve', tx: `0x${'cd'.repeat(32)}` }, inputs),
    ]).toEqual([null, null, null]);
  });

  it('writes no glyph the card fonts lack on the record, milestone and Reserve cards', async () => {
    const words = [
      ...texts(await tree({ kind: 'record', record: 'value', day: RECORD_DAY })),
      ...texts(await tree({ kind: 'milestone', metric: 'messages', threshold: 2000 })),
      ...texts(await tree({ kind: 'reserve', tx: DEPOSIT_TX })),
    ];
    expect(words.filter((w) => MISSING_GLYPHS.test(w))).toEqual([]);
  });
});
