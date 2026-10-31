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
    ['staking', { kind: 'staking' }],
    ['staker/0x8d87cbd8c3632b7ef117a15f8100943a23b7d03b', { kind: 'staker', address: '0x8d87cbd8c3632b7ef117a15f8100943a23b7d03b' }],
    ['replay', { kind: 'replay' }],
    ['project/xstocks', { kind: 'project', slug: 'xstocks' }],
    ['records', { kind: 'records' }],
    ['broadcast/daily/2026-10-10', { kind: 'broadcast', target: { kind: 'daily', day: '2026-10-10' } }],
    ['broadcast/weekly/2026-10-05', { kind: 'broadcast', target: { kind: 'weekly', monday: '2026-10-05' } }],
    ['broadcast/record/fees/2026-07-09', { kind: 'broadcast', target: { kind: 'record', record: 'fees', day: '2026-07-09' } }],
    ['broadcast/milestone/messages/1000000', { kind: 'broadcast', target: { kind: 'milestone', metric: 'messages', threshold: 1_000_000 } }],
    [`broadcast/reserve/0x${'ab'.repeat(32)}`, { kind: 'broadcast', target: { kind: 'reserve', tx: `0x${'ab'.repeat(32)}` } }],
    ['broadcast/welcome/7281642695469137430', { kind: 'broadcast', target: { kind: 'welcome', selector: '7281642695469137430' } }],
    ['broadcast/countdown/fees/2500000', { kind: 'broadcast', target: { kind: 'countdown', metric: 'fees', threshold: 2_500_000 } }],
    ['broadcast/poll/2026-10-12', { kind: 'broadcast', target: { kind: 'poll', monday: '2026-10-12' } }],
    ['broadcast/movers/2026-10-05', { kind: 'broadcast', target: { kind: 'movers', monday: '2026-10-05' } }],
    ['broadcast/spotlight/2026-10-05', { kind: 'broadcast', target: { kind: 'spotlight', monday: '2026-10-05' } }],
    ['broadcast/roundup/2026-10-05', { kind: 'broadcast', target: { kind: 'roundup', monday: '2026-10-05' } }],
    ['broadcast/project/2026-10-05', { kind: 'broadcast', target: { kind: 'project', monday: '2026-10-05' } }],
    ['broadcast/newcomer/project/xstocks', { kind: 'broadcast', target: { kind: 'newcomer', key: 'project:xstocks' } }],
    ['broadcast/staking/2026-10-26', { kind: 'broadcast', target: { kind: 'staking', monday: '2026-10-26' } }],
    [
      'broadcast/operator/0x8d87cbd8c3632b7ef117a15f8100943a23b7d03b/1793000000',
      { kind: 'broadcast', target: { kind: 'operator', address: '0x8d87cbd8c3632b7ef117a15f8100943a23b7d03b', at: 1_793_000_000 } },
    ],
  ] as [string, CardRoute][])('parses %s and prints it back', (path, route) => {
    expect(parseCardPath(path)).toEqual(route);
    expect(cardPathOf(route)).toBe(path);
  });

  it.each(['', 'day/2026-02-30', 'day/../../x', 'top/route/7d', 'top/token/7d/fees', 'top/lane/7d/value', 'top/lane/7d/fees/x', 'top/token/1y', 'history/7d', 'flow', 'home/extra', 'broadcast', 'broadcast/monthly/2026-10-10', 'broadcast/weekly/2026-10-06', 'broadcast/poll/2026-10-13', 'broadcast/welcome/base', 'project/XStocks', 'project/a/b', 'project', 'staker/0x8D87cbd8c3632b7ef117a15f8100943a23b7d03b', 'staker/0x12'])('rejects %j', (path) => {
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
