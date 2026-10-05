import { describe, expect, it } from 'vitest';
import { insertSql, sqlLiteral } from '../src/sql';

describe('sqlLiteral', () => {
  it('quotes strings, escaping single quotes', () => {
    expect(sqlLiteral("it's")).toBe("'it''s'");
  });
  it('writes numbers and null', () => {
    expect([sqlLiteral(12.5), sqlLiteral(0), sqlLiteral(null), sqlLiteral(undefined)]).toEqual(['12.5', '0', 'NULL', 'NULL']);
  });
  it('refuses non-finite numbers and other types', () => {
    expect(() => sqlLiteral(Number.NaN)).toThrow('non-finite');
    expect(() => sqlLiteral(true)).toThrow('Cannot write a boolean');
  });
});

describe('insertSql', () => {
  it('builds one statement in the row key order with the conflict clause', () => {
    expect(insertSql('meta', { key: 'coverage_from', value: '2025-06-03' }, 'ON CONFLICT(key) DO NOTHING')).toBe(
      "INSERT INTO meta (key, value) VALUES ('coverage_from', '2025-06-03') ON CONFLICT(key) DO NOTHING;",
    );
  });
});
