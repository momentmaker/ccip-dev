import { fakeCcip, NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { runFinalize } from '../src/jobs/finalize';
import * as store from '../src/store';
import { harness, liveRow, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const BASE = NETWORKS.base.chainSelector;
const GROUP = 'group-eliza';
const ELIZA_BASE = '0x00000000000000000000000000000000000e1a01';
const LOOSE = '0x00000000000000000000000000000000000b0001';
const WALLET = '0x00000000000000000000000000000000000c0001';
const APP = '0x00000000000000000000000000000000000d0001';

describe('migration 0008', () => {
  const DAY = '2026-10-07';
  const NOW = '2026-10-08T00:07:00.000Z';
  const at = (minute: number) => `${DAY}T10:0${minute}:00.000Z`;
  const EXPECTED = [
    { key: `${BASE}:${WALLET}|${BASE}:${LOOSE}`, messages: 2, usd_value: 16, fee_usd: 2 },
    { key: `${BASE}:${WALLET}|${GROUP}`, messages: 2, usd_value: 15, fee_usd: 1 },
  ];

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
  const backfill = () => env.DB.batch(env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0008'))!.queries.map((q) => env.DB.prepare(q)));

  it("rolls up a wallet's direct sends by their first token's group or the token itself, and never an app's send", async () => {
    // #given
    await seedDay();
    // #when
    await finalizeDay();
    // #then
    expect(await viaRows()).toEqual(EXPECTED);
  });

  it('backfills the same rows the rollup writes', async () => {
    // #given a finalized day whose via_token rows are gone, as before the migration
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
    await backfill();
    await finalizeDay();
    // #then
    expect(await viaRows()).toEqual(EXPECTED);
  });

  it('backfills nothing for a day that was never rolled up', async () => {
    // #given
    await seedDay();
    // #when
    await backfill();
    // #then
    expect(await viaRows()).toEqual([]);
  });

  it('reads the month by a range on messages_day', async () => {
    // #given
    const statement = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0008'))!.queries[0]!;
    // #when
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${statement}`).all<{ detail: string }>();
    // #then
    expect(plan.results.map((r) => r.detail)).toContainEqual(expect.stringMatching(/messages_day \(day>\? AND day<\?\)/));
  });
});
