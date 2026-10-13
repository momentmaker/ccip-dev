import type { MonthSummary } from '@ccip-dev/core/month';
import { describe, expect, it } from 'vitest';
import { TELEGRAM_CAPTION_MAX, X_MAX } from '../src/broadcasts/copy';
import type { MonthlyFacts } from '../src/broadcasts/monthly';
import { composeMonthlyCopy } from '../src/broadcasts/monthly-copy';
import { xLength } from '../src/broadcasts/x-length';

const LINKLIKE = /\b[a-z0-9-]+\.[a-z]{2,}\b/i;
const chain = (selector: string, name: string) => ({ selector, name });
const record = (kind: MonthSummary['records'][number]['kind'], day: string, value: number) => ({ kind, day, value, previous: { day: '2026-09-01', value: 1 }, stoodDays: 30 });

const OCTOBER: MonthSummary = {
  month: '2026-10',
  label: 'October 2026',
  messages: 47_210,
  usd: 1_249_000_000,
  fees: 64_321,
  linkSharePct: 38.2,
  records: [record('messages', '2026-10-14', 1_800), record('value', '2026-10-20', 90_100_000)],
  joined: [chain('1', 'Gravity'), chain('2', 'Tempo')],
  busiestLane: { key: '3>4', src: chain('3', 'Ethereum'), dst: chain('4', 'Base'), usd: 310_200_000 },
};
const facts = (summary: Partial<MonthSummary> = {}): MonthlyFacts => ({ kind: 'monthly', month: '2026-10', summary: { ...OCTOBER, ...summary } });

describe('composeMonthlyCopy', () => {
  it('writes the X post as the spec shows it, with the value rounded down as the video counts it', () => {
    // #when
    const { xText } = composeMonthlyCopy(facts());
    // #then
    expect(xText).toBe(['🎬 CCIP in October 2026', '47,210 messages · $1.2B moved · $64.3K in fees', 'New on CCIP: Gravity, Tempo', '#CCIP #Chainlink $LINK'].join('\n'));
  });

  it('writes the Telegram caption in sentences with bold numbers, the records set that month and the busiest lane', () => {
    // #when
    const { telegramHtml } = composeMonthlyCopy(facts());
    // #then
    expect(telegramHtml).toBe(
      [
        '<b>🎬 CCIP in October 2026</b>',
        'In October, <b>47,210</b> CCIP messages moved <b>$1.2B</b>.',
        'Senders paid <b>$64.3K</b> in fees, <b>38%</b> of it in LINK.',
        'New on CCIP: Gravity and Tempo.',
        'New all-time highs: <b>1,800</b> messages in one day (Oct 14); <b>$90.1M</b> moved in one day (Oct 20).',
        'Busiest lane: Ethereum → Base, with <b>$310.2M</b> moved.',
        '',
        '#CCIP #Chainlink $LINK',
      ].join('\n'),
    );
  });

  it('leaves out the fees, the arrivals, the records and the lane when the month has none', () => {
    // #when
    const copy = composeMonthlyCopy(facts({ fees: null, linkSharePct: null, records: [], joined: [], busiestLane: null }));
    // #then
    expect(copy).toEqual({
      xText: '🎬 CCIP in October 2026\n47,210 messages · $1.2B moved\n#CCIP #Chainlink $LINK',
      telegramHtml: '<b>🎬 CCIP in October 2026</b>\nIn October, <b>47,210</b> CCIP messages moved <b>$1.2B</b>.\n\n#CCIP #Chainlink $LINK',
    });
  });

  it('drops the New on CCIP line first when the X post is too long, and keeps the hashtags', () => {
    // #given 30 new chains with long names
    const joined = Array.from({ length: 30 }, (_, i) => chain(String(i), `Very Long Chain Name ${i}`));
    // #when
    const copy = composeMonthlyCopy(facts({ joined }));
    // #then
    expect({ x: copy.xText, xFits: xLength(copy.xText) <= X_MAX, tgFits: copy.telegramHtml.length <= TELEGRAM_CAPTION_MAX }).toEqual({
      x: '🎬 CCIP in October 2026\n47,210 messages · $1.2B moved · $64.3K in fees\n#CCIP #Chainlink $LINK',
      xFits: true,
      tgFits: true,
    });
  });

  it('never mentions anyone or links anything, even for a chain named like a handle or a domain', () => {
    // #when
    const copy = composeMonthlyCopy(facts({ joined: [chain('1', '@scam'), chain('2', 'pump.fun')], busiestLane: { ...OCTOBER.busiestLane!, src: chain('5', 'claim.io') } }));
    // #then
    expect([copy.xText, copy.telegramHtml].map((t) => ({ at: /@[A-Za-z0-9_]/.test(t), link: LINKLIKE.test(t) || t.includes('://') }))).toEqual([
      { at: false, link: false },
      { at: false, link: false },
    ]);
  });
});
