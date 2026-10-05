import { describe, expect, it } from 'vitest';
import type { CoingeckoIdLookup } from '../src/coingecko';
import { COIN_PRICE_DECIMALS } from '../src/prices';
import {
  buildTokenGroupIndex, coingeckoKeys, fallbackKeys, groupFallback, lacksOwnPrice, siblingKeys, tokenGroupEntry,
} from '../src/token-groups';
import type { ChainRef, PriceInfo, PriceLookup } from '../src/types';
import { valueTokens } from '../src/value';

const ethereum: ChainRef = { selector: '5009297550715157269', name: 'ethereum-mainnet', chainId: '1', family: 'EVM' };
const bsc: ChainRef = { selector: '11344663589394136015', name: 'binance_smart_chain-mainnet', chainId: '56', family: 'EVM' };
const arbitrum: ChainRef = { selector: '4949039107694359620', name: 'ethereum-mainnet-arbitrum-1', chainId: '42161', family: 'EVM' };
const aptos: ChainRef = { selector: '4741433654826277614', name: 'aptos-mainnet', chainId: '1', family: 'APTOS' };
const base: ChainRef = { selector: '15971525489660198786', name: 'ethereum-mainnet-base-1', chainId: '8453', family: 'EVM' };
const zeroG: ChainRef = { selector: '4426351306075016396', name: '0g-mainnet', chainId: '16661', family: 'EVM' };
const abstract: ChainRef = { selector: '3577778157919314504', name: 'abstract-mainnet', chainId: '2741', family: 'EVM' };

const USDC_ETH = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const USDC_BSC = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const USDC_APTOS = '0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b';
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const USDC_0G = '0x0000000000000000000000000000000000000a0a';
const USDC_ABSTRACT = '0x0000000000000000000000000000000000000abc';
const LONE = '0x1111111111111111111111111111111111111111';

const entry = (chain: ChainRef, address: string, decimals: number, groupId: string | null = 'usdc') =>
  tokenGroupEntry({ chain: chain.selector, address, decimals, groupId }, chain);

const usdcEth = entry(ethereum, USDC_ETH, 6);
const usdcBsc = entry(bsc, USDC_BSC, 18);
const usdcArb = entry(arbitrum, USDC_ARB, 6);
const usdcAptos = entry(aptos, USDC_APTOS, 6);
const usdcBase = entry(base, USDC_BASE, 6);
const usdc0g = entry(zeroG, USDC_0G, 6);
const usdcAbstract = entry(abstract, USDC_ABSTRACT, 6);

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
    expect(fallback(ethereum, USDC_ETH)).toBeUndefined();
  });

  it('leaves a registry token without a group unpriced', () => {
    const lookup = lookupOf({ [`bsc:${USDC_BSC}`]: { price: 1, decimals: 18 } });
    const fallback = groupFallback(buildTokenGroupIndex([entry(ethereum, LONE, 6, null), entry(bsc, USDC_BSC, 18, null)]), lookup);
    expect(fallback(ethereum, LONE)).toBeUndefined();
  });

  it('leaves a token unpriced when no sibling has a price', () => {
    const fallback = groupFallback(buildTokenGroupIndex([usdcEth, usdcBsc, usdcAptos]), lookupOf({}));
    expect(fallback(aptos, USDC_APTOS)).toBeUndefined();
  });

  it('prefers the Ethereum copy\'s price over a small chain\'s, whatever the registry order', () => {
    const lookup = lookupOf({ [`0g:${USDC_0G}`]: { price: 50, decimals: 6 }, [`ethereum:${USDC_ETH}`]: { price: 1, decimals: 6 } });
    for (const entries of [[usdcAptos, usdc0g, usdcEth], [usdcEth, usdc0g, usdcAptos]]) {
      const v = valueTokens(fiveUsdc(aptos, USDC_APTOS), lookup, groupFallback(buildTokenGroupIndex(entries), lookup));
      expect(v.usdValue).toBe(5);
    }
  });

  it('prefers Base over a small chain when the Ethereum copy has no price', () => {
    const lookup = lookupOf({ [`0g:${USDC_0G}`]: { price: 50, decimals: 6 }, [`base:${USDC_BASE}`]: { price: 1, decimals: 6 } });
    const fallback = groupFallback(buildTokenGroupIndex([usdcAptos, usdc0g, usdcEth, usdcBase]), lookup);
    expect(fallback(aptos, USDC_APTOS)).toEqual({ price: 1, decimals: 6 });
  });

  it('picks by llama key among siblings on chains outside the preferred list, whatever the registry order', () => {
    const lookup = lookupOf({ [`abstract:${USDC_ABSTRACT}`]: { price: 1.01, decimals: 6 }, [`0g:${USDC_0G}`]: { price: 0.99, decimals: 6 } });
    const forward = groupFallback(buildTokenGroupIndex([usdcAptos, usdcAbstract, usdc0g]), lookup);
    const backward = groupFallback(buildTokenGroupIndex([usdc0g, usdcAbstract, usdcAptos]), lookup);
    expect(forward(aptos, USDC_APTOS)).toEqual({ price: 0.99, decimals: 6 });
    expect(backward(aptos, USDC_APTOS)).toEqual({ price: 0.99, decimals: 6 });
  });

  it('skips siblings without a price and takes the next one in order', () => {
    const lookup = lookupOf({ [`bsc:${USDC_BSC}`]: { price: 0.98, decimals: 18 } });
    const fallback = groupFallback(buildTokenGroupIndex([usdcAptos, usdcBsc, usdcArb]), lookup);
    expect(fallback(aptos, USDC_APTOS)).toEqual({ price: 0.98, decimals: 6 });
  });
});

describe('siblingKeys', () => {
  it('lists the other group members that have a llama key, preferred chains first, then by key', () => {
    const index = buildTokenGroupIndex([usdcAbstract, usdcBsc, usdcAptos, usdc0g, usdcEth, usdcArb]);
    expect(siblingKeys(index, ethereum.selector, USDC_ETH)).toEqual([
      `arbitrum:${USDC_ARB}`, `bsc:${USDC_BSC}`, `0g:${USDC_0G}`, `abstract:${USDC_ABSTRACT}`,
    ]);
    expect(siblingKeys(index, aptos.selector, USDC_APTOS)).toEqual([
      `ethereum:${USDC_ETH}`, `arbitrum:${USDC_ARB}`, `bsc:${USDC_BSC}`, `0g:${USDC_0G}`, `abstract:${USDC_ABSTRACT}`,
    ]);
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
    expect(fallbackKeys(index, tokens, lookup)).toEqual([`ethereum:${USDC_ETH}`, `arbitrum:${USDC_ARB}`, `bsc:${USDC_BSC}`]);
  });

  it('is empty when every token has its own price', () => {
    const index = buildTokenGroupIndex([usdcEth, usdcBsc]);
    const lookup = lookupOf({ [`ethereum:${USDC_ETH}`]: { price: 1, decimals: 6 } });
    expect(fallbackKeys(index, fiveUsdc(ethereum, USDC_ETH), lookup)).toEqual([]);
  });
});

describe('lacksOwnPrice', () => {
  const lookup = lookupOf({ [`ethereum:${USDC_ETH}`]: { price: 1, decimals: 6 } });

  it('is false for a token whose own key has a price', () => {
    expect(lacksOwnPrice(fiveUsdc(ethereum, USDC_ETH)[0]!, lookup)).toBe(false);
  });

  it('is true for a token whose own key has no price, or that has no key', () => {
    expect([lacksOwnPrice(fiveUsdc(bsc, USDC_BSC)[0]!, lookup), lacksOwnPrice(fiveUsdc(aptos, USDC_APTOS)[0]!, lookup)]).toEqual([true, true]);
  });
});

describe('groupFallback with CoinGecko coin ids', () => {
  const COIN_KEY = 'coingecko:usd-coin';
  const coinIds = (ids: Record<string, string>): CoingeckoIdLookup => (chain, address) => ids[`${chain.selector}|${address}`];
  const usdcCoin = coinIds({
    [`${aptos.selector}|${USDC_APTOS}`]: 'usd-coin',
    [`${ethereum.selector}|${USDC_ETH}`]: 'usd-coin',
    [`${ethereum.selector}|${LONE}`]: 'usd-coin',
  });
  const coinAt = (price: number) => ({ [COIN_KEY]: { price, decimals: COIN_PRICE_DECIMALS } });

  it('prices a token that neither its own key nor a sibling prices from its coin, with its registry decimals', () => {
    const index = buildTokenGroupIndex([usdcAptos, usdcBsc]);
    const lookup = lookupOf(coinAt(2));
    const v = valueTokens(fiveUsdc(aptos, USDC_APTOS), lookup, groupFallback(index, lookup, { coingeckoIdOf: usdcCoin }));
    expect(v).toEqual({ usdValue: 10, unpriced: false, tokenUsd: [10] });
  });

  it('prefers a sibling\'s price to the coin\'s', () => {
    const index = buildTokenGroupIndex([usdcAptos, usdcBsc]);
    const lookup = lookupOf({ [`bsc:${USDC_BSC}`]: { price: 1, decimals: 18 }, ...coinAt(50) });
    expect(groupFallback(index, lookup, { coingeckoIdOf: usdcCoin })(aptos, USDC_APTOS)).toEqual({ price: 1, decimals: 6 });
  });

  it('keeps the token\'s own price over both', () => {
    const index = buildTokenGroupIndex([usdcEth, usdcBsc]);
    const lookup = lookupOf({
      [`ethereum:${USDC_ETH}`]: { price: 1, decimals: 6 },
      [`bsc:${USDC_BSC}`]: { price: 30, decimals: 18 },
      ...coinAt(50),
    });
    expect(valueTokens(fiveUsdc(ethereum, USDC_ETH), lookup, groupFallback(index, lookup, { coingeckoIdOf: usdcCoin })).usdValue).toBe(5);
  });

  it('prices a registry token without a group from its coin, with its registry decimals', () => {
    const index = buildTokenGroupIndex([entry(ethereum, LONE, 6, null)]);
    const fallback = groupFallback(index, lookupOf(coinAt(2)), { coingeckoIdOf: usdcCoin, decimalsOf: () => 18 });
    expect(fallback(ethereum, LONE)).toEqual({ price: 2, decimals: 6 });
  });

  it('values a token outside the registry with the decimals DefiLlama gives its own key', () => {
    const decimalsOf = (key: string) => (key === `ethereum:${LONE}` ? 6 : undefined);
    const fallback = groupFallback(buildTokenGroupIndex([]), lookupOf(coinAt(2)), { coingeckoIdOf: usdcCoin, decimalsOf });
    expect(fallback(ethereum, LONE)).toEqual({ price: 2, decimals: 6 });
  });

  it('leaves a token unpriced when neither the registry nor DefiLlama knows its decimals', () => {
    const fallback = groupFallback(buildTokenGroupIndex([]), lookupOf(coinAt(2)), { coingeckoIdOf: usdcCoin, decimalsOf: () => undefined });
    expect(fallback(ethereum, LONE)).toBeUndefined();
  });

  it('leaves a token unpriced when its coin has no price, or it has no coin', () => {
    const index = buildTokenGroupIndex([usdcAptos, entry(ethereum, LONE, 6, null)]);
    expect(groupFallback(index, lookupOf({}), { coingeckoIdOf: usdcCoin })(aptos, USDC_APTOS)).toBeUndefined();
    expect(groupFallback(index, lookupOf(coinAt(2)), { coingeckoIdOf: coinIds({}) })(ethereum, LONE)).toBeUndefined();
  });
});

describe('coingeckoKeys', () => {
  it('lists, once each, the coin keys of the tokens that neither their own key nor a sibling prices', () => {
    const index = buildTokenGroupIndex([usdcEth, usdcBsc, usdcArb, usdcAptos]);
    const lookup = lookupOf({ [`arbitrum:${USDC_ARB}`]: { price: 1, decimals: 6 } });
    const coinIdOf: CoingeckoIdLookup = (_chain, address) => (address === LONE ? 'lone-coin' : 'usd-coin');
    const tokens = [
      ...fiveUsdc(arbitrum, USDC_ARB), ...fiveUsdc(aptos, USDC_APTOS),
      ...fiveUsdc(ethereum, LONE), ...fiveUsdc(base, LONE), ...fiveUsdc(bsc, LONE),
    ];
    expect(coingeckoKeys(index, tokens, lookup, coinIdOf)).toEqual(['coingecko:lone-coin']);
  });
});
