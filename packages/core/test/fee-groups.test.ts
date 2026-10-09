import { describe, expect, it } from 'vitest';
import { FEE_TOKEN_GROUPS, feeClassifier, feeGroupTotals, feeTokenGroup } from '../src/fee-groups';
import { UNLISTED_LINK_FEE_TOKENS } from '../src/reserve';
import { linkFeeKeys, linkFeeMatcher, linkFeeUsd } from '../src/rollup';
import type { MessageRow } from '../src/types';

const BASE = '15971525489660198786';
const SOLANA = '124615329519749607';
const LINK_BASE = '0x88fb150bdc53a65fe94dea0c9ba0a6daf8c6e196';
const LINK_SOLANA = 'LinkhB3afbBKb2EQQu7s7umdZceV3wcvAUJhQAfQ23L';
const WETH_BASE = '0x4200000000000000000000000000000000000006';
const GHO_BASE = '0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee';
const UNKNOWN = '0x1111111111111111111111111111111111111111';

const linkTokens = linkFeeKeys([
  { chain: '5009297550715157269', address: '0x514910771af9ca656af840dff83e8264ecf986ca', groupId: 'link', decimals: 18 },
  { chain: BASE, address: LINK_BASE, groupId: 'link', decimals: 18 },
  { chain: SOLANA, address: LINK_SOLANA, groupId: 'link', decimals: 9 },
]);
const isLinkFee = linkFeeMatcher(linkTokens);
const classify = feeClassifier(linkTokens);

const row = (id: string, chain: string, token: string | null, amount: string | null, usd: number | null, day = '2026-10-05') =>
  ({ message_id: id, day, src_chain: chain, fee_token: token, fee_amount: amount, fee_usd: usd }) as MessageRow;

describe('feeTokenGroup', () => {
  it.each([
    ['WETH on Base', BASE, WETH_BASE, 'native'],
    ['WBTC on Bitlayer, priced through a fee price alias', '7937294810946806131', '0xff204e2681a6fa0e2c3fade68a1b28fb90e4fc5f', 'native'],
    ['GHO on Base', BASE, GHO_BASE, 'stable'],
    ['LINK on Arbitrum, which the registry leaves out', '4949039107694359620', '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', 'link'],
    ['a fee token in neither list', BASE, UNKNOWN, 'other'],
  ])('puts %s in its group', (_, chain, token, group) => {
    expect(feeTokenGroup(chain, token, isLinkFee)).toBe(group);
  });

  it('matches a checksummed address', () => {
    expect(feeTokenGroup(BASE, '0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee', isLinkFee)).toBe('stable');
  });

  it('groups a fee token the docs miss from the hand-added entries', () => {
    expect(feeTokenGroup('8481857512324358265', '0x3bd359c1119da7da1d913d1c4d2b7c461115433a', isLinkFee)).toBe('native');
  });

  it('keeps LINK out of the table', () => {
    expect(Object.keys(FEE_TOKEN_GROUPS).filter((key) => linkFeeKeys([]).has(key))).toEqual([]);
  });
});

describe('feeClassifier', () => {
  it("names a LINK fee and gives its registry token's decimals", () => {
    expect(classify(SOLANA, LINK_SOLANA)).toEqual({ group: 'link', symbol: 'LINK', linkDecimals: 9 });
  });

  it('names a grouped fee token by its table symbol', () => {
    expect(classify(BASE, WETH_BASE)).toEqual({ group: 'native', symbol: 'WETH', linkDecimals: null });
  });

  it('has no symbol for any other fee token', () => {
    expect(classify(BASE, UNKNOWN)).toEqual({ group: 'other', symbol: null, linkDecimals: null });
  });
});

describe('UNLISTED_LINK_FEE_TOKENS', () => {
  it('gives every unlisted LINK the 18 decimals read on chain on 2026-10-09', () => {
    expect(Object.values(UNLISTED_LINK_FEE_TOKENS).map((t) => t.decimals)).toEqual(Array(13).fill(18));
  });
});

describe('feeGroupTotals', () => {
  // #given a day with 0.1 LINK worth $1, WETH worth $2, GHO worth $3 and an ungrouped token worth $4
  const day = [
    row('l', BASE, LINK_BASE, '100000000000000000', 1),
    row('w', BASE, WETH_BASE, '1000000000000000', 2),
    row('g', BASE, GHO_BASE, '3000000000000000000', 3),
    row('o', BASE, UNKNOWN, '5', 4),
  ];

  it('sums the USD fees of each group and the LINK paid in LINK, leaving other out', () => {
    // #when
    const totals = feeGroupTotals(day, '2026-10-05', classify);
    // #then
    expect(totals).toEqual({ link_usd: 1, native_usd: 2, stable_usd: 3, link_amount: 0.1 });
  });

  it('counts a LINK fee with no price in LINK units, at its token decimals', () => {
    // #given 2.5 Solana LINK (9 decimals) with no USD price
    const rows = [...day, row('s', SOLANA, LINK_SOLANA, '2500000000', null)];
    // #when, #then
    expect(feeGroupTotals(rows, '2026-10-05', classify).link_amount).toBe(2.6);
  });

  it('gives the same LINK USD total as linkFeeUsd', () => {
    expect(feeGroupTotals(day, '2026-10-05', classify).link_usd).toBe(linkFeeUsd(day, '2026-10-05', isLinkFee));
  });

  it('is null throughout for a day with no priced fee', () => {
    expect(feeGroupTotals([row('n', BASE, null, null, null)], '2026-10-05', classify)).toEqual({ link_usd: null, native_usd: null, stable_usd: null, link_amount: null });
  });

  it('ignores other days and counts a duplicated message once', () => {
    // #given
    const rows = [...day, row('w', BASE, WETH_BASE, '1000000000000000', 2), row('z', BASE, WETH_BASE, '1', 9, '2026-10-04')];
    // #when, #then
    expect(feeGroupTotals(rows, '2026-10-05', classify).native_usd).toBe(2);
  });
});
