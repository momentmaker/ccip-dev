import { addDays, labelKey, type Dim } from '@ccip-dev/core';
import { NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dayLeaderEntries, DAY_LEADERS_DAYS, DAY_LEADERS_REFRESH_DAYS, publishHistoryFiles, refreshDayLeaders } from '../src/publish';
import * as store from '../src/store';
import { harness, readPublic, resetStorage } from './helpers';

beforeEach(resetStorage);
afterEach(() => vi.restoreAllMocks());

const NOW = '2026-10-12T00:07:00.000Z';
const DAY = '2026-10-11';
const BASE = '15971525489660198786';
const ETH = NETWORKS.ethereum.chainSelector;
const SENDER = '0x7af7632562b6063e52788607ad56f7a60f57ce09';
const MAPLE = { [labelKey('ethereum-mainnet-base-1', SENDER)]: { name: 'Maple Finance', x: 'maplefinance', kind: 'protocol' as const, slug: 'maple-finance' } };
const totals = (day: string, messages = 20) => ({ day, messages, token_messages: 0, usd_value: 1, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 });
const row = (day: string, dim: Dim, key: string, messages: number, usd_value: number, fee_usd: number | null) => ({ day, dim, key, messages, usd_value, fee_usd });
const seedDay = (day: string, senderMessages = 7) =>
  store.replaceDaily(env.DB, totals(day), [
    row(day, 'token', `${BASE}:0xtok`, 3, 900, null),
    row(day, 'sender', `${BASE}:${SENDER}`, senderMessages, 10, 1),
    row(day, 'lane', `${ETH}>${BASE}`, 5, 800, 1),
    row(day, 'src_chain', BASE, 6, 999, 7),
  ], NOW);
const publishedDays = async () => (await readPublic('day-leaders.json')).days;
const storedDays = async () => (await env.DB.prepare('SELECT day FROM day_leaders ORDER BY day').all<{ day: string }>()).results.map((r) => r.day);

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO chains VALUES (?, 'ethereum-mainnet-base-1', 'Base Mainnet', 'EVM', '8453', 'x', 'x')").bind(BASE),
    env.DB.prepare("INSERT INTO tokens VALUES (?, '0xtok', 'USDC', 'USD Coin', 6, NULL, 'x', 'x')").bind(BASE),
  ]);
  await store.setMeta(env.DB, 'last_finalize_day', DAY);
});

describe('day-leaders.json from stored days', () => {
  it('publishes the same days as recomputing the whole window', async () => {
    // #given two days, published once so both are stored
    await seedDay('2026-10-10', 4);
    await seedDay(DAY);
    const { c } = harness({ now: NOW, labels: MAPLE });
    await publishHistoryFiles(c);
    // #when published again from the stored days
    await publishHistoryFiles(c);
    // #then
    expect(await publishedDays()).toEqual(await dayLeaderEntries(c, '2025-09-07', DAY));
  });

  it('stores every day it computes, so the next publish computes none', async () => {
    // #given
    await seedDay(DAY);
    const { c } = harness({ now: NOW, labels: MAPLE });
    await publishHistoryFiles(c);
    const daily = vi.spyOn(store, 'dailyLeaders');
    // #when
    await publishHistoryFiles(c);
    // #then
    expect({ stored: (await storedDays()).length, recomputed: daily.mock.calls.length }).toEqual({ stored: DAY_LEADERS_DAYS, recomputed: 0 });
  });

  it("recomputes a day whose breakdown was replaced, as a re-finalize does", async () => {
    // #given the day published with 7 sender messages
    await seedDay(DAY, 7);
    const { c } = harness({ now: NOW, labels: MAPLE });
    await publishHistoryFiles(c);
    // #when the day is rolled up again with 12
    await seedDay(DAY, 12);
    await publishHistoryFiles(c);
    // #then
    expect((await publishedDays()).find((d: { day: string }) => d.day === DAY).sender.messages).toBe(12);
  });

  it('serves a day stored under other labels until the refresh replaces it', async () => {
    // #given the day stored before Maple Finance was labeled
    await seedDay(DAY);
    await publishHistoryFiles(harness({ now: NOW }).c);
    const labeled = harness({ now: '2026-10-12T13:00:00.000Z', labels: MAPLE });
    // #when a publish under the new labels runs, then the hourly refresh, then a publish
    await publishHistoryFiles(labeled.c);
    const before = (await publishedDays()).find((d: { day: string }) => d.day === DAY).sender.key;
    await refreshDayLeaders(labeled.c);
    await publishHistoryFiles(labeled.c);
    const after = (await publishedDays()).find((d: { day: string }) => d.day === DAY).sender.key;
    // #then
    expect({ before, after }).toEqual({ before: `address:${SENDER}`, after: 'project:maple-finance' });
  });

  it('looks up token symbols at publish, so a symbol added later shows on stored days', async () => {
    // #given the day stored while the token had no symbol
    await env.DB.prepare("UPDATE tokens SET symbol = '' WHERE address = '0xtok'").run();
    await seedDay(DAY);
    const { c } = harness({ now: NOW });
    await publishHistoryFiles(c);
    // #when the registry names it
    await env.DB.prepare("UPDATE tokens SET symbol = 'USDC' WHERE address = '0xtok'").run();
    await publishHistoryFiles(c);
    // #then
    expect((await publishedDays()).find((d: { day: string }) => d.day === DAY).token.label).toBe('USDC');
  });
});

describe('refreshDayLeaders', () => {
  const HOUR = '2026-10-12T13:00:00.000Z';

  it(`computes at most ${DAY_LEADERS_REFRESH_DAYS} missing days a run, newest first`, async () => {
    // #given
    await seedDay(DAY);
    // #when
    await refreshDayLeaders(harness({ now: HOUR }).c);
    // #then
    const stored = await storedDays();
    expect({ count: stored.length, newest: stored.at(-1) }).toEqual({ count: DAY_LEADERS_REFRESH_DAYS, newest: DAY });
  });

  it('never stores a day after last_finalize_day, whose breakdown is not final', async () => {
    // #given
    await store.setMeta(env.DB, 'last_finalize_day', '2026-10-10');
    // #when
    await refreshDayLeaders(harness({ now: HOUR }).c);
    // #then
    expect((await storedDays()).at(-1)).toBe('2026-10-10');
  });

  it("leaves the finalize hours alone, so it never races a finalize's rewrite of a day", async () => {
    // #when at 00:00 and at 06:00
    await refreshDayLeaders(harness({ now: '2026-10-12T00:00:00.000Z' }).c);
    await refreshDayLeaders(harness({ now: '2026-10-12T06:00:00.000Z' }).c);
    // #then
    expect(await storedDays()).toEqual([]);
  });

  it('stores a day with no leaders as empty, so it is not computed again', async () => {
    // #given one refresh stored the empty days
    await refreshDayLeaders(harness({ now: HOUR }).c);
    const daily = vi.spyOn(store, 'dailyLeaders');
    // #when a publish reads them
    await publishHistoryFiles(harness({ now: HOUR }).c);
    const refreshedFrom = addDays(DAY, -(DAY_LEADERS_REFRESH_DAYS - 1));
    const recomputed = daily.mock.calls.filter(([, , , fromDay]) => fromDay >= refreshedFrom).length;
    // #then
    expect({ recomputed, published: await publishedDays() }).toEqual({ recomputed: 0, published: [] });
  });
});
