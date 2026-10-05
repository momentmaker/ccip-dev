import { describe, expect, it } from 'vitest';
import type { ChainRef, NormalizedMessage, PriceInfo, PriceLookup } from '../src/types';
import { priceKeys, toUnits, valueFee, valueTokens } from '../src/value';

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
    expect(v).toEqual({ usdValue: 4, unpriced: false, tokenUsd: [3, 1] });
  });

  it('values unpriced tokens at zero and flags the message', () => {
    const v = valueTokens(
      [
        { chain: base, token: TOKEN, amount: '1000000000000000000' },
        { chain: metal, token: TOKEN, amount: '1000000000000000000' },
      ],
      lookup,
    );
    expect(v).toEqual({ usdValue: 2, unpriced: true, tokenUsd: [2, null] });
  });

  it('returns zero for data-only messages', () => {
    expect(valueTokens([], lookup)).toEqual({ usdValue: 0, unpriced: false, tokenUsd: [] });
  });

  it('values a token without a price of its own through the fallback and counts it as priced', () => {
    const fallback = (chain: ChainRef, token: string) => (chain === metal && token === TOKEN ? { price: 3, decimals: 18 } : undefined);
    const v = valueTokens([{ chain: metal, token: TOKEN, amount: '2000000000000000000' }], lookup, fallback);
    expect(v).toEqual({ usdValue: 6, unpriced: false, tokenUsd: [6] });
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
    expect(v).toEqual({ usdValue: 0, unpriced: true, tokenUsd: [null] });
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
