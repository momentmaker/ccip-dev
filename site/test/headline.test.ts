import type { TodayFile } from '@ccip-dev/core/public';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Headline from '../src/components/home/Headline';
import type { HeroFees } from '../src/lib/fee-revenue';
import todayJson from './fixtures/today.json';

const fixture = todayJson as unknown as TodayFile;
const today = (fee_usd: number | null): TodayFile => ({ ...fixture, totals: { ...fixture.totals, messages: 470, usd_value: 14.6e6, fee_usd } });
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'");
const render = (props: Parameters<typeof Headline>[0]) => renderToString(createElement(Headline, props));

describe('Headline fees', () => {
  it("adds today's fees to the hero line", () => {
    // #given
    const html = render({ today: today(807.98), yesterday: null, animate: false });

    // #then
    expect(text(html)).toContain('messages · $14.6M movedⓘ · $808 fees');
  });

  it("links today's fees to the Reserve page", () => {
    // #given
    const html = render({ today: today(807.98), yesterday: null, animate: false });

    // #then
    expect(html).toMatch(/<a[^>]*href="\/reserve\/"[^>]*>.*\$808.*<\/a>/);
  });

  it('leaves fees out of the hero line while none are known yet', () => {
    // #given
    const html = render({ today: today(null), yesterday: null, animate: false });

    // #then
    expect(text(html)).not.toContain('fees');
  });

  it("adds yesterday's fees to the yesterday line", () => {
    // #given
    const html = render({ today: today(807.98), yesterday: { messages: 2795, usd_value: 58.6e6, fee_usd: 1538.19 }, animate: false });

    // #then
    expect(text(html)).toContain('Yesterday: 2,795 messages · $58.6M · $1.5K fees');
  });

  it('keeps the yesterday line without fees when that day has none', () => {
    // #given
    const html = render({ today: today(807.98), yesterday: { messages: 1121, usd_value: 9e6, fee_usd: null }, animate: false });

    // #then
    expect(text(html)).toMatch(/Yesterday: 1,121 messages · \$9\.0M(?! · )/);
  });
});

describe('Headline all-time fees', () => {
  const allTime = (over: Partial<HeroFees> = {}): HeroFees => ({ usd: 2_345_678, runRateUsd: 1_234_567, since: null, ...over });
  const yesterday = { messages: 2795, usd_value: 58.6e6, fee_usd: 1538.19 };

  it('adds the all-time fees and the 30-day run-rate under the yesterday line', () => {
    // #given
    const html = render({ today: today(807.98), yesterday, animate: false, allTime: allTime() });
    // #then
    expect(text(html)).toMatch(/Yesterday: .*All-time fees: \$2\.3M · \$1\.2M\/yr at the 30-day pace →/);
  });

  it('links the line to the fee records', () => {
    // #given
    const html = render({ today: today(807.98), yesterday, animate: false, allTime: allTime() });
    // #then
    expect(html).toMatch(/<a[^>]*href="\/records\/#fees"[^>]*>All-time fees/);
  });

  it('reads "since" the first fee day while fee coverage starts after 2023-07-06', () => {
    const html = render({ today: today(807.98), yesterday, animate: false, allTime: allTime({ since: '2026-10-05' }) });
    expect(text(html)).toContain('Fees since Oct 5, 2026: $2.3M');
  });

  it('leaves the run-rate out while fewer than 30 days have fees', () => {
    const html = render({ today: today(807.98), yesterday, animate: false, allTime: allTime({ runRateUsd: null }) });
    expect(text(html)).toMatch(/All-time fees: \$2\.3M →(?!.*\/yr)/);
  });

  it('shows no all-time line without fee history', () => {
    const html = render({ today: today(807.98), yesterday, animate: false, allTime: null });
    expect(text(html)).not.toContain('All-time');
  });
});
