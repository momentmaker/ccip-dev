import { describe, expect, it } from 'vitest';
import { docsAddress, groupFeeTokens, renderGroupsFile, type DocsChains, type DocsTokens } from '../fee-groups/generate';

const BASE = '15971525489660198786';
const APTOS = '4741433654826277614';
const WETH = '0x4200000000000000000000000000000000000006';

const chains: DocsChains = {
  'ethereum-mainnet-base-1': { chainSelector: BASE, feeTokens: ['LINK', 'GHO', 'WETH'] },
  'aptos-mainnet': { chainSelector: APTOS, feeTokens: ['LINK', 'APT'] },
  'lens-mainnet': { chainSelector: '5608378062013572713', feeTokens: ['LINK', 'WGHO'] },
};
const tokens: DocsTokens = {
  LINK: { 'ethereum-mainnet-base-1': { tokenAddress: '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196' } },
  GHO: { 'ethereum-mainnet-base-1': { tokenAddress: '0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee' } },
  WETH: { 'ethereum-mainnet-base-1': { tokenAddress: WETH } },
  APT: { 'aptos-mainnet': { tokenAddress: '0x000000000000000000000000000000000000000000000000000000000000000A' } },
  WGHO: { 'lens-mainnet': { tokenAddress: '0x6bDc36E20D267Ff0dd6097799f82e78907105e2F' } },
};

describe('groupFeeTokens', () => {
  it('puts a stablecoin symbol in stable and every other symbol in native', () => {
    // #when
    const { entries } = groupFeeTokens(chains, tokens);
    // #then
    expect(Object.fromEntries(entries.map((e) => [e.symbol, e.group]))).toEqual({ APT: 'native', GHO: 'stable', WETH: 'native', WGHO: 'stable' });
  });

  it('skips LINK, which keeps its own matcher', () => {
    // #when
    const { entries } = groupFeeTokens(chains, tokens);
    // #then
    expect(entries.some((e) => e.symbol === 'LINK')).toBe(false);
  });

  it('keys each token by chain selector and lowercase 0x address, as the CCIP API reports them', () => {
    // #when
    const { entries } = groupFeeTokens(chains, tokens);
    // #then
    expect(entries.map((e) => e.key)).toContain(`${APTOS}:0x000000000000000000000000000000000000000000000000000000000000000a`);
  });

  it('leaves out a symbol marked ungrouped and says so', () => {
    // #when
    const { entries, review } = groupFeeTokens(chains, tokens, { stable: new Set(['GHO']), ungrouped: new Set(['WGHO']) });
    // #then
    expect({ symbols: entries.map((e) => e.symbol).sort(), leftOut: review.filter((l) => l.startsWith('left out')) }).toEqual({
      symbols: ['APT', 'GHO', 'WETH'],
      leftOut: ['left out WGHO: lens-mainnet'],
    });
  });

  it('prints each symbol with its group and chains, then what it skipped', () => {
    // #given a chain whose fee token has no tokens.json entry
    const withGap: DocsChains = { ...chains, 'corn-mainnet': { chainSelector: '9043146809313071210', feeTokens: ['LINK', 'WBTCN'] } };
    // #when
    const { review } = groupFeeTokens(withGap, tokens);
    // #then
    expect(review).toEqual([
      'native APT: aptos-mainnet',
      'native WETH: ethereum-mainnet-base-1',
      'stable GHO: ethereum-mainnet-base-1',
      'stable WGHO: lens-mainnet',
      'skipped LINK on 4 chains',
      'missing WBTCN on corn-mainnet: tokens.json has no address for it; hand-add it in fee-groups.ts if it is a real fee token',
    ]);
  });

  it('refuses two symbols at the same chain and address', () => {
    // #given
    const dup: DocsChains = { 'ethereum-mainnet-base-1': { chainSelector: BASE, feeTokens: ['WETH', 'WETH9'] } };
    const dupTokens: DocsTokens = { WETH: { 'ethereum-mainnet-base-1': { tokenAddress: WETH } }, WETH9: { 'ethereum-mainnet-base-1': { tokenAddress: WETH } } };
    // #when, #then
    expect(() => groupFeeTokens(dup, dupTokens)).toThrow(`${BASE}:${WETH} is listed as both WETH and WETH9`);
  });
});

describe('docsAddress', () => {
  it('lowercases 0x hex of any length and leaves base58 and TON addresses alone', () => {
    // #when
    const out = ['0xAbC', 'So11111111111111111111111111111111111111112', 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAd99'].map(docsAddress);
    // #then
    expect(out).toEqual(['0xabc', 'So11111111111111111111111111111111111111112', 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAd99']);
  });
});

describe('renderGroupsFile', () => {
  it('writes one line per token, commented with its docs chain', () => {
    // #when
    const file = renderGroupsFile([{ key: `${BASE}:${WETH}`, chain: 'ethereum-mainnet-base-1', group: 'native', symbol: 'WETH' }]);
    // #then
    expect(file).toContain(`  "${BASE}:${WETH}": { group: "native", symbol: "WETH" }, // ethereum-mainnet-base-1\n`);
  });

  it('exports the table under one name', () => {
    expect(renderGroupsFile([])).toContain("export const FEE_TOKEN_GROUPS_FROM_DOCS: Readonly<Record<string, { group: 'native' | 'stable'; symbol: string }>> = {\n};\n");
  });
});
