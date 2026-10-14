import { describe, expect, it } from 'vitest';
import type { VNode } from '../worker/h';
import { trackedMilestones } from '@ccip-dev/core/records';
import { broadcastTree } from '../worker/cards/broadcast-cards';
import { bigSize } from '../worker/cards/broadcast-frame';
import { reserveSvg } from '../worker/cards/reserve-card';
import { ctaFor } from '../worker/cards/cta';
import { MISSING_GLYPHS } from '../worker/cards/glyphs';
import { BASE, DAY, DEPOSIT_TX, HISTORY, LEADERS, loadFixture, MONDAY, OUTFLOW_TX, RECORD_DAY, SENDER, texts } from './fixtures/broadcast';

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
        'Messages', '150', '25% vs 7d avg', 'Value moved', '$2.0M', '75%', 'Fees', '$3', 'Paid in LINK', '25%', '0.29 LINK', '62% data',
        'Top token', 'syrupUSDC', '$500.0K', 'Top sender', 'xStocks', '97 msgs', 'Top fee chain', 'Base', '$2 fees',
        'Busiest lane: ', 'Ethereum', ' · $1.2M', `${ctaFor(DAY).lead} `, ctaFor(DAY).path,
      ]),
    );
  });

  it('keeps a five-digit sender figure inside its cell, compact and on one line', async () => {
    // #given a top sender with 12,345 messages and a share
    const sender = { key: 'project:xstocks', label: 'xStocks', messages: 12_345, usd: 0, fee_usd: 1, share_pct: 4.8 };
    const load: typeof loadFixture = async (name) =>
      name === 'day-leaders.json' ? ({ ...LEADERS, days: LEADERS.days.map((d) => (d.day === DAY ? { ...d, sender } : d)) } as never) : loadFixture(name);
    // #when
    const words = texts(await broadcastTree({ kind: 'daily', day: DAY }, { ...inputs, load }));
    const figure = words.find((t) => t.includes('4.8%'));
    // #then the cell is 153px wide and the text 18px, so about 15 characters is the most that fits
    expect({ figure, fits: (figure ?? '').length <= 15 }).toEqual({ figure: '12.3K · 4.8%', fits: true });
  });

  it("shows an identity sender's share, and an unlabeled one by its short address", async () => {
    // #given the day's top sender as an identity with its share, then as an unlabeled address
    const withSender = (sender: object): typeof loadFixture => async (name) =>
      name === 'day-leaders.json' ? ({ ...LEADERS, days: LEADERS.days.map((d) => (d.day === DAY ? { ...d, sender } : d)) } as never) : loadFixture(name);
    const project = { key: 'project:xstocks', label: 'xStocks', messages: 319, usd: 0, fee_usd: 79.75, share_pct: 20.3 };
    const address = { key: `address:${SENDER}`, label: null, messages: 76, usd: 0, fee_usd: 19, share_pct: 4.8 };
    // #when
    const named = texts(await broadcastTree({ kind: 'daily', day: DAY }, { ...inputs, load: withSender(project) }));
    const unnamed = texts(await broadcastTree({ kind: 'daily', day: DAY }, { ...inputs, load: withSender(address) }));
    // #then
    expect([named, unnamed]).toEqual([
      expect.arrayContaining(['Top sender', 'xStocks', '319 msgs · 20%']),
      expect.arrayContaining(['Top sender', '0x7af7…ce09', '76 msgs · 4.8%']),
    ]);
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

  it('leaves the data line out for a day published before data messages were counted', async () => {
    // #given history.json without data_messages
    const old: typeof loadFixture = async (name) =>
      name === 'history.json' ? ({ ...HISTORY, days: HISTORY.days.map(({ data_messages: _, ...d }) => d) } as never) : loadFixture(name);
    // #when
    const words = texts(await broadcastTree({ kind: 'daily', day: DAY }, { ...inputs, load: old }));
    // #then
    expect(words.filter((w) => w.includes('data'))).toEqual([]);
  });
});

describe('cards from incomplete data', () => {
  const endingOn = (name: 'history.json' | 'replay.json', lastDay: string): typeof loadFixture => async (n) => {
    const file = await loadFixture(n);
    if (n !== name) return file;
    const { days } = file as { days: { day: string }[] };
    return { ...file, days: days.filter((d) => d.day <= lastDay) } as typeof file;
  };

  it('has no weekly card while history.json lacks a day of the week', async () => {
    // #given history.json ends on Saturday, Oct 10
    const load = endingOn('history.json', '2026-10-10');
    // #when
    const card = await broadcastTree({ kind: 'weekly', monday: MONDAY }, { ...inputs, load });
    // #then
    expect(card).toBeNull();
  });

  it('has no daily, weekly, record or milestone card when replay.json lacks the day it draws', async () => {
    // #given replay.json is stale: it ends on Oct 6, before every day these cards draw
    const load = endingOn('replay.json', '2026-10-06');
    // #when
    const cards = await Promise.all([
      broadcastTree({ kind: 'daily', day: DAY }, { ...inputs, load }),
      broadcastTree({ kind: 'weekly', monday: MONDAY }, { ...inputs, load }),
      broadcastTree({ kind: 'record', record: 'messages', day: RECORD_DAY }, { ...inputs, load }),
      broadcastTree({ kind: 'milestone', metric: 'messages', threshold: 2000 }, { ...inputs, load }),
    ]);
    // #then
    expect(cards).toEqual([null, null, null, null]);
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
        'Previous record ', '200 ', 'on Sep 28, 2026 · stood 13 days', 'Driven by ', 'Ethereum', 'Base', ': 30 messages',
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
      fees: expect.arrayContaining(['Most fees paid to CCIP in a day', '$6', '$4 ', 'Driven by ', 'Base', 'Arbitrum One', ': 5,712 messages', 'All-time fees now ', '$57']),
      largest: expect.arrayContaining(['Largest single fee', '$120.00', '$80.00 ', 'on Sep 30, 2026 · stood 11 days', 'Paid on ', 'Ethereum', ', paid in LINK']),
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
        '$750.0K ', 'at deposit · ', '$900.0K ', 'today (+20.0%)',
        '210.0K', 'LINK held', '3', 'weeks in a row', 'Nov 28', 'On pace for 1M', 'LINK ADDED PER WEEK · 3 WEEKS',
        'Weekly average: ', '75,000 LINK', ' ($800.0K) over 2 weeks', 'Track it: ', 'ccip.dev/reserve',
      ]),
      bars: 3,
      current: true,
    });
  });

  it('has no card for a gift, an outflow or an unknown transaction', async () => {
    expect([
      await broadcastTree({ kind: 'reserve', tx: '0x02' }, inputs),
      await broadcastTree({ kind: 'reserve', tx: OUTFLOW_TX }, inputs),
      await broadcastTree({ kind: 'reserve', tx: `0x${'cd'.repeat(32)}` }, inputs),
    ]).toEqual([null, null, null]);
  });

  it('writes no glyph the card fonts lack on any record kind, milestone metric or Reserve card', async () => {
    // #given every record kind the record day sets and every milestone the fixture history crosses
    const kinds = ['messages', 'value', 'fees', 'largest_fee'] as const;
    const milestones = trackedMilestones(HISTORY.days);
    // #when
    const words = [
      ...(await Promise.all(kinds.map(async (record) => texts(await tree({ kind: 'record', record, day: RECORD_DAY }))))).flat(),
      ...(await Promise.all(milestones.map(async (m) => texts(await tree({ kind: 'milestone', metric: m.metric, threshold: m.threshold }))))).flat(),
      ...texts(await tree({ kind: 'reserve', tx: DEPOSIT_TX })),
    ];
    // #then
    expect({ words: words.length > 0, milestones: milestones.length > 0, missing: words.filter((w) => MISSING_GLYPHS.test(w)) }).toEqual({
      words: true, milestones: true, missing: [],
    });
  });
});

describe('record card text column', () => {
  const longNames = { src: 'Ethereum Mainnet Optimism Superchain Rollup', dst: 'Arbitrum Nova Orbit Gaming Network Extra' };

  it('keeps the worst-case previous-record and lane lines inside the text column, wrapping instead of overflowing', async () => {
    // #given a $1.2K previous fee under a $5,000 record, and chains with long names on the largest fee's route
    const load: typeof loadFixture = async (name) => {
      const file = await loadFixture(name);
      if (name === 'history.json') {
        const history = file as Awaited<ReturnType<typeof loadFixture<'history.json'>>>;
        return { ...history, largest_fees: history.largest_fees!.map((f) => ({ ...f, fee_usd: f.message_id === '0x2' ? 1234.56 : 5000 })) } as typeof file;
      }
      if (name === 'replay.json' || name === 'chains.json') {
        return JSON.parse(JSON.stringify(file).replace('Ethereum Mainnet', longNames.src).replace('Arbitrum One', longNames.dst).replace('Base Mainnet', longNames.dst)) as typeof file;
      }
      return file;
    };
    // #when
    const card = JSON.stringify(await broadcastTree({ kind: 'record', record: 'largest_fee', day: RECORD_DAY }, { ...inputs, load }));
    // #then the previous-record row, the route row and the route's own names all carry the column's width cap
    expect({ capped: card.match(/"maxWidth":660/g)?.length, wraps: card.includes('"flexWrap":"wrap"'), previous: card.includes('$1.2K ') }).toEqual({ capped: 3, wraps: true, previous: true });
  });
});

describe('bigSize', () => {
  it.each([[7, 132], [8, 104], [10, 104], [11, 80]])('sizes a %i-character value at %i px', (length, size) => {
    expect(bigSize('9'.repeat(length))).toBe(size);
  });
});

describe('reserveSvg', () => {
  const facts = (weeks: { week: string; link: number }[]) => ({ weeks }) as Parameters<typeof reserveSvg>[0];

  it('draws the same picture for the same seed', () => {
    const d = facts([{ week: 'a', link: 5 }, { week: 'b', link: 9 }]);
    expect(reserveSvg(d, 3)).toBe(reserveSvg(d, 3));
  });

  it('has no NaN or Infinity for an empty series or one that added nothing', () => {
    expect([facts([]), facts([{ week: 'a', link: 0 }, { week: 'b', link: 0 }])].map((d) => /NaN|Infinity/.test(reserveSvg(d, 3)))).toEqual([false, false]);
  });
});
