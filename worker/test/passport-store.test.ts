import type { PassportPostRecord, StoredReading } from '@ccip-dev/core';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import * as passportStore from '../src/passport-store';
import * as store from '../src/store';
import { resetStorage } from './helpers';

beforeEach(resetStorage);

const ETHEREUM = '5009297550715157269';
const DAY = '2026-11-24';

const plan = async (sql: string, ...params: unknown[]) =>
  (await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>()).results.map((r) => r.detail);

const reading = (token: string): StoredReading => ({ readOn: DAY, settings: { token } as StoredReading['settings'], parties: {} });

const tokenRecord = (day: string, groupId: string): PassportPostRecord => ({ id: `${day}-${groupId}`, day, kind: 'token', groupId, name: 'Token', changes: [], arrivals: [] });

const STATE: passportStore.ChainState = { chain: ETHEREUM, lastBlock: 100, okDay: DAY, failures: 0, transport: 'multicall3', triedDay: DAY, attempts: 1 };

describe('passport store query plans', () => {
  it.each([
    ['a chain\'s stored readings', passportStore.STORED_READINGS_SQL, [ETHEREUM]],
    ['the chain states', passportStore.chainStatesSql(2), [ETHEREUM, '1']],
    ['a page of readings', passportStore.ROWS_PAGE_SQL, [ETHEREUM, '0x', 25]],
    ['a page of results', passportStore.UNITS_PAGE_SQL, ['', 200]],
  ])('reads %s through a key, never a scan', async (_name, sql, params) => {
    // #when
    const details = await plan(sql, ...params);
    // #then
    expect(details.filter((d) => !/^SEARCH passport_\w+ USING (INDEX sqlite_autoindex_passport_\w+|PRIMARY KEY|COVERING INDEX sqlite_autoindex_passport_\w+)/.test(d))).toEqual([]);
  });
});

describe('saveChainReading', () => {
  it('stores each row\'s reading with its log rows and the chain state', async () => {
    // #when
    await passportStore.saveChainReading(env.DB, ETHEREUM, [
      { address: '0xaa', reading: reading('0xaa'), method: 1, changed: ['pool'], logs: [{ chain: ETHEREUM, address: '0xaa', day: DAY, kind: 'setting', detail: { setting: 'pool' } }] },
    ], STATE);
    // #then
    const stored = await passportStore.storedReadings(env.DB, ETHEREUM);
    expect({
      reading: stored.get('0xaa'),
      log: (await env.DB.prepare('SELECT kind, detail FROM passport_changes').all()).results,
      state: (await passportStore.chainStates(env.DB, [ETHEREUM])).get(ETHEREUM),
    }).toEqual({ reading: { reading: reading('0xaa'), firstReadDay: DAY }, log: [{ kind: 'setting', detail: '{"setting":"pool"}' }], state: STATE });
  });

  it('keeps the day of a row\'s first reading when a later one replaces it', async () => {
    // #given
    await passportStore.saveChainReading(env.DB, ETHEREUM, [{ address: '0xaa', reading: reading('0xaa'), method: 1, changed: [], logs: [] }], STATE);
    // #when
    const later = { ...reading('0xaa'), readOn: '2026-11-25' };
    await passportStore.saveChainReading(env.DB, ETHEREUM, [{ address: '0xaa', reading: later, method: 1, changed: [], logs: [] }], { ...STATE, okDay: '2026-11-25' });
    // #then
    expect((await passportStore.storedReadings(env.DB, ETHEREUM)).get('0xaa')).toEqual({ reading: later, firstReadDay: DAY });
  });

  it('writes more rows than one batch holds', async () => {
    // #given
    const rows = Array.from({ length: 130 }, (_, i) => {
      const address = `0x${i.toString(16).padStart(40, '0')}`;
      return { address, reading: reading(address), method: 1, changed: [], logs: [{ chain: ETHEREUM, address, day: DAY, kind: 'first-reading', detail: {} }] };
    });
    // #when
    await passportStore.saveChainReading(env.DB, ETHEREUM, rows, STATE);
    // #then
    expect((await passportStore.storedReadings(env.DB, ETHEREUM)).size).toBe(130);
  });
});

describe('evaluation pages', () => {
  it('loads every reading across pages in key order', async () => {
    // #given
    const addresses = Array.from({ length: passportStore.EVALUATION_PAGE * 2 + 3 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`);
    await passportStore.saveChainReading(env.DB, ETHEREUM, addresses.map((address) => ({ address, reading: reading(address), method: 1, changed: [], logs: [] })), STATE);
    // #when
    const rows = await passportStore.storedRows(env.DB);
    // #then
    expect(rows.map((r) => r.address)).toEqual(addresses);
  });
});

describe('replacePosts', () => {
  it('replaces one day\'s post records and leaves other days alone', async () => {
    // #given
    await passportStore.replacePosts(env.DB, '2026-11-23', [tokenRecord('2026-11-23', 'g1')], 'seeded');
    await passportStore.replacePosts(env.DB, DAY, [tokenRecord(DAY, 'g1'), tokenRecord(DAY, 'g2')], 'seeded');
    // #when
    await passportStore.replacePosts(env.DB, DAY, [tokenRecord(DAY, 'g2'), tokenRecord(DAY, 'g3')], 'due');
    // #then
    const { results } = await env.DB.prepare('SELECT id, state FROM passport_posts ORDER BY id').all();
    expect(results).toEqual([{ id: '2026-11-23-g1', state: 'seeded' }, { id: `${DAY}-g2`, state: 'seeded' }, { id: `${DAY}-g3`, state: 'due' }]);
  });
});

describe('clearPassport', () => {
  it('empties the passport tables and meta keys, and keeps every other meta key', async () => {
    // #given
    await passportStore.saveChainReading(env.DB, ETHEREUM, [{ address: '0xaa', reading: reading('0xaa'), method: 1, changed: [], logs: [] }], STATE);
    await store.setMeta(env.DB, 'passport:since', DAY);
    await store.setMeta(env.DB, 'peg_marker_block', '1');
    // #when
    await passportStore.clearPassport(env.DB);
    // #then
    expect({
      rows: (await passportStore.storedRows(env.DB)).length,
      states: (await passportStore.chainStates(env.DB, [ETHEREUM])).size,
      since: await store.getMeta(env.DB, 'passport:since'),
      other: await store.getMeta(env.DB, 'peg_marker_block'),
    }).toEqual({ rows: 0, states: 0, since: null, other: '1' });
  });
});
