import { describe, expect, it } from 'vitest';
import { cashtags, oneCashtag } from '../src/broadcasts/x-length';

describe('X cashtags', () => {
  it('finds what X counts as a cashtag: $ and 1–6 letters, never an amount or a longer word', () => {
    // #then
    expect(cashtags('$LINK · $USDC.e · $6.1M · $syrupUSDC · a$BTC · ($ETH)')).toEqual(['$LINK', '$USDC.e', '$ETH']);
  });

  it('keeps $LINK and writes every other cashtag plainly, since X refuses a post with two', () => {
    // #given last night's daily: the top token's cashtag above the fees line's $LINK
    const text = 'Top token: $USDC Circle · $9.2M (41%)\n$1.2K in fees · 3% paid in $LINK';
    // #then
    expect(oneCashtag(text)).toBe('Top token: USDC Circle · $9.2M (41%)\n$1.2K in fees · 3% paid in $LINK');
  });

  it('keeps the first cashtag when $LINK is absent, and leaves a text with one or none alone', () => {
    // #then
    expect([oneCashtag('$USDC then $ETH and $WBTC'), oneCashtag('only $LINK here · $5M'), oneCashtag('$6.1M moved')]).toEqual([
      '$USDC then ETH and WBTC',
      'only $LINK here · $5M',
      '$6.1M moved',
    ]);
  });
});
