/** What a metered binding has run. `rowsRead` and `d1Ms` come only from all(), run() and batch(), whose results carry D1's meta. */
export interface D1Usage {
  queries: number;
  rowsRead: number;
  d1Ms: number;
}

export interface D1Meter {
  db: D1Database;
  usage(): D1Usage;
}

const passThrough = <T extends object>(target: T, prop: string | symbol): unknown => {
  const value: unknown = Reflect.get(target, prop, target);
  return typeof value === 'function' ? value.bind(target) : value;
};

/** Wraps `db` so every statement prepared through it counts toward usage(); results are returned unchanged. */
export function meterD1(db: D1Database): D1Meter {
  const usage: D1Usage = { queries: 0, rowsRead: 0, d1Ms: 0 };
  const unwrapped = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const record = (meta: D1Meta | undefined) => {
    usage.rowsRead += meta?.rows_read ?? 0;
    usage.d1Ms += meta?.duration ?? 0;
  };

  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(statement, {
      get(target, prop) {
        if (prop === 'bind') return (...values: unknown[]) => wrap(target.bind(...values));
        if (prop === 'all' || prop === 'run') {
          return async () => {
            usage.queries += 1;
            const result = prop === 'all' ? await target.all() : await target.run();
            record(result.meta);
            return result;
          };
        }
        if (prop === 'first' || prop === 'raw') {
          return (...args: unknown[]) => {
            usage.queries += 1;
            return (target[prop] as (...a: unknown[]) => Promise<unknown>)(...args);
          };
        }
        return passThrough(target, prop);
      },
    });
    unwrapped.set(proxy, statement);
    return proxy;
  };

  const metered = new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => wrap(target.prepare(sql));
      if (prop === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          const results = await target.batch(statements.map((s) => unwrapped.get(s) ?? s));
          usage.queries += statements.length;
          for (const result of results) record(result.meta);
          return results;
        };
      }
      return passThrough(target, prop);
    },
  });

  return { db: metered, usage: () => ({ ...usage }) };
}
