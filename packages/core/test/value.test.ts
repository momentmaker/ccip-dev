import { describe, expect, it } from 'vitest';
import { COIN_PRICE_DECIMALS } from '../src/prices';
import type { ChainRef, NormalizedMessage, PriceInfo, PriceLookup } from '../src/types';
import { MAX_TRANSFER_USD, priceKeys, toUnits, valueFee, valueTokens } from '../src/value';

const base: ChainRef = { selector: '15971525489660198786', name: 'ethereum-mainnet-base-1', chainId: '8453', family: 'EVM' };
const metal: ChainRef = { selector: '13447077090413146373', name: 'metal-mainnet', chainId: '1750', family: 'EVM' };
const TOKEN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const WETH = '0x4200000000000000000000000000000000000006';
const prices: Record<string, PriceInfo> = {
  [`base:${TOKEN}`]: { price: 2, decimals: 18 },
  [`base:${WETH}`]: { price: 2500, decimals: 18 },
};
const lookup: PriceLookup = (key) => prices[key];

describe('toUnits', () => {
  it('scales a 23-digit amount by 18 decimals', () => {
    expect(toUnits('24000580226526875891506', 18)).toBeCloseTo(24000.580226526876, 9);
  });
  it('scales a 27-digit amount by 18 decimals', () => {
    expect(toUnits('123456789012345678901234567', 18)).toBeCloseTo(123456789.01234568, 6);
  });
  it('handles zero, leading zeros and zero decimals', () => {
    expect(toUnits('0', 6)).toBe(0);
    expect(toUnits('000123', 2)).toBeCloseTo(1.23, 12);
    expect(toUnits('42', 0)).toBe(42);
  });
  it('refuses negative decimals, so a coin price\'s placeholder can never scale an amount', () => {
    expect(() => toUnits('1000000', COIN_PRICE_DECIMALS)).toThrow('decimals must be a non-negative integer, got -1');
  });
});

describe('valueTokens', () => {
  it('sums priced tokens', () => {
    const v = valueTokens(
      [
        { chain: base, token: TOKEN, amount: '1500000000000000000' },
        { chain: base, token: TOKEN, amount: '500000000000000000' },
      ],
      lookup,
    );
    expect(v).toEqual({ usdValue: 4, unpriced: false, tokenUsd: [3, 1], outliers: [] });
  });

  it('values unpriced tokens at zero and flags the message', () => {
    const v = valueTokens(
      [
        { chain: base, token: TOKEN, amount: '1000000000000000000' },
        { chain: metal, token: TOKEN, amount: '1000000000000000000' },
      ],
      lookup,
    );
    expect(v).toEqual({ usdValue: 2, unpriced: true, tokenUsd: [2, null], outliers: [] });
  });

  it('returns zero for data-only messages', () => {
    expect(valueTokens([], lookup)).toEqual({ usdValue: 0, unpriced: false, tokenUsd: [], outliers: [] });
  });

  it('values a token without a price of its own through the fallback and counts it as priced', () => {
    const fallback = (chain: ChainRef, token: string) => (chain === metal && token === TOKEN ? { price: 3, decimals: 18 } : undefined);
    const v = valueTokens([{ chain: metal, token: TOKEN, amount: '2000000000000000000' }], lookup, fallback);
    expect(v).toEqual({ usdValue: 6, unpriced: false, tokenUsd: [6], outliers: [] });
  });

  it('uses the token\'s own price without consulting the fallback', () => {
    const asked: string[] = [];
    const fallback = (chain: ChainRef, token: string) => {
      asked.push(`${chain.selector}|${token}`);
      return { price: 1000, decimals: 18 };
    };
    const v = valueTokens([{ chain: base, token: TOKEN, amount: '1000000000000000000' }], lookup, fallback);
    expect(v.usdValue).toBe(2);
    expect(asked).toEqual([]);
  });

  it('still flags a token the fallback cannot price', () => {
    const v = valueTokens([{ chain: metal, token: TOKEN, amount: '1' }], lookup, () => undefined);
    expect(v).toEqual({ usdValue: 0, unpriced: true, tokenUsd: [null], outliers: [] });
  });
});

describe('valueTokens above MAX_TRANSFER_USD', () => {
  const units = (n: number) => `${n}000000000000000000`;
  /** A glitched launch-day price like elizaOS's $125,176 on 2025-11-07. */
  const glitched: PriceLookup = (key) => (key === `base:${TOKEN}` ? { price: 125_176.45, decimals: 18 } : prices[key]);

  it('is ten billion dollars', () => {
    expect(MAX_TRANSFER_USD).toBe(1e10);
  });

  it('leaves a token valued above the cap unpriced, flags the message and reports the token\'s llama key', () => {
    const v = valueTokens([{ chain: base, token: TOKEN, amount: units(1_000_000) }, { chain: base, token: WETH, amount: units(2) }], glitched);
    expect(v).toEqual({ usdValue: 5000, unpriced: true, tokenUsd: [null, 5000], outliers: [`base:${TOKEN}`] });
  });

  it('values a token at exactly the cap normally', () => {
    const v = valueTokens([{ chain: base, token: TOKEN, amount: units(5_000_000_000) }], lookup);
    expect(v).toEqual({ usdValue: 1e10, unpriced: false, tokenUsd: [1e10], outliers: [] });
  });

  it('applies to a value the fallback prices, reporting chain:address for a token without a llama key', () => {
    const fallback = () => ({ price: 125_176.45, decimals: 18 });
    const v = valueTokens([{ chain: metal, token: TOKEN, amount: units(1_000_000) }], lookup, fallback);
    expect(v).toEqual({ usdValue: 0, unpriced: true, tokenUsd: [null], outliers: [`${metal.selector}:${TOKEN}`] });
  });
});

describe('valueFee', () => {
  it('prices the fee token on the source chain', () => {
    expect(valueFee({ token: WETH, amount: '106697113670237' }, base, lookup)).toBeCloseTo(0.26674278417559, 10);
  });
  it('returns null without a fee or a price', () => {
    expect(valueFee(null, base, lookup)).toBeNull();
    expect(valueFee({ token: WETH, amount: '1' }, metal, lookup)).toBeNull();
  });
});

describe('valueFee for zero fees and test tokens', () => {
  const ethereum: ChainRef = { selector: '5009297550715157269', name: 'ethereum-mainnet', chainId: '1', family: 'EVM' };
  const TEST_LINK = '0x8aa217dcb84faada02583a7922408b1d623b97c9';

  it('values a zero amount at $0 even for a token nothing prices', () => {
    // #when
    const usd = valueFee({ token: '0xdeadbeef', amount: '0' }, metal, () => undefined);
    // #then
    expect(usd).toBe(0);
  });

  it('values a zero-value test token at $0 without a price', () => {
    // #when
    const usd = valueFee({ token: TEST_LINK, amount: '123456789' }, ethereum, () => undefined);
    // #then
    expect(usd).toBe(0);
  });
});

describe('valueFee through a fee price alias', () => {
  const bitlayer: ChainRef = { selector: '7937294810946806131', name: 'bitcoin-mainnet-bitlayer-1', chainId: '200901', family: 'EVM' };
  const hedera: ChainRef = { selector: '3229138320728879060', name: 'hedera-mainnet', chainId: '295', family: 'EVM' };
  const WBTC = '0xff204e2681a6fa0e2c3fade68a1b28fb90e4fc5f';
  const WHBAR = '0xb1f616b8134f602c3bb465fb5b5e6565ccad37ed';
  const coins: Record<string, PriceInfo> = {
    'coingecko:bitcoin': { price: 80_000, decimals: COIN_PRICE_DECIMALS },
    'coingecko:hedera-hashgraph': { price: 0.09, decimals: COIN_PRICE_DECIMALS },
  };
  const coinLookup: PriceLookup = (key) => coins[key];

  it('prices a fee token without a price of its own as the coin it wraps', () => {
    // #when
    const usd = valueFee({ token: WBTC, amount: '1000000000000000' }, bitlayer, coinLookup);
    // #then
    expect(usd).toBeCloseTo(80, 10);
  });

  it('scales the amount by the alias decimals, not 18', () => {
    // #when
    const usd = valueFee({ token: WHBAR, amount: '250000000' }, hedera, coinLookup);
    // #then
    expect(usd).toBeCloseTo(0.225, 12);
  });

  it("prefers the token's own price when both are priced", () => {
    // #given
    const both: PriceLookup = (key) => (key === `bitlayer:${WBTC}` ? { price: 1, decimals: 18 } : coins[key]);
    // #when
    const usd = valueFee({ token: WBTC, amount: '1000000000000000000' }, bitlayer, both);
    // #then
    expect(usd).toBe(1);
  });

  it.each([
    ['Mind WETH as ETH', '11690709103138290329', '0x3902228d6a3d2dc44731fd9d45fee6a61c722d0b', 'coingecko:ethereum', '1000000000000000000', 2500],
    ['Aptos LINK at 8 decimals', '4741433654826277614', '0x8c764993820ea735719f1ff7f1a0f80c022b18e7b5daefa35adf60a3a6556566', 'coingecko:chainlink', '250000000', 25],
    ['Corn WBTCN as BTC', '9043146809313071210', '0xda5ddd7270381a7c2717ad10d1c0ecb19e3cdfb2', 'coingecko:bitcoin', '1000000000000000', 80],
  ])('prices %s through its alias', (_label, selector, token, key, amount, expected) => {
    // #given
    const chain = { selector, name: 'x', chainId: '1', family: 'EVM' } as ChainRef;
    const coinPrices: Record<string, PriceInfo> = { 'coingecko:ethereum': { price: 2500, decimals: COIN_PRICE_DECIMALS }, 'coingecko:chainlink': { price: 10, decimals: COIN_PRICE_DECIMALS }, 'coingecko:bitcoin': { price: 80_000, decimals: COIN_PRICE_DECIMALS } };
    // #when
    const usd = valueFee({ token, amount }, chain, (k) => coinPrices[k]);
    // #then
    expect(usd).toBeCloseTo(expected, 10);
  });

  it('returns null when neither the token nor its coin is priced', () => {
    // #when
    const usd = valueFee({ token: WBTC, amount: '1000000000000000000' }, bitlayer, () => undefined);
    // #then
    expect(usd).toBeNull();
  });

  it("includes the alias coin's key in the message's price keys", () => {
    // #given
    const m = { src: bitlayer, tokens: [], fee: { token: WBTC, amount: '1' } } as unknown as NormalizedMessage;
    // #when
    const keys = priceKeys(m);
    // #then
    expect(keys).toEqual([`bitlayer:${WBTC}`, 'coingecko:bitcoin']);
  });
});

describe('priceKeys', () => {
  it('collects unique keys for tokens and the fee, skipping chains DefiLlama does not price', () => {
    const m = {
      src: base,
      tokens: [
        { chain: base, token: TOKEN, amount: '1' },
        { chain: base, token: TOKEN, amount: '2' },
        { chain: metal, token: TOKEN, amount: '3' },
      ],
      fee: { token: WETH, amount: '1' },
    } as NormalizedMessage;
    expect(priceKeys(m)).toEqual([`base:${TOKEN}`, `base:${WETH}`]);
  });
});

describe('valueFee for Canton and Mova', () => {
  const canton: ChainRef = { selector: '2308837218439511688', name: 'canton-mainnet', chainId: 'canton', family: 'CANTON' };
  const mova: ChainRef = { selector: '4215185756725900654', name: 'mova-mainnet', chainId: '61900', family: 'EVM' };
  const coins: PriceLookup = (key) =>
    ({ 'coingecko:canton-network': { price: 0.1163, decimals: COIN_PRICE_DECIMALS }, 'coingecko:mova-2': { price: 0.05, decimals: COIN_PRICE_DECIMALS } })[key];

  it('values Canton CC at 10 decimals', () => {
    const cc = '0xd573c85e64a85bc81e99641d37b160febc1581c724255604ce45ef2f99f6628b';
    expect(valueFee({ token: cc, amount: '33999999999' }, canton, coins)).toBeCloseTo(3.4 * 0.1163, 9);
  });

  it('values Mova WMOVA at 18 decimals', () => {
    expect(valueFee({ token: '0x911fcc80f48340864f5f94ae9a73d6296d5c2115', amount: '1840000000000000000' }, mova, coins)).toBeCloseTo(1.84 * 0.05, 9);
  });
});
