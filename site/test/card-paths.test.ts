import { describe, expect, it } from 'vitest';
import { cardPathOf, DEFAULT_CARD_URL, isOgImageUrl, ogImageUrl, parseCardPath, type CardRoute } from '../src/lib/card-paths';

describe('card paths', () => {
  it.each([
    ['home', { kind: 'home' }],
    ['daily', { kind: 'daily' }],
    ['day/2026-10-06', { kind: 'day', day: '2026-10-06' }],
    ['history/1y', { kind: 'history', range: '1y' }],
    ['top/token/30d', { kind: 'top', dim: 'token', window: '30d' }],
    ['flow/all', { kind: 'flow', window: 'all' }],
    ['reserve', { kind: 'reserve' }],
    ['replay', { kind: 'replay' }],
    ['records', { kind: 'records' }],
  ] as [string, CardRoute][])('parses %s and prints it back', (path, route) => {
    expect(parseCardPath(path)).toEqual(route);
    expect(cardPathOf(route)).toBe(path);
  });

  it.each(['', 'day/2026-02-30', 'day/../../x', 'top/chain/7d', 'top/token/1y', 'history/7d', 'flow', 'home/extra'])('rejects %j', (path) => {
    expect(parseCardPath(path)).toBeNull();
  });

  it('builds og:image URLs and recognizes only allowed ones', () => {
    expect(ogImageUrl('top/token/30d', '2026-10-07')).toBe('https://ccip.dev/og/top/token/30d.png?v=2026-10-07');
    expect(ogImageUrl(null, '2026-10-07')).toBe(DEFAULT_CARD_URL);
    expect(isOgImageUrl('https://ccip.dev/og/day/2026-10-06.png?v=2026-10-07')).toBe(true);
    expect(isOgImageUrl(DEFAULT_CARD_URL)).toBe(true);
    expect(isOgImageUrl('https://ccip.dev/og/top/chain/7d.png?v=2026-10-07')).toBe(false);
    expect(isOgImageUrl('https://ccip.dev/og/home.png')).toBe(false);
  });

  it('parses and formats per-chain replay cards, rejecting unsafe slugs', () => {
    expect(parseCardPath('replay/base')).toEqual({ kind: 'replay-chain', slug: 'base' });
    expect(cardPathOf({ kind: 'replay-chain', slug: 'bnb-chain' })).toBe('replay/bnb-chain');
    expect(parseCardPath('replay/Base')).toBeNull();
    expect(parseCardPath('replay/../x')).toBeNull();
    expect(isOgImageUrl('https://ccip.dev/og/replay/base.png?v=2026-10-06')).toBe(true);
  });
});
