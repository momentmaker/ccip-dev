import { describe, expect, it } from 'vitest';
import { displaySlug, matchIcon } from '../scripts/chain-icons/match';

const chain = (name: string, display_name: string | null = name) => ({ name, display_name });

describe('displaySlug', () => {
  it('lowercases, drops a trailing " Mainnet" and hyphenates spaces', () => {
    expect(displaySlug('BNB Chain Mainnet')).toBe('bnb-chain');
    expect(displaySlug('Henesys')).toBe('henesys');
  });
});

describe('matchIcon', () => {
  it('prefers the exact chain name', () => {
    expect(matchIcon(chain('ethereum-mainnet-base-1'), new Set(['ethereum-mainnet-base-1', 'base']), {})).toEqual({ slug: 'ethereum-mainnet-base-1', rule: 'exact' });
  });

  it('uses the child segment of <parent>-mainnet-<x>-<n>', () => {
    expect(matchIcon(chain('ethereum-mainnet-arbitrum-1'), new Set(['ethereum', 'arbitrum']), {})).toEqual({ slug: 'arbitrum', rule: 'child' });
  });

  it('uses the child segment without a trailing number', () => {
    expect(matchIcon(chain('polygon-mainnet-katana'), new Set(['katana']), {})).toEqual({ slug: 'katana', rule: 'child' });
  });

  it('never gives a child chain its parent icon', () => {
    expect(matchIcon(chain('ethereum-mainnet-polygon-zkevm-1', 'Polygon zkEVM'), new Set(['ethereum', 'polygon']), {})).toEqual({ slug: null, rule: 'none' });
  });

  it('uses the stem of <x>-mainnet', () => {
    expect(matchIcon(chain('avalanche-mainnet'), new Set(['avalanche']), {})).toEqual({ slug: 'avalanche', rule: 'stem' });
  });

  it('falls back to the display name', () => {
    expect(matchIcon(chain('binance_smart_chain-mainnet', 'BNB Chain Mainnet'), new Set(['bnb-chain']), {})).toEqual({ slug: 'bnb-chain', rule: 'display' });
  });

  it('applies an override to a slug', () => {
    expect(matchIcon(chain('mind-mainnet'), new Set(['mindnetwork', 'mind']), { 'mind-mainnet': 'mindnetwork' })).toEqual({ slug: 'mindnetwork', rule: 'override' });
  });

  it('applies an override to null as a forced lettermark', () => {
    expect(matchIcon(chain('avalanche-mainnet'), new Set(['avalanche']), { 'avalanche-mainnet': null })).toEqual({ slug: null, rule: 'none' });
  });

  it('throws when an override names an icon the docs do not have', () => {
    expect(() => matchIcon(chain('mind-mainnet'), new Set(['mind']), { 'mind-mainnet': 'mindnetwork' })).toThrow('mind-mainnet');
  });

  it('reports no match', () => {
    expect(matchIcon(chain('sui-mainnet'), new Set(['solana']), {})).toEqual({ slug: null, rule: 'none' });
  });

  it('skips the display rule when the chain has no display name', () => {
    expect(matchIcon(chain('zz-mainnet-x', null), new Set(['zz']), {})).toEqual({ slug: null, rule: 'none' });
  });
});
