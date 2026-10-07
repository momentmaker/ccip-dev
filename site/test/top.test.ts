import { describe, expect, it } from 'vitest';
import { chainNameMap } from '../src/lib/names';
import { topRows } from '../src/lib/top';

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
