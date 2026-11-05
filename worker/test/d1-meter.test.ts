import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { heaviestStatements, meterD1, STATEMENT_HEAD_CHARS, usageSince } from '../src/d1-meter';
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
    expect({ value, queries: meter.usage().queries, rowsRead: meter.usage().rowsRead }).toEqual({ value: '2', queries: 1, rowsRead: 0 });
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

describe('per-statement usage', () => {
  beforeEach(async () => {
    for (const [key, value] of [['a', '1'], ['b', '2'], ['c', '3']]) await store.setMeta(env.DB, key!, value!);
  });

  it('keeps totals for each statement, keyed by its SQL with whitespace collapsed', async () => {
    // #given
    const meter = meterD1(env.DB);
    const byKey = 'SELECT key FROM meta\n   WHERE key >= ?';
    // #when
    await meter.db.prepare(byKey).bind('a').all();
    await meter.db.prepare(byKey).bind('b').all();
    await meter.db.prepare('SELECT value FROM meta').all();
    // #then
    const statements = meter.usage().statements;
    expect({ keys: Object.keys(statements).sort(), queries: statements['SELECT key FROM meta WHERE key >= ?']?.queries }).toEqual({
      keys: ['SELECT key FROM meta WHERE key >= ?', 'SELECT value FROM meta'],
      queries: 2,
    });
  });

  it('lists the heaviest statements by rows read, with the head of their SQL', () => {
    // #given
    const statements = {
      'SELECT a': { queries: 1, rowsRead: 10, d1Ms: 1 },
      'SELECT b': { queries: 2, rowsRead: 300, d1Ms: 5 },
      'SELECT c': { queries: 1, rowsRead: 50, d1Ms: 2 },
      'SELECT d': { queries: 1, rowsRead: 0, d1Ms: 0 },
    };
    // #when
    const top = heaviestStatements(statements, 3);
    // #then
    expect(top).toEqual([
      { sql: 'SELECT b', rows_read: 300, d1_ms: 5, queries: 2 },
      { sql: 'SELECT c', rows_read: 50, d1_ms: 2, queries: 1 },
      { sql: 'SELECT a', rows_read: 10, d1_ms: 1, queries: 1 },
    ]);
  });

  it('cuts a long statement to its head', () => {
    // #when
    const [top] = heaviestStatements({ [`SELECT ${'x, '.repeat(100)}y FROM t`]: { queries: 1, rowsRead: 1, d1Ms: 0 } }, 1);
    // #then
    expect(top!.sql.length).toBe(STATEMENT_HEAD_CHARS);
  });

  it('lists nothing for a step that ran no statement', () => {
    expect(heaviestStatements({}, 3)).toEqual([]);
  });

  it("subtracts a step's starting usage, statement by statement", async () => {
    // #given
    const meter = meterD1(env.DB);
    await meter.db.prepare('SELECT value FROM meta').all();
    const before = meter.usage();
    // #when
    await meter.db.prepare('SELECT value FROM meta').all();
    await meter.db.prepare('SELECT key FROM meta').all();
    // #then
    const step = usageSince(meter.usage(), before);
    expect({ queries: step.queries, perStatement: Object.fromEntries(Object.entries(step.statements).map(([sql, s]) => [sql, s.queries])) }).toEqual({
      queries: 2,
      perStatement: { 'SELECT value FROM meta': 1, 'SELECT key FROM meta': 1 },
    });
  });
});
