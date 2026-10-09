import { describe, expect, it } from 'vitest';
import { cardPathOf, DEFAULT_CARD_URL, isOgImageUrl, ogImageUrl, parseCardPath, topOrders, type CardRoute } from '../src/lib/card-paths';

describe('card paths', () => {
  it.each([
    ['home', { kind: 'home' }],
    ['daily', { kind: 'daily' }],
    ['day/2026-10-06', { kind: 'day', day: '2026-10-06' }],
    ['history/1y', { kind: 'history', range: '1y' }],
    ['top/token/30d', { kind: 'top', dim: 'token', window: '30d', order: 'value' }],
    ['top/lane/7d/fees', { kind: 'top', dim: 'lane', window: '7d', order: 'fees' }],
    ['top/chain/all', { kind: 'top', dim: 'chain', window: 'all', order: 'value' }],
    ['top/chain/30d/fees', { kind: 'top', dim: 'chain', window: '30d', order: 'fees' }],
    ['flow/all', { kind: 'flow', window: 'all' }],
    ['reserve', { kind: 'reserve' }],
    ['replay', { kind: 'replay' }],
    ['records', { kind: 'records' }],
  ] as [string, CardRoute][])('parses %s and prints it back', (path, route) => {
    expect(parseCardPath(path)).toEqual(route);
    expect(cardPathOf(route)).toBe(path);
  });

  it.each(['', 'day/2026-02-30', 'day/../../x', 'top/route/7d', 'top/token/7d/fees', 'top/lane/7d/value', 'top/lane/7d/fees/x', 'top/token/1y', 'history/7d', 'flow', 'home/extra'])('rejects %j', (path) => {
    expect(parseCardPath(path)).toBeNull();
  });

  it('builds og:image URLs and recognizes only allowed ones', () => {
    expect(ogImageUrl('top/token/30d', '2026-10-07')).toBe('https://ccip.dev/og/top/token/30d.png?v=2026-10-07');
    expect(ogImageUrl(null, '2026-10-07')).toBe(DEFAULT_CARD_URL);
    expect(isOgImageUrl('https://ccip.dev/og/day/2026-10-06.png?v=2026-10-07')).toBe(true);
    expect(isOgImageUrl(DEFAULT_CARD_URL)).toBe(true);
    expect(isOgImageUrl('https://ccip.dev/og/top/route/7d.png?v=2026-10-07')).toBe(false);
    expect(isOgImageUrl('https://ccip.dev/og/top/lane/7d/fees.png?v=2026-10-07')).toBe(true);
    expect(isOgImageUrl('https://ccip.dev/og/home.png')).toBe(false);
  });

  it('parses and formats per-chain replay cards, rejecting unsafe slugs', () => {
    expect(parseCardPath('replay/base')).toEqual({ kind: 'replay-chain', slug: 'base' });
    expect(cardPathOf({ kind: 'replay-chain', slug: 'bnb-chain' })).toBe('replay/bnb-chain');
    expect(parseCardPath('replay/Base')).toBeNull();
    expect(parseCardPath('replay/../x')).toBeNull();
    expect(isOgImageUrl('https://ccip.dev/og/replay/base.png?v=2026-10-06')).toBe(true);
  });

  it.each(['replay/', 'replay/a/b', 'replay/-x', 'replay/x-'])('rejects %j', (path) => {
    expect(parseCardPath(path)).toBeNull();
  });

  it('still parses the plain replay card', () => {
    expect(parseCardPath('replay')).toEqual({ kind: 'replay' });
  });

  it('offers a fee ranking for lanes, senders and chains, but not tokens', () => {
    expect([topOrders('lane'), topOrders('sender'), topOrders('chain'), topOrders('token')]).toEqual([['value', 'fees'], ['value', 'fees'], ['value', 'fees'], ['value']]);
  });
});
