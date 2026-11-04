import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { meterD1 } from '../src/d1-meter';
import * as store from '../src/store';
import { resetStorage } from './helpers';

beforeEach(resetStorage);

describe('meterD1', () => {
  beforeEach(async () => {
    for (const [key, value] of [['a', '1'], ['b', '2'], ['c', '3']]) await store.setMeta(env.DB, key!, value!);
  });

  it('adds up the rows each all() read, through bind', async () => {
    // #given
    const meter = meterD1(env.DB);
    // #when
    await meter.db.prepare('SELECT key FROM meta WHERE key >= ?').bind('a').all();
    await meter.db.prepare('SELECT key FROM meta').all();
    // #then
    expect({ queries: meter.usage().queries, rowsRead: meter.usage().rowsRead >= 6 }).toEqual({ queries: 2, rowsRead: true });
  });

  it('returns the same results as the binding it wraps', async () => {
    // #given
    const meter = meterD1(env.DB);
    const sql = 'SELECT key, value FROM meta ORDER BY key';
    // #when
    const [metered, plain] = await Promise.all([meter.db.prepare(sql).all(), env.DB.prepare(sql).all()]);
    // #then
    expect(metered.results).toEqual(plain.results);
  });

  it('counts first() as a query without rows, since its result carries no meta', async () => {
    // #given
    const meter = meterD1(env.DB);
    // #when
    const value = await store.getMeta(meter.db, 'b');
    // #then
    expect({ value, usage: meter.usage() }).toEqual({ value: '2', usage: { queries: 1, rowsRead: 0, d1Ms: 0 } });
  });

  it('runs a batch of metered statements and counts each one', async () => {
    // #given
    const meter = meterD1(env.DB);
    const read = meter.db.prepare('SELECT value FROM meta WHERE key = ?');
    // #when
    const results = await meter.db.batch([read.bind('a'), read.bind('c')]);
    // #then
    expect({ values: results.map((r) => (r.results[0] as { value: string }).value), queries: meter.usage().queries }).toEqual({ values: ['1', '3'], queries: 2 });
  });
});
