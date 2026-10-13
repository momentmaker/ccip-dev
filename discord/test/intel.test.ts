import { describe, expect, it } from 'vitest';
import { chainChoices, chainTotals, dossierCard, findChain, MAX_CHOICES, recordsCard, sitrepCard, vaultCard, weeklyDeposits } from '../src/intel';
import { ARB, AVAX, BASE, CHAINS, ETH, HISTORY, MONAD, PLASMA, REPLAY, RESERVE, SOURCES, TODAY, WEMIX } from './fixtures/intel';

describe('/cciptoday', () => {
  it("projects today's messages over the share of the UTC day gone, against yesterday", () => {
    // #when 685 messages at 11:28:01.860, 47.78% of the day
    const card = sitrepCard(TODAY, HISTORY, CHAINS);
    // #then
    expect({ ...card, pace: { projected: Math.round(card.pace!.projected * 100) / 100, yesterday: card.pace!.yesterday } }).toEqual({
      updatedAt: '2026-10-13T11:28:01.860Z',
      messages: 685,
      pace: { projected: 1433.66, yesterday: 1625 },
      usd: 44064348.04,
      feesUsd: 419.36,
      linkSharePct: 0.25,
      senders: 211,
      medianDeliveryS: 820,
      lanes: [
        { src: { selector: MONAD, name: 'Monad' }, dst: { selector: ETH, name: 'Ethereum' }, usd: 16298903.16 },
        { src: { selector: ETH, name: 'Ethereum' }, dst: { selector: MONAD, name: 'Monad' }, usd: 10704140.65 },
        { src: { selector: ETH, name: 'Ethereum' }, dst: { selector: PLASMA, name: 'Plasma' }, usd: 6754321.91 },
        { src: { selector: MONAD, name: 'Monad' }, dst: { selector: AVAX, name: 'Avalanche' }, usd: 1999585.26 },
        { src: { selector: MONAD, name: 'Monad' }, dst: { selector: PLASMA, name: 'Plasma' }, usd: 1468701.01 },
      ],
    });
  });

  it('has no yesterday when history.json says it had no messages, rather than a pace against zero', () => {
    // #given history.json ending on a yesterday of 0 messages
    const last = HISTORY.days.at(-1)!;
    const empty = { ...HISTORY, days: [...HISTORY.days.slice(0, -1), { ...last, messages: 0 }] };
    // #when
    const card = sitrepCard(TODAY, empty, CHAINS);
    // #then
    expect(card.pace?.yesterday).toBeNull();
  });

  it('projects no less than the messages so far when today.json is updated past midnight under its day', () => {
    // #given 685 messages for 13 Oct, updated at 00:30 on the 14th
    const stale = { ...TODAY, updated_at: '2026-10-14T00:30:00.000Z' };
    // #when
    const card = sitrepCard(stale, HISTORY, CHAINS);
    // #then the whole day has gone, not 102% of it
    expect(card.pace?.projected).toBe(685);
  });

  it('has no pace before 01:00 UTC, and no yesterday when history.json does not end on it', () => {
    // #when
    const early = sitrepCard({ ...TODAY, updated_at: '2026-10-13T00:59:59.000Z' }, HISTORY, CHAINS);
    const late = sitrepCard(TODAY, { ...HISTORY, days: HISTORY.days.slice(0, -1) }, CHAINS);
    // #then
    expect([early.pace, late.pace?.yesterday]).toEqual([null, null]);
  });
});

describe('/ccipchain', () => {
  it('counts each chain both ways over replay.json', () => {
    // #when
    const all = chainTotals(REPLAY, null, null);
    // #then
    expect(Object.fromEntries([...all].map(([s, t]) => [s, t.usd]))).toEqual({ [ETH]: 44_000_000, [BASE]: 12_900_000, [ARB]: 29_000_000, [MONAD]: 5_500_000, [AVAX]: 400_000 });
  });

  it("ranks the chain by all-time value, adds its top-3 fee week, and orbits its partners of the last 7 days", () => {
    // #when
    const card = dossierCard(BASE, REPLAY, SOURCES, CHAINS);
    // #then
    expect(card).toEqual({
      asOf: '2026-10-13T06:01:00.177Z',
      chain: { selector: BASE, name: 'Base' },
      rank: 3,
      ranked: 5,
      feeRank: 1,
      messages: 225,
      usd: 12_900_000,
      feesUsd: 356_718.47,
      week: { messages: 115, usd: 10_900_000 },
      days: [
        { day: '2026-10-06', messages: 25 }, { day: '2026-10-07', messages: 7 }, { day: '2026-10-08', messages: 0 }, { day: '2026-10-09', messages: 30 },
        { day: '2026-10-10', messages: 10 }, { day: '2026-10-11', messages: 15 }, { day: '2026-10-12', messages: 28 },
      ],
      partners: [{ chain: { selector: ETH, name: 'Ethereum' }, usd: 9_000_000 }, { chain: { selector: MONAD, name: 'Monad' }, usd: 1_500_000 }, { chain: { selector: AVAX, name: 'Avalanche' }, usd: 400_000 }],
      since: '2023-09-16',
    });
  });

  it("dates the chain's first CCIP message from chains.json's first_seen, and from replay.json only when that is missing", () => {
    // #given first_seen a day before replay.json's first_day for Base, and none for Arbitrum
    const chains = { ...CHAINS, chains: CHAINS.chains.map((c) => (c.selector === BASE ? { ...c, first_seen: '2023-09-15T23:37:29.000Z' } : c.selector === ARB ? { ...c, first_seen: null } : c)) };
    // #when
    const since = [dossierCard(BASE, REPLAY, SOURCES, chains)?.since, dossierCard(ARB, REPLAY, SOURCES, chains)?.since];
    // #then
    expect(since).toEqual(['2023-09-15', '2023-09-17']);
  });

  it('leaves out the fee rank outside the top 3, the fees of a chain without them, and has no card for a chain CCIP never saw', () => {
    // #when
    const arbitrum = dossierCard(ARB, REPLAY, SOURCES, CHAINS);
    // #then
    expect({ rank: arbitrum?.rank, feeRank: arbitrum?.feeRank, fees: arbitrum?.feesUsd, unseen: dossierCard(PLASMA, REPLAY, SOURCES, CHAINS) }).toEqual({ rank: 2, feeRank: null, fees: null, unseen: null });
  });

  it('finds a chain however it is typed: name, " Mainnet", registry name, selector, any case', () => {
    // #when
    const found = ['base', 'Base Mainnet', ' BASE ', 'ethereum-mainnet-base-1', BASE, 'Arbitrum', 'basee', ''].map((q) => findChain(CHAINS, q)?.selector ?? null);
    // #then
    expect(found).toEqual([BASE, BASE, BASE, BASE, BASE, ARB, null, null]);
  });

  it('suggests at most 25 chains whose name or registry name holds the typed text, those starting with it first', () => {
    // #given 40 more chains
    const many = { ...CHAINS, chains: [...CHAINS.chains, ...Array.from({ length: 40 }, (_, i) => ({ ...CHAINS.chains[0]!, selector: String(i), name: `chain-${i}-mainnet`, display_name: `Chain ${i} Mainnet` }))] };
    // #when
    const choices = { typed: chainChoices(CHAINS, 'as'), first: chainChoices(CHAINS, 'A').map((c) => c.name), registry: chainChoices(CHAINS, 'MONAD-main'), all: chainChoices(many, '').length };
    // #then every registry name holds an "a", in "mainnet"
    expect(choices).toEqual({
      typed: [{ name: 'Base', value: BASE }, { name: 'Plasma', value: PLASMA }],
      first: ['Arbitrum', 'Avalanche', 'Base', 'Ethereum', 'Monad', 'Plasma', 'WEMIX'],
      registry: [{ name: 'Monad', value: MONAD }],
      all: MAX_CHOICES,
    });
  });
});

describe('/linkreserve', () => {
  it("reads the vault from reserve.json, leaving out this week while it has no deposit", () => {
    // #when
    const card = vaultCard(RESERVE)!;
    // #then
    expect({ ...card, weekly: [card.weekly.length, card.weekly.at(-1)] }).toEqual({
      asOf: '2026-10-13T11:00:55.843Z',
      link: 6204681.79,
      valueUsd: 79818684,
      priceUsd: 12.8643,
      changePct: 15.66,
      costUsd: 69008608.43,
      streak: 62,
      avgWeeklyLink: 85687.03,
      lastDeposit: { link: 82480.36, day: '2026-10-08' },
      nextDue: '2026-10-15',
      overdue: false,
      weekly: [26, 82480.36],
      milestone: { link: 7_000_000, eta: '2026-12-17' },
    });
  });

  it('keeps this week once it has a deposit, and says when one is overdue', () => {
    // #given this week's deposit has come, and a Reserve whose next deposit is overdue
    const deposited = { ...RESERVE, weekly: [...RESERVE.weekly.slice(0, -1), { week: '2026-10-12', deposits: 1, link: 80_000, usd: 1_000_000 }] };
    const overdue = { ...RESERVE, pace: { ...RESERVE.pace!, deposit_overdue: true } };
    // #then
    expect([weeklyDeposits(deposited).at(-1), vaultCard(overdue)?.overdue, vaultCard({ ...RESERVE, latest: null })]).toEqual([80_000, true, null]);
  });
});

describe('/cciprecords', () => {
  it("takes the five records by the Records page's rules, the newest the one set last", () => {
    // #when
    const card = recordsCard(HISTORY, CHAINS);
    // #then
    expect(card).toEqual({
      asOf: '2026-10-13T06:01:00.177Z',
      medals: [
        { kind: 'messages', value: 47414, day: '2026-02-22', lane: null },
        { kind: 'value', value: 330_226_186.84, day: '2026-04-20', lane: null },
        { kind: 'fees', value: 57_347.81, day: '2026-07-09', lane: null },
        { kind: 'largest_fee', value: 9002.29, day: '2025-08-19', lane: { src: 'WEMIX', dst: 'Ethereum' } },
        { kind: 'link_share', value: 100, day: '2023-07-08', lane: null },
      ],
      newest: 'fees',
      messages: 56_209,
      usd: 488_226_186.84,
      since: '2023-07-06',
    });
  });

  it('makes a record set yesterday the newest', () => {
    // #given 2026-10-12 is the busiest day yet
    const history = { ...HISTORY, days: HISTORY.days.map((d) => (d.day === '2026-10-12' ? { ...d, messages: 50_000 } : d)) };
    // #then
    expect(recordsCard(history, CHAINS).newest).toBe('messages');
  });

  it('names the largest fee\'s lane by selector when chains.json lacks a chain', () => {
    // #given
    const chains = { ...CHAINS, chains: CHAINS.chains.filter((c) => c.selector !== WEMIX) };
    // #then
    expect(recordsCard(HISTORY, chains).medals[3]!.lane).toEqual({ src: WEMIX, dst: 'Ethereum' });
  });
});

describe('the rulings', () => {
  it('breaks a tie for the newest record by the order of the five records, the first listed winning', () => {
    // #given the busiest and the biggest day are both 2026-10-12
    const history = { ...HISTORY, days: HISTORY.days.map((d) => (d.day === '2026-10-12' ? { ...d, messages: 50_000, usd_value: 400_000_000 } : d)) };
    // #when
    const card = recordsCard(history, CHAINS);
    // #then
    expect([card.medals[0]!.day, card.medals[1]!.day, card.newest]).toEqual(['2026-10-12', '2026-10-12', 'messages']);
  });

  it('hands chain names to the card raw, without stripping characters', () => {
    // #given a chain named with characters the card must handle itself
    const chains = { ...CHAINS, chains: CHAINS.chains.map((c) => (c.selector === BASE ? { ...c, display_name: 'Bäse ✦ Mainnet' } : c)) };
    // #when
    const card = dossierCard(BASE, REPLAY, SOURCES, chains);
    // #then
    expect(card?.chain.name).toBe('Bäse ✦');
  });

  it('drops only the week in progress, and only when it is empty', () => {
    // #given an empty week that is not the current one
    const stale = { ...RESERVE, updated_at: '2026-10-20T11:00:55.843Z' };
    // #then
    expect(weeklyDeposits(stale).at(-1)).toBe(0);
  });
});
