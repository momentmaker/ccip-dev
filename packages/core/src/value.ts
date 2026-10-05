import { llamaKey } from './chain-map';
import type { ChainRef, Fee, NormalizedMessage, PriceFallback, PriceLookup, TokenAmount } from './types';

export interface Valuation {
  usdValue: number;
  unpriced: boolean;
  tokenUsd: (number | null)[];
}

export function toUnits(amount: string, decimals: number): number {
  const raw = BigInt(amount);
  const base = 10n ** BigInt(decimals);
  return Number(raw / base) + Number(raw % base) / Number(base);
}

/** `fallback` prices a token that has no price of its own; a token it prices counts as priced. */
export function valueTokens(tokens: TokenAmount[], lookup: PriceLookup, fallback?: PriceFallback): Valuation {
  let usdValue = 0;
  let unpriced = false;
  const tokenUsd: (number | null)[] = [];
  for (const t of tokens) {
    const key = llamaKey(t.chain, t.token);
    const info = (key ? lookup(key) : undefined) ?? fallback?.(t.chain.selector, t.token);
    if (!info) {
      unpriced = true;
      tokenUsd.push(null);
      continue;
    }
    const usd = toUnits(t.amount, info.decimals) * info.price;
    tokenUsd.push(usd);
    usdValue += usd;
  }
  return { usdValue, unpriced, tokenUsd };
}

export function valueFee(fee: Fee | null, chain: ChainRef, lookup: PriceLookup): number | null {
  if (!fee) return null;
  const key = llamaKey(chain, fee.token);
  const info = key ? lookup(key) : undefined;
  return info ? toUnits(fee.amount, info.decimals) * info.price : null;
}

export function priceKeys(m: NormalizedMessage): string[] {
  const keys = new Set<string>();
  for (const t of m.tokens) {
    const key = llamaKey(t.chain, t.token);
    if (key) keys.add(key);
  }
  if (m.fee) {
    const key = llamaKey(m.src, m.fee.token);
    if (key) keys.add(key);
  }
  return [...keys];
}
