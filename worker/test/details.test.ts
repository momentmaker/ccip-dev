import { fakeCcip, fakePrices, NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import detailToken from '../../packages/core/test/fixtures/detail-token.json';
import { runDetails } from '../src/jobs/details';
import * as store from '../src/store';
import { harness, liveRow, resetStorage, seedRegistry } from './helpers';

beforeEach(resetStorage);

const NOW = '2026-10-05T11:20:00.000Z';
const TOKEN_KEY = 'base:0x9818b6c09f5ecc843060927e8587c427c7c93583';
const FEE_KEY = 'base:0x4200000000000000000000000000000000000006';
const due = (id: string, extras = {}) => liveRow({ id, sendTs: '2026-10-05T11:14:53.000Z' }, { next_check_at: '2026-10-05T11:16:53.000Z', ...extras });
const row = (id: string) => env.DB.prepare('SELECT * FROM messages WHERE message_id = ?').bind(id).first<Record<string, unknown>>();
const SIBLING = '0xcccccccccccccccccccccccccccccccccccccccc';
const SIBLING_KEY = `ethereum:${SIBLING}`;
const seenAt = (key: string) => env.DB.prepare('SELECT seen_at FROM prices_latest WHERE llama_key = ?').bind(key).first<{ seen_at: string }>();

/** The detail fixture's base token (18 decimals) and a 6-decimal copy on Ethereum, in one CCIP token group. */
async function seedTokenGroup(): Promise<void> {
  await seedRegistry([NETWORKS.base, NETWORKS.ethereum], [
    { chainSelector: NETWORKS.base.chainSelector, address: '0x9818B6c09f5ECc843060927E8587c427C7C93583', symbol: 'TKN', name: 'Token', decimals: 18, groupId: 'g' },
    { chainSelector: NETWORKS.ethereum.chainSelector, address: SIBLING, symbol: 'TKN', name: 'Token', decimals: 6, groupId: 'g' },
  ]);
}

describe('runDetails', () => {
  it('fills tokens, fee and value from the detail and schedules the next check', async () => {
    await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
    const prices = fakePrices({ latest: { [TOKEN_KEY]: { price: 1, decimals: 18 }, [FEE_KEY]: { price: 2500, decimals: 18 } } });
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: detailToken } }), prices });
    await runDetails(c, { limit: 10 });
    expect(await row(detailToken.messageId)).toMatchObject({
      token_count: 1,
      unpriced: 0,
      fee_token: '0x4200000000000000000000000000000000000006',
      fee_amount: '106697113670237',
      detail_fetched_at: NOW,
      next_check_at: '2026-10-05T11:30:00.000Z',
    });
    expect((await row(detailToken.messageId))!.usd_value).toBeCloseTo(24000.580226526876, 6);
    expect((await row(detailToken.messageId))!.fee_usd).toBeCloseTo(0.26674278417559, 9);
    expect(prices.latestCalls).toEqual([[TOKEN_KEY, FEE_KEY]]);
    expect(await store.getPrices(env.DB, [TOKEN_KEY])).toEqual(new Map([[TOKEN_KEY, { price: 1, decimals: 18 }]]));
  });

  it('fetches a group sibling\'s price for a token DefiLlama does not price and values the token with its own decimals', async () => {
    await seedTokenGroup();
    await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
    const prices = fakePrices({ latest: { [SIBLING_KEY]: { price: 2, decimals: 6 }, [FEE_KEY]: { price: 2500, decimals: 18 } } });
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: detailToken } }), prices });
    await runDetails(c, { limit: 10 });
    expect(prices.latestCalls).toEqual([[TOKEN_KEY, FEE_KEY], [SIBLING_KEY]]);
    expect(await row(detailToken.messageId)).toMatchObject({ unpriced: 0 });
    expect((await row(detailToken.messageId))!.usd_value).toBeCloseTo(48001.16045305375, 6);
    expect(await env.DB.prepare('SELECT usd_value FROM message_tokens WHERE message_id = ?').bind(detailToken.messageId).first<{ usd_value: number }>())
      .toEqual({ usd_value: expect.closeTo(48001.16045305375, 6) });
    expect(await seenAt(SIBLING_KEY)).toEqual({ seen_at: NOW });
  });

  it('marks a stored sibling price as seen so the prices job keeps it fresh', async () => {
    await seedTokenGroup();
    await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
    await store.upsertPrices(env.DB, new Map([[SIBLING_KEY, { price: 2, decimals: 6 }]]), '2026-09-01T00:00:00.000Z');
    const prices = fakePrices({ latest: { [FEE_KEY]: { price: 2500, decimals: 18 } } });
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: detailToken } }), prices });
    await runDetails(c, { limit: 10 });
    expect(prices.latestCalls).toEqual([[TOKEN_KEY, FEE_KEY]]);
    expect(await seenAt(SIBLING_KEY)).toEqual({ seen_at: NOW });
    expect((await row(detailToken.messageId))!.usd_value).toBeCloseTo(48001.16045305375, 6);
  });

  it('archives an invalid detail, pushes it back an hour, alerts once and keeps going', async () => {
    await store.upsertListRows(env.DB, [due('bad'), due(detailToken.messageId, { next_check_at: '2026-10-05T11:17:00.000Z' })], []);
    const ccip = fakeCcip({ details: { bad: { messageId: 'bad', status: 5 }, [detailToken.messageId]: detailToken } });
    const { c, alerts } = harness({ now: NOW, ccip });
    await runDetails(c, { limit: 10 });
    expect(await env.ARCHIVE.get('unparsed/bad.json')).not.toBeNull();
    expect((await row('bad'))!.next_check_at).toBe('2026-10-05T12:20:00.000Z');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.signature).toMatch(/^detail-schema:/);
    expect((await row(detailToken.messageId))!.detail_fetched_at).toBe(NOW);
  });

  it('alerts once per CCIP version when the fee format is unknown', async () => {
    await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
    const odd = { ...detailToken, fees: { somethingNew: true } };
    const { c, alerts } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: odd } }) });
    await runDetails(c, { limit: 10 });
    expect(alerts.map((a) => a.signature)).toEqual(['fee-version:2.0.0']);
    expect((await row(detailToken.messageId))!.fee_usd).toBeNull();
  });

  it('pushes a message back 10 minutes when the detail request fails', async () => {
    await store.upsertListRows(env.DB, [due('missing')], []);
    const { c, alerts } = harness({ now: NOW, ccip: fakeCcip({ details: {} }) });
    await runDetails(c, { limit: 10 });
    expect((await row('missing'))!.next_check_at).toBe('2026-10-05T11:30:00.000Z');
    expect(alerts).toEqual([]);
  });

  it('processes at most `limit` due messages, oldest first', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => due(`m${String(i).padStart(2, '0')}`, { next_check_at: `2026-10-05T11:${String(i).padStart(2, '0')}:00.000Z` }));
    await store.upsertListRows(env.DB, rows, []);
    const ccip = fakeCcip({ details: Object.fromEntries(rows.map((r) => [r.message_id, { ...detailToken, messageId: r.message_id }])) });
    await runDetails(harness({ now: NOW, ccip }).c, { limit: 10 });
    const done = await env.DB.prepare('SELECT message_id FROM messages WHERE detail_fetched_at IS NOT NULL ORDER BY message_id').all<{ message_id: string }>();
    expect(done.results.map((r) => r.message_id)).toEqual(rows.slice(0, 10).map((r) => r.message_id));
  });

  it('in day mode fills every live message of that day that lacks a detail, regardless of next_check_at', async () => {
    await store.upsertListRows(env.DB, [due(detailToken.messageId, { next_check_at: null })], []);
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: detailToken } }) });
    await runDetails(c, { day: '2026-10-05' });
    expect((await row(detailToken.messageId))!.detail_fetched_at).toBe(NOW);
  });

  it('finalizes a detail that keeps failing once 48 hours have passed since send', async () => {
    const old = liveRow({ id: 'old', sendTs: '2026-10-03T10:00:00.000Z' }, { next_check_at: '2026-10-05T11:00:00.000Z' });
    await store.upsertListRows(env.DB, [old], []);
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: {} }) });
    await runDetails(c, { limit: 10 });
    expect(await row('old')).toMatchObject({ status: 'UNRESOLVED', next_check_at: null });
  });

  it('keeps FAILED status but stops checking when its detail keeps failing past 48 hours', async () => {
    const old = liveRow({ id: 'old', sendTs: '2026-10-03T10:00:00.000Z' }, { status: 'FAILED', next_check_at: '2026-10-05T11:00:00.000Z' });
    await store.upsertListRows(env.DB, [old], []);
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: {} }) });
    await runDetails(c, { limit: 10 });
    expect(await row('old')).toMatchObject({ status: 'FAILED', next_check_at: null });
  });

  it('finalizes a schema-invalid detail past 48 hours', async () => {
    const old = liveRow({ id: 'bad', sendTs: '2026-10-03T10:00:00.000Z' }, { next_check_at: '2026-10-05T11:00:00.000Z' });
    await store.upsertListRows(env.DB, [old], []);
    const { c } = harness({ now: NOW, ccip: fakeCcip({ details: { bad: { messageId: 'bad', status: 5 } } }) });
    await runDetails(c, { limit: 10 });
    expect(await row('bad')).toMatchObject({ status: 'UNRESOLVED', next_check_at: null });
  });

  it('still applies the detail unpriced and alerts when the price fetch fails', async () => {
    await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
    const prices = { latest: async () => { throw new Error('prices down'); }, dailyHistory: async () => new Map() };
    const { c, alerts } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: detailToken } }), prices });
    await runDetails(c, { limit: 10 });
    expect(await row(detailToken.messageId)).toMatchObject({ detail_fetched_at: NOW, unpriced: 1 });
    expect(alerts.map((a) => a.signature)).toEqual(['prices-fetch']);
    expect(alerts[0]!.text).toContain('prices down');
  });

  it('does not alert again for the same unknown fee version after the alerter window', async () => {
    await store.upsertListRows(env.DB, [due(detailToken.messageId)], []);
    const odd = { ...detailToken, fees: { somethingNew: true } };
    const { c, alerts, setNow } = harness({ now: NOW, ccip: fakeCcip({ details: { [detailToken.messageId]: odd } }) });
    await runDetails(c, { limit: 10 });
    setNow('2026-10-05T13:30:00.000Z');
    await runDetails(c, { limit: 10 });
    expect(alerts.map((a) => a.signature)).toEqual(['fee-version:2.0.0']);
  });
});
