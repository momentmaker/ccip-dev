import { describe, expect, it } from 'vitest';
import { chainNameMap } from '../src/lib/names';
import { TOP_FILE, topEntries, topHref, topRows } from '../src/lib/top';

const ETH = '5009297550715157269';
const BASE = '15971525489660198786';
const names = chainNameMap([
  { selector: ETH, name: 'ethereum-mainnet', display_name: 'Ethereum Mainnet' },
  { selector: BASE, name: 'ethereum-mainnet-base-1', display_name: 'Base Mainnet' },
]);

describe('topRows', () => {
  it('ranks lanes with readable names and their share of the list', () => {
    expect(topRows([{ key: `${ETH}>${BASE}`, messages: 3, usd: 75, fee_usd: 1.5 }, { key: `${BASE}>${ETH}`, messages: 1, usd: 25, fee_usd: null }], 'lane', names)).toEqual([
      { rank: 1, primary: 'Ethereum → Base', secondary: null, verified: false, chains: [ETH, BASE], messages: 3, usd: 75, fee: 1.5, sharePct: 75 },
      { rank: 2, primary: 'Base → Ethereum', secondary: null, verified: false, chains: [BASE, ETH], messages: 1, usd: 25, fee: null, sharePct: 25 },
    ]);
  });

  it('lists the two chains of a lane key', () => {
    const [lane] = topRows([{ key: `${ETH}>${BASE}`, messages: 1, usd: 1 }], 'lane', names);
    expect(lane!.chains).toEqual([ETH, BASE]);
  });

  it('names tokens by symbol and senders by verified label', () => {
    const [token] = topRows([{ key: `${ETH}:0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b`, messages: 1, usd: 10, symbol: 'syrupUSDC' }], 'token', names);
    expect(token).toMatchObject({ primary: 'syrupUSDC', secondary: 'Ethereum', verified: false, chains: [ETH] });
    const [sender] = topRows([{ key: `${BASE}:0xc6160f5bc3c673ac390f11c492e8ed0d0693579a`, messages: 1, usd: null, label: 'Aave' }], 'sender', names);
    expect(sender).toMatchObject({ primary: 'Aave', secondary: 'Base', verified: true, chains: [BASE], usd: null, sharePct: null });
  });
});

describe('chains and fee rankings', () => {
  it('names a chain from its selector and shows its icon', () => {
    // #when
    const [chain] = topRows([{ key: ETH, messages: 5, usd: 10, fee_usd: 2 }], 'chain', names);
    // #then
    expect(chain).toMatchObject({ primary: 'Ethereum', secondary: null, verified: false, chains: [ETH] });
  });

  it('takes each share from the fees on a fee ranking', () => {
    // #given the lane that moved 90% of the value paid 75% of the fees
    const entries = [{ key: `${ETH}>${BASE}`, messages: 1, usd: 90, fee_usd: 3 }, { key: `${BASE}>${ETH}`, messages: 1, usd: 10, fee_usd: 1 }];
    // #when
    const rows = topRows(entries, 'lane', names, { order: 'fees' });
    // #then
    expect(rows.map((r) => r.sharePct)).toEqual([75, 25]);
  });

  it('reads the fee ranking for a fees page, and nothing from a file published before it', () => {
    // #given
    const entry = { key: 'a>b', messages: 1, usd: 1, fee_usd: 1 };
    const file = { schema_version: 1 as const, updated_at: 'x', attribution: 'y', dim: 'lane' as const, since: null, windows: { '7d': [entry], '30d': [], all: [] } };
    // #when
    const withFees = topEntries({ ...file, by_fees: { '7d': [entry], '30d': [], all: [] } }, '7d', 'fees');
    const without = topEntries(file, '7d', 'fees');
    // #then
    expect({ withFees, without }).toEqual({ withFees: [entry], without: [] });
  });

  it('puts the fee ranking under fees/ and leaves the value ranking at its address', () => {
    expect([topHref('lane', '7d', 'value'), topHref('chain', 'all', 'fees')]).toEqual(['/top/lane/7d/', '/top/chain/all/fees/']);
  });

  it('reads the Chains tab from the source-chain file', () => {
    expect(TOP_FILE.chain).toBe('top/src_chain.json');
  });
});
