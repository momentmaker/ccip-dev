import { rankIdentities, VIA_TOKEN_BACKFILL_DAY_SQL, VIA_TOKEN_CREDITS_SQL, type Dim } from '@ccip-dev/core';
import { fakeCcip, NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { runFinalize } from '../src/jobs/finalize';
import { identitiesOf, labelCoverageOf, rankedIdentities, senderBook } from '../src/senders';
import * as store from '../src/store';
import { backfillViaToken } from '../src/via-token-backfill';
import { harness, liveRow, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const BASE = NETWORKS.base.chainSelector;
const ETH = NETWORKS.ethereum.chainSelector;
const GROUP = 'group-eliza';
const ELIZA_BASE = '0x00000000000000000000000000000000000e1a01';
const ELIZA_ETH = '0x00000000000000000000000000000000000e1a02';
const LOOSE = '0x00000000000000000000000000000000000b0001';
const WALLET = '0x00000000000000000000000000000000000c0001';
const APP = '0x00000000000000000000000000000000000d0001';

describe('backfillViaToken', () => {
  const DAY = '2026-10-07';
  const NOW = '2026-10-08T00:07:00.000Z';
  const CURSOR = 'via_token_backfill:before';
  const at = (minute: number) => `${DAY}T10:0${minute}:00.000Z`;
  const EXPECTED = [
    { key: `${BASE}:${WALLET}|${BASE}:${LOOSE}`, messages: 2, usd_value: 16, fee_usd: 2 },
    { key: `${BASE}:${WALLET}|${GROUP}`, messages: 2, usd_value: 15, fee_usd: 1 },
  ];
  const TOTALS = { messages: 1, token_messages: 1, usd_value: 0, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 };

  /** The wallet bridged elizaOS twice and a token outside the registry once, and sent one data message; an app sent elizaOS for it once; one send carried the loose token first and elizaOS second, and one has no origin. */
  async function seedDay(): Promise<void> {
    await seedRegistry([NETWORKS.base], [{ chainSelector: BASE, address: ELIZA_BASE, symbol: 'ELIZA', name: 'elizaOS', decimals: 18, groupId: GROUP }]);
    await store.upsertListRows(
      env.DB,
      [
        liveRow({ id: 'w1', sendTs: at(1), sender: WALLET }, { origin: WALLET, token_count: 1, usd_value: 10, fee_usd: 1 }),
        liveRow({ id: 'w2', sendTs: at(2), sender: WALLET }, { origin: WALLET, token_count: 1, usd_value: 5 }),
        liveRow({ id: 'w3', sendTs: at(3), sender: WALLET }, { origin: WALLET, token_count: 1, usd_value: 7, fee_usd: 2 }),
        liveRow({ id: 'w4', sendTs: at(4), sender: WALLET }, { origin: WALLET }),
        liveRow({ id: 'a1', sendTs: at(5), sender: APP }, { origin: WALLET, token_count: 1, usd_value: 3 }),
        liveRow({ id: 'second', sendTs: at(6), sender: WALLET }, { origin: WALLET, token_count: 2, usd_value: 9 }),
        liveRow({ id: 'no-origin', sendTs: at(7), sender: WALLET }, { origin: null, token_count: 1, usd_value: 4 }),
      ],
      [
        { message_id: 'w1', idx: 0, chain: BASE, token: ELIZA_BASE, amount: '1', usd_value: 10 },
        { message_id: 'w2', idx: 0, chain: BASE, token: ELIZA_BASE, amount: '1', usd_value: 5 },
        { message_id: 'w3', idx: 0, chain: BASE, token: LOOSE, amount: '1', usd_value: 7 },
        { message_id: 'a1', idx: 0, chain: BASE, token: ELIZA_BASE, amount: '1', usd_value: 3 },
        { message_id: 'second', idx: 0, chain: BASE, token: LOOSE, amount: '1', usd_value: 1 },
        { message_id: 'second', idx: 1, chain: BASE, token: ELIZA_BASE, amount: '1', usd_value: 8 },
        { message_id: 'no-origin', idx: 0, chain: BASE, token: ELIZA_BASE, amount: '1', usd_value: 4 },
      ],
    );
  }

  async function finalizeDay(): Promise<void> {
    await store.setMeta(env.DB, 'live_start_day', DAY);
    await store.setMeta(env.DB, 'last_finalize_day', '2026-10-06');
    await store.setMeta(env.DB, 'last_archived_day', '2026-10-06');
    await runFinalize(harness({ now: NOW, ccip: fakeCcip({ messages: [] }) }).c, 'early');
  }

  const viaRows = async () =>
    (await env.DB.prepare("SELECT key, messages, usd_value, fee_usd FROM daily_breakdown WHERE dim = 'via_token' ORDER BY key").all()).results;
  const backfill = (maxDays?: number) => backfillViaToken(harness({ now: NOW }).c, maxDays);
  const rollUp = (day: string) => store.replaceDaily(env.DB, { day, ...TOTALS }, [], NOW);

  it("rolls up a wallet's direct sends by their first token's group or the token itself, and never an app's send", async () => {
    // #given
    await seedDay();
    // #when
    await finalizeDay();
    // #then
    expect(await viaRows()).toEqual(EXPECTED);
  });

  it('backfills the same rows the rollup writes', async () => {
    // #given a finalized day whose via_token rows are gone, as before the dimension existed
    await seedDay();
    await finalizeDay();
    await env.DB.prepare("DELETE FROM daily_breakdown WHERE dim = 'via_token'").run();
    // #when
    await backfill();
    // #then
    expect(await viaRows()).toEqual(EXPECTED);
  });

  it('leaves one row per key when the backfill runs twice over a finalized day, and when the day is finalized again after it', async () => {
    // #given
    await seedDay();
    await finalizeDay();
    // #when
    await backfill();
    await store.setMeta(env.DB, CURSOR, null);
    await backfill();
    await finalizeDay();
    // #then
    expect(await viaRows()).toEqual(EXPECTED);
  });

  it('never keys a send by its second token, nor a send with no origin', async () => {
    // #given only the send carrying elizaOS second and the one with no origin
    await seedDay();
    await env.DB.prepare("DELETE FROM messages WHERE message_id NOT IN ('second', 'no-origin')").run();
    await rollUp(DAY);
    // #when
    await backfill();
    // #then
    expect(await viaRows()).toEqual([{ key: `${BASE}:${WALLET}|${BASE}:${LOOSE}`, messages: 1, usd_value: 9, fee_usd: null }]);
  });

  it('writes nothing for a day that was never rolled up', async () => {
    // #given
    await seedDay();
    // #when
    await store.backfillViaTokenDay(env.DB, DAY);
    // #then
    expect(await viaRows()).toEqual([]);
  });

  it("reads the day's messages by messages_day", async () => {
    // #when
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${VIA_TOKEN_BACKFILL_DAY_SQL}`).bind(DAY).all<{ detail: string }>();
    // #then
    expect(plan.results.map((r) => r.detail)).toContainEqual(expect.stringMatching(/messages_day \(day=\?\)/));
  });

  it('walks back from today, newest first, a run of days at a time, and ends at done', async () => {
    // #given five rolled-up days before today
    for (const day of ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']) await rollUp(day);
    const cursors: (string | null)[] = [];
    // #when
    for (let run = 0; run < 4; run++) {
      await backfill(2);
      cursors.push(await store.getMeta(env.DB, CURSOR));
    }
    // #then
    expect(cursors).toEqual(['2026-10-06', '2026-10-04', '2026-10-03', 'done']);
  });

  it('does nothing once done', async () => {
    // #given a rolled-up day with no via_token rows, and the cursor at done
    await seedDay();
    await rollUp(DAY);
    await store.setMeta(env.DB, CURSOR, 'done');
    // #when
    await backfill();
    // #then
    expect(await viaRows()).toEqual([]);
  });
});

describe('via-token store queries', () => {
  const DAY = '2026-10-13';
  const NOW = '2026-10-14T00:07:00.000Z';
  const W1 = '0x0000000000000000000000000000000000000a01';
  const W2 = '0x0000000000000000000000000000000000000a02';
  const W3 = '0x0000000000000000000000000000000000000a03';
  const LABELED_WALLET = '0x0000000000000000000000000000000000000a04';
  const ELIZA_APP = '0x0000000000000000000000000000000000000a05';
  const ETH_ONLY_WALLET = '0x0000000000000000000000000000000000000a06';
  const TOTALS = { day: DAY, messages: 200, token_messages: 200, usd_value: 2_000, fee_usd: 20, unique_senders: 5, median_delivery_s: null, unpriced_messages: 0 };
  const row = (dim: Dim, key: string, messages: number, fee_usd: number) => ({ day: DAY, dim, key, messages, usd_value: messages * 10, fee_usd });
  /** W1 only bridged elizaOS; W2 bridged it 10 times and USDC 5 times of its 30; W3 sent 25 through no token; a labeled wallet bridged elizaOS 7 times. */
  const ROWS = [
    row('sender', `${BASE}:${W1}`, 50, 5), row('via_token', `${BASE}:${W1}|${GROUP}`, 50, 5),
    row('sender', `${BASE}:${W2}`, 30, 3), row('via_token', `${BASE}:${W2}|${GROUP}`, 10, 1), row('via_token', `${BASE}:${W2}|group-usdc`, 5, 0.5),
    row('sender', `${BASE}:${W3}`, 25, 2.5),
    row('sender', `${BASE}:${LABELED_WALLET}`, 7, 0.7), row('via_token', `${BASE}:${LABELED_WALLET}|${GROUP}`, 7, 0.7),
  ];

  beforeEach(async () => {
    await store.replaceDaily(env.DB, TOTALS, ROWS, NOW);
  });

  it('credits each source chain with the claimed direct sends of senders no label names', async () => {
    // #when
    const credits = await store.viaTokenCreditsOf(env.DB, DAY, DAY, [GROUP], [LABELED_WALLET]);
    // #then
    expect(credits).toEqual([{ key: `${BASE}|${GROUP}`, messages: 60, usd_value: 600, fee_usd: 6 }]);
  });

  it('credits each day separately, for the day leaders', async () => {
    // #when
    const credits = await store.viaTokenCreditDays(env.DB, DAY, DAY, [GROUP], [LABELED_WALLET]);
    // #then
    expect(credits).toEqual([{ day: DAY, key: `${BASE}|${GROUP}`, messages: 60, usd_value: 600, fee_usd: 6 }]);
  });

  it('ranks unlabeled addresses by what the move leaves them, and drops one with nothing left', async () => {
    // #when
    const before = await store.topUnlabeledSenders(env.DB, DAY, DAY, [LABELED_WALLET], 1, 'messages', []);
    const after = await store.topUnlabeledSenders(env.DB, DAY, DAY, [LABELED_WALLET], 2, 'messages', [GROUP]);
    // #then W1's 50 all moved; W2 keeps 20 of 30, its USDC sends included, since no project claims USDC
    expect({ before: before.map((r) => r.key), after: after.map((r) => [r.key, r.messages, r.fee_usd]) }).toEqual({
      before: [`${BASE}:${W1}`],
      after: [[`${BASE}:${W2}`, 20, 2], [`${BASE}:${W3}`, 25, 2.5]],
    });
  });

  it.each(['value', 'fees'] as const)('ranks by %s what the move leaves a partly moved wallet, and drops a fully moved one', async (order) => {
    // #when W1 moved everything and has the highest fees; W2's raw value and fees beat W3's until its claimed sends leave
    const rows = await store.topUnlabeledSenders(env.DB, DAY, DAY, [LABELED_WALLET], 3, order, [GROUP]);
    // #then
    expect(rows.map((r) => [r.key, r.messages, r.usd_value, r.fee_usd])).toEqual([
      [`${BASE}:${W2}`, 20, 200, 2],
      [`${BASE}:${W3}`, 25, 250, 2.5],
    ]);
  });

  it('keeps the busiest address by value and by fees from what it keeps', async () => {
    // #when
    const [byValue] = await store.topUnlabeledSenders(env.DB, DAY, DAY, [LABELED_WALLET], 1, 'value', [GROUP]);
    const [byFees] = await store.topUnlabeledSenders(env.DB, DAY, DAY, [LABELED_WALLET], 1, 'fees', [GROUP]);
    // #then
    expect([byValue?.key, byFees?.key]).toEqual([`${BASE}:${W3}`, `${BASE}:${W3}`]);
  });

  it('gives each day its busiest unlabeled address by what the move leaves it', async () => {
    // #when
    const rows = await store.dailyTopUnlabeledSenders(env.DB, DAY, DAY, [LABELED_WALLET], [GROUP]);
    // #then
    expect(rows.map((r) => `${r.day} ${r.key}`)).toEqual([`${DAY} ${BASE}:${W3}`]);
  });

  it('takes a claimed list of more than 100 keys as one parameter', async () => {
    // #given
    const claimed = [GROUP, ...Array.from({ length: 150 }, (_, i) => `group-${i}`)];
    // #when
    const credits = await store.viaTokenCreditsOf(env.DB, DAY, DAY, claimed, [LABELED_WALLET]);
    // #then
    expect(credits.map((r) => r.messages)).toEqual([60]);
  });

  it('reads the credits through a daily_breakdown index', async () => {
    // #when
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${VIA_TOKEN_CREDITS_SQL}`).bind(DAY, DAY, '[]', '[]').all<{ detail: string }>();
    // #then
    expect(plan.results.map((r) => r.detail).join(' | ')).toMatch(/SEARCH daily_breakdown USING (COVERING )?INDEX/);
  });

  it('has no credits when no project claims a token', async () => {
    // #then
    expect(await store.viaTokenCreditsOf(env.DB, DAY, DAY, [], [LABELED_WALLET])).toEqual([]);
  });

  describe('through the sender book', () => {
    const ELIZA = { name: 'elizaOS', x: 'elizaOS', url: null, kind: 'protocol' as const, source: null, addresses: [], tokens: [] };
    const OTHER = { name: 'Other', x: null, url: null, kind: 'app' as const, source: null, addresses: [], tokens: [] };
    const context = () =>
      harness({
        now: NOW,
        labels: {
          [`ethereum-mainnet-base-1:${ELIZA_APP}`]: { name: 'elizaOS', x: 'elizaOS', kind: 'protocol', slug: 'elizaos' },
          [`ethereum-mainnet-base-1:${LABELED_WALLET}`]: { name: 'Other', kind: 'app', slug: 'other' },
        },
        labelTokens: { [`ethereum-mainnet:${ELIZA_ETH}`]: 'elizaos' },
        projects: { elizaos: ELIZA, other: OTHER },
      }).c;

    beforeEach(async () => {
      // #given elizaOS's entry names its Ethereum token, its Base token shares the registry group, and its own Base contract sent 40
      await seedRegistry([NETWORKS.base, NETWORKS.ethereum], [
        { chainSelector: ETH, address: ELIZA_ETH, symbol: 'ELIZA', name: 'elizaOS', decimals: 18, groupId: GROUP },
        { chainSelector: BASE, address: ELIZA_BASE, symbol: 'ELIZA', name: 'elizaOS', decimals: 18, groupId: GROUP },
      ]);
      await store.replaceDaily(env.DB, TOTALS, [...ROWS, row('sender', `${BASE}:${ELIZA_APP}`, 40, 4)], NOW);
    });

    it("ranks elizaOS once, with its own sends and the Base wallets' sends of its token, ahead of what the wallets keep", async () => {
      // #given
      const c = context();
      // #when
      const ranked = await rankedIdentities(c, await senderBook(c), DAY, DAY, 'messages', 4);
      // #then
      expect(ranked.map((i) => [i.key, i.messages, i.via_token_messages])).toEqual([
        ['project:elizaos', 100, 60], [`address:${W3}`, 25, 0], [`address:${W2}`, 20, 0], ['project:other', 7, 0],
      ]);
    });

    it('ranks the window the way the day rows rank in JS', async () => {
      // #given
      const c = context();
      const book = await senderBook(c);
      const day = (dim: Dim) => store.breakdownBetween(env.DB, dim, DAY, DAY);
      // #when
      const windowed = await rankedIdentities(c, book, DAY, DAY, 'messages', 10);
      // #then
      expect(windowed).toEqual(rankIdentities(identitiesOf(book, await day('sender'), await day('via_token')), 'messages', 10));
    });

    it('counts the credits in label coverage, with their own part', async () => {
      // #given
      const c = context();
      // #then
      expect(await labelCoverageOf(c, await senderBook(c), DAY, DAY)).toEqual({
        messages_pct: 53.5, usd_pct: 53.5, fees_pct: 53.5, via_token_messages_pct: 30, via_token_usd_pct: 30, via_token_fees_pct: 30, window: '7d',
      });
    });

    it('keeps a wallet a label names on another chain with the project as inferred, not via its token', async () => {
      // #given the wallet is labeled only on Ethereum and direct-sends elizaOS from Base
      await store.replaceDaily(env.DB, TOTALS, [row('sender', `${BASE}:${ETH_ONLY_WALLET}`, 12, 1.2), row('via_token', `${BASE}:${ETH_ONLY_WALLET}|${GROUP}`, 12, 1.2)], NOW);
      const c = harness({
        now: NOW,
        labels: { [`ethereum-mainnet:${ETH_ONLY_WALLET}`]: { name: 'elizaOS', x: 'elizaOS', kind: 'protocol', slug: 'elizaos' } },
        labelTokens: { [`ethereum-mainnet:${ELIZA_ETH}`]: 'elizaos' },
        projects: { elizaos: ELIZA },
      }).c;
      // #when
      const [eliza] = await rankedIdentities(c, await senderBook(c), DAY, DAY, 'messages', 5);
      // #then
      expect({ key: eliza?.key, messages: eliza?.messages, inferred: eliza?.inferred, via: eliza?.via_token_messages }).toEqual({ key: 'project:elizaos', messages: 12, inferred: true, via: 0 });
    });
  });
});
