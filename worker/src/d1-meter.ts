export interface StatementUsage {
  queries: number;
  rowsRead: number;
  d1Ms: number;
}

/**
 * What a metered binding has run, in all and per statement (keyed by its SQL with whitespace collapsed). `rowsRead` and
 * `d1Ms` come only from all(), run() and batch(), whose results carry D1's meta.
 */
export interface D1Usage extends StatementUsage {
  statements: Record<string, StatementUsage>;
}

export interface D1Meter {
  db: D1Database;
  usage(): D1Usage;
}

/** How much of a statement's SQL a log line keeps: enough to tell the queries apart. */
export const STATEMENT_HEAD_CHARS = 120;

const collapse = (sql: string) => sql.replace(/\s+/g, ' ').trim();

const passThrough = <T extends object>(target: T, prop: string | symbol): unknown => {
  const value: unknown = Reflect.get(target, prop, target);
  return typeof value === 'function' ? value.bind(target) : value;
};

/** Wraps `db` so every statement prepared through it counts toward usage(); results are returned unchanged. */
export function meterD1(db: D1Database): D1Meter {
  const total: StatementUsage = { queries: 0, rowsRead: 0, d1Ms: 0 };
  const statements = new Map<string, StatementUsage>();
  const prepared = new WeakMap<D1PreparedStatement, { statement: D1PreparedStatement; sql: string }>();
  const record = (sql: string, meta: D1Meta | undefined) => {
    const statement = statements.get(sql) ?? { queries: 0, rowsRead: 0, d1Ms: 0 };
    statements.set(sql, statement);
    for (const usage of [total, statement]) {
      usage.queries += 1;
      usage.rowsRead += meta?.rows_read ?? 0;
      usage.d1Ms += meta?.duration ?? 0;
    }
  };

  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const proxy = new Proxy(statement, {
      get(target, prop) {
        if (prop === 'bind') return (...values: unknown[]) => wrap(target.bind(...values), sql);
        if (prop === 'all' || prop === 'run') {
          return async () => {
            const result = prop === 'all' ? await target.all() : await target.run();
            record(sql, result.meta);
            return result;
          };
        }
        if (prop === 'first' || prop === 'raw') {
          return (...args: unknown[]) => {
            record(sql, undefined);
            return (target[prop] as (...a: unknown[]) => Promise<unknown>)(...args);
          };
        }
        return passThrough(target, prop);
      },
    });
    prepared.set(proxy, { statement, sql });
    return proxy;
  };

  const metered = new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => wrap(target.prepare(sql), collapse(sql));
      if (prop === 'batch') {
        return async (batch: D1PreparedStatement[]) => {
          const results = await target.batch(batch.map((s) => prepared.get(s)?.statement ?? s));
          results.forEach((result, i) => record(prepared.get(batch[i]!)?.sql ?? '(unmetered)', result.meta));
          return results;
        };
      }
      return passThrough(target, prop);
    },
  });

  return {
    db: metered,
    usage: () => ({ ...total, statements: Object.fromEntries([...statements].map(([sql, s]) => [sql, { ...s }])) }),
  };
}

/** The usage between two readings of one meter, statement by statement; statements that did not run in between drop out. */
export function usageSince(now: D1Usage, before: D1Usage): D1Usage {
  const statements: Record<string, StatementUsage> = {};
  for (const [sql, s] of Object.entries(now.statements)) {
    const earlier = before.statements[sql] ?? { queries: 0, rowsRead: 0, d1Ms: 0 };
    if (s.queries > earlier.queries) {
      statements[sql] = { queries: s.queries - earlier.queries, rowsRead: s.rowsRead - earlier.rowsRead, d1Ms: s.d1Ms - earlier.d1Ms };
    }
  }
  return { queries: now.queries - before.queries, rowsRead: now.rowsRead - before.rowsRead, d1Ms: now.d1Ms - before.d1Ms, statements };
}

/** The `limit` statements that read the most rows, as log fields, with the head of their SQL. */
export function heaviestStatements(statements: Record<string, StatementUsage>, limit: number): { sql: string; rows_read: number; d1_ms: number; queries: number }[] {
  return Object.entries(statements)
    .sort(([, a], [, b]) => b.rowsRead - a.rowsRead || b.d1Ms - a.d1Ms)
    .slice(0, limit)
    .map(([sql, s]) => ({ sql: sql.slice(0, STATEMENT_HEAD_CHARS), rows_read: s.rowsRead, d1_ms: Math.round(s.d1Ms), queries: s.queries }));
}
