import { describe, expect, it } from 'vitest';
import { buildTokenGroupIndex, fallbackKeys, groupFallback, siblingKeys, tokenGroupEntry } from '../src/token-groups';
import type { ChainRef, PriceInfo, PriceLookup } from '../src/types';
import { valueTokens } from '../src/value';

const ethereum: ChainRef = { selector: '5009297550715157269', name: 'ethereum-mainnet', chainId: '1', family: 'EVM' };
const bsc: ChainRef = { selector: '11344663589394136015', name: 'binance_smart_chain-mainnet', chainId: '56', family: 'EVM' };
const arbitrum: ChainRef = { selector: '4949039107694359620', name: 'ethereum-mainnet-arbitrum-1', chainId: '42161', family: 'EVM' };
const aptos: ChainRef = { selector: '4741433654826277614', name: 'aptos-mainnet', chainId: '1', family: 'APTOS' };

const USDC_ETH = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const USDC_BSC = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const USDC_APTOS = '0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b';
const LONE = '0x1111111111111111111111111111111111111111';

const entry = (chain: ChainRef, address: string, decimals: number, groupId: string | null = 'usdc') =>
  tokenGroupEntry({ chain: chain.selector, address, decimals, groupId }, chain);

const usdcEth = entry(ethereum, USDC_ETH, 6);
const usdcBsc = entry(bsc, USDC_BSC, 18);
const usdcArb = entry(arbitrum, USDC_ARB, 6);
const usdcAptos = entry(aptos, USDC_APTOS, 6);

const lookupOf = (prices: Record<string, PriceInfo>): PriceLookup => (key) => prices[key];
const fiveUsdc = (chain: ChainRef, token: string) => [{ chain, token, amount: '5000000' }];

describe('tokenGroupEntry', () => {
  it('derives the llama key from the chain, and none for a chain DefiLlama does not price or an unknown chain', () => {
    expect(usdcBsc.llamaKey).toBe(`bsc:${USDC_BSC}`);
    expect(usdcAptos.llamaKey).toBeNull();
    expect(tokenGroupEntry({ chain: '1', address: USDC_ETH, decimals: 6, groupId: 'usdc' }, undefined).llamaKey).toBeNull();
  });
});

describe('groupFallback', () => {
  it('prices a token with no price of its own from a group sibling, using the token\'s own decimals', () => {
    const index = buildTokenGroupIndex([usdcEth, usdcBsc]);
    const lookup = lookupOf({ [`bsc:${USDC_BSC}`]: { price: 1, decimals: 18 } });
    const v = valueTokens(fiveUsdc(ethereum, USDC_ETH), lookup, groupFallback(index, lookup));
    expect(v).toEqual({ usdValue: 5, unpriced: false, tokenUsd: [5] });
  });

  it('prices a non-EVM token, which has no llama key, through an EVM sibling', () => {
    const index = buildTokenGroupIndex([usdcAptos, usdcBsc]);
    const lookup = lookupOf({ [`bsc:${USDC_BSC}`]: { price: 0.999, decimals: 18 } });
    const v = valueTokens(fiveUsdc(aptos, USDC_APTOS), lookup, groupFallback(index, lookup));
    expect(v.unpriced).toBe(false);
    expect(v.usdValue).toBeCloseTo(4.995, 12);
  });

  it('leaves a token outside the registry unpriced', () => {
    const lookup = lookupOf({ [`bsc:${USDC_BSC}`]: { price: 1, decimals: 18 } });
    const fallback = groupFallback(buildTokenGroupIndex([usdcBsc]), lookup);
    expect(fallback(ethereum.selector, USDC_ETH)).toBeUndefined();
  });

  it('leaves a registry token without a group unpriced', () => {
    const lookup = lookupOf({ [`bsc:${USDC_BSC}`]: { price: 1, decimals: 18 } });
    const fallback = groupFallback(buildTokenGroupIndex([entry(ethereum, LONE, 6, null), entry(bsc, USDC_BSC, 18, null)]), lookup);
    expect(fallback(ethereum.selector, LONE)).toBeUndefined();
  });

  it('leaves a token unpriced when no sibling has a price', () => {
    const fallback = groupFallback(buildTokenGroupIndex([usdcEth, usdcBsc, usdcAptos]), lookupOf({}));
    expect(fallback(aptos.selector, USDC_APTOS)).toBeUndefined();
  });

  it('picks the priced sibling first by llama key, whatever the registry order', () => {
    const lookup = lookupOf({
      [`bsc:${USDC_BSC}`]: { price: 0.98, decimals: 18 },
      [`arbitrum:${USDC_ARB}`]: { price: 1.01, decimals: 6 },
    });
    const forward = groupFallback(buildTokenGroupIndex([usdcAptos, usdcBsc, usdcArb]), lookup);
    const backward = groupFallback(buildTokenGroupIndex([usdcArb, usdcBsc, usdcAptos]), lookup);
    expect(forward(aptos.selector, USDC_APTOS)).toEqual({ price: 1.01, decimals: 6 });
    expect(backward(aptos.selector, USDC_APTOS)).toEqual({ price: 1.01, decimals: 6 });
  });

  it('skips siblings without a price and takes the next one in order', () => {
    const lookup = lookupOf({ [`bsc:${USDC_BSC}`]: { price: 0.98, decimals: 18 } });
    const fallback = groupFallback(buildTokenGroupIndex([usdcAptos, usdcBsc, usdcArb]), lookup);
    expect(fallback(aptos.selector, USDC_APTOS)).toEqual({ price: 0.98, decimals: 6 });
  });
});

describe('siblingKeys', () => {
  it('lists the other group members that have a llama key, sorted by key', () => {
    const index = buildTokenGroupIndex([usdcBsc, usdcAptos, usdcEth, usdcArb]);
    expect(siblingKeys(index, ethereum.selector, USDC_ETH)).toEqual([`arbitrum:${USDC_ARB}`, `bsc:${USDC_BSC}`]);
    expect(siblingKeys(index, aptos.selector, USDC_APTOS)).toEqual([`arbitrum:${USDC_ARB}`, `bsc:${USDC_BSC}`, `ethereum:${USDC_ETH}`]);
  });

  it('is empty for a token outside the registry or without a group', () => {
    const index = buildTokenGroupIndex([usdcBsc, entry(ethereum, LONE, 6, null)]);
    expect(siblingKeys(index, ethereum.selector, USDC_ETH)).toEqual([]);
    expect(siblingKeys(index, ethereum.selector, LONE)).toEqual([]);
  });
});

describe('fallbackKeys', () => {
  it('lists, once each, the sibling keys of tokens that have no price of their own', () => {
    const index = buildTokenGroupIndex([usdcEth, usdcBsc, usdcArb, usdcAptos]);
    const lookup = lookupOf({ [`arbitrum:${USDC_ARB}`]: { price: 1, decimals: 6 } });
    const tokens = [...fiveUsdc(arbitrum, USDC_ARB), ...fiveUsdc(aptos, USDC_APTOS), ...fiveUsdc(ethereum, USDC_ETH)];
    expect(fallbackKeys(index, tokens, lookup)).toEqual([`arbitrum:${USDC_ARB}`, `bsc:${USDC_BSC}`, `ethereum:${USDC_ETH}`]);
  });

  it('is empty when every token has its own price', () => {
    const index = buildTokenGroupIndex([usdcEth, usdcBsc]);
    const lookup = lookupOf({ [`ethereum:${USDC_ETH}`]: { price: 1, decimals: 6 } });
    expect(fallbackKeys(index, fiveUsdc(ethereum, USDC_ETH), lookup)).toEqual([]);
  });
});
