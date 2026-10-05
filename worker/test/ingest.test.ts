import { COIN_PRICE_DECIMALS, coingeckoKey } from '@ccip-dev/core';
import { fakeCcip, listMessage, NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { runIngest } from '../src/jobs/ingest';
import * as store from '../src/store';
import { COINGECKO_IDS_SQL, harness, readPublic, resetStorage, seedRegistry, TOKEN_GROUPS_SQL, watchedDb } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-10-08T12:01:00.000Z';
const at = (minutesAgo: number) => new Date(Date.parse('2026-10-08T12:00:00.000Z') - minutesAgo * 60_000).toISOString();
const six = () => Array.from({ length: 6 }, (_, i) => listMessage({ id: `m${6 - i}`, sendTs: at(i * 10) }));
const count = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM messages').first<{ n: number }>())!.n;

describe('runIngest', () => {
  it('on the first run sets live_start_day, stops at its floor and publishes', async () => {
    const yesterday = listMessage({ id: 'old', sendTs: '2026-10-07T23:59:00.000Z' });
    const ccip = fakeCcip({ messages: [...six(), yesterday] });
    const { c } = harness({ now: NOW, ccip });
    await runIngest(c, { pageSize: 2 });
    expect(await count()).toBe(6);
    expect(ccip.listCalls).toEqual([null, '2', '4', '6']);
    expect(await store.getMeta(env.DB, 'live_start_day')).toBe('2026-10-08');
    expect(await store.getMeta(env.DB, 'last_finalize_day')).toBe('2026-10-07');
    expect(await store.getMeta(env.DB, 'last_archived_day')).toBe('2026-10-07');
    expect(await store.getMeta(env.DB, 'last_ingest_ok_at')).toBe(NOW);
    const row = await env.DB.prepare('SELECT next_check_at, source FROM messages WHERE message_id = ?').bind('m6').first();
    expect(row).toEqual({ next_check_at: '2026-10-08T12:02:00.000Z', source: 'live' });
    expect((await readPublic('live.json')).messages).toHaveLength(2);
  });

  it('stops at the first message it already has', async () => {
    const { c } = harness({ now: NOW, ccip: fakeCcip({ messages: six() }) });
    await runIngest(c, { pageSize: 2 });
    const ccip = fakeCcip({ messages: [listMessage({ id: 'm7', sendTs: at(-0.5) }), ...six()] });
    await runIngest(harness({ now: NOW, ccip }).c, { pageSize: 2 });
    expect(ccip.listCalls).toEqual([null]);
    expect(await count()).toBe(7);
  });

  it('saves a resume cursor when it hits the page cap and fills the gap on later runs', async () => {
    const { c } = harness({ now: NOW, ccip: fakeCcip({ messages: six() }) });
    await runIngest(c, { pageSize: 2, maxPages: 2 });
    expect(await count()).toBe(4);
    expect(await store.getMeta(env.DB, 'ingest_resume_cursor')).toBe('4');
    expect(await store.getMeta(env.DB, 'ingest_resume_stop_id')).toBeNull();

    const ccip = fakeCcip({ messages: six() });
    await runIngest(harness({ now: NOW, ccip }).c, { pageSize: 2, maxPages: 2 });
    expect(ccip.listCalls).toEqual([null, '4']);
    expect(await count()).toBe(6);
    expect(await store.getMeta(env.DB, 'ingest_resume_cursor')).toBeNull();
  });

  it('keeps ingesting and drops the resume cursor when the resume walk fails', async () => {
    await runIngest(harness({ now: NOW, ccip: fakeCcip({ messages: six() }) }).c, { pageSize: 2, maxPages: 2 });
    expect(await store.getMeta(env.DB, 'ingest_resume_cursor')).toBe('4');

    const ccip = fakeCcip({ messages: [listMessage({ id: 'm7', sendTs: at(-0.5) }), ...six()], failCursors: new Set(['4']) });
    const { c, alerts } = harness({ now: '2026-10-08T12:05:00.000Z', ccip });
    await runIngest(c, { pageSize: 2, maxPages: 2 });

    expect(await count()).toBe(5);
    expect(await store.getMeta(env.DB, 'last_ingest_ok_at')).toBe('2026-10-08T12:05:00.000Z');
    expect(await store.getMeta(env.DB, 'ingest_resume_cursor')).toBeNull();
    expect(await store.getMeta(env.DB, 'ingest_resume_stop_id')).toBeNull();
    expect(alerts.map((a) => a.signature)).toEqual(['ingest-resume']);
    expect((await readPublic('live.json')).messages.map((m: { id: string }) => m.id)).toContain('m7');
  });

  it('stores a message that appears on two consecutive pages only once', async () => {
    const m = six();
    const { c } = harness({ now: NOW, ccip: fakeCcip({ messages: [m[0]!, m[1]!, m[1]!, m[2]!] }) });
    await runIngest(c, { pageSize: 2 });
    expect(await count()).toBe(3);
  });

  it('ends on an empty page even when a cursor is returned', async () => {
    const ccip = { ...fakeCcip(), listMessages: async () => ({ messages: [], raw: [], cursor: 'again' }) };
    const { c } = harness({ now: NOW, ccip });
    await runIngest(c);
    expect(await count()).toBe(0);
    expect(await store.getMeta(env.DB, 'last_ingest_ok_at')).toBe(NOW);
  });

  it('values tokens from prices_latest and flags unpriced ones', async () => {
    await store.upsertPrices(env.DB, new Map([['base:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', { price: 2, decimals: 6 }]]), NOW);
    const priced = listMessage({ id: 'p', sendTs: at(1), token: { address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', amount: '5000000' } });
    const unpriced = listMessage({ id: 'u', sendTs: at(2), token: { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', amount: '1' } });
    await runIngest(harness({ now: NOW, ccip: fakeCcip({ messages: [priced, unpriced] }) }).c);
    const rows = await env.DB.prepare('SELECT message_id, usd_value, unpriced FROM messages ORDER BY message_id').all();
    expect(rows.results).toEqual([
      { message_id: 'p', usd_value: 10, unpriced: 0 },
      { message_id: 'u', usd_value: 0, unpriced: 1 },
    ]);
  });

  it('values a token without a prices_latest row through a priced group sibling, with its own decimals', async () => {
    const own = '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
    const sibling = '0xcccccccccccccccccccccccccccccccccccccccc';
    await seedRegistry([NETWORKS.base, NETWORKS.ethereum], [
      { chainSelector: NETWORKS.base.chainSelector, address: own, symbol: 'TKN', name: 'Token', decimals: 6, groupId: 'g' },
      { chainSelector: NETWORKS.ethereum.chainSelector, address: sibling, symbol: 'TKN', name: 'Token', decimals: 18, groupId: 'g' },
    ]);
    await store.upsertPrices(env.DB, new Map([[`ethereum:${sibling}`, { price: 2, decimals: 18 }]]), NOW);
    const m = listMessage({ id: 's', sendTs: at(1), token: { address: own, amount: '5000000' } });
    await runIngest(harness({ now: NOW, ccip: fakeCcip({ messages: [m] }) }).c);
    expect(await env.DB.prepare('SELECT usd_value, unpriced FROM messages WHERE message_id = ?').bind('s').first()).toEqual({
      usd_value: 10,
      unpriced: 0,
    });
    expect(await env.DB.prepare('SELECT usd_value FROM message_tokens WHERE message_id = ?').bind('s').first()).toEqual({ usd_value: 10 });
  });

  describe('through a CoinGecko coin', () => {
    const OWN = '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
    const SIBLING = '0xcccccccccccccccccccccccccccccccccccccccc';
    const UNMAPPED = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const registryToken = (network: typeof NETWORKS.base, address: string, decimals: number, groupId: string | null) => ({
      chainSelector: network.chainSelector, address, symbol: 'TKN', name: 'Token', decimals, groupId,
    });
    const usdValue = (id: string) => env.DB.prepare('SELECT usd_value, unpriced FROM messages WHERE message_id = ?').bind(id).first();

    async function seedCoin(groupId: string | null): Promise<void> {
      await seedRegistry([NETWORKS.base, NETWORKS.ethereum], [
        registryToken(NETWORKS.base, OWN, 6, groupId),
        registryToken(NETWORKS.ethereum, SIBLING, 18, 'g'),
      ]);
      await store.replaceCoingeckoIds(env.DB, [{ chain: NETWORKS.base.chainSelector, address: OWN.toLowerCase(), coinId: 'tkn' }], NOW);
      await store.upsertPrices(env.DB, new Map([[coingeckoKey('tkn'), { price: 2, decimals: COIN_PRICE_DECIMALS }]]), NOW);
    }

    it('values a token that neither its own key nor its group prices, with its registry decimals', async () => {
      await seedCoin(null);
      const m = listMessage({ id: 'c', sendTs: at(1), token: { address: OWN, amount: '5000000' } });
      await runIngest(harness({ now: NOW, ccip: fakeCcip({ messages: [m] }) }).c);
      expect(await usdValue('c')).toEqual({ usd_value: 10, unpriced: 0 });
    });

    it('prefers a priced sibling to the coin', async () => {
      await seedCoin('g');
      await store.upsertPrices(env.DB, new Map([[`ethereum:${SIBLING}`, { price: 3, decimals: 18 }]]), NOW);
      const m = listMessage({ id: 's', sendTs: at(1), token: { address: OWN, amount: '5000000' } });
      await runIngest(harness({ now: NOW, ccip: fakeCcip({ messages: [m] }) }).c);
      expect(await usdValue('s')).toEqual({ usd_value: 15, unpriced: 0 });
    });

    it('reads the CoinGecko ids only when a token is still unpriced after its own key and its group', async () => {
      await seedCoin('g');
      await store.upsertPrices(env.DB, new Map([[`ethereum:${SIBLING}`, { price: 3, decimals: 18 }]]), NOW);
      const siblingPriced = listMessage({ id: 's', sendTs: at(2), token: { address: OWN, amount: '1' } });
      const unpriced = listMessage({ id: 'u', sendTs: at(1), token: { address: UNMAPPED, amount: '1' } });
      const first = watchedDb(COINGECKO_IDS_SQL);
      await runIngest(harness({ now: NOW, ccip: fakeCcip({ messages: [siblingPriced] }), db: first.db }).c);
      const second = watchedDb(COINGECKO_IDS_SQL);
      await runIngest(harness({ now: NOW, ccip: fakeCcip({ messages: [unpriced, siblingPriced] }), db: second.db }).c);
      expect([first.prepared(), second.prepared()]).toEqual([0, 1]);
    });

    it('stores, publishes and alerts without the coin step when the CoinGecko ids cannot be read', async () => {
      await seedCoin(null);
      const m = listMessage({ id: 'c', sendTs: at(1), token: { address: OWN, amount: '5000000' } });
      const { db } = watchedDb(COINGECKO_IDS_SQL, { fail: true });
      const { c, alerts } = harness({ now: NOW, ccip: fakeCcip({ messages: [m] }), db });
      await runIngest(c);
      expect(await usdValue('c')).toEqual({ usd_value: 0, unpriced: 1 });
      expect(await store.getMeta(env.DB, 'last_ingest_ok_at')).toBe(NOW);
      expect(alerts.map((a) => a.signature)).toEqual(['coingecko-ids-read']);
    });
  });

  it('stores, publishes and alerts without the fallback when the token groups cannot be read', async () => {
    const m = listMessage({ id: 'u', sendTs: at(1), token: { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', amount: '1' } });
    const { db } = watchedDb(TOKEN_GROUPS_SQL, { fail: true });
    const { c, alerts } = harness({ now: NOW, ccip: fakeCcip({ messages: [m] }), db });
    await runIngest(c);
    expect(await env.DB.prepare('SELECT unpriced FROM messages WHERE message_id = ?').bind('u').first()).toEqual({ unpriced: 1 });
    expect(await store.getMeta(env.DB, 'last_ingest_ok_at')).toBe(NOW);
    expect((await readPublic('live.json')).messages.map((x: { id: string }) => x.id)).toEqual(['u']);
    expect(alerts.map((a) => a.signature)).toEqual(['token-groups']);
  });

  it('reads the token groups only when a token lacks its own price', async () => {
    await store.upsertPrices(env.DB, new Map([['base:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', { price: 2, decimals: 6 }]]), NOW);
    const priced = listMessage({ id: 'p', sendTs: at(2), token: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', amount: '1' } });
    const unpriced = listMessage({ id: 'u', sendTs: at(1), token: { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', amount: '1' } });
    const first = watchedDb(TOKEN_GROUPS_SQL);
    await runIngest(harness({ now: NOW, ccip: fakeCcip({ messages: [priced] }), db: first.db }).c);
    const second = watchedDb(TOKEN_GROUPS_SQL);
    await runIngest(harness({ now: NOW, ccip: fakeCcip({ messages: [unpriced, priced] }), db: second.db }).c);
    expect([first.prepared(), second.prepared()]).toEqual([0, 1]);
  });

  it('leaves the same state when run twice against an unchanged message list', async () => {
    const snapshot = async () => ({
      messages: (await env.DB.prepare('SELECT * FROM messages ORDER BY message_id').all()).results,
      tokens: (await env.DB.prepare('SELECT * FROM message_tokens ORDER BY message_id, idx').all()).results,
      meta: (await env.DB.prepare("SELECT key, value FROM meta WHERE key != 'last_ingest_ok_at' ORDER BY key").all()).results,
    });
    const messages = six();
    await runIngest(harness({ now: NOW, ccip: fakeCcip({ messages }) }).c, { pageSize: 2 });
    const afterFirst = await snapshot();
    await runIngest(harness({ now: NOW, ccip: fakeCcip({ messages }) }).c, { pageSize: 2 });
    expect(afterFirst.messages).toHaveLength(6);
    expect(await snapshot()).toEqual(afterFirst);
  });
});
