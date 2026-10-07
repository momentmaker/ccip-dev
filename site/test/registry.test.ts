import { describe, expect, it } from 'vitest';
import { chainNameMap } from '../src/lib/names';
import { chainRows, isNew, tokenRows } from '../src/lib/registry';

describe('registry', () => {
  it('marks anything first seen in the last 14 days as new', () => {
    expect(isNew('2026-09-24T10:00:00.000Z', '2026-10-07')).toBe(true);
    expect(isNew('2026-09-23T23:59:59.000Z', '2026-10-07')).toBe(false);
    expect(isNew(null, '2026-10-07')).toBe(false);
  });

  it('lists chains newest first with short names, unknown first-seen last', () => {
    const rows = chainRows(
      [
        { selector: '1', name: 'a-mainnet', display_name: 'A Mainnet', family: 'EVM', chain_id: '1', first_seen: '2024-01-01T00:00:00.000Z' },
        { selector: '2', name: 'b-mainnet', display_name: null, family: 'SVM', chain_id: null, first_seen: null },
        { selector: '3', name: 'c-mainnet', display_name: 'C Mainnet', family: 'EVM', chain_id: '3', first_seen: '2026-10-01T00:00:00.000Z' },
      ],
      '2026-10-07',
    );
    expect(rows.map((r) => [r.name, r.isNew])).toEqual([['C', true], ['A', false], ['b-mainnet', false]]);
  });

  it('lists tokens newest first with their chain name and a fallback symbol', () => {
    const names = chainNameMap([{ selector: '1', display_name: 'A Mainnet' }]);
    const rows = tokenRows(
      [
        { chain: '1', address: '0x1111111111111111111111111111111111111111', symbol: null, name: null, decimals: 18, group_id: null, first_seen: '2026-01-01T00:00:00.000Z' },
        { chain: '1', address: '0x2222222222222222222222222222222222222222', symbol: 'USDC', name: 'USD Coin', decimals: 6, group_id: 'g', first_seen: '2026-10-06T00:00:00.000Z' },
      ],
      names,
      '2026-10-07',
    );
    expect(rows.map((r) => [r.symbol, r.chain, r.isNew])).toEqual([['USDC', 'A', true], ['0x1111…1111', 'A', false]]);
    expect(rows.map((r) => r.chainSelector)).toEqual(['1', '1']);
  });
});
