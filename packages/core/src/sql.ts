export const TOTALS_CONFLICT =
  'ON CONFLICT(day) DO UPDATE SET messages = excluded.messages, token_messages = excluded.token_messages, ' +
  'usd_value = excluded.usd_value, fee_usd = excluded.fee_usd, unique_senders = excluded.unique_senders, ' +
  'median_delivery_s = excluded.median_delivery_s, unpriced_messages = excluded.unpriced_messages, computed_at = excluded.computed_at';
export const BREAKDOWN_CONFLICT =
  'ON CONFLICT(day, dim, key) DO UPDATE SET messages = excluded.messages, usd_value = excluded.usd_value, fee_usd = excluded.fee_usd';

export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Cannot write non-finite number ${value} to SQL`);
    return String(value);
  }
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  throw new Error(`Cannot write a ${typeof value} to SQL`);
}

export function insertSql(table: string, row: object, conflictClause: string): string {
  const entries = Object.entries(row);
  const columns = entries.map(([column]) => column).join(', ');
  const values = entries.map(([, value]) => sqlLiteral(value)).join(', ');
  return `INSERT INTO ${table} (${columns}) VALUES (${values})${conflictClause ? ` ${conflictClause}` : ''};`;
}
