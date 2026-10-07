import { describe, expect, it } from 'vitest';
import { chainSlug, slugMap } from '../src/lib/chain-slug';

const c = (selector: string, display_name: string | null, name: string | null = null) => ({ selector, display_name, name });

describe('chainSlug', () => {
  it.each([
    ['Base Mainnet', 'base'],
    ['BNB Chain Mainnet', 'bnb-chain'],
    ['B^2 Mainnet', 'b-2'],
    ['Polygon zkEVM', 'polygon-zkevm'],
    ['sui-mainnet', 'sui'],
    ['Ünïcode Chain', 'unicode-chain'],
  ])('%s → %s', (display, slug) => {
    expect(chainSlug(c('1', display))).toBe(slug);
  });

  it('falls back to the name, then the selector', () => {
    expect(chainSlug(c('42', null, 'ethereum-mainnet'))).toBe('ethereum');
    expect(chainSlug(c('42', '日本'))).toBe('42');
  });

  it('slugs the displayed name of a registry-only chain', () => {
    expect(chainSlug(c('7', null, 'ethereum-mainnet-kroma-1'))).toBe('kroma');
  });
});

describe('slugMap', () => {
  it('suffixes collisions in selector order and keeps every slug URL-safe', () => {
    const map = slugMap([c('9', 'Mind Mainnet'), c('1', 'Mind Network'), c('5', 'Mind Mainnet')]);
    expect(map.get('5')).toBe('mind');
    expect(map.get('9')).toBe('mind-2');
    expect(map.get('1')).toBe('mind-network');
    for (const s of map.values()) expect(s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it('never hands a suffixed slug to a chain whose natural slug is already that', () => {
    const map = slugMap([c('1', 'Mind'), c('2', 'Mind'), c('3', 'Mind 2')]);
    expect(Object.fromEntries(map)).toEqual({ '1': 'mind', '2': 'mind-3', '3': 'mind-2' });
  });
});
