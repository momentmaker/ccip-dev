import { decodePegReading, pegLiveBody, type PegLiveBody, type PegOpen } from '@ccip-dev/core';
import { PEG_LIVE_WORDS } from '@ccip-dev/core/testing';
import { describe, expect, it } from 'vitest';
import { linkText, pctText, pegAlertText, pegRouteLine, utcStamp } from '../src/peg-copy';

const BASE = pegLiveBody(decodePegReading(PEG_LIVE_WORDS.map((w) => BigInt(w))));
const live = (over: Partial<PegLiveBody> & { discountOver?: Partial<PegLiveBody['discount']> } = {}): PegLiveBody => ({
  ...BASE,
  ...over,
  discount: { ...BASE.discount, ...over.discountOver },
});
const OPEN: PegOpen = { side: 'discount', openedAt: '2026-11-18T00:00:00.000Z', peakGap: -0.0091, peakAt: '2026-11-18T01:10:00.000Z', tier: 0, public: false };
const OPTS = { publicLine: 0.0075, publicPosts: true, bestSize: 38_000, now: new Date('2026-11-18T03:20:00.000Z') };

describe('formats', () => {
  it('writes times, gaps and amounts the way the alerts read', () => {
    expect(utcStamp('2026-11-18T15:50:11.000Z')).toBe('Nov 18 15:50 UTC');
    expect(pctText(-0.0084)).toBe('0.84%');
    expect(linkText(17.88)).toBe('17.9');
    expect(linkText(38_000)).toBe('38,000');
  });
});

describe('pegAlertText', () => {
  const discount = live({ spot: 0.9916, gap: -0.0084, discountOver: { depth: 25_000, profit: 61.5, instant: 17.88, tradeable: 17.88, tradeable_profit: 0.15, queued_ahead: 0 } });

  it('opens with the gap, the Curve depth, the redeem route, what trades now and the link', () => {
    expect(pegAlertText({ kind: 'opened', episode: OPEN }, discount, OPTS)).toBe(
      [
        'stLINK at a 0.84% discount (1 stLINK = 0.9916 LINK)',
        'Curve: buying stLINK beats 1:1 up to 25,000 LINK (+61.50 LINK at that size)',
        'Redeem at 1:1: 17.9 LINK instant; the rest queues behind 0.0 stLINK, next payout after Nov 18 15:50 UTC',
        'Tradeable now: 17.9 LINK for +0.15 LINK',
        'https://ccip.dev/staking/#peg',
      ].join('\n'),
    );
  });

  it('says when no Curve size beats 1:1 and no claim window is open', () => {
    const text = pegAlertText({ kind: 'opened', episode: OPEN }, live({ gap: -0.004, spot: 0.996, discountOver: { depth: null, profit: null, tradeable: 0, tradeable_profit: null, claim_window_open: false } }), OPTS);
    expect(text).toContain('Curve: no size beats 1:1 after fees');
    expect(text).toContain('(no claim window open)');
    expect(text).toContain('Tradeable now: none at 1:1 instantly');
  });

  it('describes the mint route for a premium', () => {
    const premium = live({ spot: 1.0254, gap: 0.0254 });
    const text = pegAlertText({ kind: 'opened', episode: { ...OPEN, side: 'premium', peakGap: 0.0254 } }, premium, OPTS);
    expect(text.split('\n')[0]).toBe('stLINK at a 2.54% premium (1 stLINK = 1.0254 LINK)');
    expect(text).toContain('Mint at 1:1: 1,541 LINK instant');
  });

  it('names a crossed tier', () => {
    expect(pegAlertText({ kind: 'tier', episode: OPEN, tier: 0.01 }, discount, OPTS).split('\n')[0]).toBe('stLINK discount past 1%: now 0.84% (1 stLINK = 0.9916 LINK)');
  });

  it('says whether crossing the public line posts to the channel', () => {
    expect(pegAlertText({ kind: 'went_public', episode: OPEN }, discount, OPTS).split('\n')[0]).toBe('stLINK discount past the 0.75% public line: now 0.84%. Posting to the channel.');
    expect(pegAlertText({ kind: 'went_public', episode: OPEN }, discount, { ...OPTS, publicPosts: false }).split('\n')[0]).toBe('stLINK discount past the 0.75% public line: now 0.84%. Public posts are off.');
  });

  it('recaps a close with its length, peak and best size', () => {
    expect(pegAlertText({ kind: 'closed', episode: OPEN, closedAt: '2026-11-18T03:20:00.000Z' }, discount, OPTS)).toBe(
      ['stLINK discount closed after 3h 20m: peak 0.91% at Nov 18 01:10 UTC', 'Best Curve size seen: 38,000 LINK', 'https://ccip.dev/staking/#peg'].join('\n'),
    );
  });
});

describe('pegRouteLine', () => {
  const discount = live({ discountOver: { instant: 17.88, queued_ahead: 0 } });

  it('names the payout time while it is ahead', () => {
    expect(pegRouteLine('discount', discount, new Date('2026-11-18T03:20:00.000Z'))).toContain('next payout after Nov 18 15:50 UTC');
  });

  it('does not name a payout time that has passed', () => {
    const line = pegRouteLine('discount', discount, new Date('2026-11-18T16:00:00.000Z'));
    expect(line).toContain('payout possible in the next claim window');
    expect(line).not.toContain('Nov 18 15:50');
  });
});
