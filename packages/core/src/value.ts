import { llamaKey } from './chain-map';
import { feePriceAlias, isZeroValueFeeToken } from './fee-aliases';
import type { ChainRef, Fee, NormalizedMessage, PriceFallback, PriceLookup, TokenAmount } from './types';

/**
 * No single CCIP transfer comes near this. A token amount valued above it was priced by a glitched print (elizaOS's
 * $125,176 launch-day point valued single transfers at over $100 billion), so it counts as unpriced instead.
 */
export const MAX_TRANSFER_USD = 1e10;

export interface Valuation {
  usdValue: number;
  unpriced: boolean;
  tokenUsd: (number | null)[];
  /** The tokens valued above MAX_TRANSFER_USD, one entry per amount: the llama key, else `<chain selector>:<address>`. */
  outliers: string[];
}

export function toUnits(amount: string, decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error(`decimals must be a non-negative integer, got ${decimals}`);
  const raw = BigInt(amount);
  const base = 10n ** BigInt(decimals);
  return Number(raw / base) + Number(raw % base) / Number(base);
}

/**
 * `fallback` prices a token that has no price of its own; a token it prices counts as priced. A token valued above
 * MAX_TRANSFER_USD, however it was priced, counts as unpriced and is reported in `outliers`.
 */
export function valueTokens(tokens: TokenAmount[], lookup: PriceLookup, fallback?: PriceFallback): Valuation {
  let usdValue = 0;
  let unpriced = false;
  const tokenUsd: (number | null)[] = [];
  const outliers: string[] = [];
  for (const t of tokens) {
    const key = llamaKey(t.chain, t.token);
    const info = (key ? lookup(key) : undefined) ?? fallback?.(t.chain, t.token);
    if (!info) {
      unpriced = true;
      tokenUsd.push(null);
      continue;
    }
    const usd = toUnits(t.amount, info.decimals) * info.price;
    if (usd > MAX_TRANSFER_USD) {
      outliers.push(key ?? `${t.chain.selector}:${t.token}`);
      unpriced = true;
      tokenUsd.push(null);
      continue;
    }
    tokenUsd.push(usd);
    usdValue += usd;
  }
  return { usdValue, unpriced, tokenUsd, outliers };
}

/**
 * A zero fee and a zero-value test token are worth $0 without a price. Otherwise the token's own price wins; a fee token
 * without one is valued as the coin its alias names, at the alias decimals.
 */
export function valueFee(fee: Fee | null, chain: ChainRef, lookup: PriceLookup): number | null {
  if (!fee) return null;
  if (BigInt(fee.amount) === 0n || isZeroValueFeeToken(chain, fee.token)) return 0;
  const key = llamaKey(chain, fee.token);
  const own = key ? lookup(key) : undefined;
  if (own) return toUnits(fee.amount, own.decimals) * own.price;
  const alias = feePriceAlias(chain, fee.token);
  const coin = alias ? lookup(alias.key) : undefined;
  return alias && coin ? toUnits(fee.amount, alias.decimals) * coin.price : null;
}

/** The keys `valueFee` may read: the fee token's own llama key and its alias coin's key. */
export function feePriceKeys(fee: Fee, chain: ChainRef): string[] {
  const key = llamaKey(chain, fee.token);
  const alias = feePriceAlias(chain, fee.token);
  return [...(key ? [key] : []), ...(alias ? [alias.key] : [])];
}

export function priceKeys(m: NormalizedMessage): string[] {
  const keys = new Set<string>();
  for (const t of m.tokens) {
    const key = llamaKey(t.chain, t.token);
    if (key) keys.add(key);
  }
  if (m.fee) for (const key of feePriceKeys(m.fee, m.src)) keys.add(key);
  return [...keys];
}
